// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` test project. `node:*` imports belong here, never in `setup.ts`.

import type { InputStreamInterface, OutputStreamInterface } from '@src/server'
import type { TestRecorderInterface } from './setup.js'
import { EventEmitter } from 'node:events'
import { expect } from 'vitest'
import { strip } from '@orkestrel/console'
import { createRecorder } from './setup.js'

/**
 * A recording {@link OutputStreamInterface} — a stand-in `process.stdout` / `process.stderr`
 * with a recorded `write`, so a non-TTY `Terminal` test drives the `node:readline` fallback
 * WITHOUT touching the real process streams (AGENTS §16.1 — a reusable server fixture lives in
 * setup). The recorder captures every written string; `isTTY` is fixed at construction.
 *
 * @param options - `isTTY` (default `false` — a piped stream). `write` always returns `true`
 *   (no simulated backpressure).
 * @returns The `target` (pass as `output` to `createTerminal`) plus its `writes` recorder
 *   (`writes.calls` is the list of `[text]` tuples written, `writes.count` the tally).
 */
export function createStreamTarget(options?: { isTTY?: boolean }): {
	readonly target: OutputStreamInterface
	readonly writes: TestRecorderInterface<readonly [text: string]>
} {
	const writes = createRecorder<readonly [text: string]>()
	const target: OutputStreamInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? false,
	}
	return { target, writes }
}

/**
 * A scripted FAKE TTY pair for the interactive `Terminal` driver — a stand-in `process.stdin` /
 * `process.stdout` so a prompt test drives every keypress and records every byte WITHOUT a real
 * terminal (AGENTS §16.1 — a reusable server fixture lives in setup). The `input` is a real
 * {@link EventEmitter} (so `on` / `off` / the driver's `'data'` subscription are genuine, not mocked)
 * wearing the {@link InputStreamInterface} shape (a TTY by default, with `setRawMode` / `resume` /
 * `pause`); `push(chunk)` emits a scripted key chunk into it. The `output` records every written
 * string; {@link FakeTTYInterface.text} returns that output ANSI-STRIPPED (via the framework's
 * `strip`, never a re-rolled regex — §16.1) so a test asserts the RENDERED CONTENT of a prompt view.
 *
 * The fixture also tracks the raw-mode lifecycle so a test can prove the driver is leak-free: `enters`
 * / `exits` count `setRawMode(true)` / `setRawMode(false)`, `raw` is the live raw-mode flag, and
 * `listeners` is the current `'data'` listener count — after a prompt resolves a test asserts
 * `enters === 1`, `exits === 1`, `raw === false`, and `listeners === 0` (raw mode entered exactly
 * once and fully cleaned up, no leaked listener).
 *
 * @param options - `isTTY` (default `true` — exercise the raw-mode interactive path; pass `false` to
 *   drive the `node:readline` non-TTY fallback)
 * @returns The {@link FakeTTYInterface}
 */
export function createFakeTTY(options?: { isTTY?: boolean }): FakeTTYInterface {
	const emitter = new EventEmitter()
	const writes = createRecorder<readonly [text: string]>()
	let raw = false
	let enters = 0
	let exits = 0
	const input: InputStreamInterface = {
		on(event, listener) {
			emitter.on(event, listener)
		},
		off(event, listener) {
			emitter.off(event, listener)
		},
		setRawMode(mode: boolean) {
			if (mode && !raw) enters += 1
			if (!mode && raw) exits += 1
			raw = mode
		},
		resume() {},
		pause() {},
		isTTY: options?.isTTY ?? true,
	}
	const output: OutputStreamInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? true,
	}
	return {
		input,
		output,
		writes,
		push: (chunk: string | Uint8Array) => emitter.emit('data', chunk),
		text: () => strip(writes.calls.map(([written]) => written).join('')),
		get raw() {
			return raw
		},
		get enters() {
			return enters
		},
		get exits() {
			return exits
		},
		listeners: () => emitter.listenerCount('data'),
	}
}

