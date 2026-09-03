import { RETURN } from '@src/core'
import { createTerminal } from '@src/server'
import { createFakeTTY } from '../../setupServer.js'
import { createForm } from '@orkestrel/form'
import { describe, expect, it } from 'vitest'

describe('createTerminal', () => {
	it('returns the one-method whole-form interface', () => {
		const terminal = createTerminal()
		expect(typeof terminal.ask).toBe('function')
		expect(Object.keys(terminal)).not.toContain('input')
	})

	it('forwards injected streams to a working interactive driver', async () => {
		const tty = createFakeTTY({ scripts: [['Ada', RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		expect(await terminal.ask(form)).toEqual({ name: 'Ada' })
		expect(tty.listeners()).toBe(0)
	})
})
