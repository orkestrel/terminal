// Server-local types for the interactive `Terminal` driver — the ONLY impure part of the terminal
// stack. `@orkestrel/form` owns the form, its twelve controls, and its rules; `@src/core` owns the
// `TerminalInterface` contract the driver implements, the `parseKey` decoder, the `create*State`
// factories, the `*Reduce` reducers, the theme, and `TerminalError`. None of those is redeclared
// here. What is genuinely server-only is the pair of injectable stream shapes (so a test drives the
// walk with a fake TTY) and the driver's own options.

import type { PromptThemeOptions } from '@src/core'

/**
 * The minimal input-stream shape the driver reads — exactly the slice of a Node `tty.ReadStream` /
 * `process.stdin` it touches, and no more. A {@link TerminalOptions} `input` is narrowed to this
 * through {@link import('./helpers.js').isInputStream}, never an assertion, so a test drives a whole
 * form with a hand-built fake stream that emits scripted key chunks, never touches the real
 * `process.stdin`, and asserts that raw mode is entered once and always cleaned up.
 *
 * @remarks
 * - `on(event, listener)` / `off(event, listener)` — subscribe / unsubscribe a `'data'` chunk
 *   listener (the irreducible event seam; a `Buffer`, string, or `Uint8Array` chunk arrives). The
 *   two required methods.
 * - `setRawMode(mode)` — switch the TTY in and out of raw mode (each keypress delivered
 *   immediately, no line buffering, no echo). Present on a real `tty.ReadStream`; ABSENT on a
 *   piped, non-TTY stream, and its absence (or `isTTY !== true`) selects the
 *   {@link import('node:readline').Interface} line-input fallback.
 * - `resume()` / `pause()` — start / stop the flow of `'data'` events. Raw mode `resume()`s on
 *   enter and `pause()`s on cleanup; both are optional, so a fake may omit them.
 * - `isTTY` — `true` on a real terminal, absent or `false` when piped to a file or another process.
 */
export interface InputStreamInterface {
	on(event: 'data', listener: (chunk: string | Uint8Array) => void): void
	off(event: 'data', listener: (chunk: string | Uint8Array) => void): void
	setRawMode?(mode: boolean): void
	resume?(): void
	pause?(): void
	readonly isTTY?: boolean
}

/**
 * The minimal output-stream shape the driver writes — exactly the slice of a Node `tty.WriteStream`
 * / `process.stdout` it touches. A {@link TerminalOptions} `output` is narrowed to this through
 * {@link import('./helpers.js').isOutputStream}, never an assertion, so a test records every byte
 * the walk renders and asserts the rendered content with the ANSI stripped.
 *
 * @remarks
 * - `write(text)` — the one required method: push a chunk (a rendered field view, a group header, a
 *   cursor or clear sequence) to the stream. A real stream returns a backpressure boolean; the
 *   driver ignores the return, because a prompt is human-paced, so a fake may return `void`.
 * - `isTTY` — present and `true` on a real terminal. The driver does not branch its rendering on
 *   it; the styler already decided color.
 */
export interface OutputStreamInterface {
	write(text: string): boolean | void
	readonly isTTY?: boolean
}

/**
 * Options for {@link import('./factories.js').createTerminal} — every member optional, so a bare
 * `createTerminal()` walks a form over the real `process.stdin` / `process.stdout` with the default
 * theme.
 *
 * @remarks
 * - `input` — the stream keystrokes are read from; defaults to `process.stdin`. Any
 *   {@link InputStreamInterface}-shaped stream is accepted, resolved through
 *   {@link import('./helpers.js').isInputStream}, so a test injects a fake TTY that emits scripted
 *   `'data'` chunks. A stream that is not a TTY falls back to `node:readline` line input.
 * - `output` — the stream each view is rendered to; defaults to `process.stdout`. Any
 *   {@link OutputStreamInterface}-shaped stream is accepted, resolved through
 *   {@link import('./helpers.js').isOutputStream}, so a test records the rendered output.
 * - `theme` — the glyphs and role styles every rendered line is painted with, merged over
 *   {@link import('@src/core').DEFAULT_PROMPT_THEME} leaf by leaf by
 *   {@link import('@src/core').createPromptTheme}. Supplying one icon or one role leaves every
 *   other slot at its default.
 */
export interface TerminalOptions {
	readonly input?: InputStreamInterface
	readonly output?: OutputStreamInterface
	readonly theme?: PromptThemeOptions
}