/** A scripted fake-TTY pair for the interactive `Terminal` tests — see {@link createFakeTTY}. */
export interface FakeTTYInterface {
	/** The injectable input stream — pass as `createTerminal({ input })`; a real {@link EventEmitter} under the {@link InputStreamInterface} shape. */
	readonly input: InputStreamInterface
	/** The injectable recording output stream — pass as `createTerminal({ output })`. */
	readonly output: OutputStreamInterface
	/** Every written string, in order (`writes.calls` is the list of `[text]` tuples) — the raw record behind {@link text}. */
	readonly writes: TestRecorderInterface<readonly [text: string]>
	/** Emit one scripted key chunk into the input as a `'data'` event (a string or raw bytes `parseKey` decodes). */
	push(chunk: string | Uint8Array): void
	/** The full written output with ANSI stripped — assert a prompt view's rendered content against this. */
	text(): string
	/** The live raw-mode flag — assert `false` after a prompt resolves (raw mode was left). */
	readonly raw: boolean
	/** How many times `setRawMode(true)` was called — assert `1` (raw mode entered exactly once per prompt). */
	readonly enters: number
	/** How many times `setRawMode(false)` was called — assert `1` (raw mode cleaned up). */
	readonly exits: number
	/** The current `'data'` listener count — assert `0` after a prompt resolves (no leaked listener). */
	listeners(): number
}

// The cursor hide / show escapes the interactive `Terminal` writes around a prompt — built from the
// ESC char code so no raw control byte sits in source. `assertCleanExit` asserts BOTH appear in the
// raw output (the cursor was hidden during the prompt and RESTORED on the way out).
const CURSOR_HIDE = `${String.fromCharCode(27)}[?25l`
const CURSOR_SHOW = `${String.fromCharCode(27)}[?25h`

/**
 * The full concatenated RAW output (ANSI intact) the interactive `Terminal` driver wrote to a {@link
 * FakeTTYInterface} — the un-stripped twin of {@link FakeTTYInterface.text} (which returns the same
 * bytes ANSI-STRIPPED). Use it to assert the exact escape sequences (the cursor hide/show, the
 * cursor-up redraw climbs) OR — for a `password` prompt — to prove a secret NEVER appears in ANY
 * written chunk, the committed submit line included (AGENTS §16.1).
 *
 * @param tty - The fake TTY from {@link createFakeTTY}
 * @returns Every written string joined in order, ANSI escapes intact
 */
export function rawOutput(tty: FakeTTYInterface): string {
	return tty.writes.calls.map(([written]) => written).join('')
}

/**
 * Assert the raw-mode LEAK-FREEDOM invariant after an interactive prompt settles (submit OR cancel):
 * raw mode was entered EXACTLY `entries` time(s) and fully unwound (`enters === exits`, `raw ===
 * false`), no `'data'` listener leaked (`listeners() === 0`), and the cursor was hidden then SHOWN
 * again (restored on the way out) — the load-bearing `Terminal` invariant every exit-path test
 * checks (AGENTS §16.1). The un-stripped {@link rawOutput} is the twin reader it builds on.
 *
 * @param tty - The fake TTY from {@link createFakeTTY}, after a prompt has resolved/rejected
 * @param entries - How many raw-mode entries to expect (default `1` — one prompt; pass the prompt
 *   count for a re-use-across-sequential-prompts assertion)
 */
export function assertCleanExit(tty: FakeTTYInterface, entries = 1): void {
	expect(tty.enters).toBe(entries)
	expect(tty.exits).toBe(entries)
	expect(tty.raw).toBe(false)
	expect(tty.listeners()).toBe(0)
	const raw = rawOutput(tty)
	expect(raw).toContain(CURSOR_HIDE)
	expect(raw).toContain(CURSOR_SHOW)
}
