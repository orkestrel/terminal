import type {
	PendingPrompt,
	PendingPromptStatus,
	PromptThemeOptions,
	PromptToken,
	PromptType,
	TerminalSnapshot,
} from './types.js'
import type { Guard } from '@orkestrel/contract'
import {
	arrayOf,
	isNonEmptyString,
	isNumber,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'
import { ATTRIBUTES, COLORS } from '@orkestrel/console'

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

/**
 * Narrow an unknown value to a {@link PromptToken} — a styler accessor name, built from the
 * console module's own {@link import('@orkestrel/console').COLORS} +
 * {@link import('@orkestrel/console').ATTRIBUTES} so the token axis has ONE source.
 */
export const isPromptToken: Guard<PromptToken> = literalOf(...COLORS, ...ATTRIBUTES)

/**
 * Narrow an unknown wire value to a {@link PromptThemeOptions} — the §14 guard a remote prompt's
 * `theme` option passes before it reaches a local prompt.
 *
 * @remarks
 * The shape is CLOSED at both levels: an unknown icon slot, an unknown role, a non-string glyph,
 * or a token outside the styler's accessor set rejects the whole theme, so a hostile payload
 * degrades to the default theme rather than partially applying. Glyphs still carry arbitrary text
 * at this point — {@link import('./helpers.js').sanitizeThemeIcons} strips their control bytes on
 * dispatch.
 */
export const isPromptThemeOptions: Guard<PromptThemeOptions> = recordOf(
	{
		icons: recordOf(
			{
				question: isString,
				pointer: isString,
				dot: isString,
				selected: isString,
				checked: isString,
				unchecked: isString,
				success: isString,
				error: isString,
			},
			true,
		),
		roles: recordOf(
			{
				question: arrayOf(isPromptToken),
				pointer: arrayOf(isPromptToken),
				message: arrayOf(isPromptToken),
				success: arrayOf(isPromptToken),
				error: arrayOf(isPromptToken),
				selected: arrayOf(isPromptToken),
				focus: arrayOf(isPromptToken),
				hint: arrayOf(isPromptToken),
				description: arrayOf(isPromptToken),
			},
			true,
		),
	},
	true,
)

/** Narrow an unknown value to a {@link TerminalSnapshot}. */
export const isTerminalSnapshot: Guard<TerminalSnapshot> = recordOf(
	{ id: isNonEmptyString, timeout: isNumber },
	['timeout'],
)
