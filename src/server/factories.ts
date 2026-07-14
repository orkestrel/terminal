import type { TerminalInterface, TerminalOptions } from './types.js'
import { Terminal } from './Terminal.js'

/**
 * Create the interactive terminal prompt {@link TerminalInterface} (T-c) — the local-TTY arm of the
 * prompt tri-surface, the env-symmetric sibling of the core headless `createPrompt` broker and the
 * SSE `createPromptClient` bridge. A `Terminal` answers each prompt LOCALLY at this machine's
 * keyboard: it reads raw-mode stdin, drives the pure core `*Reduce` reducers, renders each `view` in
 * place, and resolves on submit / rejects with a {@link import('@src/core').TerminalError} (`CANCEL`)
 * on ctrl-c. It is the ONLY impure part of the prompt stack.
 *
 * @param options - See {@link TerminalOptions}
 * @returns A {@link TerminalInterface} — the six async prompt forms (`input` / `password` / `confirm`
 *   / `select` / `checkbox` / `editor`) driven over the resolved streams
 *
 * @remarks
 * - **Drives the pure reducers.** Each prompt builds its initial state (`create*State`), enters raw
 *   mode ONCE, and feeds each keypress through `parseKey` → the reducer → an in-place re-render; the
 *   driver owns no prompt logic itself (state / view / validation / cancel all come from the core).
 * - **Raw-mode leak-free.** Raw mode is entered exactly once per prompt and ALWAYS cleaned up — on
 *   submit, on cancel, and on a throw — leaving no raw mode and no leaked `'data'` listener.
 * - **Injectable + guard-narrowed.** `options.input` / `options.output` default to `process.stdin` /
 *   `process.stdout` but accept ANY {@link import('./types.js').InputStreamInterface} /
 *   {@link import('./types.js').OutputStreamInterface}, resolved through their §14 guards (never an
 *   `as`), so a test drives every prompt with a fake TTY that emits scripted key chunks and records
 *   the rendered output — and asserts the resolved value, cancel-on-ctrl-c, and no leaked raw mode.
 * - **Non-TTY fallback.** When `input` is not a TTY (piped), raw mode is unavailable, so the prompts
 *   fall back to `node:readline` line input (still validating); `select` / `checkbox` present a
 *   numbered list, and `editor` reads lines until EOF.
 *
 * @example
 * ```ts
 * import { createTerminal } from '@src/server'
 *
 * const terminal = createTerminal()
 * const name = await terminal.input({ message: 'Your name' })
 * const proceed = await terminal.confirm({ message: 'Continue?', default: true })
 * ```
 */
export function createTerminal(options?: TerminalOptions): TerminalInterface {
	return new Terminal(options)
}
