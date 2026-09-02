import type {
	PendingForm,
	PromptInterface,
	PromptOptions,
	TerminalAnswerError,
	TerminalManagerEventMap,
	TerminalManagerInterface,
	TerminalManagerOptions,
	TerminalSnapshot,
	TerminalStoreInterface,
	TimerHandler,
} from './types.js'
import type { Result } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { FormInterface, FormValues } from '@orkestrel/form'
import { TerminalError } from './errors.js'
import { createPrompt } from './factories.js'
import { Emitter } from '@orkestrel/emitter'
import { isArray } from '@orkestrel/contract'

/**
 * Registers named {@link PromptInterface} brokers (one per endpoint), so several parties can
 * `ask` forms of each other by NAME with a `from` → `to` attribution edge on every parked form,
 * and a transitive DEADLOCK check across all in-flight asks.
 *
 * @remarks
 * - **Registry.** `add(name, options?)` mints (or, if `name` is already mounted, returns the
 *   EXISTING broker UNCHANGED — idempotent, never clobbers a live/parked endpoint). Every mounted
 *   broker's `pending` / `answer` / `expire` events are re-emitted on the manager, attributed by
 *   `name`.
 * - **`ask`.** The target must already be mounted via {@link add} — `ask` never auto-adds it;
 *   rejects `TARGET` for an unknown `to` (listing the known names). Rejects `DEADLOCK` when parking
 *   `from → to` would close a cycle over the CURRENT in-flight edge set (walked transitively);
 *   otherwise parks the caller's live form through the target's broker and returns that form's own
 *   `answer` promise. Edge cleanup never alters the value or rejection the caller observes.
 * - **Durable open / save.** `open(name)` restores an EMPTY broker from the `store` (parked
 *   Promises are process-bound and never resurrected); `save(name)` persists the endpoint's
 *   configured `timeout`.
 * - **Removal.** `remove` drops one endpoint, a batch (the array overload declared FIRST), or every
 *   endpoint when called without an argument. It destroys each broker, which expires every form
 *   still parked on it. `destroy` is idempotent.
 *
 * @example
 * ```ts
 * const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
 * const manager = new TerminalManager()
 * manager.add('agent')
 * const answer = manager.ask('user', 'agent', form)
 * manager.answer('agent', manager.pending('agent')[0].id, { name: 'Ada' })
 * await answer // { name: 'Ada' }
 * ```
 */
