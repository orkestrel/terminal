import type {
	FetchHandler,
	PendingPrompt,
	PromptClientEventMap,
	PromptClientInterface,
	PromptClientOptions,
	PromptFormInterface,
	TimerCancel,
	TimerHandler,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { SSEEvent } from '@orkestrel/sse'
import {
	ACCEPT_EVENT_STREAM,
	DEFAULT_RECONNECT_DELAY_MS,
	HEADER_TOKEN,
	SSE_BUFFER_LIMIT,
	SSE_EVENTS,
} from './constants.js'
import {
	defaultTimer,
	dispatchPendingPrompt,
	globalFetch,
	isAbortError,
	isInsecureRemote,
	isPendingPrompt,
	parseWireJSON,
} from './helpers.js'
import { Emitter } from '@orkestrel/emitter'
import { createSSEParser } from '@orkestrel/sse'
import { isRecord, isString } from '@orkestrel/contract'

/**
 * The SSE prompt BRIDGE (observable §13) — the client-side counterpart to
 * {@link import('./Prompt.js').Prompt}. Connects to a remote broker's SSE endpoint, receives
 * serialized pending prompts, dispatches EACH to a LOCAL {@link PromptFormInterface} terminal (so
 * a human at THIS machine answers a prompt parked elsewhere), and POSTs the answer back.
 * Universal — `fetch` + SSE are web-standard, so it runs in a browser or on a server; the
 * injected `fetch` / timer make it fully deterministic in tests.
 *
 * @remarks
 * - **Connect + reconnect.** {@link connect} opens the SSE stream (via the injected `fetch` + the
 *   core `SSEParser`) and loops, reconnecting after the stream drops with the `delay` backoff
 *   (driven by the injected timer) — unless `reconnect` is `false`, the client was
 *   {@link destroy}ed, or the drop was a deliberate {@link disconnect} (an abort).
 * - **Dispatch + answer.** Each decoded `pending` event is narrowed to a `PendingPrompt` (§14 —
 *   never an `as`), dispatched to `terminal`, and its resolved value POSTed back to `url`.
 *   Dispatch is strictly SERIAL: the read loop drives the terminal for ONE prompt at a time and
 *   only reads/dispatches the next event after the current prompt fully settles (its answer
 *   POSTed). A prompt id redelivered by the broker AFTER its prior dispatch has settled is
 *   dispatched again — the client does not dedupe across completion.
 * - **Server signals.** An `expire` event (the broker dropped a parked prompt) emits `expire`; a
 *   `shutdown` event calls {@link disconnect} (not {@link destroy}) — the client stops streaming
 *   without auto-reconnect but stays reusable; a later {@link connect} recovers it.
 * - **Lean events (§13).** `connect` / `disconnect` / `expire` / `error` — errors are `unknown`.
 *   `disconnect` fires exactly once per connected-to-disconnected transition, whether triggered by
 *   the server ending the stream cleanly or by a deliberate {@link disconnect} / {@link destroy}.
 *
 * @example
 * ```ts
 * const client = createPromptClient({
 * 	url: 'http://localhost:3001/prompts',
 * 	terminal: createTerminal(), // a local PromptFormInterface (T-c)
 * 	on: { connect: () => log('connected') },
 * })
 * await client.connect() // streams remote prompts to the local terminal, POSTs answers back
 * ```
 */
export class PromptClient implements PromptClientInterface {
	readonly url: string
	readonly #terminal: PromptFormInterface
	readonly #token: string | undefined
	readonly #reconnect: boolean
	readonly #delay: number
	readonly #fetch: FetchHandler
	readonly #timer: TimerHandler
	readonly #emitter: Emitter<PromptClientEventMap>
	#controller: AbortController | undefined
	#backoff: TimerCancel | undefined
	#wake: (() => void) | undefined
	#connecting = false
	#connected = false
	#destroyed = false
	#warnedInsecureToken = false

	constructor(options: PromptClientOptions) {
		this.url = options.url
		this.#terminal = options.terminal
		this.#token = options.token
		this.#reconnect = options.reconnect ?? true
		this.#delay = options.delay ?? DEFAULT_RECONNECT_DELAY_MS
		this.#fetch = options.fetch ?? globalFetch
		this.#timer = options.timer ?? defaultTimer
		this.#emitter = new Emitter({ on: options.on, error: options.error })
	}

	get emitter(): EmitterInterface<PromptClientEventMap> {
		return this.#emitter
	}

	get connected(): boolean {
		return this.#connected
	}

	// === Connection lifecycle

	async connect(): Promise<void> {
		if (this.#destroyed) return
		// Re-entrancy guard: a connect already in progress owns `#controller` / the backoff fields —
		// a second concurrent call must not race them, so it returns immediately.
		if (this.#connecting) return
		// Arm the "should be connected" flag — `disconnect()` clears it to stop the reconnect loop
		// (a deliberate disconnect, not a transport drop); re-arming here lets a later connect restart.
		this.#connecting = true
		while (this.#connecting && !this.#destroyed) {
			try {
				await this.#stream()
			} catch (error) {
				this.#markDisconnected()
				if (this.#destroyed || isAbortError(error)) return
				this.#emitter.emit('error', error)
			}
			// Stop after a clean end / error unless reconnect is on and the client is still connecting.
			if (!this.#reconnect || !this.#connecting || this.#destroyed) return
			// Park on the backoff. `disconnect()` wakes this early and clears `#connecting`, so the loop
			// re-checks the flag above and EXITS instead of reconnecting.
			await this.#wait(this.#delay)
		}
	}

	disconnect(): void {
		// Stop the CURRENT connection AND prevent reconnect — the user explicitly disconnected. Clearing
		// `#connecting` makes the connect loop exit the next time it re-checks (a later `connect()` may
		// restart it). Abort an in-flight stream; and if the loop is parked on the backoff, cancel that
		// timer and wake the parked `#wait` so the loop re-checks `#connecting` immediately and exits.
		this.#connecting = false
		this.#controller?.abort()
		this.#controller = undefined
		this.#backoff?.()
		this.#backoff = undefined
		const wake = this.#wake
		this.#wake = undefined
		wake?.()
		this.#markDisconnected()
	}

	destroy(): void {
		if (this.#destroyed) return
		this.#destroyed = true
		this.disconnect()
		this.#emitter.destroy()
	}

	// === Private helpers

	// Open the SSE stream once and pump it to completion: GET the endpoint, read the body stream,
	// decode bytes, feed the core SSEParser, and handle each dispatched event. Throws on a non-OK
	// response / missing body / abort — `connect` catches and (maybe) reconnects.
	async #stream(): Promise<void> {
		if (this.#token !== undefined && isInsecureRemote(this.url) && !this.#warnedInsecureToken) {
			this.#warnedInsecureToken = true
			this.#emitter.emit(
				'error',
				new Error('auth token sent as cleartext over insecure http; use https'),
			)
		}
		const controller = new AbortController()
		this.#controller = controller
		const response = await this.#fetch(this.url, {
			headers: this.#headers({ Accept: ACCEPT_EVENT_STREAM }),
			signal: controller.signal,
		})
		if (!response.ok) throw new Error(`broker returned ${String(response.status)}`)
		const body = response.body
		if (body === null) throw new Error('broker sent no stream')

		this.#connected = true
		this.#emitter.emit('connect')

		const reader = body.getReader()
		const decoder = new TextDecoder()
		// Bound the parser's internal buffer — an OVERFLOW throws out of `parser.parse`, propagates
		// through this loop, `connect`'s catch (as an `error` event), and into the backoff reconnect
		// (which opens a fresh parser); this propagate-and-reconnect policy is intentional.
		const parser = createSSEParser({ limit: SSE_BUFFER_LIMIT })
		try {
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				for (const event of parser.parse(decoder.decode(value, { stream: true }))) {
					await this.#handle(event)
				}
			}
		} finally {
			reader.releaseLock()
		}
		this.#markDisconnected()
	}

	// Route one decoded SSE event by its `event:` name (§14-narrow every payload).
	async #handle(event: SSEEvent): Promise<void> {
		if (event.event === SSE_EVENTS.pending) {
			const parsed = parseWireJSON(event.data)
			if (isPendingPrompt(parsed)) await this.#dispatch(parsed.id, parsed)
			return
		}
		if (event.event === SSE_EVENTS.expire) {
			const parsed = parseWireJSON(event.data)
			if (isRecord(parsed) && isString(parsed.id)) {
				this.#emitter.emit('expire', parsed.id)
			}
			return
		}
		if (event.event === SSE_EVENTS.shutdown) this.disconnect()
	}

	// Dispatch one pending prompt to the local terminal and POST its answer back. Dispatch is
	// strictly serial — see the class docstring — so this always runs to completion (or errors)
	// before the read loop reads and dispatches the next event.
	async #dispatch(id: string, pending: PendingPrompt): Promise<void> {
		try {
			const value = await dispatchPendingPrompt(this.#terminal, pending)
			await this.#post(id, value)
		} catch (error) {
			this.#emitter.emit('error', error)
		}
	}

	// POST one answer back to the broker; surface a non-OK / failed POST as an `error` event.
	async #post(id: string, value: unknown): Promise<void> {
		const response = await this.#fetch(this.url, {
			method: 'POST',
			headers: this.#headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ id, value }),
		})
		if (!response.ok) this.#emitter.emit('error', new Error(`broker rejected answer ${id}`))
	}

	// Emit `disconnect` exactly once per connected→disconnected transition — the single choke point
	// for both the clean server-end tail of `#stream` and the deliberate `disconnect()`/`destroy()`
	// teardown, so neither path can double-emit or miss the event.
	#markDisconnected(): void {
		if (!this.#connected) return
		this.#connected = false
		this.#emitter.emit('disconnect')
	}

	// Merge the base headers with the auth token header when a token is configured.
	#headers(base: Record<string, string>): Record<string, string> {
		if (this.#token !== undefined) base[HEADER_TOKEN] = this.#token
		return base
	}

	// Park `ms` on the INJECTED timer (deterministic in tests) — the reconnect backoff. The timer's
	// cancel and the resolver are held on `#backoff` / `#wake` so `disconnect()` can wake the loop
	// early (cancel the timer + resolve now); both clear on settle so they never fire twice.
	#wait(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const settle = (): void => {
				this.#backoff = undefined
				this.#wake = undefined
				resolve()
			}
			this.#wake = settle
			this.#backoff = this.#timer(() => {
				settle()
			}, ms)
		})
	}
}
