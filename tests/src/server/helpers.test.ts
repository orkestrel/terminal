import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable, Writable } from 'node:stream'
import {
	isInputStream,
	isOutputStream,
	isRawCapable,
	isReadable,
	isWritable,
	lineCount,
	moveUp,
	redrawPrefix,
} from '@src/server'

// Pure-helper coverage for the T-c server-terminals branch (AGENTS §16) — the two stream-boundary
// guards (§14: total, false for anything off-shape), the readline-boundary guards, the raw-mode
// capability probe, and the in-place re-render cursor math (line counting + the reposition/clear
// prefix). Every helper is total and deterministic; no terminal, no I/O.

const ESC = String.fromCharCode(27)

describe('isInputStream', () => {
	it('accepts a stream with callable on / off', () => {
		expect(isInputStream({ on() {}, off() {} })).toBe(true)
	})

	it('accepts a full input shape (setRawMode / resume / pause / isTTY present)', () => {
		expect(
			isInputStream({ on() {}, off() {}, setRawMode() {}, resume() {}, pause() {}, isTTY: true }),
		).toBe(true)
	})

	it('rejects a value missing on or off', () => {
		expect(isInputStream({ on() {} })).toBe(false)
		expect(isInputStream({ off() {} })).toBe(false)
	})

	it('is total — false for non-objects, never a throw', () => {
		expect(isInputStream(undefined)).toBe(false)
		expect(isInputStream(null)).toBe(false)
		expect(isInputStream('stdin')).toBe(false)
		expect(isInputStream(42)).toBe(false)
		expect(isInputStream([])).toBe(false)
		expect(isInputStream({ on: 'not a function', off() {} })).toBe(false)
		expect(isInputStream({ on() {}, off: 7 })).toBe(false)
	})

	it('a real EventEmitter (process.stdin shape) satisfies the guard', () => {
		const emitter = new EventEmitter()
		// on/off are the only required members; an EventEmitter has both — the driver's real input seam.
		expect(isInputStream(emitter)).toBe(true)
	})
})

describe('isOutputStream', () => {
	it('accepts a stream with a callable write', () => {
		expect(isOutputStream({ write() {} })).toBe(true)
	})

	it('accepts an output shape carrying isTTY', () => {
		expect(isOutputStream({ write() {}, isTTY: true })).toBe(true)
	})

	it('is total — false for anything off-shape, never a throw', () => {
		expect(isOutputStream(undefined)).toBe(false)
		expect(isOutputStream(null)).toBe(false)
		expect(isOutputStream('stdout')).toBe(false)
		expect(isOutputStream(0)).toBe(false)
		expect(isOutputStream({})).toBe(false)
		expect(isOutputStream({ write: 42 })).toBe(false)
	})
})

describe('isReadable / isWritable (readline boundary)', () => {
	it('a real node Readable / Writable satisfies the guards', () => {
		const stream = new PassThrough()
		expect(isReadable(stream)).toBe(true)
		expect(isWritable(stream)).toBe(true)
	})

	it('a real Readable.from(...) — the non-TTY fallback input — is readable', () => {
		const readable = Readable.from(['line\n'])
		expect(isReadable(readable)).toBe(true)
		// A pure Readable is not writable (no `write`/`end`), so the readline output is omitted for it.
		expect(isWritable(readable)).toBe(false)
	})

	it('a real Writable is writable but not readable', () => {
		const writable = new Writable({ write: (_chunk, _enc, done) => done() })
		expect(isWritable(writable)).toBe(true)
		expect(isReadable(writable)).toBe(false)
	})

	it('a minimal fake input stream (on/off only) is NOT a full readable or writable', () => {
		expect(isReadable({ on() {}, off() {} })).toBe(false)
		expect(isWritable({ on() {}, off() {} })).toBe(false)
	})

	it('is total — false for non-objects and partial shapes', () => {
		expect(isReadable(undefined)).toBe(false)
		expect(isReadable(null)).toBe(false)
		expect(isReadable('x')).toBe(false)
		expect(isWritable(null)).toBe(false)
		expect(isWritable(undefined)).toBe(false)
		expect(isReadable({ read() {} })).toBe(false) // missing pipe
		expect(isReadable({ pipe() {} })).toBe(false) // missing read
		expect(isWritable({ write() {} })).toBe(false) // missing end
		expect(isWritable({ end() {} })).toBe(false) // missing write
	})
})

