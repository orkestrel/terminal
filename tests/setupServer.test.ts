// tests/setupServer.ts — the Node-only test infrastructure the server project loads. This proof
// covers the exported behavior the server suites depend on: the recording output target, the
// manually pushed TTY's real emitter and its raw-mode transition counters, the split between the
// stripped and the raw transcript, the scripted TTY's per-registration delivery, and the scripted
// line stream. Expectations are derived through routes the module cannot share — a real
// EventEmitter's own listener count, the console stripper, the host timer queue, and a real stream
// drain. Terminal's own rendering and key handling belong to the server suites.

import type { FakeTTYInterface } from './setupServer.js'
import {
	createFakeTTY,
	createLineInput,
	createScriptedTTY,
	createStreamTarget,
	rawOutput,
} from './setupServer.js'
import { CTRL_D, RETURN } from '@src/core'
import { strip } from '@orkestrel/console'
import { collect, createRecorder, requireValue, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('createStreamTarget', () => {
	it('records every write in order and reports the requested TTY flag', () => {
		const plain = createStreamTarget()

		expect(plain.target.isTTY).toBe(false)
		expect(plain.target.write('first')).toBe(true)
		plain.target.write('second')
		expect(plain.writes.calls).toEqual([['first'], ['second']])

		// The flag is what a driver reads to decide whether it may drive raw mode at all, so the
		// fixture must be able to present an interactive sink as well as a piped one.
		const interactive = createStreamTarget({ isTTY: true })
		expect(interactive.target.isTTY).toBe(true)
		expect(interactive.writes.calls).toEqual([])
	})
})

describe('createFakeTTY', () => {
	it('delivers a pushed chunk through a real emitter that on and off register against', () => {
		const tty = createFakeTTY()
		const received = createRecorder<readonly [chunk: string | Uint8Array]>()

		expect(tty.input.isTTY).toBe(true)
		expect(tty.output.isTTY).toBe(true)
		// The count is the emitter's own, so a listener the module failed to register cannot be
		// reported as registered.
		expect(tty.listeners()).toBe(0)

		tty.input.on('data', received.handler)
		expect(tty.listeners()).toBe(1)

		const bytes = new TextEncoder().encode('bytes')
		tty.push('typed')
		tty.push(bytes)
		expect(received.calls).toEqual([['typed'], [bytes]])

		tty.input.off('data', received.handler)
		expect(tty.listeners()).toBe(0)
		tty.push('after the release')
		expect(received.calls).toEqual([['typed'], [bytes]])
	})

	it('counts raw-mode transitions rather than setRawMode calls', () => {
		const tty = createFakeTTY()
		const setRawMode = requireValue(tty.input.setRawMode, 'The fake TTY exposes no setRawMode')

		expect(tty.raw).toBe(false)

		setRawMode(true)
		setRawMode(true)
		expect(tty.raw).toBe(true)
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(0)

		setRawMode(false)
		setRawMode(false)
		expect(tty.raw).toBe(false)
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)

		setRawMode(true)
		expect(tty.enters).toBe(2)
		expect(tty.exits).toBe(1)
	})

	it('splits the transcript into a stripped reading and the raw bytes', () => {
		const tty = createFakeTTY()
		const styled = '\u001b[31mName\u001b[0m'
		tty.output.write(styled)
		tty.output.write(' Ada')

		// `text` is the assertion surface, so it must equal what the real stripper returns over the
		// concatenated writes. `rawOutput` is the escape-sequence surface and keeps every byte.
		expect(tty.text()).toBe(strip(`${styled} Ada`))
		expect(tty.text()).toBe('Name Ada')
		expect(rawOutput(tty)).toBe(`${styled} Ada`)
		expect(rawOutput(tty)).not.toBe(tty.text())
	})
})

describe('createScriptedTTY', () => {
	it('delivers one script per listener registration, in order and off the host queue', async () => {
		const tty = createScriptedTTY([['Ada', RETURN], [CTRL_D]])
		const first = createRecorder<readonly [chunk: string | Uint8Array]>()
		const second = createRecorder<readonly [chunk: string | Uint8Array]>()

		tty.input.on('data', first.handler)
		// Nothing arrives inside the registration call, so a field that registers and then reads
		// its own state synchronously still sees an empty stream.
		expect(first.calls).toEqual([])

		await waitForDelay()
		expect(first.calls).toEqual([['Ada'], [RETURN]])

		// The next registration draws the next script rather than replaying the first.
		tty.input.on('data', second.handler)
		await waitForDelay()
		expect(second.calls).toEqual([[CTRL_D]])

		// A registration past the last script delivers nothing at all.
		const spent = createScriptedTTY([['only']])
		const after = createRecorder<readonly [chunk: string | Uint8Array]>()
		spent.input.on('data', after.handler)
		await waitForDelay()
		spent.input.on('data', after.handler)
		await waitForDelay()
		expect(after.calls).toEqual([['only']])
	})

	it('carries the same recording TTY contract as the manually pushed one', () => {
		const tty: FakeTTYInterface = createScriptedTTY([])
		const setRawMode = requireValue(tty.input.setRawMode, 'The scripted TTY exposes no setRawMode')

		tty.output.write('\u001b[32mdone\u001b[0m')
		expect(tty.input.isTTY).toBe(true)
		expect(tty.text()).toBe('done')
		expect(rawOutput(tty)).toBe('\u001b[32mdone\u001b[0m')

		setRawMode(true)
		setRawMode(false)
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
	})
})

describe('createLineInput', () => {
	it('ends a real stream carrying the lines under the requested trailing newline', async () => {
		const terminated = createLineInput(['Ada', 'Grace'])
		terminated.setEncoding('utf8')
		expect((await collect<string>(terminated)).join('')).toBe('Ada\nGrace\n')

		const open = createLineInput(['Ada', 'Grace'], false)
		open.setEncoding('utf8')
		expect((await collect<string>(open)).join('')).toBe('Ada\nGrace')

		// An empty script still ends, so a reader waiting on it resolves rather than hanging.
		const empty = createLineInput([])
		empty.setEncoding('utf8')
		expect((await collect<string>(empty)).join('')).toBe('')
	})
})
