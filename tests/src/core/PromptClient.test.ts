import type {
	CheckboxOptions,
	FetchHandler,
	InputOptions,
	PromptFormInterface,
	SelectOptions,
} from '@src/core'
import { createPromptClient, HEADER_TOKEN } from '@src/core'
import {
	createManualTimer,
	createRecorder,
	createSSEResponse,
	recordEmitterEvents,
	waitForDelay,
} from '../../setup.js'
import { describe, expect, it } from 'vitest'

// The SSE prompt BRIDGE, driven deterministically by an INJECTED fetch returning a controlled SSE
// `ReadableStream` (no real network): the client opens the stream, dispatches each decoded pending
// prompt to a LOCAL stub terminal, and POSTs the answer back. The injected timer drives the
// reconnect backoff. A recorder asserts the §13 events (connect / disconnect / expire / error) and
// the stub terminal records the options it was dispatched (proving §14 wire reconstruction).

// One recorded fetch call (so a test asserts the GET that opened the stream + each POSTed answer).
interface FetchCall {
	readonly url: string
	readonly method: string
	readonly headers: Readonly<Record<string, string>>
	readonly body?: string
}

// A scripted fetch: each GET pops the next queued SSE Response (an empty ended stream once the
// queue drains, so a reconnect loop keeps terminating); each POST resolves 200 OK. Every call is
// recorded for assertion.
function scriptedFetch(responses: readonly Response[]): {
	readonly fetch: FetchHandler
	readonly calls: readonly FetchCall[]
} {
	const queue = [...responses]
	const calls: FetchCall[] = []
	const fetch: FetchHandler = (url, init) => {
		const method = init?.method ?? 'GET'
		calls.push({ url, method, headers: init?.headers ?? {}, body: init?.body })
		if (method === 'POST') return Promise.resolve(new Response(null, { status: 200 }))
		return Promise.resolve(queue.shift() ?? createSSEResponse([]))
	}
	return { fetch, calls }
}

// A stub local terminal that records each dispatched options bag and answers with a scripted value
// per form. A real PromptFormInterface (not a mock) — it just resolves immediately.
function stubTerminal(answers: Partial<Record<keyof PromptFormInterface, unknown>>): {
	readonly terminal: PromptFormInterface
	readonly inputs: ReturnType<typeof createRecorder<readonly [InputOptions]>>
	readonly selects: ReturnType<typeof createRecorder<readonly [SelectOptions]>>
	readonly checkboxes: ReturnType<typeof createRecorder<readonly [CheckboxOptions]>>
} {
	const inputs = createRecorder<readonly [InputOptions]>()
	const selects = createRecorder<readonly [SelectOptions]>()
	const checkboxes = createRecorder<readonly [CheckboxOptions]>()
	const terminal: PromptFormInterface = {
		async input(options) {
			inputs.handler(options)
			return typeof answers.input === 'string' ? answers.input : ''
		},
		async password(options) {
			inputs.handler(options)
			return typeof answers.password === 'string' ? answers.password : ''
		},
		async confirm() {
			return answers.confirm === true
		},
		async select(options) {
			selects.handler(options)
			return typeof answers.select === 'string' ? answers.select : ''
		},
		async checkbox(options) {
			checkboxes.handler(options)
			return Array.isArray(answers.checkbox)
				? answers.checkbox.filter((v): v is string => typeof v === 'string')
				: []
		},
		async editor() {
			return typeof answers.editor === 'string' ? answers.editor : ''
		},
	}
	return { terminal, inputs, selects, checkboxes }
}

describe('PromptClient — dispatch + answer', () => {
	it('dispatches a pending prompt to the local terminal and POSTs the answer back', async () => {
		const pending = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: { default: 'Ada', validate: { required: true } },
			status: 'pending',
			time: 1,
		}
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: pending }]),
		])
		const { terminal, inputs } = stubTerminal({ input: 'Grace' })
		const client = createPromptClient({
			url: 'http://broker/prompts',
			terminal,
			reconnect: false,
			fetch,
		})

		await client.connect()

		// The terminal received the reconstructed options (default + validate rules survived the wire).
		expect(inputs.count).toBe(1)
		const [options] = inputs.calls[0]
		expect(options.message).toBe('Name?')
		expect(options.default).toBe('Ada')
		expect(options.validate).toEqual({ required: true })

		// The GET opened the stream; the POST sent the answer back to the same url.
		const post = calls.find((call) => call.method === 'POST')
		expect(post?.url).toBe('http://broker/prompts')
		expect(post?.body).toBe(JSON.stringify({ id: 'p1', value: 'Grace' }))
	})

	it('reconstructs select choices across the wire', async () => {
		const pending = {
			id: 'p2',
			form: 'select',
			message: 'Pick',
			options: { choices: ['a', { name: 'Bee', value: 'b' }], default: 'b' },
			status: 'pending',
			time: 1,
		}
		const { fetch } = scriptedFetch([createSSEResponse([{ event: 'pending', data: pending }])])
		const { terminal, selects } = stubTerminal({ select: 'b' })
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		await client.connect()
		const [options] = selects.calls[0]
		expect(options.choices).toEqual(['a', { name: 'Bee', value: 'b' }])
		expect(options.default).toBe('b')
	})

	it('ignores a non-PendingPrompt payload (§14 narrowing rejects it)', async () => {
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: { id: 'x' } }]), // missing form/options/etc.
		])
		const { terminal, inputs } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		await client.connect()
		expect(inputs.count).toBe(0)
		expect(calls.some((call) => call.method === 'POST')).toBe(false)
	})
})

