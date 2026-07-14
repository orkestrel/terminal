import type {
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	Parked,
	PasswordOptions,
	PendingPrompt,
	PromptEventMap,
	PromptInterface,
	PromptOptions,
	PromptType,
	SelectOptions,
	TimerHandler,
} from './types.js'
import type { EmitterInterface } from '../emitters/index.js'
import { DEFAULT_PROMPT_TIMEOUT_MS } from './constants.js'
import { TerminalError } from './errors.js'
import { defaultTimer, resolveValidation, serializePromptOptions } from './helpers.js'
import { Emitter } from '../emitters/index.js'
import { isArray, isBoolean, isString } from '../contracts/index.js'

/**
 * The headless prompt BROKER (observable §13) — parks each {@link PromptInterface} call as a
 * pending prompt and returns a Promise that resolves when the prompt is {@link answer}ed (or
 * rejects on timeout / teardown). The tri-surface's headless arm: there is no terminal here, so a
 * transport forwards each `pending` event to whoever can answer, and {@link answer} resolves the
 * parked Promise — for environments where direct user access is unavailable (an MCP server on
 * stdio, a browser with no TTY, a prompt issued on one machine answered on another).
 *
 * @remarks
 * - **Park-as-Promise.** Each `input` / `password` / `confirm` / `select` / `checkbox` / `editor`
 *   mints an id (`crypto.randomUUID()`), parks a wire-safe {@link PendingPrompt}, emits `pending`,
 *   and returns an unresolved Promise. The prompt's options are serialized
 *   ({@link serializePromptOptions}) so a transport can forward them as-is.
 * - **Answer validates + type-checks.** {@link answer} runs the prompt's per-form gate: it
 *   type-checks `value` to the form (string / boolean / string[]) AND, for the text forms, runs
 *   the validator resolved from the original `validate` rules. A rejected answer returns `false`
 *   and the prompt stays `pending`; an accepted answer resolves the Promise, emits `answer`, and
 *   removes the prompt.
 * - **Timeout → expire → reject.** An unanswered prompt expires after `timeout` ms (via the
 *   INJECTED timer): `expire` fires and the parked Promise rejects with a {@link TerminalError}
 *   (`code: 'EXPIRE'`). {@link destroy} expires every still-pending prompt the same way.
 * - **Deterministic.** The timer is injectable ({@link import('./types.js').TimerHandler}); a test
 *   supplies one that fires on demand, so expiry is driven without real time.
 *
 * @example
 * ```ts
 * const prompt = createPrompt({ timeout: 60_000 })
 * prompt.emitter.on('pending', (pending) => broadcast(pending)) // forward to a client
 *
 * const name = await prompt.input({ message: 'Your name' }) // parks; resolves on answer()
 * // ...elsewhere, a client POSTs the answer back:
 * prompt.answer(id, 'Ada') // resolves the awaited input() above
 * ```
 */
export class Prompt implements PromptInterface {
	readonly #timeout: number
	readonly #timer: TimerHandler
	readonly #parked = new Map<string, Parked>()
	readonly #emitter: Emitter<PromptEventMap>
	#destroyed = false

	constructor(options?: PromptOptions) {
		this.#timeout = options?.timeout ?? DEFAULT_PROMPT_TIMEOUT_MS
		this.#timer = options?.timer ?? defaultTimer
		this.#emitter = new Emitter({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<PromptEventMap> {
		return this.#emitter
	}

	get count(): number {
		return this.#parked.size
	}

	// === Pending accessors (§9.1)

	pending(): readonly PendingPrompt[]
	pending(id: string): PendingPrompt | undefined
	pending(id?: string): readonly PendingPrompt[] | PendingPrompt | undefined {
		if (id !== undefined) return this.#parked.get(id)?.prompt
		const result: PendingPrompt[] = []
		for (const parked of this.#parked.values()) result.push(parked.prompt)
		return result
	}

	// === Answer

	answer(id: string, value: unknown): boolean {
		const parked = this.#parked.get(id)
		if (parked === undefined) return false
		// The per-form gate validates + type-checks, and on accept resolves the Promise (it owns the
		// typed `resolve`). It returns the accepted value, or `undefined` to reject the answer.
		const accepted = parked.respond(value)
		if (accepted === undefined) return false
		parked.cancel()
		this.#emitter.emit('answer', id, accepted)
		this.#parked.delete(id)
		return true
	}

	// === PromptFormInterface — each call parks a prompt and awaits its answer

	input(options: InputOptions): Promise<string> {
		const validator = resolveValidation(options.validate)
		return this.#park('input', options.message, options, (value) =>
			isString(value) && validator(value) === true ? value : undefined,
		)
	}

