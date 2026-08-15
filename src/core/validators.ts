import type {
	PendingPrompt,
	PendingPromptStatus,
	PromptIcon,
	PromptRole,
	PromptThemeOptions,
	PromptType,
	TerminalSnapshot,
} from './types.js'
import type { Guard } from '@orkestrel/contract'
import type { Style } from '@orkestrel/console'
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
 * Narrow an unknown value to a console {@link Style} — the value every
 * {@link import('./types.js').PromptRole} carries, built from the console module's own
 * {@link import('@orkestrel/console').COLORS} + {@link import('@orkestrel/console').ATTRIBUTES} so
 * the style vocabulary has ONE source.
 *
 * @remarks
 * The record is CLOSED and matches the `Style` contract exactly: `foreground` and `background` are
 * optional and each must name a color (`default` included, as the console `Color` union has it),
 * `attributes` is REQUIRED and must be an array over the attribute set, and any other key rejects
 * the whole value.
 */
export const isStyle: Guard<Style> = recordOf(
	{
		foreground: literalOf(...COLORS, 'default'),
		background: literalOf(...COLORS, 'default'),
		attributes: arrayOf(literalOf(...ATTRIBUTES)),
	},
	['foreground', 'background'],
)

/**
 * Narrow an unknown wire value to a {@link PromptThemeOptions} — the §14 guard a remote prompt's
 * `theme` option passes before it reaches a local prompt.
 *
 * @remarks
 * The shape is CLOSED at every level: an unknown icon slot, an unknown role, a non-string glyph, or
 * a role whose value is not a {@link isStyle}-shaped console style rejects the whole theme, so a
 * hostile payload degrades to the default theme rather than partially applying. Glyphs still carry
 * arbitrary text at this point — {@link import('./helpers.js').sanitizeThemeIcons} strips their
 * control bytes on dispatch.
 *
 * The icons and roles shapes are checked against their complete union-keyed guard records. A slot
 * added to either union without an entry here is a compile error rather than a wire theme that is
 * silently refused.
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
			} satisfies Record<PromptIcon, Guard<string>>,
			true,
		),
		roles: recordOf(
			{
				question: isStyle,
				pointer: isStyle,
				message: isStyle,
				content: isStyle,
				success: isStyle,
				error: isStyle,
				selected: isStyle,
				focus: isStyle,
				hint: isStyle,
				description: isStyle,
				muted: isStyle,
			} satisfies Record<PromptRole, Guard<Style>>,
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