describe('PromptClient — connection events', () => {
	it('emits connect then disconnect across one stream', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.connect.count).toBe(1)
		expect(events.disconnect.count).toBe(1)
		expect(client.connected).toBe(false)
	})

	it('emits expire on a server expire event', async () => {
		const { fetch } = scriptedFetch([
			createSSEResponse([{ event: 'expire', data: { id: 'gone' } }]),
		])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.expire.calls).toEqual([['gone']])
	})

	it('emits error on a non-OK response', async () => {
		const fetch: FetchHandler = () => Promise.resolve(new Response('nope', { status: 500 }))
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(1)
		expect(events.connect.count).toBe(0)
	})
})

describe('PromptClient — reconnect', () => {
	it('reconnects with the injected delay after the stream drops', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([]), createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			delay: 50,
			fetch,
			timer: timer.handler,
		})

		// Kick off the (infinite) reconnect loop without awaiting; let the first stream run.
		void client.connect()
		await waitForDelay()
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
		expect(timer.pending).toBe(1) // parked on the reconnect backoff

		// Fire the backoff timer — the client reconnects (a second GET).
		timer.flush()
		await waitForDelay()
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)

		client.destroy()
	})

	it('disconnect() stops the reconnect loop while parked on the backoff (no reconnect)', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			delay: 50,
			fetch,
			timer: timer.handler,
		})

		// Kick off the loop; the first (empty) stream ends and the loop parks on the backoff timer.
		void client.connect()
		await waitForDelay()
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
		expect(timer.pending).toBe(1) // parked on the reconnect backoff

		// Disconnect WHILE parked: the loop must wake, see the cleared flag, and EXIT (not reconnect).
		client.disconnect()
		expect(timer.pending).toBe(0) // the backoff timer was cancelled
		timer.flush() // even firing any stragglers must not reconnect
		await waitForDelay()
		// No SECOND GET — the loop exited instead of re-entering #stream(). (Fails without the FIX-1
		// flag: a parked backoff would wake on flush and reconnect.)
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)

		client.destroy()
	})

	it('does not reconnect after disconnect (an abort is not a fault)', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			fetch,
			timer: timer.handler,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		void client.connect()
		await waitForDelay()
		client.disconnect()
		client.destroy()
		await waitForDelay()
		// A deliberate disconnect surfaces no error event.
		expect(events.error.count).toBe(0)
	})
})

describe('PromptClient — auth token', () => {
	it('sends the token header on the stream + answer requests', async () => {
		const pending = {
			id: 'p1',
			form: 'confirm',
			message: 'OK?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: pending }]),
		])
		const { terminal } = stubTerminal({ confirm: true })
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: false,
			token: 'secret',
			fetch,
		})

		await client.connect()
		expect(calls.every((call) => call.headers[HEADER_TOKEN] === 'secret')).toBe(true)
		const post = calls.find((call) => call.method === 'POST')
		expect(post?.body).toBe(JSON.stringify({ id: 'p1', value: true }))
	})

	it('omits the token header when no token is configured', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		await client.connect()
		expect(calls.every((call) => call.headers[HEADER_TOKEN] === undefined)).toBe(true)
	})
})

// ============================================================================
// HARDENING — wire-payload totality (malformed lines guard-rejected, never a
// throw / dispatch), reconnect redelivery, and permanent destroy().
// ============================================================================

