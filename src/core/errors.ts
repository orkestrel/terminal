import type { TerminalErrorCode } from './types.js'

// `.claude/rules/typescript.md` § Errors and outcomes: a real error type, not a sentinel. Callers
// branch on the machine-readable
// `error.code` rather than parsing the message, and the guard narrows with `instanceof`,
// mirroring the agents-module errors.

/**
 * Represents the error the terminal surfaces for its own refusals: parking on a destroyed or full broker, an
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
	/** Holds the machine-readable condition — see {@link TerminalErrorCode}. */
	readonly code: TerminalErrorCode
	/** Holds an optional context bag naming the offending values — see the class {@link TerminalError remarks}. */
	readonly context?: Readonly<Record<string, unknown>>

	/**
	 * Builds one terminal refusal.
	 *
	 * @param code - The machine-readable {@link TerminalErrorCode} a caller branches on
	 * @param message - The human-readable reason
	 * @param context - The optional bag naming the offending values — see the class {@link TerminalError remarks}
	 */
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
 * Narrows an unknown caught value to a {@link TerminalError}.
 *
 * @param value - The value to test (typically a `catch` binding or a rejected prompt call)
 * @returns True if `value` is a {@link TerminalError}; false otherwise
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
