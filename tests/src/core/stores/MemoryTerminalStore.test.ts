import { MemoryTerminalStore } from '@src/core'
import { TERMINAL_STORE_SCENARIOS } from '../../../setup.js'
import { describe, expect, it } from 'vitest'

// src/core/stores/MemoryTerminalStore.ts — the in-process Map twin behind the TerminalStoreInterface
// persistence seam (get / set / delete, async, keyed by a snapshot's own id). The snapshot is
// CONFIG-ONLY (`id` + optional `timeout`) — no live broker state ever crosses this seam. This
// file runs the shared contract matrix both twins satisfy against the memory backend.

describe('MemoryTerminalStore', () => {
	it.each(TERMINAL_STORE_SCENARIOS)('$label', async (scenario) => {
		expect(await scenario.act(new MemoryTerminalStore())).toEqual(scenario.expected)
	})
})
