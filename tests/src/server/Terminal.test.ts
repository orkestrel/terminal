import type { FakeTTYInterface } from '../../setupServer.js'
import type { InputStreamInterface, OutputStreamInterface } from '@src/server'
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { isTerminalError } from '@src/core'
import { createTerminal } from '@src/server'
import { assertCleanExit, createFakeTTY, createStreamTarget, rawOutput } from '../../setupServer.js'

// Behavioral coverage for the T-c interactive `Terminal` driver (AGENTS §16) — it DRIVES the pure
// core reducers over a SCRIPTED FAKE TTY: each test calls a prompt, pushes scripted key chunks, and
// asserts the resolved value, the RENDERED view content (ANSI stripped via the fixture's `text()`),
// cancel-on-ctrl-c (a `TerminalError` `CANCEL`), and — the load-bearing invariant — that raw mode is
// entered exactly once and FULLY cleaned up on EVERY exit path (submit / cancel): no leaked raw mode,
// no leaked `'data'` listener, the cursor hidden during and RESTORED on exit. The non-TTY fallback is
// driven with a real `node:stream` Readable. No real terminal, no mock of the prompt logic (it lives
// in the core).

// Key byte constants (built from char codes so no raw control character sits in source).
const ESC = String.fromCharCode(27)
const ENTER = '\r'
const NEWLINE = '\n'
const CTRL_C = String.fromCharCode(3)
const CTRL_D = String.fromCharCode(4)
const CTRL_U = String.fromCharCode(21)
const BACKSPACE = String.fromCharCode(127)
const SPACE = ' '
const ARROW_DOWN = `${ESC}[B`
const ARROW_UP = `${ESC}[A`
const CURSOR_HIDE = `${ESC}[?25l`
const CURSOR_SHOW = `${ESC}[?25h`

// A real node Readable that yields `chunks` then ends — drives the non-TTY (readline) fallback path.
function readableFrom(chunks: readonly string[]): Readable {
	return Readable.from(chunks)
}

// `rawOutput` (the un-stripped twin of `tty.text()`) and `assertCleanExit` (the raw-mode leak-freedom
// invariant) live in `setupServer.ts` (AGENTS §16.1) — imported above, used throughout.

// How many times the in-place re-render climbed `count` lines (the `ESC[{count}A` cursor-up sequence).
function upMoves(tty: FakeTTYInterface, count: number): number {
	return rawOutput(tty).split(`${ESC}[${String(count)}A`).length - 1
}

