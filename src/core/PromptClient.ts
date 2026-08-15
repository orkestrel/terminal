import type {
	FetchHandler,
	PromptClientEventMap,
	PromptClientInterface,
	PromptClientOptions,
	TimerCancel,
	TimerHandler,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { FieldError, FormInterface, FormSchema, FormValues } from '@orkestrel/form'
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
	globalFetch,
	isAbortError,
	isInsecureRemote,
	sanitizeSchema,
} from './helpers.js'
import { isPendingForm } from './validators.js'
import { arrayOf, isBoolean, isRecord, isString, parseJSON } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createForm, isFieldError, parseForm } from '@orkestrel/form'
import { createSSEParser } from '@orkestrel/sse'

/**
 * The SSE form bridge. It ingests serialized forms from a remote broker, renders them through a
 * local terminal, and posts answers back without blocking the event stream.
 *
 * @remarks
 * - **Connect + reconnect.** {@link connect} opens the SSE stream and reconnects after a transport
 *   drop with the injected backoff unless reconnect is disabled, the client was destroyed, or
 *   {@link disconnect} deliberately stopped it.
 * - **Ingest + render.** Each `pending` envelope passes through `isPendingForm`, Form's `parseForm`,
 *   and terminal's `sanitizeSchema`, then enters a serial render queue. The SSE reader never awaits
 *   that queue, so `expire` and `shutdown` remain live while a person is answering.
 * - **Safe local form.** The rendering copy omits every wire `pattern`, because Form compiles a
 *   pattern during local evaluation. The broker's parked form retains it and remains authoritative.
 * - **Refusal retry.** A structured `rejected` response seeds a new rendering form with the values
 *   just submitted, applies every {@link FieldError} through `invalidate`, and asks again. No retry
 *   counter truncates the loop; acceptance, expiry, and shutdown are its bounds.
 * - **Replay safety.** A replayed id is skipped while it is queued, rendering, or posting. Once an
 *   attempt ends, a later delivery of that id may be rendered again.
 *
 * @example
 * ```ts
 * const client = createPromptClient({
 * 	url: 'http://localhost:3001/prompts',
 * 	terminal: createTerminal(),
 * })
 * await client.connect()
 * ```
 */
export class PromptClient implements PromptClientInterface {
	readonly url: string
	readonly #terminal: PromptClientOptions['terminal']
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
	#draining = false
	#warnedInsecureToken = false
	readonly #seen = new Set<string>()
	readonly #queue = new Map<string, FormSchema>()
	#active:
		| { readonly id: string; readonly form: FormInterface; readonly stopped: boolean }
		| undefined

