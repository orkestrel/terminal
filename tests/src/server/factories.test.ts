import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { createTerminal } from '@src/server'
import { createFakeTTY, createStreamTarget } from '../../../setupServer.js'

// Factory coverage for the T-c server-terminals branch (AGENTS §16) — `createTerminal` builds a
// working `TerminalInterface` over the injected streams and exposes exactly the six prompt forms;
// the deep per-prompt behavior is exercised in Terminal.test.ts. Construction with default (real
// process) streams must not throw — a bare `createTerminal()` is valid (it just isn't driven here).

describe('createTerminal', () => {
	it('constructs with no options (default process streams) without throwing', () => {
		expect(() => createTerminal()).not.toThrow()
	})

	it('constructs with only one stream injected (the other defaults) without throwing', () => {
		const tty = createFakeTTY()
		expect(() => createTerminal({ input: tty.input })).not.toThrow()
		expect(() => createTerminal({ output: tty.output })).not.toThrow()
	})

	it('exposes the six PromptFormInterface methods', () => {
		const terminal = createTerminal()
		expect(typeof terminal.input).toBe('function')
		expect(typeof terminal.password).toBe('function')
		expect(typeof terminal.confirm).toBe('function')
		expect(typeof terminal.select).toBe('function')
		expect(typeof terminal.checkbox).toBe('function')
		expect(typeof terminal.editor).toBe('function')
	})

	it('drives an interactive prompt to resolution over the injected fake TTY', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'OK?', default: false })
		tty.push('y')
		expect(await promise).toBe(true)
	})

	it('drives a non-TTY prompt to resolution over an injected readable', async () => {
		const input = Readable.from(['Ada\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name' })).toBe('Ada')
	})
})