describe('Terminal — input', () => {
	it('types characters and submits the typed value on Enter', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		for (const character of 'Ada') tty.push(character)
		tty.push(ENTER)
		expect(await promise).toBe('Ada')
	})

	it('renders the message and the typed value into the view', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		for (const character of 'Ada') tty.push(character)
		tty.push(ENTER)
		await promise
		expect(tty.text()).toContain('Name')
		expect(tty.text()).toContain('Ada')
	})

	it('backspace shrinks the value', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		for (const character of 'AdaX') tty.push(character)
		tty.push(BACKSPACE)
		tty.push(ENTER)
		expect(await promise).toBe('Ada')
	})

	it('ctrl-u clears the whole line back to the default', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name', default: 'Anon' })
		for (const character of 'typed') tty.push(character)
		tty.push(CTRL_U) // wipe the line — value back to '' → empty Enter takes the default
		tty.push(ENTER)
		expect(await promise).toBe('Anon')
	})

	it('falls back to the default on an empty Enter', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name', default: 'Anon' })
		tty.push(ENTER)
		expect(await promise).toBe('Anon')
	})

	it('submits an empty string when there is no default', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		tty.push(ENTER) // immediate empty submit, no default
		expect(await promise).toBe('')
		assertCleanExit(tty)
	})

	it('rejects an invalid submit, stays active, then accepts a valid one', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name', validate: { minimum: 3 } })
		tty.push('ab')
		tty.push(ENTER) // too short — stays active, error rendered
		tty.push('c')
		tty.push(ENTER) // now 'abc' — accepted
		expect(await promise).toBe('abc')
		expect(tty.text()).toContain('at least 3')
	})

	it('clears the error on the next keystroke after a rejected submit', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name', validate: { minimum: 3 } })
		tty.push('ab')
		tty.push(ENTER) // rejected — error shown
		tty.push('c') // typing clears the error in the live view
		tty.push(ENTER)
		await promise
		// The final committed submit line carries no error text.
		const lastWrite = tty.writes.calls.at(-2)?.[0] ?? ''
		expect(lastWrite).not.toContain('at least 3')
	})

	it('a custom function validator gates the submit', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({
			message: 'Name',
			validate: (value) => (value === 'ok' ? true : 'must be ok'),
		})
		for (const character of 'no') tty.push(character)
		tty.push(ENTER) // rejected
		tty.push(BACKSPACE)
		tty.push(BACKSPACE)
		for (const character of 'ok') tty.push(character)
		tty.push(ENTER) // accepted
		expect(await promise).toBe('ok')
		expect(tty.text()).toContain('must be ok')
	})

	it('enters raw mode exactly once and cleans it up (no leak)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		tty.push('x')
		tty.push(ENTER)
		await promise
		// Raw mode entered exactly once and fully unwound, no leaked 'data' listener, cursor restored.
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
		expect(rawOutput(tty)).toContain(CURSOR_HIDE)
		expect(rawOutput(tty)).toContain(CURSOR_SHOW)
	})

	it('a custom validator that THROWS still cleans up raw mode and rejects with the thrown error', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const thrown = new Error('validator exploded')
		const promise = terminal.input({
			message: 'Name',
			validate: () => {
				throw thrown
			},
		})
		for (const character of 'x') tty.push(character)
		tty.push(ENTER) // triggers the throwing validator inside the reducer's submit step
		await expect(promise).rejects.toBe(thrown)
		assertCleanExit(tty)
	})

	it('decodes a CTRL+H-form newline (\\n) as Enter too', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		for (const character of 'Zoe') tty.push(character)
		tty.push(NEWLINE) // '\n' is the other Enter byte (CONTROL_NAMES maps it to 'return')
		expect(await promise).toBe('Zoe')
	})

	it('appends a pushed multi-byte chunk verbatim', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		tty.push(Buffer.from('Ada', 'utf8')) // a raw byte chunk, decoded utf-8 by parseKey
		tty.push(ENTER)
		expect(await promise).toBe('Ada')
	})
})

describe('Terminal — password', () => {
	it('resolves the real value but masks it in the view', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.password({ message: 'Secret' })
		for (const character of 's3cret') tty.push(character)
		tty.push(ENTER)
		expect(await promise).toBe('s3cret')
		// The raw secret never reaches the rendered output; the mask does.
		expect(tty.text()).not.toContain('s3cret')
		expect(tty.text()).toContain('******')
	})

	it('NEVER writes the secret to ANY output chunk — including the committed submit line', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const secret = 'h0rse-Battery!'
		const promise = terminal.password({ message: 'Secret' })
		for (const character of secret) tty.push(character)
		tty.push(ENTER)
		expect(await promise).toBe(secret)
		// Assert over the FULL raw recorded output (ANSI intact), every chunk, the submit line too: the
		// whole secret never appears, and neither does a distinctive multi-char fragment of it (single
		// letters legitimately recur in the styled message, so a fragment is the meaningful leak unit).
		const raw = rawOutput(tty)
		expect(raw).not.toContain(secret)
		expect(raw).not.toContain('rse-Bat')
		expect(raw).not.toContain('h0rse')
	})

	it('a rejected (too-short) password stays active and still never leaks the secret', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.password({ message: 'Secret', validate: { minimum: 6 } })
		for (const character of 'abc') tty.push(character)
		tty.push(ENTER) // rejected — error rendered, stays active
		for (const character of 'def') tty.push(character)
		tty.push(ENTER) // now 6 chars — accepted
		expect(await promise).toBe('abcdef')
		expect(tty.text()).toContain('at least 6')
		expect(rawOutput(tty)).not.toContain('abc')
		expect(rawOutput(tty)).not.toContain('abcdef')
	})

	it('honors a custom mask glyph and still hides the secret', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.password({ message: 'Secret', mask: '•' })
		for (const character of 'pw') tty.push(character)
		tty.push(ENTER)
		expect(await promise).toBe('pw')
		expect(tty.text()).toContain('••')
		expect(rawOutput(tty)).not.toContain('pw')
	})

	it('enters raw mode once and cleans up on submit (no leak)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.password({ message: 'Secret' })
		for (const character of 'pw') tty.push(character)
		tty.push(ENTER)
		await promise
		// Raw mode entered exactly once and fully unwound, no leaked 'data' listener, cursor restored.
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
		expect(rawOutput(tty)).toContain(CURSOR_HIDE)
		expect(rawOutput(tty)).toContain(CURSOR_SHOW)
	})

	it('a degraded TTY (isTTY but no setRawMode) never echoes the typed secret into raw output', async () => {
		// isTTY: true but setRawMode ABSENT ⇒ isRawCapable is false ⇒ the readline fallback is taken,
		// which the driver runs with `terminal: false` so a masked answer is never echoed (AGENTS §16.1).
		const secret = 'sup3r-Secret!'
		const input: InputStreamInterface = Object.assign(Readable.from([`${secret}\n`]), {
			isTTY: true,
		})
		const { target, writes } = createStreamTarget({ isTTY: true })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.password({ message: 'Secret' })).toBe(secret)
		const raw = writes.calls.map(([text]) => text).join('')
		expect(raw).not.toContain(secret)
	})
})

