import type { TerminalSnapshot, TerminalStoreInterface } from '../types.js'

/**
 * Implements the in-memory {@link TerminalStoreInterface} — a process-lifetime `Map` of
 * {@link TerminalSnapshot}s keyed by endpoint id, the DEFAULT store
 * {@link import('../factories.js').createMemoryTerminalStore} builds. The EXACT twin of
 * {@link import('./DatabaseTerminalStore.js').DatabaseTerminalStore}.
 *
 * @remarks
 * A plain `Map<string, TerminalSnapshot>` — the snapshot is already pure, self-contained CONFIG-only
 * JSON, so the memory tier needs no encoding. There is NO idle-TTL and NO
 * eviction: a persisted config lives until an explicit `delete`. A durable backend (JSON / SQLite /
 * IndexedDB) swaps in through the SAME interface without touching the manager — its
 * driver-pluggable twin is {@link import('./DatabaseTerminalStore.js').DatabaseTerminalStore} (the
 * snapshot as one opaque JSON column).
 *
 * - **`get` resolves the persisted snapshot for an id**, or `undefined` if none is stored.
 * - **`set` inserts / replaces under the snapshot's OWN `id`** (no separate id param).
 * - **`delete` drops a snapshot by id**; an absent id is a no-op (no throw).
 *
 * The public surface is EXACTLY `get` / `set` / `delete` — no extra members, so the class and
 * {@link TerminalStoreInterface} carry the same methods. Hydration is a caller concern: `open` always
 * restores an EMPTY broker — parked Promises are process-bound and never resurrected.
 *
 * @example
 * ```ts
 * import { createMemoryTerminalStore } from '@orkestrel/terminal'
 *
 * const store = createMemoryTerminalStore()
 * await store.set({ id: 'shell', timeout: 5000 })   // persist a config
 * const snapshot = await store.get('shell')
 * await store.delete('shell')                       // drop it
 * ```
 */
export class MemoryTerminalStore implements TerminalStoreInterface {
	readonly #snapshots = new Map<string, TerminalSnapshot>()

	/**
	 * Resolves the persisted snapshot for `id`.
	 *
	 * @param id - The endpoint name the snapshot is keyed by
	 * @returns The stored snapshot, or `undefined` when none is held
	 */
	get(id: string): Promise<TerminalSnapshot | undefined> {
		return Promise.resolve(this.#snapshots.get(id))
	}

	/**
	 * Inserts or replaces under the snapshot's OWN `id` (no separate id param).
	 *
	 * @param snapshot - The config snapshot to persist, carrying its own `id`
	 * @returns A promise that settles once the snapshot is held
	 */
	set(snapshot: TerminalSnapshot): Promise<void> {
		this.#snapshots.set(snapshot.id, snapshot)
		return Promise.resolve()
	}

	/**
	 * Drops a snapshot by id; an absent id is a no-op (no throw).
	 *
	 * @param id - The endpoint name to drop
	 * @returns A promise that settles once the snapshot is gone
	 */
	delete(id: string): Promise<void> {
		this.#snapshots.delete(id)
		return Promise.resolve()
	}
}
