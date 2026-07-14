import type { FetchHandler, PromptFormInterface } from '@src/core'
import { createPromptClient, HEADER_TOKEN, SSE_BUFFER_LIMIT } from '@src/core'
import {
	createManualTimer,
	createRecordingTerminal,
	createSSEResponse,
	recordEmitterEvents,
	waitForDelay,
} from '../../setup.js'
import { describe, expect, it } from 'vitest'

// The SSE prompt BRIDGE, driven deterministically by an INJECTED fetch returning a controlled SSE
// `ReadableStream` (no real network): the client opens the stream, dispatches each decoded pending
// prompt to a LOCAL recording terminal, and POSTs the answer back. The injected timer drives the
// reconnect backoff. A recorder asserts the §13 events (connect / disconnect / expire / error) and
// the recording terminal records the options it was dispatched (proving §14 wire reconstruction).

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

// A stream that never closes and never enqueues — stays "open" until `signal` aborts, so a test
// can catch the client in a genuinely CONNECTED (not-yet-ended) state to exercise a real
// connected→disconnected transition (N1 concurrency, T2 disconnect/destroy while connected). Mirrors
// a real fetch's behavior on an aborted in-flight stream: the pending `reader.read()` rejects with
// an AbortError instead of hanging forever.
function hangingStream(signal: AbortSignal | undefined): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			signal?.addEventListener('abort', () => {
				controller.error(new DOMException('aborted', 'AbortError'))
			})
		},
	})
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
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
		const { terminal, calls: recorded } = createRecordingTerminal({ answers: { input: 'Grace' } })
		const client = createPromptClient({
			url: 'http://broker/prompts',
			terminal,
			reconnect: false,
			fetch,
		})

		await client.connect()

		// The terminal received the reconstructed options (default + validate rules survived the wire).
		expect(recorded.input.count).toBe(1)
		const [options] = recorded.input.calls[0]
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
		const { terminal, calls: recorded } = createRecordingTerminal({ answers: { select: 'b' } })
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		await client.connect()
		const [options] = recorded.select.calls[0]
		expect(options.choices).toEqual(['a', { name: 'Bee', value: 'b' }])
		expect(options.default).toBe('b')
	})

	it('ignores a non-PendingPrompt payload (§14 narrowing rejects it)', async () => {
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: { id: 'x' } }]), // missing form/options/etc.
		])
		const { terminal, calls: recorded } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		await client.connect()
		expect(recorded.input.count).toBe(0)
		expect(calls.some((call) => call.method === 'POST')).toBe(false)
	})
})

describe('PromptClient — connection events', () => {
	it('emits connect then disconnect across one stream', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
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
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.expire.calls).toEqual([['gone']])
	})

	it('emits error on a non-OK response', async () => {
		const fetch: FetchHandler = () => Promise.resolve(new Response('nope', { status: 500 }))
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(1)
		expect(events.connect.count).toBe(0)
	})
})

describe('PromptClient — disconnect emits exactly once (T2)', () => {
	it('fires exactly once on a clean server-end', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.disconnect.count).toBe(1)
	})

	it('fires exactly once when disconnect() tears down an active connection', async () => {
		const { fetch: baseFetch } = scriptedFetch([])
		const fetch: FetchHandler = (url, init) => {
			if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(hangingStream(init?.signal))
			return baseFetch(url, init)
		}
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		const connecting = client.connect()
		await waitForDelay()
		expect(events.connect.count).toBe(1)
		expect(client.connected).toBe(true)

		client.disconnect()
		await connecting

		expect(events.disconnect.count).toBe(1)
		// Calling disconnect() again (already disconnected) must not double-emit.
		client.disconnect()
		expect(events.disconnect.count).toBe(1)
	})

	it('fires exactly once when destroy() tears down an active connection', async () => {
		const { fetch: baseFetch } = scriptedFetch([])
		const fetch: FetchHandler = (url, init) => {
			if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(hangingStream(init?.signal))
			return baseFetch(url, init)
		}
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		const connecting = client.connect()
		await waitForDelay()
		expect(client.connected).toBe(true)

		client.destroy()
		await connecting

		expect(events.disconnect.count).toBe(1)
		// destroy() is idempotent and must not double-emit.
		client.destroy()
		expect(events.disconnect.count).toBe(1)
	})
})

