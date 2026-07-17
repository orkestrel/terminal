import type { TerminalStoreInterface } from '@src/core'
import { MemoryTerminalStore, DatabaseTerminalStore } from '@src/core'
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { rawShape, stringShape } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'

// src/core/MemoryTerminalStore.ts + src/core/DatabaseTerminalStore.ts — the two twin backends
// behind the TerminalStoreInterface persistence seam (get / set / delete, async, keyed by a
// snapshot's own id). The snapshot is CONFIG-ONLY (`id` + optional `timeout`) — no live broker
// state ever crosses this seam. This file runs ONE shared behavioral suite against both twins
// (the memory Map and the database one-table twin over a real memory driver), then adds a
// twin-specific block for the Database store's read-boundary guard on an off-shape stored row.

function buildDatabaseStore(): TerminalStoreInterface {
	const driver = createMemoryDriver()
	const database = createDatabase({
		driver,
		tables: { terminals: { id: stringShape(), snapshot: rawShape({}) } },
	})
	return new DatabaseTerminalStore(database.table('terminals'))
}

function assertTerminalStoreContract(build: () => TerminalStoreInterface): void {
	it('resolves undefined for a never-stored id (miss)', async () => {
		const store = build()
		expect(await store.get('nope')).toBeUndefined()
	})

	it('set then get round-trips a snapshot with a timeout', async () => {
		const store = build()
		const snapshot = { id: 'shell', timeout: 5000 }
		await store.set(snapshot)
		expect(await store.get('shell')).toEqual(snapshot)
	})

	it('set then get round-trips a snapshot WITHOUT a timeout (optional field absent)', async () => {
		const store = build()
		const snapshot = { id: 'plain' }
		await store.set(snapshot)
		expect(await store.get('plain')).toEqual(snapshot)
	})

	it('a second set under the SAME id upserts (replaces) rather than duplicating', async () => {
		const store = build()
		await store.set({ id: 'shell', timeout: 1000 })
		await store.set({ id: 'shell', timeout: 9000 })
		expect(await store.get('shell')).toEqual({ id: 'shell', timeout: 9000 })
	})

	it('delete drops a stored snapshot; a subsequent get misses', async () => {
		const store = build()
		await store.set({ id: 'shell', timeout: 5000 })
		await store.delete('shell')
		expect(await store.get('shell')).toBeUndefined()
	})

	it('delete of an absent id is a no-op (no throw)', async () => {
		const store = build()
		await expect(store.delete('never-existed')).resolves.toBeUndefined()
	})

	it('two distinct ids coexist independently', async () => {
		const store = build()
		await store.set({ id: 'shell', timeout: 1000 })
		await store.set({ id: 'bash', timeout: 2000 })
		expect(await store.get('shell')).toEqual({ id: 'shell', timeout: 1000 })
		expect(await store.get('bash')).toEqual({ id: 'bash', timeout: 2000 })
	})
}

describe('MemoryTerminalStore', () => {
	assertTerminalStoreContract(() => new MemoryTerminalStore())
})

describe('DatabaseTerminalStore', () => {
	assertTerminalStoreContract(buildDatabaseStore)
})

describe('DatabaseTerminalStore — read-boundary guard', () => {
	it('an off-shape stored row (a malformed snapshot column) resolves undefined on get (§14 fail-closed)', async () => {
		const driver = createMemoryDriver()
		const database = createDatabase({
			driver,
			tables: { terminals: { id: stringShape(), snapshot: rawShape({}) } },
		})
		const table = database.table('terminals')
		// Plant a poisoned row directly on the table — a snapshot missing its required `id`.
		await table.set({ id: 'poisoned', snapshot: { timeout: 5000 } })

		const store = new DatabaseTerminalStore(table)
		expect(await store.get('poisoned')).toBeUndefined()
	})
})
