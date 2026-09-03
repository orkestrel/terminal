import type { TerminalSnapshot, TerminalSnapshotRow, TerminalStoreInterface } from '../types.js'
import type { TableInterface } from '@orkestrel/database'
import { isTerminalSnapshot } from '../validators.js'

/**
 * Implements a {@link TerminalStoreInterface} backed by one table of the `databases` layer — an endpoint's
 * durable CONFIG state IS a row, so persistence reduces to keyed point-access (`get` / `set` /
 * `delete`) over a {@link TableInterface}, the driver-pluggable twin of the plain-`Map`
 * {@link import('./MemoryTerminalStore.js').MemoryTerminalStore}.
 *
 * @remarks
 * The store is driver-agnostic: it holds a single {@link TableInterface} whose backend (memory,
 * JSON, SQLite, IndexedDB) is chosen by whoever builds it (the factories), so a JSON / SQLite /
 * IndexedDB backend swaps in WITHOUT touching the manager — the same seam as
 * {@link import('./MemoryTerminalStore.js').MemoryTerminalStore}. The driver defaults to memory
 * ({@link import('../factories.js').createDatabaseTerminalStore} passes `createMemoryDriver()`), so
 * it ALSO works in memory out of the box; you opt into the durable plumbing by passing a JSON /
 * SQLite / IndexedDB driver.
 *
 * The {@link TerminalSnapshot} is stored as ONE OPAQUE JSON COLUMN — the table is a row of
 * `{ id; snapshot }` ({@link TerminalSnapshotRow}). The snapshot is already a COMPLETE,
 * self-contained, pure-JSON CONFIG payload (no live broker state), so storing it whole is lossless
 * AND keeps the row type flat (`snapshot` reads back as `unknown`).
 *
 * - **`set(snapshot)` upserts under the snapshot's OWN `id`** (no separate id param) — it writes
 *   the row `{ id: snapshot.id, snapshot }`.
 * - **`get(id)` resolves the stored snapshot for an id**, narrowing the opaque JSON column back to
 *   a {@link TerminalSnapshot} ({@link import('../validators.js').isTerminalSnapshot} — the total
 *   guard that narrows an untrusted storage read), or `undefined` if none is stored.
 * - **`delete(id)` drops a snapshot by id**; an absent id is a no-op (no throw).
 *
 * There is NO idle-TTL / eviction — a persisted config lives until an explicit `delete`. The public
 * surface is EXACTLY `get` / `set` / `delete` — no extra members, so the class and
 * {@link TerminalStoreInterface} carry the same methods. Hydration stays a caller concern: `open` always restores an EMPTY
 * broker — parked Promises are process-bound and never resurrected.
 *
 * @example
 * ```ts
 * import { createDatabaseTerminalStore } from '@orkestrel/terminal'
 * import { createMemoryDriver } from '@orkestrel/database'
 *
 * const store = createDatabaseTerminalStore(createMemoryDriver()) // a durable driver swaps in here
 * await store.set({ id: 'shell', timeout: 5000 })        // persist the config (one JSON column)
 * const snapshot = await store.get('shell')
 * await store.delete('shell')                            // drop it
 * ```
 */
export class DatabaseTerminalStore implements TerminalStoreInterface {
	readonly #table: TableInterface<TerminalSnapshotRow>

	/**
	 * Wraps a table as a terminal store.
	 *
	 * @param table - The {@link TableInterface} holding the snapshots — its row is the
	 *   {@link TerminalSnapshotRow} `{ id; snapshot }` shape (the snapshot one opaque JSON column)
	 */
	constructor(table: TableInterface<TerminalSnapshotRow>) {
		this.#table = table
	}

	/**
	 * Resolves the persisted snapshot for `id`, narrowing the opaque JSON column back to a
	 * `TerminalSnapshot`.
	 *
	 * @param id - The endpoint name the row is keyed by
	 * @returns The stored snapshot, or `undefined` when none is held or the column is off-shape
	 */
	async get(id: string): Promise<TerminalSnapshot | undefined> {
		const row = await this.#table.get(id)
		if (row === undefined) return undefined
		// The snapshot crosses back as an untrusted storage read (a structured clone / a JSON row),
		// so narrow the opaque JSON column with the boundary guard rather than a cast;
		// a malformed blob resolves `undefined`, never a broken config.
		return isTerminalSnapshot(row.snapshot) ? row.snapshot : undefined
	}

	/**
	 * Inserts or replaces under the snapshot's OWN `id` (no separate id param) — the row is
	 * `{ id, snapshot }`.
	 *
	 * @param snapshot - The config snapshot to persist, carrying its own `id`
	 * @returns A promise that settles once the row is written
	 */
	async set(snapshot: TerminalSnapshot): Promise<void> {
		await this.#table.set({ id: snapshot.id, snapshot })
	}

	/**
	 * Drops a snapshot by id; an absent id is a no-op (no throw).
	 *
	 * @param id - The endpoint name to drop
	 * @returns A promise that settles once the row is gone
	 */
	async delete(id: string): Promise<void> {
		await this.#table.remove(id)
	}
}