describe('PromptClient — error events (T8)', () => {
	it('emits error when the POST answer request fails (non-OK response)', async () => {
		const pending = {
			id: 'p1',
			form: 'confirm',
			message: 'OK?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const { fetch: baseFetch } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: pending }]),
		])
		const fetch: FetchHandler = (url, init) => {
			if ((init?.method ?? 'GET') === 'POST')
				return Promise.resolve(new Response(null, { status: 500 }))
			return baseFetch(url, init)
		}
		const { terminal } = createRecordingTerminal({ answers: { confirm: true } })
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(1)
	})

	it('emits error when the terminal throws mid-dispatch (dispatch-catch)', async () => {
		const pending = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'pending', data: pending }]),
		])
		// A real (not mocked) PromptFormInterface implementation that deliberately throws — a
		// scripted collaborator exercising the #dispatch catch path.
		const throwingTerminal: PromptFormInterface = {
			async input() {
				throw new Error('terminal exploded')
			},
			async password() {
				return ''
			},
			async confirm() {
				return false
			},
			async select() {
				return ''
			},
			async checkbox() {
				return []
			},
			async editor() {
				return ''
			},
		}
		const client = createPromptClient({
			url: 'http://broker/p',
			terminal: throwingTerminal,
			reconnect: false,
			fetch,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(1)
		expect(calls.some((call) => call.method === 'POST')).toBe(false) // never reached the POST
	})
})

describe('PromptClient — concurrent connect() (N1)', () => {
	it('two concurrent connect() calls do not double-open a stream', async () => {
		let opens = 0
		const fetch: FetchHandler = (url, init) => {
			if ((init?.method ?? 'GET') === 'GET') {
				opens += 1
				return Promise.resolve(hangingStream(init?.signal))
			}
			return Promise.resolve(new Response(null, { status: 200 }))
		}
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		const first = client.connect()
		const second = client.connect() // concurrent — must return immediately without opening a second stream
		await second
		await waitForDelay()

		expect(opens).toBe(1) // a single stream/controller was opened
		expect(client.connected).toBe(true)

		client.destroy()
		await first
	})
})

describe('PromptClient — strict serial dispatch (N6)', () => {
	// CONFIRMING TEST: delivers two DIFFERENT pending ids (X then Y) on one stream, holding X's
	// terminal call deferred. Proves the read loop processes ONE prompt at a time, in order: while
	// X is in flight, the loop has not yet read/dispatched Y's event at all — only X has reached
	// the terminal. Releasing X lets the loop continue and dispatch Y next.
	it('dispatches one prompt at a time, in order — the second is not reached while the first is in flight', async () => {
		const pendingX = {
			id: 'x',
			form: 'input',
			message: 'X?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const pendingY = {
			id: 'y',
			form: 'input',
			message: 'Y?',
			options: {},
			status: 'pending',
			time: 1,
		}
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([
				{ event: 'pending', data: pendingX },
				{ event: 'pending', data: pendingY },
			]),
		])
		const { terminal, calls: recorded, controller } = createRecordingTerminal({ defer: ['input'] })
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		const connecting = client.connect()
		await waitForDelay()
		// Only X has reached the terminal — the loop is still awaiting X's dispatch, so it has not
		// yet read the next SSE event to dispatch Y.
		expect(controller.pending).toHaveLength(1)
		expect(recorded.input.count).toBe(1)
		expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)

		// Release X — the loop's #dispatch(x) settles, POSTs X's answer, then reads and dispatches Y.
		controller.release('input')
		await waitForDelay()
		expect(recorded.input.count).toBe(2) // Y has now reached the terminal too
		expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1) // only X's answer POSTed so far

		// Drain Y so the connect() promise can settle, then clean up.
		controller.release()
		await connecting
		expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)
		client.destroy()
	})
})

describe('PromptClient — insecure token warning (N7)', () => {
	it('warns exactly once via error event for a token sent over a plain http remote host', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([]), createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
		const timer = createManualTimer()
		const client = createPromptClient({
			url: 'http://example.com/prompts',
			terminal,
			token: 'secret',
			reconnect: true,
			delay: 10,
			fetch,
			timer: timer.handler,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		void client.connect()
		await waitForDelay()
		timer.flush() // trigger a reconnect — the warning must not fire again
		await waitForDelay()

		expect(events.error.count).toBe(1)
		client.destroy()
	})

	it('does not warn for an https remote host', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({
			url: 'https://example.com/p',
			terminal,
			token: 'secret',
			reconnect: false,
			fetch,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(0)
	})

	it('does not warn for an http loopback host', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({
			url: 'http://localhost:3000/p',
			terminal,
			token: 'secret',
			reconnect: false,
			fetch,
		})
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.error.count).toBe(0)
	})
})

