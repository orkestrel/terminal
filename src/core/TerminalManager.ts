import type {
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	PasswordOptions,
	PendingPrompt,
	PromptFormOptions,
	PromptInterface,
	PromptOptions,
	PromptType,
	PromptValue,
	SelectOptions,
	TerminalAnswerResult,
	TerminalManagerEventMap,
	TerminalManagerInterface,
	TerminalManagerOptions,
	TerminalOptions,
	TerminalSnapshot,
	TerminalStoreInterface,
	TimerHandler,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { TerminalError } from './errors.js'
import { createPrompt } from './factories.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'

/**
 * The multi-endpoint terminal MANAGER — a registry of named {@link PromptInterface} brokers (one
 * per endpoint), so several parties can `ask` prompts of each other by NAME with a `from` → `to`
 * attribution edge on every parked prompt, and a transitive DEADLOCK check across all in-flight
 * asks.
 *
 * @remarks
 * - **Registry.** `add(name, options?)` mints (or, if `name` is already mounted, returns the
 *   EXISTING broker UNCHANGED — idempotent, never clobbers a live/parked endpoint). Every mounted
 *   broker's `pending` / `answer` / `expire` events are re-emitted on the manager, attributed by
 *   `name`.
 * - **`ask`.** The target must already be mounted via {@link add} — `ask` never auto-adds it;
 *   rejects `TARGET` for an unknown `to` (listing the known names). Rejects `DEADLOCK` when parking
 *   `from → to` would close a cycle over the CURRENT in-flight edge set (walked transitively);
 *   otherwise parks through the target's broker and resolves with the ORIGINAL ticket Promise (edge
 *   cleanup is attached via `.then`, never altering the value/rejection the caller observes).
 * - **Durable open / save.** `open(name)` restores an EMPTY broker from the `store` (parked
 *   Promises are process-bound and never resurrected); `save(name)` persists the endpoint's
 *   configured `timeout`.
 * - **Removal.** `remove` drops one endpoint or a batch (§9.2, array overload FIRST), destroying
 *   each broker (which expires every prompt still parked on it). `clear` drops all; `destroy` is
 *   idempotent.
 *
 * @example
 * ```ts
 * const manager = new TerminalManager()
 * manager.add('agent')
 * const name = manager.ask('user', 'agent', 'input', { message: 'Your name' })
 * manager.answer('agent', manager.pending('agent')[0].id, 'Ada')
 * await name // 'Ada'
 * ```
 */
export class TerminalManager implements TerminalManagerInterface {
	readonly #terminals = new Map<string, PromptInterface>()
	readonly #config = new Map<string, TerminalOptions>()
	// The handlers subscribed on a mounted broker's emitter — kept so `remove` can `off` them
	// explicitly (on top of the broker's own `destroy`, which already renders its emitter inert).
	readonly #listeners = new Map<
		string,
		{
			readonly pending: (prompt: PendingPrompt) => void
			readonly answer: (id: string, value: unknown) => void
			readonly expire: (id: string) => void
		}
	>()
	// In-flight `ask` edges, keyed by the parked ticket's id — the deadlock graph. `from` asked
	// `to`; cleanup on settle (answer / expire / destroy / remove) removes EXACTLY the edge that
	// call created.
	readonly #edges = new Map<string, { readonly from: string; readonly to: string }>()
	readonly #store: TerminalStoreInterface | undefined
	readonly #timeout: number | undefined
	readonly #timer: TimerHandler | undefined
	readonly #cap: number | undefined
	readonly #emitter: Emitter<TerminalManagerEventMap>
	#destroyed = false

	constructor(options?: TerminalManagerOptions) {
		this.#store = options?.store
		this.#timeout = options?.timeout
		this.#timer = options?.timer
		this.#cap = options?.cap
		this.#emitter = new Emitter({ on: options?.on, error: options?.error })
	}

	get emitter(): EmitterInterface<TerminalManagerEventMap> {
		return this.#emitter
	}

	get count(): number {
		return this.#terminals.size
	}

	// === Accessors (§9.1)

	terminal(name: string): PromptInterface | undefined {
		return this.#terminals.get(name)
	}

	terminals(): readonly string[] {
		return [...this.#terminals.keys()]
	}

	// === Registry

	add(name: string, options?: TerminalOptions): PromptInterface {
		if (this.#destroyed) throw new TerminalError('DESTROYED', 'manager destroyed')
		const existing = this.#terminals.get(name)
		if (existing !== undefined) return existing
		const timeout = options?.timeout ?? this.#timeout
		const timer = options?.timer ?? this.#timer
		const cap = options?.cap ?? this.#cap
		const promptOptions: PromptOptions = {
			...(timeout !== undefined ? { timeout } : {}),
			...(timer !== undefined ? { timer } : {}),
			...(cap !== undefined ? { cap } : {}),
		}
		const broker = createPrompt(promptOptions)
		const listeners = {
			pending: (prompt: PendingPrompt) => this.#emitter.emit('pending', prompt),
			answer: (id: string, value: unknown) => this.#emitter.emit('answer', name, id, value),
			expire: (id: string) => this.#emitter.emit('expire', name, id),
		}
		broker.emitter.on('pending', listeners.pending)
		broker.emitter.on('answer', listeners.answer)
		broker.emitter.on('expire', listeners.expire)
		this.#terminals.set(name, broker)
		this.#config.set(name, options ?? {})
		this.#listeners.set(name, listeners)
		return broker
	}

	// === Ask (overloaded per PromptType, mirroring TerminalManagerInterface)

	ask(
		from: string,
		to: string,
		form: 'input' | 'password' | 'editor',
		options: InputOptions | PasswordOptions | EditorOptions,
	): Promise<string>
	ask(from: string, to: string, form: 'confirm', options: ConfirmOptions): Promise<boolean>
	ask(from: string, to: string, form: 'select', options: SelectOptions): Promise<string>
	ask(
		from: string,
		to: string,
		form: 'checkbox',
		options: CheckboxOptions,
	): Promise<readonly string[]>
	ask(
		from: string,
		to: string,
		form: PromptType,
		options: PromptFormOptions,
	): Promise<PromptValue> {
		const broker = this.#terminals.get(to)
		if (broker === undefined) {
			const known = this.terminals()
			return Promise.reject(
				new TerminalError(
					'TARGET',
					`unknown terminal '${to}' (known: ${known.length > 0 ? known.join(', ') : 'none'})`,
					{ to, known },
				),
			)
		}
		const cycle = this.#findCycle(from, to)
		if (cycle !== undefined) {
			return Promise.reject(
				new TerminalError(
					'DEADLOCK',
					`ask ${from} -> ${to} would deadlock: ${cycle.join(' -> ')}`,
					{
						from,
						to,
						path: cycle,
					},
				),
			)
		}
		const ticket = broker.park({ form, options, from, to })
		if (broker.pending(ticket.id) !== undefined) {
			this.#edges.set(ticket.id, { from, to })
			const clear = (): void => {
				this.#edges.delete(ticket.id)
			}
			ticket.value.then(clear, clear)
		}
		return ticket.value
	}

	// === Pending accessors (§9.1)

	pending(): readonly PendingPrompt[]
	pending(to: string): readonly PendingPrompt[]
	pending(to?: string): readonly PendingPrompt[] {
		if (to !== undefined) {
			const broker = this.#terminals.get(to)
			return broker === undefined ? [] : broker.pending()
		}
		const result: PendingPrompt[] = []
		for (const broker of this.#terminals.values()) result.push(...broker.pending())
		return result
	}

	// === Answer

	answer(to: string, id: string, value: unknown): TerminalAnswerResult {
		const broker = this.#terminals.get(to)
		if (broker === undefined) return { success: false, error: 'terminal' }
		return broker.answer(id, value)
	}

	// === Durable open / save

	async open(name: string): Promise<PromptInterface | undefined> {
		if (this.#destroyed) throw new TerminalError('DESTROYED', 'manager destroyed')
		const existing = this.#terminals.get(name)
		if (existing !== undefined) return existing
		if (this.#store === undefined) return undefined
		const snapshot = await this.#store.get(name)
		if (this.#destroyed) throw new TerminalError('DESTROYED', 'manager destroyed')
		if (snapshot === undefined) return undefined
		return this.add(name, snapshot.timeout !== undefined ? { timeout: snapshot.timeout } : {})
	}

	async save(name: string): Promise<boolean> {
		const broker = this.#terminals.get(name)
		if (this.#store === undefined || broker === undefined) return false
		const config = this.#config.get(name)
		const snapshot: TerminalSnapshot = {
			id: name,
			...(config?.timeout !== undefined ? { timeout: config.timeout } : {}),
		}
		await this.#store.set(snapshot)
		return true
	}

	// === Removal (§9.2: the array overload FIRST)

	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(names: string | readonly string[]): boolean {
		if (isArray(names)) {
			let removed = false
			for (const name of names) {
				if (this.#removeOne(name)) removed = true
			}
			return removed
		}
		return this.#removeOne(names)
	}

	clear(): void {
		for (const name of [...this.#terminals.keys()]) this.#removeOne(name)
	}

	destroy(): void {
		if (this.#destroyed) return
		this.#destroyed = true
		this.clear()
		this.#emitter.destroy()
	}

	// === Private helpers

	// Drop one endpoint: destroy its broker FIRST (its expire loop re-emits `expire` for every
	// still-parked prompt through the manager's listeners — still attached at this point, so
	// each settles on the manager emitter too), THEN unsubscribe the manager's listeners and
	// remove it from every registry map. `false` when `name` was not mounted.
	#removeOne(name: string): boolean {
		const broker = this.#terminals.get(name)
		if (broker === undefined) return false
		broker.destroy()
		const listeners = this.#listeners.get(name)
		if (listeners !== undefined) {
			broker.emitter.off('pending', listeners.pending)
			broker.emitter.off('answer', listeners.answer)
			broker.emitter.off('expire', listeners.expire)
		}
		this.#terminals.delete(name)
		this.#config.delete(name)
		this.#listeners.delete(name)
		return true
	}

	// Walk the in-flight edge graph forward from `to`, looking for `from` — a hit means parking
	// `from -> to` would close a cycle. Returns the closing cycle path (`from` first and last),
	// or `undefined` when no cycle would form.
	#findCycle(from: string, to: string): readonly string[] | undefined {
		if (from === to) return [from, to]
		const visited = new Set<string>([to])
		const queue: (readonly string[])[] = [[to]]
		while (queue.length > 0) {
			const path = queue.shift()
			if (path === undefined) break
			const last = path[path.length - 1]
			if (last === undefined) continue
			for (const edge of this.#edges.values()) {
				if (edge.from !== last) continue
				if (edge.to === from) return [from, ...path, from]
				if (visited.has(edge.to)) continue
				visited.add(edge.to)
				queue.push([...path, edge.to])
			}
		}
		return undefined
	}
}
