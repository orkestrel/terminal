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

/**
 * Narrows an unknown value to a {@link PendingFormStatus}.
 *
 * @param value - The candidate ticket status
 * @returns True if the value is one of the declared ticket statuses; false otherwise
 */
export const isPendingFormStatus: Guard<PendingFormStatus> = literalOf(
	'pending',
	'answered',
	'expired',
)

/**
 * Narrows an unknown wire value to a {@link PendingForm} envelope.
 *
 * @remarks
 * This guard checks the transport record and proves only that `schema` is a record. The Form
 * package's `parseForm` owns the schema payload and its semantic audit.
 *
 * @param value - The decoded wire value to inspect
 * @returns True if the value is a complete pending-form envelope; false otherwise
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
 * Narrows an unknown value to a transport-neutral {@link WireEvent}.
 *
 * @param value - The candidate wire event
 * @returns True if the value carries an event name, serialized data, and an optional id; false otherwise
 */
export const isWireEvent: Guard<WireEvent> = recordOf(
	{ event: isString, data: isString, id: isString },
	['id'],
)

/**
 * Narrows an unknown value to a {@link TerminalSnapshot} — the read boundary a store applies to an
 * untrusted persisted row.
 *
 * @param value - The candidate snapshot read back from storage
 * @returns True if the value carries a non-empty `id` and an optional numeric `timeout`; false otherwise
 */
export const isTerminalSnapshot: Guard<TerminalSnapshot> = recordOf(
	{ id: isNonEmptyString, timeout: isNumber },
	['timeout'],
)