describe('PromptClient — malformed wire payloads (§14 guards, no throw / dispatch)', () => {
	// Build a stream whose `pending` event carries an arbitrary RAW data string (not necessarily
	// JSON). Bypasses createSSEResponse's JSON.stringify so a non-JSON / off-shape line can be sent.
	function rawPendingStream(rawData: string): Response {
		const body = `event: pending\ndata: ${rawData}\n\n`
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(body))
				controller.close()
			},
		})
		return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
	}

	// Each malformed payload must be silently rejected: no terminal dispatch, no POST, no error event,
	// no throw out of connect().
	const payloads: readonly { readonly label: string; readonly raw: string }[] = [
		{ label: 'a non-JSON line', raw: 'not json at all' },
		{ label: 'a JSON number (not a record)', raw: '42' },
		{ label: 'a JSON string (not a record)', raw: '"hello"' },
		{ label: 'a JSON array (not a record)', raw: '[1,2,3]' },
		{ label: 'a JSON null', raw: 'null' },
		{ label: 'a record missing form / status / time', raw: '{"id":"x","message":"m"}' },
		{
			label: 'a record with a bogus form',
			raw: '{"id":"x","form":"bogus","message":"m","options":{},"status":"pending","time":1}',
		},
		{
			label: 'a record with an empty id',
			raw: '{"id":"","form":"input","message":"m","options":{},"status":"pending","time":1}',
		},
	]
	for (const { label, raw } of payloads) {
		it(`rejects ${label} (no dispatch, no POST, no error)`, async () => {
			const { fetch, calls } = scriptedFetch([])
			// Replace the queued GET response with the raw-payload stream.
			const wrappedFetch: FetchHandler = (url, init) => {
				if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(rawPendingStream(raw))
				return fetch(url, init)
			}
			const { terminal, inputs } = stubTerminal({})
			const client = createPromptClient({
				url: 'http://broker/p',
				terminal,
				reconnect: false,
				fetch: wrappedFetch,
			})
			const events = recordEmitterEvents(client.emitter, [
				'connect',
				'disconnect',
				'expire',
				'error',
			])

			await expect(client.connect()).resolves.toBeUndefined() // never throws
			expect(inputs.count).toBe(0) // never dispatched
			expect(calls.some((call) => call.method === 'POST')).toBe(false) // never answered
			expect(events.error.count).toBe(0) // a malformed line is not an `error`
		})
	}

	it('a malformed expire payload is ignored (no expire event)', async () => {
		const { fetch } = scriptedFetch([
			createSSEResponse([{ event: 'expire', data: { nothing: true } }]), // no id field
		])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])
		await client.connect()
		expect(events.expire.count).toBe(0)
	})

	it('an unknown SSE event name is ignored (no throw, stream completes cleanly)', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([{ event: 'mystery', data: { x: 1 } }])])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])
		await client.connect()
		expect(events.connect.count).toBe(1)
		expect(events.disconnect.count).toBe(1)
		expect(events.error.count).toBe(0)
	})
})

describe('PromptClient — reconnect redelivery & shutdown', () => {
	it('the same prompt id, redelivered across a reconnect, is dispatched each fresh arrival', async () => {
		// #active is cleared in `finally` once a dispatch settles, so a legitimate REDELIVERY on a
		// later stream is handled again (the in-flight dedupe guard only suppresses a still-pending
		// duplicate — the serial read loop never overlaps two dispatches of one id within a stream).
		const pending = {
			id: 'dup',
			form: 'input',
			message: 'Name?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: pending }]),
			createSSEResponse([{ event: 'pending', data: pending }]),
		])
		const { terminal, inputs } = stubTerminal({ input: 'Ada' })
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			delay: 10,
			fetch,
			timer: timer.handler,
		})

		void client.connect()
		await waitForDelay()
		expect(inputs.count).toBe(1) // first stream dispatched once
		timer.flush() // reconnect
		await waitForDelay()
		expect(inputs.count).toBe(2) // redelivery dispatched again (not stuck-deduped)
		expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)

		client.destroy()
	})

	it('a shutdown event tears the client down permanently', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([{ event: 'shutdown', data: {} }])])
		const { terminal } = stubTerminal({})
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			fetch,
			timer: timer.handler,
		})

		await client.connect()
		expect(client.connected).toBe(false)
		// Destroyed: a later connect() is a no-op (returns immediately, opens no stream).
		await expect(client.connect()).resolves.toBeUndefined()
	})
})

describe('PromptClient — destroy is permanent', () => {
	it('destroy() prevents any further connect (no GET issued afterward)', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		client.destroy()
		await client.connect() // a no-op on a destroyed client
		expect(calls).toHaveLength(0) // no GET, no POST — nothing happened
		expect(client.connected).toBe(false)
	})

	it('destroy() during an active reconnect loop stops it and emits no error', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal,
			reconnect: true,
			delay: 10,
			fetch,
			timer: timer.handler,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		void client.connect()
		await waitForDelay()
		expect(timer.pending).toBe(1) // parked on backoff
		client.destroy()
		expect(timer.pending).toBe(0) // backoff cancelled
		timer.flush()
		await waitForDelay()
		// No second GET, no error from the deliberate teardown.
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1)
		expect(events.error.count).toBe(0)
	})

	it('destroy() is idempotent', () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = stubTerminal({})
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		expect(() => {
			client.destroy()
			client.destroy()
		}).not.toThrow()
	})
})
