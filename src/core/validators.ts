import type { PendingPrompt, PendingPromptStatus, PromptType, TerminalSnapshot } from './types.js'
import type { Guard } from '@orkestrel/contract'
import {
	isNonEmptyString,
	isNumber,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'

/** Narrow an unknown value to a {@link PromptType} — one of the six prompt forms. */
export const isPromptType: Guard<PromptType> = literalOf(
	'input',
	'password',
	'confirm',
	'select',
	'checkbox',
	'editor',
)

/** Narrow an unknown value to a {@link PendingPromptStatus}. */
export const isPendingPromptStatus: Guard<PendingPromptStatus> = literalOf(
	'pending',
	'answered',
	'expired',
)

/**
 * Narrow an unknown wire value to a {@link PendingPrompt} before dispatching it.
 *
 * @param value - The decoded wire value to inspect
 * @returns Whether `value` is a complete pending-prompt record
 */
export const isPendingPrompt: Guard<PendingPrompt> = recordOf(
	{
		id: isNonEmptyString,
		form: isPromptType,
		message: isString,
		options: isRecord,
		status: isPendingPromptStatus,
		time: isNumber,
		from: isString,
		to: isString,
	},
	['from', 'to'],
)

/** Narrow an unknown value to a {@link TerminalSnapshot}. */
export const isTerminalSnapshot: Guard<TerminalSnapshot> = recordOf(
	{ id: isNonEmptyString, timeout: isNumber },
	['timeout'],
)