describe('Terminal — confirm', () => {
	it('y submits true', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?' })
		tty.push('y')
		expect(await promise).toBe(true)
	})

	it('n submits false', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?' })
		tty.push('n')
		expect(await promise).toBe(false)
	})

	it('uppercase Y also submits true (case-insensitive)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?' })
		tty.push('Y')
		expect(await promise).toBe(true)
	})

	it('ignores an unrelated key, staying active until a decision', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?' })
		tty.push('q') // ignored — not y/n/return
		tty.push('z') // ignored
		tty.push('n') // decision
		expect(await promise).toBe(false)
	})

	it('Enter takes the true default', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?', default: true })
		tty.push(ENTER)
		expect(await promise).toBe(true)
	})

	it('Enter takes the false default and cleans up (no leak)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?', default: false })
		tty.push(ENTER)
		expect(await promise).toBe(false)
		assertCleanExit(tty)
	})
})

describe('Terminal — select', () => {
	it('navigates with the down arrow and submits the focused value', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({
			message: 'Pick',
			choices: ['red', 'green', 'blue'],
		})
		tty.push(ARROW_DOWN) // focus -> green
		tty.push(ARROW_DOWN) // focus -> blue
		tty.push(ARROW_UP) // focus -> green
		tty.push(ENTER)
		expect(await promise).toBe('green')
	})

	it('wraps the focus past the top and bottom edges', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		tty.push(ARROW_UP) // from red (0) wraps to blue (2)
		tty.push(ENTER)
		expect(await promise).toBe('blue')
	})

	it('navigates with j / k (vim keys) as well as arrows', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		tty.push('j') // down -> green
		tty.push('j') // down -> blue
		tty.push('k') // up -> green
		tty.push(ENTER)
		expect(await promise).toBe('green')
	})

	it('renders all choices and live re-renders (cursor climbs back over the list)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		tty.push(ARROW_DOWN)
		tty.push(ENTER)
		await promise
		const text = tty.text()
		expect(text).toContain('red')
		expect(text).toContain('green')
		expect(text).toContain('blue')
		// The in-place re-render moved the cursor up over the previous (4-line: header + 3 rows) view.
		// lineCount = 4 ⇒ redrawPrefix climbs 4 - 1 = 3 lines, at least once (the arrow + the submit).
		expect(upMoves(tty, 3)).toBeGreaterThanOrEqual(1)
	})

	it('pre-focuses the default choice', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({
			message: 'Pick',
			choices: ['red', 'green', 'blue'],
			default: 'blue',
		})
		tty.push(ENTER) // submit the pre-focused default
		expect(await promise).toBe('blue')
	})

	it('an immediate Enter submits the first choice', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		tty.push(ENTER)
		expect(await promise).toBe('red')
		assertCleanExit(tty)
	})

	it('submits a full choice object value distinct from its name', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({
			message: 'Pick',
			choices: [
				{ name: 'Red', value: 'r' },
				{ name: 'Green', value: 'g' },
			],
		})
		tty.push(ARROW_DOWN)
		tty.push(ENTER)
		expect(await promise).toBe('g') // the value, not the display name
	})
})

