// Pure helpers for the T-c server-terminals branch (AGENTS §5 — every function here is exported and
// unit-tested). Total utilities: the two stream-boundary guards (narrow `process.stdin` /
// `process.stdout` / any injected stream without `as`, §14), the raw-mode capability probe, and the
// pure cursor-math the interactive `Terminal` driver uses to redraw a prompt view IN PLACE (count a
// view's lines, build the cursor-up sequence, and assemble the whole reposition-and-clear prefix) —
// so the impure driver only feeds bytes into the reducers and writes the strings these helpers build.

import type { InputStreamInterface, OutputStreamInterface } from './types.js'
import { CARRIAGE_RETURN, CLEAR_DOWN, CSI_UP } from './constants.js'

/**
 * Whether `value` is a usable {@link InputStreamInterface} — a record with callable `on` / `off`
 * `'data'` subscription methods. A total type guard (AGENTS §14): it NEVER throws and returns `false`
 * for anything off-shape, so it narrows the one unavoidable input boundary (the real `process.stdin`,
 * or a fake TTY a test injects) to the exact slice the driver reads — no `as`.
 *
 * @remarks
 * Only `on` / `off` are required (the irreducible event seam); `setRawMode` / `resume` / `pause` /
 * `isTTY` are optional on {@link InputStreamInterface}, so their absence does not disqualify a stream
 * — a piped, non-TTY stream is still a valid input, just one the driver reads through the readline
 * fallback rather than raw mode.
 *
 * @param value - Any value crossing the boundary (a process stream, an injected fake, `unknown`)
 * @returns `true` when `value` has callable `on` and `off`
 */
export function isInputStream(value: unknown): value is InputStreamInterface {
	return (
		typeof value === 'object' &&
		value !== null &&
		'on' in value &&
		typeof value.on === 'function' &&
		'off' in value &&
		typeof value.off === 'function'
	)
}

/**
 * Whether `value` is a usable {@link OutputStreamInterface} — a record with a callable `write`. A
 * total type guard (AGENTS §14): it NEVER throws and returns `false` for anything off-shape, so it
 * narrows the output boundary (the real `process.stdout`, or a recording fake a test injects) to the
 * one method the driver writes through — no `as`.
 *
 * @param value - Any value crossing the boundary (a process stream, an injected fake, `unknown`)
 * @returns `true` when `value` has a callable `write`
 */
export function isOutputStream(value: unknown): value is OutputStreamInterface {
	return (
		typeof value === 'object' &&
		value !== null &&
		'write' in value &&
		typeof value.write === 'function'
	)
}

/**
 * Whether `value` is a Node {@link NodeJS.ReadableStream} — a total structural guard (AGENTS §14)
 * checking for the callable `read` / `pipe` / `on` that `node:readline`'s `createInterface` requires
 * as its `input`. The non-TTY fallback narrows the resolved input stream through this before handing
 * it to readline (never an `as`), so a real piped `process.stdin` (or a `PassThrough` a test injects)
 * crosses into the readline boundary honestly. Never throws; returns `false` for a minimal fake that
 * isn't a full readable.
 *
 * @param value - The resolved input stream (or any value crossing the boundary)
 * @returns `true` when `value` has the readable methods readline needs
 */
export function isReadable(value: unknown): value is NodeJS.ReadableStream {
	return (
		typeof value === 'object' &&
		value !== null &&
		'read' in value &&
		typeof value.read === 'function' &&
		'pipe' in value &&
		typeof value.pipe === 'function'
	)
}

/**
 * Whether `value` is a Node {@link NodeJS.WritableStream} — a total structural guard (AGENTS §14)
 * checking for the callable `write` / `end` that `node:readline`'s `createInterface` accepts as its
 * `output`. Paired with {@link isReadable} so the non-TTY fallback narrows BOTH streams to the
 * readline boundary without an `as`. Never throws.
 *
 * @param value - The resolved output stream (or any value crossing the boundary)
 * @returns `true` when `value` has the writable methods readline needs
 */
export function isWritable(value: unknown): value is NodeJS.WritableStream {
	return (
		typeof value === 'object' &&
		value !== null &&
		'write' in value &&
		typeof value.write === 'function' &&
		'end' in value &&
		typeof value.end === 'function'
	)
}

/**
 * Whether an input stream can be driven in RAW mode — it both reports `isTTY === true` AND exposes a
 * callable `setRawMode`. The {@link import('./Terminal.js').Terminal} probes this to choose its path:
 * `true` ⇒ the interactive raw-mode prompts (arrow-key navigation, live re-render); `false` ⇒ the
 * `node:readline` line-input fallback (a piped / non-terminal stream cannot enter raw mode). Total —
 * never throws.
 *
 * @param input - The resolved {@link InputStreamInterface}
 * @returns `true` when the stream is a TTY with `setRawMode`
 */
export function isRawCapable(input: InputStreamInterface): boolean {
	return input.isTTY === true && typeof input.setRawMode === 'function'
}

/**
 * The number of terminal LINES a rendered prompt `view` occupies — one more than its newline count
 * (a view with no newline is a single line; N newlines span N+1 lines). The basis of the in-place
 * re-render: the driver records the line count of the view it just wrote so the next redraw knows how
 * far up to move the cursor before overwriting. Total; an empty string is one (empty) line.
 *
 * @param view - The rendered (possibly multi-line, possibly ANSI-styled) view string
 * @returns The number of lines the view spans (always at least 1)
 */
export function lineCount(view: string): number {
	let lines = 1
	for (const character of view) {
		if (character === '\n') lines += 1
	}
	return lines
}

/**
 * The cursor-UP control sequence that moves the cursor up `count` lines (`ESC[{count}A`) — or the
 * empty string when `count` is zero or negative (no movement needed, and `ESC[0A` is a wasted write).
 * The pure step the in-place re-render uses to climb back over the previous view before clearing it.
 * Total.
 *
 * @param count - How many lines to move the cursor up
 * @returns The `ESC[{count}A` sequence, or `''` when `count <= 0`
 */
export function moveUp(count: number): string {
	if (count <= 0) return ''
	return `${CSI_UP.replace('{count}', String(count))}`
}

/**
 * The full reposition-and-clear prefix to write BEFORE re-rendering a prompt view in place — given
 * the line count of the PREVIOUS view, it moves the cursor up over those lines, returns it to column
 * 0, and erases everything from there to the end of the screen, so the next view is drawn on a clean
 * region (no orphaned rows from a taller previous view). Pure; the driver writes this immediately
 * followed by the new view.
 *
 * @remarks
 * For the FIRST render `previousLines` is `1` (the cursor sits on the line the prompt opened on) so
 * the prefix is just a carriage return + clear-down — the prompt draws from the current line. For a
 * subsequent render it climbs `previousLines - 1` lines (the cursor is on the LAST line of the prior
 * view) before clearing. Keeping the math here (not in the driver) makes the re-render unit-testable
 * without a real terminal.
 *
 * @param previousLines - The line count of the view currently on screen (from {@link lineCount})
 * @returns The control-sequence prefix to write before the new view
 */
export function redrawPrefix(previousLines: number): string {
	return `${moveUp(previousLines - 1)}${CARRIAGE_RETURN}${CLEAR_DOWN}`
}
