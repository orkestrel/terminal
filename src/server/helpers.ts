// Pure helpers for the server terminal driver — every function here is exported and unit-tested.
// The families here are all total: the stream-boundary guards that narrow `process.stdin` / any
// injected stream without an assertion; the cursor math the driver uses to redraw a field view IN
// PLACE (count a view's lines, build the cursor-up sequence, assemble the reposition-and-clear
// prefix); and the projections and line renderers the whole-form walk needs that no reducer owns —
// a control read as text, a value shown read-only, the choices a field actually offers, and the
// group, locked, suggestion, unavailable, and numbered-list lines. The impure driver only feeds
// bytes into the reducers and writes the strings these helpers build. The output boundary is
// narrowed by the console module's own `isStreamTarget`, which this module does not redeclare.

import type { FieldChoice, FieldValue, FormField, TextField } from '@orkestrel/form'
import type { PromptTheme } from '@src/core'
import type { StylerInterface } from '@orkestrel/console'
import type { InputStreamInterface } from './types.js'
import { RETURN } from '@src/core'
import {
	CLEAR_DOWN,
	CONTROL_HINTS,
	CSI_UP,
	LOCKED_MARK,
	SUGGESTION_LEAD,
	UNAVAILABLE_LEAD,
} from './constants.js'

/**
 * Checks whether `value` is a usable {@link InputStreamInterface} — a record with callable `on` / `off`
 * `'data'` subscription methods. A total type guard: it NEVER throws and returns `false`
 * for anything off-shape, so it narrows the one unavoidable input boundary (the real `process.stdin`,
 * or a fake TTY a test injects) to the exact slice the driver reads — no `as`.
 *
 * @remarks
 * Only `on` / `off` are required (the irreducible event seam); `setRawMode` / `resume` / `pause` /
 * `isTTY` are optional on {@link InputStreamInterface}, so their absence does not disqualify a stream
 * — a piped, non-TTY stream is still a valid input, just one the driver reads through the readline
 * fallback rather than raw mode.
 *
 * @param value - Any value crossing the boundary (a process stream, an injected fake, `unknown`)
 * @returns True if `value` has callable `on` and `off`; false otherwise
 */
export function isInputStream(value: unknown): value is InputStreamInterface {
	return (
		typeof value === 'object' &&
		value !== null &&
		'on' in value &&
		typeof value.on === 'function' &&
		'off' in value &&
		typeof value.off === 'function'
	)
}

/**
 * Checks whether `value` is a Node {@link NodeJS.ReadableStream} — a total structural guard
 * checking for the callable `read` / `pipe` / `on` that `node:readline`'s `createInterface` requires
 * as its `input`. The non-TTY fallback narrows the resolved input stream through this before handing
 * it to readline (never an `as`), so a real piped `process.stdin` (or a `PassThrough` a test injects)
 * crosses into the readline boundary honestly. Never throws; returns `false` for a minimal fake that
 * isn't a full readable.
 *
 * @param value - The resolved input stream (or any value crossing the boundary)
 * @returns True if `value` has the readable methods readline needs; false otherwise
 */
export function isReadable(value: unknown): value is NodeJS.ReadableStream {
	return (
		typeof value === 'object' &&
		value !== null &&
		'read' in value &&
		typeof value.read === 'function' &&
		'pipe' in value &&
		typeof value.pipe === 'function'
	)
}

/**
 * Checks whether an input stream can be driven in RAW mode — it both reports `isTTY === true` AND
 * exposes a callable `setRawMode`. The {@link import('./Terminal.js').Terminal} probes this to choose its path:
 * `true` ⇒ the interactive raw-mode prompts (arrow-key navigation, live re-render); `false` ⇒ the
 * `node:readline` line-input fallback (a piped / non-terminal stream cannot enter raw mode). Total —
 * never throws.
 *
 * @param input - The resolved {@link InputStreamInterface}
 * @returns True if the stream is a TTY with `setRawMode`; false otherwise
 */
