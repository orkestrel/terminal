import {
	createDatabaseTerminalStore,
	createMemoryTerminalStore,
	createPrompt,
	createPromptClient,
	createTerminalManager,
} from '@src/core'
import { createManualTimer, createRecordingTerminal } from '../../setup.js'
import { createForm } from '@orkestrel/form'
import { describe, expect, it } from 'vitest'

describe('core factories', () => {
	it('createPrompt forwards hooks and the timer seam to a working broker', async () => {
		const timer = createManualTimer()
		const pending: string[] = []
		const prompt = createPrompt({
			timer: timer.handler,
			on: { pending: (form) => pending.push(form.id) },
		})
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const id = prompt.park(form)

		expect(pending).toEqual([id])
		expect(timer.pending).toBe(1)
		prompt.answer(id, { name: 'Ada' })
		expect(await form.answer).toEqual({ name: 'Ada' })
	})

	it('createPromptClient returns a disconnected client with the supplied URL', () => {
		const terminal = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://localhost/prompts', terminal })
		expect(client.url).toBe('http://localhost/prompts')
		expect(client.connected).toBe(false)
		client.destroy()
	})

	it('createTerminalManager returns a working registry', () => {
		const manager = createTerminalManager()
		expect(manager.add('agent')).toBe(manager.terminal('agent'))
		expect(manager.terminals()).toEqual(['agent'])
		manager.destroy()
	})

	it('store factories return working independent implementations', async () => {
		for (const store of [createMemoryTerminalStore(), createDatabaseTerminalStore()]) {
			await store.set({ id: 'agent', timeout: 20 })
			expect(await store.get('agent')).toEqual({ id: 'agent', timeout: 20 })
			await store.delete('agent')
			expect(await store.get('agent')).toBeUndefined()
		}
	})
})
