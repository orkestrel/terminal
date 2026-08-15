// The reserved cross-environment proof: a real Prompt broker, a protocol-faithful SSE fixture
// server, a real PromptClient driven over that real HTTP connection, and a real server Terminal
// walking scripted TTY streams — composed with no part of the system under test replaced.

import type { PendingForm, PromptInterface, WireEvent } from '@src/core'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
	CTRL_D,
	RETURN,
	createPrompt,
	createPromptClient,
	serializeExpire,
	serializePending,
} from '@src/core'
import { createTerminal } from '@src/server'
import { createHostileText, createHostileWireSchema } from './setup.js'
import { createFakeTTY, createScriptedTTY } from './setupServer.js'
import { createForm, isFormValues, serializeForm } from '@orkestrel/form'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

/** One live fixture connection and its pending-form catch-up state. */
interface FixtureClient {
	readonly response: ServerResponse
}

/** A real, protocol-faithful SSE broker endpoint driving the system under test end to end. */
interface FixtureServer {
	readonly url: string
	readonly posts: number
	/** Resolve with the broker's `answer` result the next time a POST lands. */
	post(): Promise<unknown>
	close(): Promise<void>
}

/** Write one wire frame to one open SSE connection. */
function writeFrame(response: ServerResponse, frame: WireEvent): void {
	response.write(`event: ${frame.event}\ndata: ${frame.data}\n\n`)
}

/**
 * Start a real `node:http` server that forwards a real {@link PromptInterface} broker over SSE and
 * lands every POST back through `prompt.answer` — the transport TU8 proves, built from the
 * package's own transport-neutral `serializePending` / `serializeExpire` wire seam.
 */
function startFixtureServer(prompt: PromptInterface): Promise<FixtureServer> {
	return new Promise((resolve, reject) => {
		let posts = 0
		let postWaiters: Array<(result: unknown) => void> = []
		const clients = new Set<FixtureClient>()
		const onPending = (form: PendingForm): void => {
			for (const client of clients) writeFrame(client.response, serializePending(form))
		}
		const onExpire = (id: string): void => {
			for (const client of clients) writeFrame(client.response, serializeExpire(id))
		}
		prompt.emitter.on('pending', onPending)
		prompt.emitter.on('expire', onExpire)

		const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
			if (request.method === 'GET') {
				response.writeHead(200, { 'Content-Type': 'text/event-stream' })
				for (const form of prompt.pending()) writeFrame(response, serializePending(form))
				const client: FixtureClient = { response }
				clients.add(client)
				request.on('close', () => clients.delete(client))
				return
			}
			if (request.method === 'POST') {
				const chunks: Buffer[] = []
				request.on('data', (chunk: Buffer) => chunks.push(chunk))
				request.on('end', () => {
					posts += 1
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
					const waiters = postWaiters
					postWaiters = []
					for (const waiter of waiters) waiter(result)
				})
				return
			}
			response.writeHead(404)
			response.end()
		})

		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			if (address === null || typeof address === 'string') {
				reject(new Error('The fixture server carries no bound address'))
				return
			}
			resolve({
				get posts() {
					return posts
				},
				url: `http://127.0.0.1:${String(address.port)}/prompts`,
				post: () => new Promise((waiter) => postWaiters.push(waiter)),
				close: () =>
					new Promise<void>((finish) => {
						prompt.emitter.off('pending', onPending)
						prompt.emitter.off('expire', onExpire)
						for (const client of clients) client.response.end()
						server.close(() => finish())
					}),
			})
		})
	})
}

/**
 * Whether stripped text still carries a smuggled C0 control byte or DEL — the exact class
 * {@link createHostileText} injects. `\n` and `\r` are excluded: they are the terminal's own
 * legitimate line breaks and redraw carriage returns, present in every real render regardless of
 * schema content, so flagging them would make this instrument fail on clean output.
 */
function hasControlBytes(text: string): boolean {
	return [...text].some((character) => {
		const code = character.charCodeAt(0)
		return (code < 32 && code !== 10 && code !== 13) || code === 127
	})
}

const openServers: FixtureServer[] = []

afterEach(async () => {
	while (openServers.length > 0) {
		const server = openServers.pop()
		if (server !== undefined) await server.close()
	}
})

describe('terminal end to end', () => {
	it('parks, transports, renders, and answers one whole form across the real wire', async () => {
		const prompt = createPrompt()
		const server = await startFixtureServer(prompt)
		openServers.push(server)
		const schema = {
			name: 'profile',
			label: 'Profile',
			fields: [
				{
					control: 'text' as const,
					name: 'name',
					label: 'Name',
					rule: {
						required: true,
						custom: (value: unknown) => (value === 'Ada' ? true : 'Use Ada'),
					},
				},
				{
					control: 'select' as const,
					name: 'role',
					label: 'Role',
					choices: [
						{ value: 'admin', label: 'Admin' },
						{ value: 'viewer', label: 'Viewer' },
					],
					default: 'admin',
				},
			],
		}
		const form = createForm(schema)
		const id = prompt.park(form)

		// The parked wire record is exactly the dependency's own serialization, and the authoritative
		// `custom` validator that decided `evaluateField` never crosses it.
		const pending = prompt.pending(id)
		expect(pending?.schema).toStrictEqual(serializeForm(schema))
		expect(JSON.stringify(pending?.schema)).not.toContain('custom')

		const tty = createScriptedTTY([['Ada', RETURN], [RETURN]])
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const client = createPromptClient({ url: server.url, terminal, reconnect: false })

		const connecting = client.connect()
		const values = await form.answer
		client.disconnect()
		await connecting
		client.destroy()

		expect(values).toEqual({ name: 'Ada', role: 'admin' })
		expect(prompt.pending(id)).toBeUndefined()
		expect(server.posts).toBe(1)
	})

	it('drives a hostile schema through the real TTY with no rendered control bytes, proven against a failing control', async () => {
		const prompt = createPrompt()
		const server = await startFixtureServer(prompt)
		openServers.push(server)
		const schema = createHostileWireSchema()
		const form = createForm(schema)
		prompt.park(form)

		// The wire order matches `schema.fields`: text, editor, password, number, date, time,
		// datetime, color, confirm, select, checkbox, file. Every field carries a default or accepts
		// absence, so a blank return walks the whole form; the editor field needs its explicit finish.
		const tty = createScriptedTTY([
			[RETURN],
			[CTRL_D],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
			[RETURN],
		])
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const client = createPromptClient({ url: server.url, terminal, reconnect: false })

		// The claim under test is the render: every byte the scripted output stream received is
		// clean. That is proven the moment the walk finishes and posts back, which needs only one
		// landed POST, not an accepted answer — the TU8 report records a separately surfaced defect
		// that keeps a schema with hostile bytes in its field names from ever being accepted here.
		const connecting = client.connect()
		await server.post()
		client.disconnect()
		await connecting
		client.destroy()

		// `text()` strips the terminal's OWN legitimate styling ANSI (color, cursor, bold), the byte
		// class this instrument must not flag, leaving only bytes the schema itself smuggled in.
		const output = tty.text()
		expect(hasControlBytes(output)).toBe(false)
		expect(server.posts).toBe(1)

		// Negative control drawn from outside the sanitize pipeline: writing the raw hostile text
		// directly to a TTY output, then reading it through the same stripped instrument, bypasses
		// every layer under test and proves the instrument this proof relies on can actually fail
		// rather than passing on anything it is given.
		const raw = createFakeTTY()
		raw.output.write(createHostileText('unsanitized'))
		expect(hasControlBytes(raw.text())).toBe(true)
	})
})
