// The reserved cross-environment proof: a real Prompt broker, a protocol-faithful SSE fixture
// server, a real PromptClient driven over that real HTTP connection, and a real server Terminal
// walking scripted TTY streams — composed with no part of the system under test replaced.

import type { TerminalFixtureServer } from './setupServer.js'
import { CTRL_D, RETURN, createPrompt, createPromptClient } from '@src/core'
import { createTerminal } from '@src/server'
import {
	createTerminalProfileSchema,
	createHostilePattern,
	createHostileText,
	createHostileWireSchema,
} from './setup.js'
import {
	createFakeTTY,
	startTerminalFixtureServer,
	hasTerminalControlBytes,
} from './setupServer.js'
import { createForm, serializeForm } from '@orkestrel/form'
import { afterEach, describe, expect, it } from 'vitest'

const openServers: TerminalFixtureServer[] = []

afterEach(async () => {
	while (openServers.length > 0) {
		const server = openServers.pop()
		if (server !== undefined) await server.close()
	}
})

describe('terminal end to end', () => {
	it('parks, transports, renders, and answers one whole form across the real wire', async () => {
		const prompt = createPrompt()
		const server = await startTerminalFixtureServer(prompt)
		openServers.push(server)
		const schema = createTerminalProfileSchema()
		const form = createForm(schema)
		const id = prompt.park(form)

		// The parked wire record is exactly the dependency's own serialization, and the authoritative
		// `custom` validator that decided `evaluateField` never crosses it.
		const pending = prompt.pending(id)
		expect(pending?.schema).toStrictEqual(serializeForm(schema))
		expect(JSON.stringify(pending?.schema)).not.toContain('custom')

		const tty = createFakeTTY({ scripts: [['Ada', RETURN], [RETURN]] })
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
		const server = await startTerminalFixtureServer(prompt)
		openServers.push(server)
		const schema = createHostileWireSchema()
		const form = createForm(schema)
		prompt.park(form)

		// The wire order matches `schema.fields`: text, editor, password, number, date, time,
		// datetime, color, confirm, select, checkbox, file, list. Every field carries a default or
		// accepts absence, so a blank return walks the whole form; the editor field needs its explicit
		// finish.
		const tty = createFakeTTY({
			scripts: [
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
				[RETURN],
			],
		})
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
			[hostile('list')]: [hostile('entry')],
		})

		// `text()` strips the terminal's OWN legitimate styling ANSI (color, cursor, bold), the byte
		// class this instrument must not flag, leaving only bytes the schema itself smuggled in.
		const output = tty.text()
		expect(hasTerminalControlBytes(output)).toBe(false)
		expect(server.posts).toBe(1)

		// Negative control drawn from outside the sanitize pipeline: writing the raw hostile text
		// directly to a TTY output, then reading it through the same stripped instrument, bypasses
		// every layer under test and proves the instrument this proof relies on can actually fail
		// rather than passing on anything it is given.
		const raw = createFakeTTY()
		raw.output.write(createHostileText('unsanitized'))
		expect(hasTerminalControlBytes(raw.text())).toBe(true)
	})
})