export function supportsRawMode(input: InputStreamInterface): boolean {
	return input.isTTY === true && typeof input.setRawMode === 'function'
}

/**
 * Counts the terminal LINES a rendered prompt `view` occupies — one more than its newline count
 * (a view with no newline is a single line; N newlines span N+1 lines). The basis of the in-place
 * re-render: the driver records the line count of the view it just wrote so the next redraw knows how
 * far up to move the cursor before overwriting. Total; an empty string is one (empty) line.
 *
 * @param view - The rendered (possibly multi-line, possibly ANSI-styled) view string
 * @returns The number of lines the view spans (always at least 1)
 */
export function lineCount(view: string): number {
	let lines = 1
	for (const character of view) {
		if (character === '\n') lines += 1
	}
	return lines
}

/**
 * Returns the cursor-UP control sequence that moves the cursor up `count` lines (`ESC[{count}A`) — or the
 * empty string when `count` is zero or negative (no movement needed, and `ESC[0A` is a wasted write).
 * The pure step the in-place re-render uses to climb back over the previous view before clearing it.
 * Total.
 *
 * @param count - How many lines to move the cursor up
 * @returns The `ESC[{count}A` sequence, or `''` when `count <= 0`
 */
export function renderCursorUp(count: number): string {
	if (count <= 0) return ''
	return `${CSI_UP.replace('{count}', String(count))}`
}

/**
 * Returns the full reposition-and-clear prefix to write BEFORE re-rendering a prompt view in place — given
 * the line count of the PREVIOUS view, it moves the cursor up over those lines, returns it to column
 * 0, and erases everything from there to the end of the screen, so the next view is drawn on a clean
 * region (no orphaned rows from a taller previous view). Pure; the driver writes this immediately
 * followed by the new view.
 *
 * @remarks
 * For the FIRST render `previousLines` is `1` (the cursor sits on the line the prompt opened on) so
 * the prefix is just a carriage return + clear-down — the prompt draws from the current line. For a
 * subsequent render it climbs `previousLines - 1` lines (the cursor is on the LAST line of the prior
 * view) before clearing. Keeping the math here (not in the driver) makes the re-render unit-testable
 * without a real terminal.
 *
 * @param previousLines - The line count of the view currently on screen (from {@link lineCount})
 * @returns The control-sequence prefix to write before the new view
 */
export function redrawPrefix(previousLines: number): string {
	return `${renderCursorUp(previousLines - 1)}${RETURN}${CLEAR_DOWN}`
}

/**
 * Projects any field the walk reads as a LINE OF TEXT into the {@link TextField} the text reducer
 * takes — `text` itself, and the controls a terminal has no widget for: `number`, `date`,
 * `time`, `datetime`, `color`, and one `file` entry. The label carries that control's format cue
 * from {@link CONTROL_HINTS}, and a declared `default` becomes the line a bare return submits. The
 * projection carries no rule, because the AUTHORITATIVE form still evaluates the answer this line
 * binds; it exists only so one reducer covers every one of them.
 *
 * @param field - The field being read
 * @returns The text field the reducer renders for it
 *
 * @example
 * ```ts
 * fieldToText({ control: 'date', name: 'born', label: 'Birthday' })
 * // { control: 'text', name: 'born', label: 'Birthday (YYYY-MM-DD)' }
 * ```
 */
export function fieldToText(field: FormField): TextField {
	const label = field.label ?? field.name
	const hint = CONTROL_HINTS[field.control]
	const seed = 'default' in field ? field.default : undefined
	const text = typeof seed === 'number' ? String(seed) : seed
	return {
		control: 'text',
		name: field.name,
		label: hint === undefined ? label : `${label} ${hint}`,
		...(typeof text === 'string' ? { default: text } : {}),
	}
}

/**
 * Projects one held answer into the text a read-only line shows — a scalar as itself, a boolean as
 * `yes` / `no` (the word the confirm reducer commits), and a list joined by commas. Absence renders
 * as nothing, because a locked field nobody has answered has nothing to show.
 *
 * @param value - The answer the form holds for a field, or absence
 * @returns The text to render for it
 */
