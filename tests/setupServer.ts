// Node-only shared test infrastructure for the server project. Assertions stay in test files.

import type { PendingForm, PromptInterface, WireEvent } from '@src/core'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { InputStreamInterface } from '@src/server'
import type { RecorderInterface } from '@orkestrel/test'
import type { StreamTargetInterface } from '@orkestrel/console/server'
import { serializePending, serializeExpire } from '@src/core'
import { isFormValues } from '@orkestrel/form'
import { createLoopback } from '@orkestrel/test/server'
import { createServer } from 'node:http'
import { strip } from '@orkestrel/console'
import { createRecorder } from '@orkestrel/test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/** Holds a recording output stream. */
export interface StreamTargetResult {
	readonly target: StreamTargetInterface
	readonly writes: RecorderInterface<readonly [text: string]>
}

/** Creates an injected output stream that records every written byte. */
export function createStreamTarget(options?: { readonly isTTY?: boolean }): StreamTargetResult {
	const writes = createRecorder<readonly [text: string]>()
	return {
		target: {
			write(text: string): boolean {
				writes.handler(text)
				return true
			},
			isTTY: options?.isTTY ?? false,
		},
		writes,
	}
}

/** Describes a recording TTY backed by a real EventEmitter. */
export interface FakeTTYInterface {
	readonly input: InputStreamInterface
	readonly output: StreamTargetInterface
	readonly writes: RecorderInterface<readonly [text: string]>
	readonly raw: boolean
	readonly enters: number
	readonly exits: number
	push(chunk: string | Uint8Array): void
	text(): string
	listeners(): number
}

/** Configures a recording TTY. */
export interface FakeTTYOptions {
	readonly isTTY?: boolean
	readonly scripts?: ReadonlyArray<ReadonlyArray<string | Uint8Array>>
}

/**
 * Creates a recording TTY. It is manually pushed by default; supplying `scripts` makes each listener
 * registration draw the next script and replay it off the host queue.
 */
export function createFakeTTY(options?: FakeTTYOptions): FakeTTYInterface {
	const fixture = new TerminalTTYFixture(options)
	return {
		input: {
			on: (event, listener) => fixture.on(event, listener),
			off: (event, listener) => fixture.off(event, listener),
			setRawMode: (mode) => fixture.mode(mode),
			resume() {},
			pause() {},
			isTTY: options?.isTTY ?? true,
		},
		output: {
			write(text: string): boolean {
				fixture.writes.handler(text)
				return true
			},
			isTTY: options?.isTTY ?? true,
		},
		writes: fixture.writes,
		push: (chunk) => fixture.push(chunk),
		text: () => strip(fixture.writes.calls.map(([text]) => text).join('')),
		get raw() {
			return fixture.raw
		},
		get enters() {
			return fixture.enters
		},
		get exits() {
			return fixture.exits
		},
		listeners: () => fixture.listeners(),
	}
}

/** Creates an ended readable stream containing scripted lines. */
export function createLineInput(lines: readonly string[], finalNewline = true): PassThrough {
	const input = new PassThrough()
	const text = lines.join('\n')
	input.end(finalNewline && text.length > 0 ? `${text}\n` : text)
	return input
}

/** Concatenates all raw output bytes. */
export function rawOutput(tty: FakeTTYInterface): string {
	return tty.writes.calls.map(([text]) => text).join('')
}

/** Owns the stream protocol and raw-mode state of a scripted terminal fixture. */
export class TerminalTTYFixture {
	readonly writes = createRecorder<readonly [text: string]>()
	readonly #emitter = new EventEmitter()
	readonly #scripts: FakeTTYOptions['scripts']
	#raw = false
	#enters = 0
	#exits = 0
	#index = 0

	constructor(options?: FakeTTYOptions) {
		this.#scripts = options?.scripts
	}

	get raw(): boolean {
		return this.#raw
	}

	get enters(): number {
		return this.#enters
	}

	get exits(): number {
		return this.#exits
	}