describe('PromptClient — oversized SSE event is bounded (N9)', () => {
	it('surfaces an error instead of hanging when the SSE buffer limit is exceeded', async () => {
		// An unterminated `data:` field larger than SSE_BUFFER_LIMIT — the parser throws an
		// OVERFLOW error synchronously; the client must surface it as an `error` event, never hang.
		function oversizedStream(): Response {
			const body = `event: pending\ndata: ${'x'.repeat(SSE_BUFFER_LIMIT + 10)}`
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(body))
					controller.close()
				},
			})
			return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
		}
		const fetch: FetchHandler = (url, init) => {
			if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(oversizedStream())
			return Promise.resolve(new Response(null, { status: 200 }))
		}
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect() // must resolve (never freeze) even though the parser overflowed
		expect(events.error.count).toBe(1)
	})
})

describe('PromptClient — reconnect', () => {
	it('reconnects with the injected delay after the stream drops', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([]), createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
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
		const { terminal } = createRecordingTerminal()
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
		const { terminal } = createRecordingTerminal()
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
		const { terminal } = createRecordingTerminal({ answers: { confirm: true } })
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
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		await client.connect()
		expect(calls.every((call) => call.headers[HEADER_TOKEN] === undefined)).toBe(true)
	})
})

// ============================================================================
// HARDENING — wire-payload totality (malformed lines guard-rejected, never a
// throw / dispatch), reconnect redelivery, and shutdown-disconnect.
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
			const { terminal, calls: recorded } = createRecordingTerminal()
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
			expect(recorded.input.count).toBe(0) // never dispatched
			expect(calls.some((call) => call.method === 'POST')).toBe(false) // never answered
			expect(events.error.count).toBe(0) // a malformed line is not an `error`
		})
	}

	it('a malformed expire payload is ignored (no expire event)', async () => {
		const { fetch } = scriptedFetch([
			createSSEResponse([{ event: 'expire', data: { nothing: true } }]), // no id field
		])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])
		await client.connect()
		expect(events.expire.count).toBe(0)
	})

	it('an unknown SSE event name is ignored (no throw, stream completes cleanly)', async () => {
		const { fetch } = scriptedFetch([createSSEResponse([{ event: 'mystery', data: { x: 1 } }])])
		const { terminal } = createRecordingTerminal()
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
		// Dispatch is strictly serial and does NOT dedupe across completion: a redelivery of the
		// SAME id on a LATER stream (after the earlier dispatch fully resolved and POSTed) is
		// dispatched again, correctly — the client has no memory of ids it already answered. This
		// is the real, intended behavior (see the "strict serial dispatch (N6)" test above for the
		// in-order, one-at-a-time guarantee within a single stream).
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
		const { terminal, calls: recorded } = createRecordingTerminal({ answers: { input: 'Ada' } })
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
		expect(recorded.input.count).toBe(1) // first stream dispatched once
		timer.flush() // reconnect
		await waitForDelay()
		expect(recorded.input.count).toBe(2) // redelivery dispatched again (not stuck-deduped)
		expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2)

		client.destroy()
	})

	it('a shutdown event disconnects (not destroys) and the client stays reusable (N8)', async () => {
		const { fetch, calls } = scriptedFetch([
			createSSEResponse([{ event: 'shutdown', data: {} }]),
			createSSEResponse([]),
		])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		const events = recordEmitterEvents(client.emitter, ['connect', 'disconnect', 'expire', 'error'])

		await client.connect()
		expect(events.connect.count).toBe(1)
		expect(events.disconnect.count).toBe(1) // exactly one disconnect from the shutdown
		expect(client.connected).toBe(false)
		expect(events.error.count).toBe(0) // a deliberate shutdown-disconnect is not a fault

		// The client is NOT destroyed — a subsequent connect() opens a fresh stream.
		await client.connect()
		expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)
		expect(events.connect.count).toBe(2)
	})
})

describe('PromptClient — destroy is permanent', () => {
	it('destroy() prevents any further connect (no GET issued afterward)', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })

		client.destroy()
		await client.connect() // a no-op on a destroyed client
		expect(calls).toHaveLength(0) // no GET, no POST — nothing happened
		expect(client.connected).toBe(false)
	})

	it('destroy() during an active reconnect loop stops it and emits no error', async () => {
		const { fetch, calls } = scriptedFetch([createSSEResponse([])])
		const { terminal } = createRecordingTerminal()
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
		const { terminal } = createRecordingTerminal()
		const client = createPromptClient({ url: 'http://broker/p', terminal, reconnect: false, fetch })
		expect(() => {
			client.destroy()
			client.destroy()
		}).not.toThrow()
	})
})
