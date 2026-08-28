import type { TerminalStoreInterface } from '@src/core'
import { DatabaseTerminalStore } from '@src/core'
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { rawShape, stringShape } from '@orkestrel/contract'
import { TERMINAL_STORE_SCENARIOS } from '../../../setup.js'
import { describe, expect, it } from 'vitest'

// src/core/stores/DatabaseTerminalStore.ts — the one-table twin behind the TerminalStoreInterface
// persistence seam (get / set / delete, async, keyed by a snapshot's own id), exercised over a
// real memory driver. The snapshot is CONFIG-ONLY (`id` + optional `timeout`) — no live broker
// state ever crosses this seam. This file runs the shared contract matrix both twins satisfy,
// then adds the twin-specific read-boundary guard on an off-shape stored row.

function buildDatabaseTable() {
	const driver = createMemoryDriver()
	const database = createDatabase({
		driver,
		tables: { terminals: { id: stringShape(), snapshot: rawShape({}) } },
	})
	return database.table('terminals')
}

function buildDatabaseStore(): TerminalStoreInterface {
	return new DatabaseTerminalStore(buildDatabaseTable())
}

describe('DatabaseTerminalStore', () => {
	it.each(TERMINAL_STORE_SCENARIOS)('$label', async (scenario) => {
		expect(await scenario.act(buildDatabaseStore())).toEqual(scenario.expected)
	})
})

describe('DatabaseTerminalStore — read-boundary guard', () => {
	it('an off-shape stored row (a malformed snapshot column) resolves undefined on get (§14 fail-closed)', async () => {
		const table = buildDatabaseTable()
		// Plant a poisoned row directly on the table — a snapshot missing its required `id`.
		await table.set({ id: 'poisoned', snapshot: { timeout: 5000 } })

		const store = new DatabaseTerminalStore(table)
		expect(await store.get('poisoned')).toBeUndefined()
	})
})