describe('Terminal — checkbox', () => {
	it('toggles with space and submits the checked values in choice order', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({
			message: 'Pick many',
			choices: ['a', 'b', 'c'],
		})
		tty.push(SPACE) // check a
		tty.push(ARROW_DOWN)
		tty.push(ARROW_DOWN) // focus c
		tty.push(SPACE) // check c
		tty.push(ENTER)
		expect(await promise).toEqual(['a', 'c'])
	})

	it('un-toggles a space-checked item back off', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({ message: 'Pick', choices: ['a', 'b'] })
		tty.push(SPACE) // check a
		tty.push(SPACE) // uncheck a
		tty.push(ARROW_DOWN)
		tty.push(SPACE) // check b
		tty.push(ENTER)
		expect(await promise).toEqual(['b'])
	})

	it('submits an empty list on an immediate Enter when nothing is checked', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({ message: 'Pick', choices: ['a', 'b'] })
		tty.push(ENTER)
		expect(await promise).toEqual([])
		assertCleanExit(tty)
	})

	it('pre-checks the initially-checked choices', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({
			message: 'Pick',
			choices: [
				{ name: 'a', value: 'a', checked: true },
				{ name: 'b', value: 'b' },
				{ name: 'c', value: 'c', checked: true },
			],
		})
		tty.push(ENTER) // submit the pre-checked set untouched
		expect(await promise).toEqual(['a', 'c'])
	})

	it('gates a submit below the minimum, staying active until satisfied', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({ message: 'Pick 2', choices: ['a', 'b', 'c'], min: 2 })
		tty.push(SPACE) // check a (count 1)
		tty.push(ENTER) // rejected — below min, stays active
		tty.push(ARROW_DOWN)
		tty.push(SPACE) // check b (count 2)
		tty.push(ENTER) // now satisfied
		expect(await promise).toEqual(['a', 'b'])
		expect(tty.text()).toContain('at least 2')
	})

	it('gates a submit above the maximum, staying active until trimmed', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({ message: 'Pick <=1', choices: ['a', 'b'], max: 1 })
		tty.push(SPACE) // check a
		tty.push(ARROW_DOWN)
		tty.push(SPACE) // check b (count 2 — over max)
		tty.push(ENTER) // rejected
		tty.push(SPACE) // uncheck b (count 1)
		tty.push(ENTER) // satisfied
		expect(await promise).toEqual(['a'])
		expect(tty.text()).toContain('no more than 1')
	})
})

describe('Terminal — editor', () => {
	it('commits lines on Enter and finishes on ctrl-d', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.editor({ message: 'Notes' })
		for (const character of 'line one') tty.push(character)
		tty.push(ENTER) // commit 'line one', start fresh line
		for (const character of 'line two') tty.push(character)
		tty.push(CTRL_D) // finish
		expect(await promise).toBe('line one\nline two')
	})

	it('an immediate ctrl-d on an empty editor falls back to the default', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.editor({ message: 'Notes', default: 'seeded' })
		tty.push(CTRL_D)
		expect(await promise).toBe('seeded')
	})

	it('a rejected finish stays active, then ctrl-d again accepts', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.editor({ message: 'Notes', validate: { minimum: 5 } })
		for (const character of 'hi') tty.push(character)
		tty.push(CTRL_D) // 'hi' too short — rejected, stays active
		for (const character of 'there') tty.push(character)
		tty.push(CTRL_D) // 'hithere' passes
		expect(await promise).toBe('hithere')
		expect(tty.text()).toContain('at least 5')
	})

	it('enters raw mode once and cleans up on the ctrl-d finish (no leak)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.editor({ message: 'Notes' })
		for (const character of 'x') tty.push(character)
		tty.push(CTRL_D)
		await promise
		// Raw mode entered exactly once and fully unwound, no leaked 'data' listener, cursor restored.
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
		expect(rawOutput(tty)).toContain(CURSOR_HIDE)
		expect(rawOutput(tty)).toContain(CURSOR_SHOW)
	})
})