export class TerminalManager implements TerminalManagerInterface {
	readonly #terminals = new Map<string, PromptInterface>()
	readonly #config = new Map<string, PromptOptions>()
	// The handlers subscribed on a mounted broker's emitter — kept so `remove` can `off` them
	// explicitly (on top of the broker's own `destroy`, which already renders its emitter inert).
	readonly #listeners = new Map<
		string,
		{
			readonly pending: (form: PendingForm) => void
			readonly answer: (id: string, values: FormValues) => void
			readonly expire: (id: string) => void
		}
	>()
	// In-flight `ask` edges, keyed by the parked form's id — the deadlock graph. `from` asked
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
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
	}

	get emitter(): EmitterInterface<TerminalManagerEventMap> {
		return this.#emitter
	}

	get count(): number {
		return this.#terminals.size
	}

	// === Accessors

	terminal(name: string): PromptInterface | undefined {
		return this.#terminals.get(name)
	}

	terminals(): readonly PromptInterface[] {
		return [...this.#terminals.values()]
	}

	// === Registry

	add(name: string, options?: PromptOptions): PromptInterface {
		if (this.#destroyed) throw new TerminalError('DESTROYED', 'manager destroyed')
		const existing = this.#terminals.get(name)
		if (existing !== undefined) return existing
		const timeout = options?.timeout ?? this.#timeout
		const timer = options?.timer ?? this.#timer
		const cap = options?.cap ?? this.#cap
		const promptOptions: PromptOptions = {
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
			...(timeout !== undefined ? { timeout } : {}),
			...(timer !== undefined ? { timer } : {}),
			...(cap !== undefined ? { cap } : {}),
		}
		const broker = createPrompt(promptOptions)
		const listeners = {
			pending: this.#createPendingListener(),
			answer: this.#createAnswerListener(name),
			expire: this.#createExpireListener(name),
		}
		broker.emitter.on('pending', listeners.pending)
		broker.emitter.on('answer', listeners.answer)
		broker.emitter.on('expire', listeners.expire)
		this.#terminals.set(name, broker)
		this.#config.set(name, { ...options })
		this.#listeners.set(name, listeners)
		return broker
	}

	// === Ask

	ask(from: string, to: string, form: FormInterface): Promise<FormValues> {
		const broker = this.#terminals.get(to)
		if (broker === undefined) {
			const known = [...this.#terminals.keys()]
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
		const id = broker.park(form, { from, to })
		if (broker.pending(id) !== undefined) {
			this.#edges.set(id, { from, to })
			form.answer.then(this.#createEdgeClear(id), this.#createEdgeClear(id))
		}
		return form.answer
	}

	// === Pending accessors

	pending(): readonly PendingForm[]
	pending(to: string): readonly PendingForm[]
	pending(to?: string): readonly PendingForm[] {
		if (to !== undefined) {
			const broker = this.#terminals.get(to)
			return broker === undefined ? [] : broker.pending()
		}
		const result: PendingForm[] = []
		for (const broker of this.#terminals.values()) result.push(...broker.pending())
		return result
	}

	// === Answer

	answer(to: string, id: string, values: FormValues): Result<FormValues, TerminalAnswerError> {
		const broker = this.#terminals.get(to)
		if (broker === undefined) return { success: false, error: { reason: 'terminal' } }
		const result = broker.answer(id, values)
		if (result.success) this.#edges.delete(id)
		return result
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

	// === Removal (the array overload declared FIRST)

	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(): void
	remove(names?: string | readonly string[]): boolean | void {
		if (names === undefined) {
			for (const name of [...this.#terminals.keys()]) this.#removeOne(name)
			return
		}
		if (isArray(names)) {
			let removed = true
			for (const name of names) {
				if (!this.#removeOne(name)) removed = false
			}
			return removed
		}
		return this.#removeOne(names)
	}

	destroy(): void {
		if (this.#destroyed) return
		this.#destroyed = true
		this.remove()
		this.#edges.clear()
		this.#emitter.destroy()
	}

	// === Private helpers

	#createPendingListener(): (form: PendingForm) => void {
		return (form) => this.#emitter.emit('pending', form)
	}

	#createAnswerListener(name: string): (id: string, values: FormValues) => void {
		return (id, values) => {
			this.#edges.delete(id)
			this.#emitter.emit('answer', name, id, values)
		}
	}

	#createExpireListener(name: string): (id: string) => void {
		return (id) => {
			this.#edges.delete(id)
			this.#emitter.emit('expire', name, id)
		}
	}

	#createEdgeClear(id: string): () => void {
		return () => {
			this.#edges.delete(id)
		}
	}

	// Drop one endpoint: destroy its broker FIRST (its expire loop re-emits `expire` for every
	// still-parked form through the manager's listeners — still attached at this point, so
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
		this.#clearEdges(name)
		return true
	}

	#clearEdges(to: string): void {
		for (const [id, edge] of this.#edges) {
			if (edge.to === to) this.#edges.delete(id)
		}
	}

	// Walk the in-flight edge graph forward from `to`, looking for `from` — a hit means parking
	// `from -> to` would close a cycle. Returns the closing cycle path (`from` first and last),
	// or `undefined` when no cycle would form.
	#findCycle(from: string, to: string): readonly string[] | undefined {
		if (from === to) return [from, to]
		const visited = new Set<string>([to])
		const queue: Array<readonly string[]> = [[to]]
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
