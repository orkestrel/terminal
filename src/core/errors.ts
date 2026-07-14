import type { TerminalErrorCode } from './types.js'

// AGENTS §12: a real error type, not a sentinel. A parked broker prompt that is never
// answered (its `timeout` elapsed, or the broker was `destroy`ed while it was still pending)
// REJECTS its Promise with a `TerminalError` carrying a machine-readable `code`, so an
// `await prompt.input(...)` caller branches on `error.code` rather than parsing the message.
// The optional `context` bag names the offending prompt id. The guard narrows with `instanceof`,
// mirroring the agents-module errors.

/**
 * An error a {@link import('./Prompt.js').Prompt} broker rejects a parked prompt's Promise with.
 *
 * @remarks
 * Carries a {@link TerminalErrorCode} and an optional `context` bag (the prompt `id`). Thrown —
 * as a Promise rejection on the awaited prompt call — when a parked prompt is not answered before
 * its `timeout`, or when the broker is `destroy`ed while the prompt is still `pending` (both
 * `EXPIRE`); or when the user aborts an interactive server-`Terminal` prompt with ctrl-c
 * (`CANCEL`). Narrow a caught value with {@link isTerminalError} and branch on `error.code`.
 */
export class TerminalError extends Error {
	/** The machine-readable condition — see {@link TerminalErrorCode}. */
	readonly code: TerminalErrorCode
	/** An optional context bag naming the offending prompt id. */
	readonly context?: Readonly<Record<string, unknown>>

	constructor(
		code: TerminalErrorCode,
		message: string,
		context?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		this.name = 'TerminalError'
		this.code = code
		this.context = context
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
 * 	const name = await prompt.input({ message: 'Your name' })
 * } catch (error) {
 * 	if (isTerminalError(error) && error.code === 'EXPIRE') retryLater()
 * }
 * ```
 */
export function isTerminalError(value: unknown): value is TerminalError {
	return value instanceof TerminalError
}
