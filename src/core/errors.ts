import type { TerminalErrorCode } from './types.js'

// AGENTS §12: a real error type, not a sentinel. An interactive server-`Terminal` prompt aborted
// with ctrl-c REJECTS its Promise with a `TerminalError` carrying a machine-readable `code`, so a
// caller branches on `error.code` rather than parsing the message. A parked broker prompt that
// expires (its `timeout` elapsed, or the broker was `destroy`ed while it was still pending) instead
// abandons the parked form, and its own answer Promise rejects with the Form package's `ABANDONED`
// error. The optional `context` bag names the offending prompt id. The guard narrows with
// `instanceof`, mirroring the agents-module errors.

/**
 * The error the terminal surfaces for its own refusals: parking on a destroyed or full broker, an
 * unusable driver stream, a manager routing fault, or a ctrl-c cancellation. A parked form's own
 * lifecycle failures reject through the form's `answer` with the form package's error, never with
 * this one.
 *
 * @remarks
 * Carries a {@link TerminalErrorCode} and an optional `context` bag naming the offending values:
 * `{ cap }` on `LIMIT`, `{ to, known }` on `TARGET`, and `{ from, to, path }` on `DEADLOCK`. Narrow
 * a caught value with {@link isTerminalError} and branch on `error.code`.
 */
export class TerminalError extends Error {
	/** The machine-readable condition — see {@link TerminalErrorCode}. */
	readonly code: TerminalErrorCode
	/** An optional context bag naming the offending values — see the class {@link TerminalError remarks}. */
	readonly context?: Readonly<Record<string, unknown>>

	constructor(
		code: TerminalErrorCode,
		message: string,
		context?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		this.name = 'TerminalError'
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrow an unknown caught value to a {@link TerminalError}.
 *
 * @param value - The value to test (typically a `catch` binding or a rejected prompt call)
 * @returns `true` when `value` is a {@link TerminalError}
 *
 * @example
 * ```ts
 * try {
 * 	await terminal.ask(form)
 * } catch (error) {
 * 	if (isTerminalError(error) && error.code === 'CANCEL') {
 * 		// the person aborted
 * 	}
 * }
 * ```
 */
export function isTerminalError(value: unknown): value is TerminalError {
	return value instanceof TerminalError
}
