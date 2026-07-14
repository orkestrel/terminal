import { createPrompt, createPromptClient } from '@src/core'
import { createManualTimer } from '../../../setup.js'
import { describe, expect, it } from 'vitest'

// The terminals factories are thin constructors — these tests assert each returns a working
// instance with its options forwarded (the broker parks + the injected timer drives expiry; the
// client exposes its url + connects through the injected fetch). The full park / answer / dispatch
// behavior is covered by Prompt.test.ts / PromptClient.test.ts.

describe('createPrompt', () => {
	it('returns a working broker that parks a prompt and forwards the on hook', async () => {
		const parked: string[] = []
		const prompt = createPrompt({ on: { pending: (pending) => parked.push(pending.id) } })

		const answer = prompt.input({ message: 'Name?' })
		expect(prompt.count).toBe(1)
		const [pending] = prompt.pending()
		expect(parked).toEqual([pending.id]) // the on hook fired
		prompt.answer(pending.id, 'Ada')
		expect(await answer).toBe('Ada')
	})

	it('forwards the injected timer for deterministic expiry', () => {
		const timer = createManualTimer()
		const prompt = createPrompt({ timeout: 10, timer: timer.handler })
		void prompt.input({ message: 'x' })
		expect(timer.pending).toBe(1) // the injected timer armed the deadline
	})
})

describe('createPromptClient', () => {
	it('returns a client exposing its url, not yet connected', () => {
		const client = createPromptClient({
			url: 'http://broker/prompts',
			terminal: {
				input: async () => '',
				password: async () => '',
				confirm: async () => false,
				select: async () => '',
				checkbox: async () => [],
				editor: async () => '',
			},
		})
		expect(client.url).toBe('http://broker/prompts')
		expect(client.connected).toBe(false)
	})
})