	on(event: 'data', listener: (chunk: string | Uint8Array) => void): void {
		this.#emitter.on(event, listener)
		if (this.#scripts === undefined) return
		const script = this.#scripts[this.#index] ?? []
		this.#index += 1
		queueMicrotask(() => {
			for (const chunk of script) this.#emitter.emit('data', chunk)
		})
	}

	off(event: 'data', listener: (chunk: string | Uint8Array) => void): void {
		this.#emitter.off(event, listener)
	}

	mode(mode: boolean): void {
		if (mode && !this.#raw) this.#enters += 1
		if (!mode && this.#raw) this.#exits += 1
		this.#raw = mode
	}

	push(chunk: string | Uint8Array): void {
		this.#emitter.emit('data', chunk)
	}

	listeners(): number {
		return this.#emitter.listenerCount('data')
	}
}

/** Creates the minimal input stream boundary accepted by the server guard. */
export function createMinimalTerminalInput(): InputStreamInterface {
	return { on() {}, off() {} }
}

/** Creates the inert TTY boundary described by the injected-stream guide. */
export function createTerminalGuideInput(): InputStreamInterface {
	return {
		on: () => undefined,
		off: () => undefined,
		setRawMode: () => undefined,
		resume: () => undefined,
		pause: () => undefined,
		isTTY: true,
	}
}

/** Holds one live fixture connection. */
export interface TerminalFixtureClient {
	readonly response: ServerResponse
}

/** Describes the SSE broker endpoint exercised by the integration scenarios. */
export interface TerminalFixtureServer {
	readonly url: string
	readonly posts: number
	/** Resolve with the broker's `answer` result the next time a POST lands. */
	post(): Promise<unknown>
	close(): Promise<void>
}

/** Writes one wire frame to one open SSE connection. */
export function writeTerminalFrame(response: ServerResponse, frame: WireEvent): void {
	response.write(`event: ${frame.event}\ndata: ${frame.data}\n\n`)
}

/** Builds the listener that forwards each parked form to every open fixture client. */
export function createTerminalPendingHandler(
	clients: ReadonlySet<TerminalFixtureClient>,
): (form: PendingForm) => void {
	return (form) => {
		for (const client of clients) writeTerminalFrame(client.response, serializePending(form))
	}
}

/** Builds the listener that forwards each expiry to every open fixture client. */
export function createTerminalExpireHandler(
	clients: ReadonlySet<TerminalFixtureClient>,
): (id: string) => void {
	return (id) => {
		for (const client of clients) writeTerminalFrame(client.response, serializeExpire(id))
	}
}

/**
 * Starts a real `node:http` server that forwards a real {@link PromptInterface} broker over SSE and
 * lands every POST back through `prompt.answer` — the transport TU8 proves, built from the
 * package's own transport-neutral `serializePending` / `serializeExpire` wire seam.
 */
export async function startTerminalFixtureServer(
	prompt: PromptInterface,
): Promise<TerminalFixtureServer> {
	const state = new TerminalTransportFixture()
	const clients = state.clients
	const onPending = createTerminalPendingHandler(clients)
	const onExpire = createTerminalExpireHandler(clients)
	prompt.emitter.on('pending', onPending)
	prompt.emitter.on('expire', onExpire)

	const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
		if (request.method === 'GET') {
			response.writeHead(200, { 'Content-Type': 'text/event-stream' })
			for (const form of prompt.pending()) writeTerminalFrame(response, serializePending(form))
			const client: TerminalFixtureClient = { response }
			state.add(client)
			request.on('close', () => state.remove(client))
			return
		}
		if (request.method === 'POST') {
			const chunks: Buffer[] = []
			request.on('data', (chunk: Buffer) => chunks.push(chunk))
			request.on('end', () => {
				state.receive()
				const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
				const id =
					typeof parsed === 'object' && parsed !== null
						? Object.getOwnPropertyDescriptor(parsed, 'id')?.value
						: undefined
				const values =
					typeof parsed === 'object' && parsed !== null
						? Object.getOwnPropertyDescriptor(parsed, 'values')?.value
						: undefined
				if (typeof id !== 'string' || !isFormValues(values)) {
					response.writeHead(400)
					response.end()
					return
				}
				const result = prompt.answer(id, values)
				response.writeHead(200, { 'Content-Type': 'application/json' })
				response.end(JSON.stringify(result))
				state.answer(result)
			})
			return
		}
		response.writeHead(404)
		response.end()
	})

	const loopback = await createLoopback(server)
	return {
		get posts() {
			return state.posts
		},
		url: `${loopback.url}/prompts`,
		post: () => state.post(),
		close: async () => {
			prompt.emitter.off('pending', onPending)
			prompt.emitter.off('expire', onExpire)
			for (const client of clients) client.response.end()
			await loopback.destroy()
		},
	}
}

/**
 * Checks whether stripped text still carries a C0 control byte or DEL — the exact class
 * {@link createHostileText} injects. `\n` and `\r` are excluded: they are the terminal's own
 * legitimate line breaks and redraw carriage returns, present in every real render regardless of
 * schema content, so flagging them would make this instrument fail on clean output.
 */
export function hasTerminalControlBytes(text: string): boolean {
	return [...text].some((character) => {
		const code = character.charCodeAt(0)
		return (code < 32 && code !== 10 && code !== 13) || code === 127
	})
}

/** Owns the live connections, POST count, and response waiters of one fixture server. */
export class TerminalTransportFixture {
	readonly #clients = new Set<TerminalFixtureClient>()
	#posts = 0
	#waiters: Array<(result: unknown) => void> = []

	get clients(): ReadonlySet<TerminalFixtureClient> {
		return this.#clients
	}

	get posts(): number {
		return this.#posts
	}

	add(client: TerminalFixtureClient): void {
		this.#clients.add(client)
	}

	remove(client: TerminalFixtureClient): void {
		this.#clients.delete(client)
	}

	receive(): void {
		this.#posts += 1
	}

	post(): Promise<unknown> {
		return new Promise((waiter) => this.#waiters.push(waiter))
	}

	answer(result: unknown): void {
		const waiters = this.#waiters
		this.#waiters = []
		for (const waiter of waiters) waiter(result)
	}
}