	constructor(options: PromptClientOptions) {
		this.url = options.url
		this.#terminal = options.terminal
		this.#token = options.token
		this.#reconnect = options.reconnect ?? true
		this.#delay = options.delay ?? DEFAULT_RECONNECT_DELAY_MS
		this.#fetch = options.fetch ?? globalFetch
		this.#timer = options.timer ?? defaultTimer
		this.#emitter = new Emitter({
			...(options.on !== undefined ? { on: options.on } : {}),
			...(options.error !== undefined ? { error: options.error } : {}),
		})
	}

	get emitter(): EmitterInterface<PromptClientEventMap> {
		return this.#emitter
	}

	get connected(): boolean {
		return this.#connected
	}

	async connect(): Promise<void> {
		if (this.#destroyed || this.#connecting) return
		this.#connecting = true
		while (this.#connecting && !this.#destroyed) {
			try {
				await this.#stream()
			} catch (error) {
				this.#markDisconnected()
				if (this.#destroyed || isAbortError(error)) return
				this.#emitter.emit('error', error)
			}
			if (!this.#reconnect || !this.#connecting || this.#destroyed) return
			await this.#wait(this.#delay)
		}
	}

	disconnect(): void {
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
		this.#interrupt()
		this.#emitter.destroy()
	}

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
		const parser = createSSEParser({ limit: SSE_BUFFER_LIMIT })
		try {
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				for (const event of parser.parse(decoder.decode(value, { stream: true }))) {
					this.#handle(event)
					if (!this.#connecting) break
				}
				if (!this.#connecting) break
			}
		} finally {
			reader.releaseLock()
		}
		this.#markDisconnected()
	}

	#handle(event: SSEEvent): void {
		if (event.event === SSE_EVENTS.pending) {
			const parsed = parseJSON(event.data)
			if (!isPendingForm(parsed) || this.#seen.has(parsed.id)) return
			const schema = parseForm(parsed.schema)
			if (schema === undefined) {
				this.#emitter.emit(
					'error',
					new Error(`broker sent an invalid form schema for ${parsed.id}`),
				)
				return
			}
			this.#seen.add(parsed.id)
			this.#queue.set(parsed.id, sanitizeSchema(schema))
			void this.#drain()
			return
		}
		if (event.event === SSE_EVENTS.expire) {
			const parsed = parseJSON(event.data)
			if (isRecord(parsed) && isString(parsed.id)) this.#expire(parsed.id)
			return
		}
		if (event.event === SSE_EVENTS.shutdown) {
			this.disconnect()
			this.#interrupt()
		}
	}

	async #drain(): Promise<void> {
		if (this.#draining) return
		this.#draining = true
		try {
			while (!this.#destroyed) {
				let queued: readonly [string, FormSchema] | undefined
				for (const entry of this.#queue) {
					queued = entry
					break
				}
				if (queued === undefined) return
				const [id, schema] = queued
				this.#queue.delete(id)
				try {
					await this.#render(id, schema)
				} catch (error) {
					const active = this.#active
					if (active?.id !== id || !active.stopped) this.#emitter.emit('error', error)
				} finally {
					const active = this.#active
					if (active?.id === id) {
						active.form.destroy()
						this.#active = undefined
					}
					if (!this.#queue.has(id)) this.#seen.delete(id)
				}
			}
		} finally {
			this.#draining = false
		}
	}

	async #render(id: string, schema: FormSchema): Promise<void> {
		let values: FormValues | undefined
		let errors: readonly FieldError[] = []
		while (this.#seen.has(id) && !this.#destroyed) {
			const form = this.#createRenderingForm(schema, values)
			this.#active = { id, form, stopped: false }
			for (const error of errors) form.invalidate(error.field, error.message)
			const submitted = await this.#terminal.ask(form)
			const active = this.#active
			if (active?.id !== id || active.stopped) return
			const rejected = await this.#post(id, submitted)
			const posted = this.#active
			if (posted?.id !== id || posted.stopped || rejected === undefined) return
			values = submitted
			errors = rejected
			form.destroy()
			this.#active = undefined
		}
	}

	#createRenderingForm(schema: FormSchema, values?: FormValues): FormInterface {
		const fields = schema.fields.map((field) => {
			if (field.rule?.pattern === undefined) return field
			const { pattern: _pattern, ...rule } = field.rule
			return { ...field, rule }
		})
		const form = createForm({ ...schema, fields }, values === undefined ? undefined : { values })
		void form.answer.catch(() => undefined)
		return form
	}

	async #post(id: string, values: FormValues): Promise<readonly FieldError[] | undefined> {
		const response = await this.#fetch(this.url, {
			method: 'POST',
			headers: this.#headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ id, values }),
		})
		if (!response.ok) this.#emitter.emit('error', new Error(`broker rejected answer ${id}`))
		const parsed = parseJSON(await response.text())
		if (!isRecord(parsed) || !isBoolean(parsed.success)) {
			this.#emitter.emit('error', new Error(`broker returned an invalid answer result for ${id}`))
			return undefined
		}
		if (parsed.success) return undefined
		const error = parsed.error
		if (!isRecord(error) || !isString(error.reason)) {
			this.#emitter.emit('error', new Error(`broker returned an invalid answer error for ${id}`))
			return undefined
		}
		if (error.reason === 'unknown') return undefined
		if (error.reason === 'rejected' && arrayOf(isFieldError)(error.errors)) return error.errors
		this.#emitter.emit('error', new Error(`broker returned an invalid answer refusal for ${id}`))
		return undefined
	}

	#expire(id: string): void {
		const active = this.#active
		if (active?.id === id) {
			this.#active = { ...active, stopped: true }
			this.#seen.delete(id)
			active.form.destroy()
		} else if (this.#queue.delete(id)) this.#seen.delete(id)
		this.#emitter.emit('expire', id)
	}

	#interrupt(): void {
		this.#queue.clear()
		this.#seen.clear()
		const active = this.#active
		if (active === undefined) return
		this.#active = { ...active, stopped: true }
		active.form.destroy()
	}

	#markDisconnected(): void {
		if (!this.#connected) return
		this.#connected = false
		this.#emitter.emit('disconnect')
	}

	#headers(base: Record<string, string>): Record<string, string> {
		if (this.#token !== undefined) return { ...base, [HEADER_TOKEN]: this.#token }
		return { ...base }
	}

	#wait(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const settle = this.#createSettler(resolve)
			this.#wake = settle
			this.#backoff = this.#timer(settle, ms)
		})
	}

	#createSettler(resolve: () => void): () => void {
		return () => {
			this.#backoff = undefined
			this.#wake = undefined
			resolve()
		}
	}
}
