import type { TerminalInterface } from '@src/core'
import type { TerminalOptions } from './types.js'
import { Terminal } from './Terminal.js'

/**
 * Creates the interactive terminal form driver — the local-keyboard arm of the terminal trio, beside
 * the core headless `createPrompt` broker and the SSE `createPromptClient` bridge. Where the broker
 * PARKS a live form until somebody elsewhere answers it, a `Terminal` answers one HERE: it walks the
 * form's fields in schema order, drives each control's pure reducer over raw-mode stdin, binds every
 * answer through the form's own `fill`, and submits. It is the only impure part of the terminal
 * stack.
 *
 * @param options - See {@link TerminalOptions}
 * @returns A {@link TerminalInterface} whose `ask` drives one whole form over the resolved streams
 *
 * @remarks
 * - **The form is the unit.** `ask` takes the caller's live form and returns its settled values. The
 *   returned promise is that form's own `answer`, so a caller holding the form can await either one.
 * - **Every control renders.** The line-read controls are read as a line of text with their format cue,
 *   `password` masks, `confirm` takes a key, `editor` takes a block, `select` and `checkbox` drive a
 *   list, and an open `select` accepts a value its list does not offer.
 * - **The form decides.** A blank answer binds as absence, the form evaluates, and a refusal
 *   re-walks only the fields the walk can still edit.
 * - **Injectable and guard-narrowed.** `input` and `output` default to `process.stdin` and
 *   `process.stdout` but accept any stream of the declared minimal shape, resolved through their
 *   guards rather than an assertion, so a test drives a whole form with a fake TTY that emits
 *   scripted key chunks and records every rendered byte.
 * - **Non-TTY fallback.** A piped stream cannot enter raw mode, so the same walk runs over
 *   `node:readline` line input.
 *
 * @example
 * ```ts
 * import { createForm } from '@orkestrel/form'
 * import { createTerminal } from '@orkestrel/terminal/server'
 *
 * const terminal = createTerminal()
 * const values = await terminal.ask(
 * 	createForm({
 * 		label: 'Sign up',
 * 		fields: [
 * 			{ control: 'text', name: 'email', label: 'Email', rule: { required: true, email: true } },
 * 			{ control: 'confirm', name: 'terms', label: 'I accept the terms' },
 * 		],
 * 	}),
 * )
 * ```
 */
export function createTerminal(options?: TerminalOptions): TerminalInterface {
	return new Terminal(options)
}
