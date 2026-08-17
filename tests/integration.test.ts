// The reserved cross-environment proof: a real Prompt broker, a protocol-faithful SSE fixture
// server, a real PromptClient driven over that real HTTP connection, and a real server Terminal
// walking scripted TTY streams — composed with no part of the system under test replaced.

import type { PendingForm, PromptInterface, WireEvent } from '@src/core'
import type { FormSchema } from '@orkestrel/form'
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
import { createHostilePattern, createHostileText, createHostileWireSchema } from './setup.js'
import { createFakeTTY, createScriptedTTY } from './setupServer.js'
import { createForm, isFormValues, serializeForm } from '@orkestrel/form'
import { createLoopback } from '@orkestrel/test/server'
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

/** Build the listener that forwards each newly parked form to every open fixture client. */
function createPendingHandler(clients: ReadonlySet<FixtureClient>): (form: PendingForm) => void {
	return (form) => {
		for (const client of clients) writeFrame(client.response, serializePending(form))
	}
}

/** Build the listener that forwards each expiry to every open fixture client. */
function createExpireHandler(clients: ReadonlySet<FixtureClient>): (id: string) => void {
	return (id) => {
		for (const client of clients) writeFrame(client.response, serializeExpire(id))
	}
}

/**
 * Start a real `node:http` server that forwards a real {@link PromptInterface} broker over SSE and
 * lands every POST back through `prompt.answer` — the transport TU8 proves, built from the
 * package's own transport-neutral `serializePending` / `serializeExpire` wire seam.
 */
async function startFixtureServer(prompt: PromptInterface): Promise<FixtureServer> {
	let posts = 0
	let postWaiters: Array<(result: unknown) => void> = []
	const clients = new Set<FixtureClient>()
	const onPending = createPendingHandler(clients)
	const onExpire = createExpireHandler(clients)
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

	const loopback = await createLoopback(server)
	return {
		get posts() {
			return posts
		},
		url: `${loopback.url}/prompts`,
		post: () => new Promise((waiter) => postWaiters.push(waiter)),
		close: async () => {
			prompt.emitter.off('pending', onPending)
			prompt.emitter.off('expire', onExpire)
			for (const client of clients) client.response.end()
			await loopback.destroy()
		},
	}
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
		const schema: FormSchema = {
			name: 'profile',
			label: 'Profile',
			fields: [
				{
					control: 'text',
					name: 'name',
					label: 'Name',
					rule: {
						required: true,
						custom: (value: unknown) => (value === 'Ada' ? true : 'Use Ada'),
					},
				},
				{
					control: 'select',
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

		const connecting = client.connect()
		const values = await form.answer
		client.disconnect()
		await connecting
		client.destroy()

		const hostile = createHostileText
		expect(values).toEqual({
			[hostile('text')]: createHostilePattern('pattern'),
			[hostile('editor')]: hostile('editor seed'),
			[hostile('confirm')]: false,
			[hostile('select')]: hostile('one'),
			[hostile('checkbox')]: [hostile('two')],
		})

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