describe('Terminal — cancel (ctrl-c) on every prompt', () => {
	// Each prompt must reject a TerminalError(CANCEL) AND fully unwind raw mode + restore the cursor.
	async function cancelOf(promise: Promise<unknown>): Promise<unknown> {
		return promise.then(
			() => undefined,
			(reason: unknown) => reason,
		)
	}

	it('input cancels with a TerminalError CANCEL and cleans up (no leak)', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		tty.push('part')
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error)).toBe(true)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		assertCleanExit(tty)
	})

	it('password cancels and cleans up — and the typed secret never leaked', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.password({ message: 'Secret' })
		for (const character of 'topsecret') tty.push(character)
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		expect(rawOutput(tty)).not.toContain('topsecret')
		assertCleanExit(tty)
	})

	it('confirm cancels and cleans up', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.confirm({ message: 'Proceed?' })
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		assertCleanExit(tty)
	})

	it('select cancels and cleans up', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.select({ message: 'Pick', choices: ['a', 'b'] })
		tty.push(ARROW_DOWN)
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		assertCleanExit(tty)
	})

	it('checkbox cancels and cleans up', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.checkbox({ message: 'Pick', choices: ['a', 'b'] })
		tty.push(SPACE)
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		assertCleanExit(tty)
	})

	it('editor cancels and cleans up', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.editor({ message: 'Notes' })
		for (const character of 'draft') tty.push(character)
		tty.push(CTRL_C)
		const error = await cancelOf(promise)
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		assertCleanExit(tty)
	})
})

describe('Terminal — re-use across sequential prompts (no listener accretion)', () => {
	it('one Terminal drives several prompts in a row with NO leaked listeners or raw mode', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })

		const first = terminal.input({ message: 'A' })
		for (const character of 'one') tty.push(character)
		tty.push(ENTER)
		expect(await first).toBe('one')
		expect(tty.listeners()).toBe(0) // unsubscribed between prompts — no accretion
		expect(tty.raw).toBe(false)

		const second = terminal.confirm({ message: 'B?' })
		tty.push('y')
		expect(await second).toBe(true)
		expect(tty.listeners()).toBe(0)

		const third = terminal.select({ message: 'C', choices: ['x', 'y', 'z'] })
		tty.push(ARROW_DOWN)
		tty.push(ENTER)
		expect(await third).toBe('y')

		// Three prompts ⇒ raw entered + exited exactly three times, 1:1, with nothing left subscribed.
		expect(tty.enters).toBe(3)
		expect(tty.exits).toBe(3)
		expect(tty.listeners()).toBe(0)
		expect(tty.raw).toBe(false)
	})

	it('a cancelled prompt does not poison a subsequent successful one', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })

		const cancelled = terminal.input({ message: 'A' })
		tty.push(CTRL_C)
		await cancelled.catch(() => undefined)
		expect(tty.listeners()).toBe(0)
		expect(tty.raw).toBe(false)

		const ok = terminal.input({ message: 'B' })
		for (const character of 'fine') tty.push(character)
		tty.push(ENTER)
		expect(await ok).toBe('fine')
		expect(tty.enters).toBe(2)
		expect(tty.exits).toBe(2)
		expect(tty.listeners()).toBe(0)
	})
})