describe('isRawCapable', () => {
	it('true only when isTTY === true AND setRawMode is callable', () => {
		expect(isRawCapable({ on() {}, off() {}, setRawMode() {}, isTTY: true })).toBe(true)
	})

	it('false when not a TTY, even with setRawMode', () => {
		expect(isRawCapable({ on() {}, off() {}, setRawMode() {}, isTTY: false })).toBe(false)
		expect(isRawCapable({ on() {}, off() {}, setRawMode() {} })).toBe(false)
	})

	it('false on a TTY without setRawMode (a piped-but-marked stream)', () => {
		expect(isRawCapable({ on() {}, off() {}, isTTY: true })).toBe(false)
	})

	it('requires isTTY to be exactly true (a truthy non-true value does not qualify)', () => {
		// isTTY is `boolean | undefined`; the guard tests `=== true`, so only a real TTY flag passes.
		expect(isRawCapable({ on() {}, off() {}, setRawMode() {}, isTTY: undefined })).toBe(false)
	})
})

describe('lineCount', () => {
	it('a single line (no newline) is one line', () => {
		expect(lineCount('one line')).toBe(1)
		expect(lineCount('')).toBe(1)
	})

	it('N newlines span N+1 lines', () => {
		expect(lineCount('a\nb')).toBe(2)
		expect(lineCount('a\nb\nc')).toBe(3)
		expect(lineCount('trailing\n')).toBe(2)
	})

	it('counts newlines inside an ANSI-styled multi-line view', () => {
		const view = `${ESC}[36m?${ESC}[0m head\n  row one\n  row two`
		expect(lineCount(view)).toBe(3)
	})

	it('counts consecutive (blank-line) newlines too', () => {
		expect(lineCount('a\n\nb')).toBe(3) // the empty middle line still counts
		expect(lineCount('\n')).toBe(2) // a lone newline spans two (empty) lines
		expect(lineCount('\n\n\n')).toBe(4)
	})
})

describe('moveUp', () => {
	it('builds ESC[{count}A for a positive count', () => {
		expect(moveUp(3)).toBe(`${ESC}[3A`)
		expect(moveUp(1)).toBe(`${ESC}[1A`)
	})

	it('is empty for zero or negative (no wasted ESC[0A write)', () => {
		expect(moveUp(0)).toBe('')
		expect(moveUp(-2)).toBe('')
	})
})

describe('redrawPrefix', () => {
	it('a first render (previousLines = 1) is just CR + clear-down, no upward move', () => {
		const prefix = redrawPrefix(1)
		expect(prefix).not.toContain('A') // no cursor-up
		expect(prefix).toContain(`${ESC}[J`) // clear-down
		expect(prefix).toContain(String.fromCharCode(13)) // carriage return
	})

	it('a taller previous view climbs previousLines - 1 lines before clearing', () => {
		const prefix = redrawPrefix(4)
		expect(prefix).toContain(`${ESC}[3A`) // climb 3 lines (4 - 1)
		expect(prefix).toContain(`${ESC}[J`)
	})

	it('orders the sequence climb → carriage-return → clear-down (so the new view draws on a clean region)', () => {
		// The climb must precede the CR+clear so the cursor is back at the top-left of the prior view
		// before the screen is erased downward — otherwise a taller prior view leaves orphaned rows.
		expect(redrawPrefix(3)).toBe(`${ESC}[2A${String.fromCharCode(13)}${ESC}[J`)
	})

	it('a two-line previous view climbs exactly one line', () => {
		expect(redrawPrefix(2)).toBe(`${ESC}[1A${String.fromCharCode(13)}${ESC}[J`)
	})

	it('never emits a wasted cursor-up (ESC[..A) even for a degenerate count', () => {
		// previousLines 1 ⇒ climb 0 ⇒ moveUp('') ⇒ no cursor-up byte at all (only CR + clear-down).
		expect(redrawPrefix(1)).toBe(`${String.fromCharCode(13)}${ESC}[J`)
		// previousLines 0 ⇒ moveUp(-1) is '' too — still no cursor-up, just CR + clear-down.
		expect(redrawPrefix(0)).toBe(`${String.fromCharCode(13)}${ESC}[J`)
		expect(redrawPrefix(0)).not.toContain('A') // no cursor-up segment
	})
})
