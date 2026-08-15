import type { PendingForm, PendingFormStatus, TerminalSnapshot, WireEvent } from './types.js'
import type { Guard } from '@orkestrel/contract'
import {
	isNonEmptyString,
	isNumber,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'

/** Narrow an unknown value to a {@link PendingFormStatus}. */
export const isPendingFormStatus: Guard<PendingFormStatus> = literalOf(
	'pending',
	'answered',
	'expired',
)

/**
 * Narrow an unknown wire value to a {@link PendingForm} envelope.
 *
 * @remarks
 * This guard checks the transport record and proves only that `schema` is a record. The Form
 * package's `parseForm` owns the schema payload and its semantic audit.
 *
 * @param value - The decoded wire value to inspect
 * @returns Whether the value is a complete pending-form envelope
 */
export function isPendingForm(value: unknown): value is PendingForm {
	return recordOf(
		{
			id: isNonEmptyString,
			schema: isRecord,
			status: isPendingFormStatus,
			time: isNumber,
			from: isString,
			to: isString,
		},
		['from', 'to'],
	)(value)
}

/**
 * Narrow an unknown value to a transport-neutral {@link WireEvent}.
 *
 * @param value - The candidate wire event
 * @returns Whether the value carries an event name, serialized data, and an optional id
 */
export const isWireEvent: Guard<WireEvent> = recordOf(
	{ event: isString, data: isString, id: isString },
	['id'],
)

/** Narrow an unknown value to a {@link TerminalSnapshot}. */
export const isTerminalSnapshot: Guard<TerminalSnapshot> = recordOf(
	{ id: isNonEmptyString, timeout: isNumber },
	['timeout'],
)