describe('Terminal — in-place re-render math (via the driver)', () => {
	it('a growing then shrinking view (error appears then clears) redraws over the right line counts', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name', validate: { minimum: 3 } })
		tty.push('a') // 1-line view
		tty.push(ENTER) // rejected — view GROWS to 2 lines (value + error line)
		tty.push('bc') // typing clears the error — view SHRINKS back to 1 line
		tty.push(ENTER) // 'abc' accepted
		expect(await promise).toBe('abc')
		const raw = rawOutput(tty)
		// While the error was on screen (2-line view), the next redraw climbed 2 - 1 = 1 line.
		expect(raw).toContain(`${ESC}[1A`)
		// Every redraw clears down so a shrinking view leaves no orphaned error row.
		expect(raw).toContain(`${ESC}[J`)
	})

	it('the first render never climbs (no ESC[0A) and hides the cursor before drawing', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const promise = terminal.input({ message: 'Name' })
		// The very first write is the cursor-hide, before any view or cursor-up.
		expect(tty.writes.calls[0]?.[0]).toBe(CURSOR_HIDE)
		tty.push(ENTER)
		await promise
		// A single-line prompt never emits a wasted ESC[0A climb.
		expect(rawOutput(tty)).not.toContain(`${ESC}[0A`)
	})
})