	password(options: PasswordOptions): Promise<string> {
		const validator = resolveValidation(options.validate)
		return this.#park('password', options.message, options, (value) =>
			isString(value) && validator(value) === true ? value : undefined,
		)
	}

	confirm(options: ConfirmOptions): Promise<boolean> {
		return this.#park('confirm', options.message, options, (value) =>
			isBoolean(value) ? value : undefined,
		)
	}

	select(options: SelectOptions): Promise<string> {
		return this.#park('select', options.message, options, (value) =>
			isString(value) ? value : undefined,
		)
	}

	checkbox(options: CheckboxOptions): Promise<readonly string[]> {
		return this.#park('checkbox', options.message, options, (value) =>
			isArray(value) && value.every(isString) ? value : undefined,
		)
	}

	editor(options: EditorOptions): Promise<string> {
		const validator = resolveValidation(options.validate)
		return this.#park('editor', options.message, options, (value) =>
			isString(value) && validator(value) === true ? value : undefined,
		)
	}

	// === Lifecycle

	destroy(): void {
		if (this.#destroyed) return
		this.#destroyed = true
		// Expire every still-pending prompt so no awaiting caller hangs — the full path (cancel +
		// emit `expire` + reject), same as a timeout. Snapshot the ids first (the map mutates).
		for (const id of [...this.#parked.keys()]) this.#expire(id)
		this.#parked.clear()
		this.#emitter.destroy()
	}

	// === Private helpers

	// Park one prompt: build the wire record, arm the injected expiry timer, store the gate-and-resolve
	// closure, emit `pending`, and return the Promise the form method awaits. `gate` is typed to the
	// form's value `T` — it validates + type-checks an answer and returns the coerced `T` (or
	// `undefined` to reject) — so the Promise resolves with the precise type, no assertion anywhere.
	#park<T>(
		form: PromptType,
		message: string,
		options: object,
		gate: (value: unknown) => T | undefined,
	): Promise<T> {
		if (this.#destroyed) return Promise.reject(new TerminalError('EXPIRE', 'broker destroyed'))
		const id = crypto.randomUUID()
		const prompt: PendingPrompt = {
			id,
			form,
			message,
			options: serializePromptOptions(options),
			status: 'pending',
			time: Date.now(),
		}
		return new Promise<T>((resolve, reject) => {
			const cancel = this.#timer(() => this.#expire(id), this.#timeout)
			// The gate-and-resolve closure: re-mark the record `answered`, resolve with the typed value.
			const respond = (value: unknown): T | undefined => {
				const accepted = gate(value)
				if (accepted === undefined) return undefined
				const current = this.#parked.get(id)
				if (current !== undefined) {
					this.#parked.set(id, { ...current, prompt: { ...current.prompt, status: 'answered' } })
				}
				resolve(accepted)
				return accepted
			}
			const expire = (): void => {
				reject(new TerminalError('EXPIRE', `prompt ${id} expired`, { id }))
			}
			this.#parked.set(id, { prompt, respond, expire, cancel })
			this.#emitter.emit('pending', prompt)
		})
	}

	// Expire one parked prompt: cancel its timer, mark it `expired`, emit `expire`, reject its Promise,
	// and drop it. A no-op when the id is already gone (answered / already expired).
	#expire(id: string): void {
		const parked = this.#parked.get(id)
		if (parked === undefined) return
		parked.cancel()
		this.#parked.set(id, { ...parked, prompt: { ...parked.prompt, status: 'expired' } })
		this.#emitter.emit('expire', id)
		this.#parked.delete(id)
		parked.expire()
	}
}
