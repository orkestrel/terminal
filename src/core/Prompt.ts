import type {
	AnswerResult,
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	Parked,
	ParkRequest,
	PasswordOptions,
	PendingPrompt,
	PromptEventMap,
	PromptFormOptions,
	PromptInterface,
	PromptOptions,
	PromptType,
	PromptValue,
	SelectOptions,
	Ticket,
	TimerHandler,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { DEFAULT_PROMPT_TIMEOUT_MS } from './constants.js'
import { TerminalError } from './errors.js'
import {
	defaultTimer,
	normalizeCheckboxChoice,
	normalizeChoice,
	resolveValidation,
	serializePromptOptions,
} from './helpers.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray, isBoolean, isString } from '@orkestrel/contract'

/**
 * The headless prompt BROKER (observable §13) — parks each {@link PromptInterface} call as a
 * pending prompt and returns a Promise that resolves when the prompt is {@link answer}ed (or
 * rejects on timeout / teardown). The tri-surface's headless arm: there is no terminal here, so a
 * transport forwards each `pending` event to whoever can answer, and {@link answer} resolves the
 * parked Promise — for environments where direct user access is unavailable (a headless server on
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

	answer(id: string, value: unknown): AnswerResult {
		const parked = this.#parked.get(id)
		if (parked === undefined) return { success: false, error: 'unknown' }
		// The per-form gate validates + type-checks, and on accept resolves the Promise (it owns the
		// typed `resolve`). It returns the accepted value, or `undefined` to reject the answer.
		const accepted = parked.respond(value)
		if (accepted === undefined) return { success: false, error: 'rejected' }
		parked.cancel()
		this.#emitter.emit('answer', id, accepted)
		this.#parked.delete(id)
		return { success: true, value: accepted }
	}

	// === PromptInterface — park a prompt directly (the general entry the six form methods wrap)

	park(request: ParkRequest): Ticket {
		const gate = this.#gate(request.form, request.options)
		return this.#park(
			request.form,
			request.options.message,
			request.options,
			gate,
			request.from,
			request.to,
		)
	}

	// === PromptFormInterface — each call parks a prompt and awaits its answer

	input(options: InputOptions): Promise<string> {
		return this.#park('input', options.message, options, this.#gate('input', options)).value
	}

	password(options: PasswordOptions): Promise<string> {
		return this.#park('password', options.message, options, this.#gate('password', options)).value
	}

	confirm(options: ConfirmOptions): Promise<boolean> {
		return this.#park('confirm', options.message, options, this.#gate('confirm', options)).value
	}

	select(options: SelectOptions): Promise<string> {
		return this.#park('select', options.message, options, this.#gate('select', options)).value
	}

	checkbox(options: CheckboxOptions): Promise<readonly string[]> {
		return this.#park('checkbox', options.message, options, this.#gate('checkbox', options)).value
	}

	editor(options: EditorOptions): Promise<string> {
		return this.#park('editor', options.message, options, this.#gate('editor', options)).value
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

	// Park one prompt: build the wire record (stamping `from` / `to` when given), arm the injected
	// expiry timer, store the gate-and-resolve closure, emit `pending`, and return the id + Promise.
	// `gate` is typed to the form's value `T` — it validates + type-checks an answer and returns the
	// coerced `T` (or `undefined` to reject) — so the Promise resolves with the precise type, no
	// assertion anywhere.
	#park<T>(
		form: PromptType,
		message: string,
		options: object,
		gate: (value: unknown) => T | undefined,
		from?: string,
		to?: string,
	): { readonly id: string; readonly value: Promise<T> } {
		if (this.#destroyed) {
			return {
				id: crypto.randomUUID(),
				value: Promise.reject(new TerminalError('EXPIRE', 'broker destroyed')),
			}
		}
		const id = crypto.randomUUID()
		const prompt: PendingPrompt = {
			id,
			form,
			message,
			options: serializePromptOptions(options),
			status: 'pending',
			time: Date.now(),
			...(from !== undefined ? { from } : {}),
			...(to !== undefined ? { to } : {}),
		}
		const value = new Promise<T>((resolve, reject) => {
			const cancel = this.#timer(() => this.#expire(id), this.#timeout)
			// The gate-and-resolve closure: re-mark the record `answered`, resolve with the typed value.
			const respond = (answer: unknown): T | undefined => {
				const accepted = gate(answer)
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
		return { id, value }
	}

	// The per-form gate factory — validates + type-checks an answer to the form's precise value
	// type (or `undefined` to reject). Overloaded per form so each `PromptFormInterface` call site
	// gets back a gate typed to its exact `Promise<T>`, no assertion anywhere; the general (last)
	// overload is what {@link park} uses, returning the wide `PromptValue`.
	#gate(form: 'input', options: InputOptions): (value: unknown) => string | undefined
	#gate(form: 'password', options: PasswordOptions): (value: unknown) => string | undefined
	#gate(form: 'confirm', options: ConfirmOptions): (value: unknown) => boolean | undefined
	#gate(form: 'select', options: SelectOptions): (value: unknown) => string | undefined
	#gate(
		form: 'checkbox',
		options: CheckboxOptions,
	): (value: unknown) => readonly string[] | undefined
	#gate(form: 'editor', options: EditorOptions): (value: unknown) => string | undefined
	#gate(form: PromptType, options: PromptFormOptions): (value: unknown) => PromptValue | undefined
	#gate(form: PromptType, options: PromptFormOptions): (value: unknown) => PromptValue | undefined {
		switch (form) {
			case 'input':
			case 'password':
			case 'editor': {
				if (!this.#isTextOptions(form, options)) return () => undefined
				const validator = resolveValidation(options.validate)
				return (value) => (isString(value) && validator(value) === true ? value : undefined)
			}
			case 'confirm': {
				if (!this.#isConfirmOptions(form, options)) return () => undefined
				return (value) => (isBoolean(value) ? value : undefined)
			}
			case 'select': {
				if (!this.#isSelectOptions(form, options)) return () => undefined
				const values = new Set(options.choices.map(normalizeChoice).map((choice) => choice.value))
				return (value) => (isString(value) && values.has(value) ? value : undefined)
			}
			case 'checkbox': {
				if (!this.#isCheckboxOptions(form, options)) return () => undefined
				const values = new Set(
					options.choices.map(normalizeCheckboxChoice).map((choice) => choice.value),
				)
				const { min, max } = options
				return (value) => {
					if (!isArray(value) || !value.every(isString)) return undefined
					if (!value.every((item) => values.has(item))) return undefined
					if (min !== undefined && value.length < min) return undefined
					if (max !== undefined && value.length > max) return undefined
					return value
				}
			}
		}
	}

	// Form-based type guards: `form` is the source of truth for which options shape is present (the
	// {@link ParkRequest} contract — options is "narrowed at the call site by the paired PromptType").
	// Structural narrowing alone cannot distinguish these (input/editor share an identical shape), so
	// the guard trusts the caller-supplied `form`, exactly as `pending().form` already does on read.
	#isTextOptions(
		form: PromptType,
		_options: PromptFormOptions,
	): _options is InputOptions | PasswordOptions | EditorOptions {
		return form === 'input' || form === 'password' || form === 'editor'
	}

	#isConfirmOptions(form: PromptType, _options: PromptFormOptions): _options is ConfirmOptions {
		return form === 'confirm'
	}

	#isSelectOptions(form: PromptType, _options: PromptFormOptions): _options is SelectOptions {
		return form === 'select'
	}

	#isCheckboxOptions(form: PromptType, _options: PromptFormOptions): _options is CheckboxOptions {
		return form === 'checkbox'
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