describe('Terminal — non-TTY fallback (node:readline)', () => {
	it('input reads a validated line', async () => {
		const input = readableFrom(['Grace\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name' })).toBe('Grace')
	})

	it('input re-asks until a line passes validation', async () => {
		const input = readableFrom(['ab\n', 'abcd\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name', validate: { minimum: 3 } })).toBe('abcd')
	})

	it('input on an empty line uses the default', async () => {
		const input = readableFrom(['\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name', default: 'Anon' })).toBe('Anon')
	})

	it('input settles on EOF WITHOUT a trailing newline (no hang)', async () => {
		const input = readableFrom(['noTrailingNewline'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name' })).toBe('noTrailingNewline')
	})

	it('input on a totally empty (immediate-EOF) stream settles the default, never hangs', async () => {
		const input = readableFrom([])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name', default: 'fallback' })).toBe('fallback')
	})

	it('input that fails validation at EOF settles the best-effort value instead of spinning', async () => {
		// 'ab' fails minimum:3 AND the stream then ends — must settle, not loop forever on the dead stream.
		const input = readableFrom(['ab'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.input({ message: 'Name', validate: { minimum: 3 } })).toBe('ab')
	})

	it('password reads a validated line (no masking possible on a pipe)', async () => {
		const input = readableFrom(['hunter2\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.password({ message: 'Secret', validate: { minimum: 4 } })).toBe('hunter2')
	})

	it('confirm reads y/n', async () => {
		const input = readableFrom(['yes\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.confirm({ message: 'Proceed?' })).toBe(true)
	})

	it('confirm on an empty line uses the default', async () => {
		const input = readableFrom(['\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.confirm({ message: 'Proceed?', default: true })).toBe(true)
	})

	it('confirm settles the default at EOF instead of hanging', async () => {
		const input = readableFrom([]) // immediate EOF, no input at all
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.confirm({ message: 'Proceed?', default: false })).toBe(false)
	})

	it('select reads a numbered choice', async () => {
		const input = readableFrom(['2\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		const value = await terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		expect(value).toBe('green')
	})

	it('select re-asks on an out-of-range number then accepts a valid one', async () => {
		const input = readableFrom(['9\n', '3\n']) // 9 is invalid, 3 maps to blue
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		const value = await terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		expect(value).toBe('blue')
	})

	it('select settles the empty string at EOF (no valid pick) instead of hanging', async () => {
		const input = readableFrom(['nonsense']) // not a number, then EOF
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.select({ message: 'Pick', choices: ['red', 'green'] })).toBe('')
	})

	it('checkbox reads comma-separated numbers', async () => {
		const input = readableFrom(['1,3\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		const value = await terminal.checkbox({ message: 'Pick', choices: ['a', 'b', 'c'] })
		expect(value).toEqual(['a', 'c'])
	})

	it('checkbox re-asks when below the minimum then accepts', async () => {
		const input = readableFrom(['1\n', '1,2\n']) // first line is 1 (< min 2), second satisfies
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		const value = await terminal.checkbox({ message: 'Pick 2', choices: ['a', 'b', 'c'], min: 2 })
		expect(value).toEqual(['a', 'b'])
	})

	it('checkbox settles the empty list at EOF instead of hanging', async () => {
		const input = readableFrom([]) // immediate EOF
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.checkbox({ message: 'Pick', choices: ['a', 'b'] })).toEqual([])
	})

	it('editor reads lines until EOF and joins them', async () => {
		const input = readableFrom(['first\n', 'second\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.editor({ message: 'Notes' })).toBe('first\nsecond')
	})

	it('editor reads a final line with NO trailing newline', async () => {
		const input = readableFrom(['a\nb']) // 'b' unterminated — readline still delivers it on close
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.editor({ message: 'Notes' })).toBe('a\nb')
	})

	it('editor on an empty (immediate-EOF) stream falls back to the default', async () => {
		const input = readableFrom([])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		expect(await terminal.editor({ message: 'Notes', default: 'nothing typed' })).toBe(
			'nothing typed',
		)
	})

	it('never enters raw mode on a non-TTY stream', async () => {
		const input = readableFrom(['hello\n'])
		const writes: string[] = []
		const output: OutputStreamInterface = {
			write(text: string) {
				writes.push(text)
				return true
			},
			isTTY: false,
		}
		const terminal = createTerminal({ input, output })
		expect(await terminal.input({ message: 'Say' })).toBe('hello')
		// No cursor-hide escape — the raw-mode path was never taken.
		expect(writes.join('')).not.toContain(CURSOR_HIDE)
	})

	it('renders the numbered choice list in the non-TTY select fallback', async () => {
		const input = readableFrom(['1\n'])
		const { target, writes } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		await terminal.select({ message: 'Pick', choices: ['red', 'green', 'blue'] })
		const printed = writes.calls.map(([text]) => text).join('')
		expect(printed).toContain('red')
		expect(printed).toContain('green')
		expect(printed).toContain('blue')
	})

	it('does NOT leak data / line listeners on the input stream after a fallback resolves', async () => {
		const input = readableFrom(['hi\n'])
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		await terminal.input({ message: 'X' })
		// readline closed its interface on resolve — no listener left behind on the real stream.
		expect(input.listenerCount('data')).toBe(0)
		expect(input.listenerCount('line')).toBe(0)
	})

	it('throws loudly when the fallback is driven with a non-readable input stream', async () => {
		// A minimal fake passes isInputStream (on/off) but is NOT a node Readable — and is not a TTY,
		// so the readline fallback is selected; #readline fails loudly rather than hanging silently.
		const input = { on() {}, off() {}, isTTY: false }
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		await expect(terminal.input({ message: 'X' })).rejects.toThrow(/readable input stream/)
	})

	it('the non-readable-input failure is a TerminalError with code DRIVER', async () => {
		const input = { on() {}, off() {}, isTTY: false }
		const { target } = createStreamTarget({ isTTY: false })
		const terminal = createTerminal({ input, output: target })
		const error = await terminal.input({ message: 'X' }).catch((reason: unknown) => reason)
		expect(isTerminalError(error) && error.code).toBe('DRIVER')
	})
})

describe('Terminal — injectable streams + guards', () => {
	// The guard fall-through for a MALFORMED stream (a value that fails isInputStream / isOutputStream,
	// so the real process stream is used) is covered at the guard level in helpers.test.ts — those
	// guards take `unknown`, so the off-shape cases live there without an `as` at this typed boundary.

	it('drives a prompt over a non-TTY input even when the output omits isTTY', async () => {
		// The output stand-in has a write but no isTTY — isOutputStream still accepts it, and isWritable
		// gates whether readline gets it as its output; the prompt resolves regardless.
		const input = readableFrom(['ok\n'])
		const output: OutputStreamInterface = { write: () => true }
		const terminal = createTerminal({ input, output })
		expect(await terminal.input({ message: 'X' })).toBe('ok')
	})
})
