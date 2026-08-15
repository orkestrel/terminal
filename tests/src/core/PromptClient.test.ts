import type { FetchInit } from '@src/core'
import {
	createHostileWireSchema,
	createPendingForm,
	createRecordingTerminal,
	createSSEResponse,
	recordEmitterEvents,
	requireElement,
} from '../../setup.js'
import { HEADER_TOKEN, createPromptClient } from '@src/core'
import { waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

function createJSONResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('PromptClient', () => {
	it('parses, sanitizes, renders, and POSTs exactly {id, values}', async () => {
		const terminal = createRecordingTerminal({ answers: [{ name: 'Ada' }] })
		const pending = createPendingForm(
			{
				name: 'profile',
				fields: [
					{
						control: 'text',
						name: 'name',
						label: '\u001b[31mName\u001b[0m\u0000',
					},
				],
			},
			{ id: 'one' },
		)
		const posts: FetchInit[] = []
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async (_input, init) => {
				if (init?.method === 'POST') {
					posts.push(init)
					return createJSONResponse({ success: true, value: { name: 'Ada' } })
				}
				return createSSEResponse([{ event: 'pending', data: pending }])
			},
		})

		await client.connect()
		await waitForDelay()

		expect(terminal.calls.count).toBe(1)
		expect(requireElement(terminal.calls.calls, 0)[0].schema.fields[0]?.label).toBe('Name')
		expect(posts).toHaveLength(1)
		expect(requireElement(posts, 0).method).toBe('POST')
		expect(requireElement(posts, 0).headers).toEqual({ 'Content-Type': 'application/json' })
		expect(requireElement(posts, 0).body).toBe(
			JSON.stringify({ id: 'one', values: { name: 'Ada' } }),
		)
		client.destroy()
	})

	it('sanitizes the full hostile schema before any terminal-readable position is observed', async () => {
		const terminal = createRecordingTerminal({ defer: true })
		const pending = createPendingForm(createHostileWireSchema(), { id: 'hostile' })
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async () => createSSEResponse([{ event: 'pending', data: pending }]),
		})

		await client.connect()
		await waitForDelay()
		const observed = requireElement(terminal.calls.calls, 0)[0].schema
		const wire = JSON.stringify(observed)

		expect(
			[...wire].some((character) => {
				const code = character.charCodeAt(0)
				return code < 32 || code === 127
			}),
		).toBe(false)
		expect(wire).not.toContain('\u001b[')
		expect(observed.fields).toHaveLength(12)
		expect(observed.groups?.[0]).toEqual({
			name: 'group',
			label: 'Group',
			help: 'Group help',
		})
		expect('meta' in requireElement(observed.fields, 0)).toBe(false)
		client.destroy()
	})

	it('retries an authoritative rejection with seeded values and exact invalidations', async () => {
		const terminal = createRecordingTerminal({ answers: [{ word: 'bad' }, { word: 'good' }] })
		const pending = createPendingForm(
			{
				fields: [{ control: 'text', name: 'word', rule: { pattern: '^good$' } }],
			},
			{ id: 'retry' },
		)
		const bodies: string[] = []
		const rejection = {
			success: false,
			error: {
				reason: 'rejected',
				errors: [{ field: 'word', message: 'Must match the required pattern', rule: 'pattern' }],
			},
		}
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async (_input, init) => {
				if (init?.method !== 'POST') {
					return createSSEResponse([{ event: 'pending', data: pending }])
				}
				bodies.push(init.body ?? '')
				return bodies.length === 1
					? createJSONResponse(rejection)
					: createJSONResponse({ success: true, value: { word: 'good' } })
			},
		})

		await client.connect()
		await waitForDelay(10)

		expect(terminal.calls.count).toBe(2)
		const first = requireElement(terminal.calls.calls, 0)[0]
		const second = requireElement(terminal.calls.calls, 1)[0]
		expect(first.schema.fields[0]?.rule?.pattern).toBeUndefined()
		expect(second.schema.fields[0]?.rule?.pattern).toBeUndefined()
		expect(second.values).toEqual({ word: 'bad' })
		expect(second.errors).toEqual([{ field: 'word', message: 'Must match the required pattern' }])
		expect(bodies).toEqual([
			JSON.stringify({ id: 'retry', values: { word: 'bad' } }),
			JSON.stringify({ id: 'retry', values: { word: 'good' } }),
		])
		client.destroy()
	})

	it('ingests expire while a render is active and abandons the local form', async () => {
		const terminal = createRecordingTerminal({ defer: true })
		const pending = createPendingForm(undefined, { id: 'active' })
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async () =>
				createSSEResponse([
					{ event: 'pending', data: pending },
					{ event: 'expire', data: { id: 'active' } },
				]),
		})
		const events = recordEmitterEvents(client.emitter, ['expire', 'error'])

		await client.connect()
		await waitForDelay()

		expect(terminal.calls.count).toBe(1)
		expect(terminal.active?.status).toBe('abandoned')
		expect(events.expire.calls).toEqual([['active']])
		expect(events.error.calls).toEqual([])
		client.destroy()
	})

	it('shutdown interrupts the active render, disconnects once, and remains reusable', async () => {
		const terminal = createRecordingTerminal({ defer: true })
		const pending = createPendingForm(undefined, { id: 'active' })
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async () =>
				createSSEResponse([
					{ event: 'pending', data: pending },
					{ event: 'shutdown', data: '' },
				]),
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect'])

		await client.connect()
		await waitForDelay()

		expect(terminal.active?.status).toBe('abandoned')
		expect(events.connect.count).toBe(1)
		expect(events.disconnect.count).toBe(1)
		expect(client.connected).toBe(false)
		client.destroy()
	})

	it('drops invalid envelopes and malformed schemas without rendering', async () => {
		const terminal = createRecordingTerminal()
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async () =>
				createSSEResponse([
					{ event: 'pending', data: { id: '', schema: {}, status: 'pending', time: 1 } },
					{
						event: 'pending',
						data: { id: 'bad-schema', schema: { fields: 'nope' }, status: 'pending', time: 1 },
					},
				]),
		})
		const events = recordEmitterEvents(client.emitter, ['error'])

		await client.connect()

		expect(terminal.calls.count).toBe(0)
		expect(events.error.count).toBe(1)
		expect(events.error.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: 'broker sent an invalid form schema for bad-schema' }),
		)
		client.destroy()
	})

	it('deduplicates the same id while its local form is in flight', async () => {
		const terminal = createRecordingTerminal({ defer: true })
		const pending = createPendingForm(undefined, { id: 'same' })
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async () =>
				createSSEResponse([
					{ event: 'pending', data: pending },
					{ event: 'pending', data: pending },
				]),
		})

		await client.connect()
		await waitForDelay()
		expect(terminal.calls.count).toBe(1)
		client.destroy()
	})

	it('reports malformed answer responses and ends the local attempt', async () => {
		const terminal = createRecordingTerminal({ answers: [{ name: 'Ada' }] })
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async (_input, init) =>
				init?.method === 'POST'
					? createJSONResponse({ success: 'yes' })
					: createSSEResponse([{ event: 'pending', data: createPendingForm() }]),
		})
		const events = recordEmitterEvents(client.emitter, ['error'])

		await client.connect()
		await waitForDelay()

		expect(events.error.calls[0]?.[0]).toEqual(
			expect.objectContaining({ message: 'broker returned an invalid answer result for form-1' }),
		)
		client.destroy()
	})

	it('sends the token on GET and POST and warns once only for insecure remote HTTP', async () => {
		const terminal = createRecordingTerminal({ answers: [{ name: 'Ada' }] })
		const headers: Array<Readonly<Record<string, string>> | undefined> = []
		const client = createPromptClient({
			url: 'http://example.com/prompts',
			token: 'secret',
			terminal,
			reconnect: false,
			fetch: async (_input, init) => {
				headers.push(init?.headers)
				return init?.method === 'POST'
					? createJSONResponse({ success: true, value: { name: 'Ada' } })
					: createSSEResponse([{ event: 'pending', data: createPendingForm() }])
			},
		})
		const events = recordEmitterEvents(client.emitter, ['error'])

		await client.connect()
		await waitForDelay()

		expect(headers).toEqual([
			{ Accept: 'text/event-stream', [HEADER_TOKEN]: 'secret' },
			{ 'Content-Type': 'application/json', [HEADER_TOKEN]: 'secret' },
		])
		expect(events.error.count).toBe(1)
		client.destroy()
	})

	it('destroy is permanent and a later connect performs no fetch', async () => {
		const terminal = createRecordingTerminal()
		let fetches = 0
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			fetch: async () => {
				fetches += 1
				return createSSEResponse([])
			},
		})
		client.destroy()
		await client.connect()
		expect(fetches).toBe(0)
	})
})
