// Server-local types for the T-c terminals branch — the interactive `Terminal` driver, the ONLY
// impure part of the prompt stack. The PURE prompt core (`src/core/terminals`) owns the
// cross-environment contracts — `PromptFormInterface` (the six async prompt methods this driver
// implements as the THIRD surface, beside the headless broker + the SSE bridge), the `parseKey`
// decoder, the `create*State` factories + `*Reduce` reducers, and `TerminalError`; those are
// IMPORTED from `@src/core`, never redeclared. The types here are server-only: the injectable
// input / output stream shapes (so a test drives the driver with a fake TTY), the `Terminal`
// options, and its interface.

import type { PromptFormInterface } from '@src/core'

/**
 * The minimal input-stream shape the {@link TerminalInterface} reads — exactly the slice of a Node
 * `tty.ReadStream` / `process.stdin` it touches, and no more (AGENTS §21 — minimal interface). A
 * {@link TerminalOptions} `input` is narrowed to this via
 * {@link import('./helpers.js').isInputStream} (AGENTS §14 — narrow the boundary, never `as`), so a
 * test drives every prompt with a hand-built fake stream that emits scripted key chunks and never
 * touches the real `process.stdin` — and asserts raw mode is entered exactly once and always
 * cleaned up (no leak).
 *
 * @remarks
 * - `on(event, listener)` / `off(event, listener)` — subscribe / unsubscribe a `'data'` chunk
 *   listener (the irreducible event seam; a `Buffer` / string / `Uint8Array` chunk arrives). The two
 *   required methods.
 * - `setRawMode(mode)` — switch the TTY in / out of raw mode (each keypress delivered immediately,
 *   no line buffering, no echo). Present on a real `tty.ReadStream`; ABSENT on a piped, non-TTY
 *   stream — its absence (or `isTTY !== true`) selects the {@link import('node:readline').Interface}
 *   line-input fallback. The ONLY place raw mode is touched is {@link import('./Terminal.js').Terminal}'s
 *   `#enterRaw`.
 * - `resume()` / `pause()` — start / stop the flow of `'data'` events. The raw-mode primitive
 *   `resume()`s on enter and `pause()`s on cleanup; optional (a fake may omit them).
 * - `isTTY` — `true` on a real terminal, absent / `false` when piped to a file or another process.
 *   The driver reads it to choose the raw-mode path (interactive arrow-key prompts) vs. the readline
 *   fallback (numbered / line input).
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
 * The minimal output-stream shape the {@link TerminalInterface} writes — exactly the slice of a Node
 * `tty.WriteStream` / `process.stdout` it touches (AGENTS §21). A {@link TerminalOptions} `output`
 * is narrowed to this via {@link import('./helpers.js').isOutputStream} (AGENTS §14), so a test
 * records every byte the driver renders (the prompt view, the cursor-management sequences) with a
 * fake stream and asserts the rendered content (ANSI stripped) and the resolved value.
 *
 * @remarks
 * - `write(text)` — the one required method: push a chunk (a rendered prompt view, a cursor / clear
 *   escape sequence) to the stream. A real stream returns a backpressure boolean; the driver ignores
 *   the return (a prompt is human-paced, never backpressured), so a fake may return `void`.
 * - `isTTY` — present and `true` on a real terminal. The driver does not branch its rendering on it
 *   (the styler already decided color); it is part of the minimal shape for symmetry with the input
 *   stream and so a consumer may inspect it.
 */
export interface OutputStreamInterface {
	write(text: string): boolean | void
	readonly isTTY?: boolean
}

/**
 * Options for {@link import('./factories.js').createTerminal} — both streams optional, so a bare
 * `createTerminal()` drives the real `process.stdin` / `process.stdout`.
 *
 * @remarks
 * - `input` — the stream keystrokes are read from; defaults to `process.stdin`. Any
 *   {@link InputStreamInterface}-shaped stream is accepted (resolved through
 *   {@link import('./helpers.js').isInputStream}, never `as`), so a test injects a fake TTY that
 *   emits scripted `'data'` chunks. When the stream is not a TTY (no `setRawMode` / `isTTY !== true`),
 *   the prompts fall back to `node:readline` line input.
 * - `output` — the stream the prompt view is rendered to; defaults to `process.stdout`. Any
 *   {@link OutputStreamInterface}-shaped stream is accepted (resolved through
 *   {@link import('./helpers.js').isOutputStream}), so a test records the rendered output.
 */
export interface TerminalOptions {
	readonly input?: InputStreamInterface
	readonly output?: OutputStreamInterface
}

/**
 * The interactive terminal prompt DRIVER (the third {@link PromptFormInterface} surface) — reads the
 * TTY and DRIVES the pure core `*Reduce` reducers, the ONLY impure part of the prompt stack. Where
 * the core `Prompt` broker PARKS each prompt and the `PromptClient` bridges one over SSE, a
 * `Terminal` answers each prompt LOCALLY at this machine's keyboard: it feeds raw-mode stdin bytes
 * through `parseKey` into the matching reducer, renders the returned `view` in place (tracking the
 * previous view's line count to overwrite it), and resolves on a `submit` step / rejects with a
 * {@link import('@src/core').TerminalError} (`CANCEL`) on ctrl-c.
 *
 * @remarks
 * - **Drives the pure reducers.** Each method builds the initial state (`create*State(options)`),
 *   enters raw mode once, and on each keypress runs `parseKey` → the reducer → an in-place re-render;
 *   it owns NO prompt logic of its own (state, view, validation, and the cancel signal all come from
 *   the pure core).
 * - **Raw-mode leak-free.** Raw mode is entered exactly once per prompt and ALWAYS cleaned up — on
 *   submit, on cancel, and on a throw — leaving no raw mode and no leaked `'data'` listener.
 * - **In-place re-render.** Between keystrokes the cursor is moved up over the previous view's lines,
 *   the screen cleared down, and the new view written — so a `select` / `checkbox` list redraws live;
 *   the cursor is hidden during the prompt and restored after.
 * - **Non-TTY fallback.** When `input` is not a TTY, raw mode is unavailable, so the prompts fall
 *   back to `node:readline` line input (still validating) — `select` / `checkbox` present a numbered
 *   list read via a readline line, and `editor` reads lines until EOF.
 * - **Event-free.** A `Terminal` is a request / response driver — each prompt is a Promise; there is
 *   no observable lifecycle worth an emitter, so (unlike the broker / bridge) it carries none.
 */
export interface TerminalInterface extends PromptFormInterface {}
