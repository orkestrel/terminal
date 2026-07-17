import type { TerminalSnapshot, TerminalStoreInterface } from './types.js'

/**
 * The in-memory {@link TerminalStoreInterface} — a process-lifetime `Map` of
 * {@link TerminalSnapshot}s keyed by endpoint id, the DEFAULT store
 * {@link import('./factories.js').createMemoryTerminalStore} builds. The EXACT twin of
 * {@link import('./DatabaseTerminalStore.js').DatabaseTerminalStore}.
 *
 * @remarks
 * A plain `Map<string, TerminalSnapshot>` (AGENTS §21 — the snapshot is already pure, self-contained
 * CONFIG-only JSON, so no encoding is needed for the memory tier). There is NO idle-TTL and NO
 * eviction: a persisted config lives until an explicit `delete`. A durable backend (JSON / SQLite /
 * IndexedDB) swaps in through the SAME interface without touching the manager — its
 * driver-pluggable twin is {@link import('./DatabaseTerminalStore.js').DatabaseTerminalStore} (the
 * snapshot as one opaque JSON column).
 *
 * - **`get` resolves the persisted snapshot for an id**, or `undefined` if none is stored.
 * - **`set` inserts / replaces under the snapshot's OWN `id`** (no separate id param).
 * - **`delete` drops a snapshot by id**; an absent id is a no-op (no throw).
 *
 * The public surface is EXACTLY `get` / `set` / `delete` — no extra members (the §22 method
 * bijection with {@link TerminalStoreInterface}). Hydration is a caller concern: `open` always
 * restores an EMPTY broker — parked Promises are process-bound and never resurrected.
 *
 * @example
 * ```ts
 * import { createMemoryTerminalStore } from '@src/core'
 *
 * const store = createMemoryTerminalStore()
 * await store.set({ id: 'shell', timeout: 5000 })   // persist a config
 * const snapshot = await store.get('shell')
 * await store.delete('shell')                       // drop it
 * ```
 */
export class MemoryTerminalStore implements TerminalStoreInterface {
	readonly #snapshots = new Map<string, TerminalSnapshot>()

	get(id: string): Promise<TerminalSnapshot | undefined> {
		return Promise.resolve(this.#snapshots.get(id))
	}

	set(snapshot: TerminalSnapshot): Promise<void> {
		// Insert / replace under the snapshot's OWN id (no separate id param).
		this.#snapshots.set(snapshot.id, snapshot)
		return Promise.resolve()
	}

	delete(id: string): Promise<void> {
		// Drop by id; `Map.delete` of an absent id is already a no-op (no throw).
		this.#snapshots.delete(id)
		return Promise.resolve()
	}
}