export function valueToText(value: FieldValue | undefined): string {
	if (value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'yes' : 'no'
	return value.join(', ')
}

/**
 * Returns the choices a `select` or `checkbox` field actually OFFERS — the form refuses a disabled
 * choice's value at every door, including a fill, so the walk never puts one in front of the
 * cursor. Pair with {@link filterDisabled} to tell the reader what was withheld.
 *
 * @param choices - The field's declared choices
 * @returns The choices the walk offers, in declared order
 */
export function filterEnabled(choices: readonly FieldChoice[]): readonly FieldChoice[] {
	return choices.filter((choice) => choice.disabled !== true)
}

/**
 * Returns the choices a `select` or `checkbox` field SHOWS but refuses — the complement of
 * {@link filterEnabled}, rendered by {@link renderUnavailableLine} above the list so a reader sees
 * why a declared choice is missing from it.
 *
 * @param choices - The field's declared choices
 * @returns The refused choices, in declared order
 */
export function filterDisabled(choices: readonly FieldChoice[]): readonly FieldChoice[] {
	return choices.filter((choice) => choice.disabled === true)
}

/**
 * Renders the section header the walk writes when it enters a new field group, painted by the
 * `message` role.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param label - The group's declared label, falling back to its own name
 * @returns The rendered section header
 */
export function renderGroupHeader(
	styler: StylerInterface,
	theme: PromptTheme,
	label: string,
): string {
	return styler.render(theme.roles.message, label)
}

/**
 * Renders the read-only line a LOCKED field shows — its label, the {@link LOCKED_MARK}, and the
 * answer the form already holds. The walk writes this instead of a prompt, because the field is still
 * validated and still submitted but must not be edited here.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param label - The field's label
 * @param value - The held answer, from {@link valueToText}
 * @returns The rendered line, with no trailing space when there is nothing to show
 */
export function renderLockedLine(
	styler: StylerInterface,
	theme: PromptTheme,
	label: string,
	value: string,
): string {
	const head = `${styler.render(theme.roles.muted, theme.icons.dot)} ${styler.render(theme.roles.message, label)} ${styler.render(theme.roles.hint, LOCKED_MARK)}`
	return value.length === 0 ? head : `${head} ${styler.render(theme.roles.content, value)}`
}

/**
 * Renders the line listing an OPEN select's offered values above its text prompt — a suggestion
 * list, because an open select admits an answer the list does not offer.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param choices - The choices the open select offers, from {@link filterEnabled}
 * @returns The rendered suggestion line
 */
export function renderSuggestionLine(
	styler: StylerInterface,
	theme: PromptTheme,
	choices: readonly FieldChoice[],
): string {
	const values = choices.map((choice) => choice.value).join(', ')
	return styler.render(theme.roles.hint, `${SUGGESTION_LEAD}: ${values}`)
}

/**
 * Renders the line naming the choices a field shows but refuses, written above the list the walk
 * drives.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param choices - The refused choices, from {@link filterDisabled}
 * @returns The rendered unavailable line
 */
export function renderUnavailableLine(
	styler: StylerInterface,
	theme: PromptTheme,
	choices: readonly FieldChoice[],
): string {
	const labels = choices.map((choice) => choice.label).join(', ')
	return styler.render(theme.roles.muted, `${UNAVAILABLE_LEAD}: ${labels}`)
}

/**
 * Renders the numbered choice list the non-TTY fallback prints — a piped stream cannot navigate
 * with arrow keys, so each offered choice is printed with the number the reader types back. One
 * line per choice, with no trailing newline.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param choices - The choices the walk offers, from {@link filterEnabled}
 * @returns The rendered list
 */
export function renderNumberedList(
	styler: StylerInterface,
	theme: PromptTheme,
	choices: readonly FieldChoice[],
): string {
	return choices
		.map(
			(choice, index) =>
				`  ${styler.render(theme.roles.muted, `${String(index + 1)})`)} ${styler.render(theme.roles.content, choice.label)}`,
		)
		.join('\n')
}
