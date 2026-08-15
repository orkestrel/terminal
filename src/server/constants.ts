// Server-terminals constants — the cursor and line-clear ANSI sequences the interactive `Terminal`
// driver writes to redraw a field view IN PLACE, plus the copy the walk shows around those views:
// the per-control format hints, the readline-fallback prompts, and the marks for a locked field and
// an unavailable choice. UPPER_SNAKE, every member exported. Sequences are built from a named ESC
// byte through `String.fromCharCode` so no raw control character appears in source (the core
// terminals / console-module idiom).

import type { FieldControl } from '@orkestrel/form'

/** The Escape byte (ESC, U+001B) — the lead byte of every CSI cursor-control sequence below. */
export const ESCAPE = String.fromCharCode(27)

/** The Control Sequence Introducer (`ESC[`) — the prefix of every cursor / erase sequence. */
export const CSI = `${ESCAPE}[`

/**
 * The cursor-UP sequence TEMPLATE (`ESC[{count}A`) — {@link import('./helpers.js').moveUp}
 * interpolates `{count}` with the number of lines to climb (the `{count}` placeholder idiom the core
 * terminals' `RULE_MESSAGES` uses). Kept as a template so the count stays out of the constant.
 */
export const CSI_UP = `${CSI}{count}A`

/**
 * Hide the cursor (`ESC[?25l`) — written before the driver starts redrawing a prompt so the cursor
 * does not flicker across the view during an in-place re-render; paired with {@link CURSOR_SHOW}.
 */
export const CURSOR_HIDE = `${CSI}?25l`

/** Show the cursor (`ESC[?25h`) — restores the cursor after a prompt resolves / cancels (the {@link CURSOR_HIDE} pair). */
export const CURSOR_SHOW = `${CSI}?25h`

/**
 * Erase from the cursor down to the end of the screen (`ESC[J`) — wipes the WHOLE previous (possibly
 * multi-line `select` / `checkbox`) view in one write before the new view is rendered, so a redraw
 * never leaves orphaned rows below.
 */
export const CLEAR_DOWN = `${CSI}J`

/** A carriage return (`\r`, U+000D) — returns the cursor to column 0 so a redraw starts at the line's left edge. */
export const CARRIAGE_RETURN = String.fromCharCode(13)

/** A line feed (`\n`, U+000A) — the line terminator the driver writes after the final committed prompt view. */
export const LINE_FEED = String.fromCharCode(10)

/**
 * The numbered-list prompt the non-TTY {@link import('./Terminal.js').Terminal} `select` fallback
 * appends — a piped (non-terminal) stream cannot navigate with arrow keys, so the choices are
 * printed numbered and the user types one number on a single readline line.
 */
export const FALLBACK_SELECT_HINT = 'Enter a number'

/** The comma-separated multi-select hint the non-TTY `checkbox` fallback shows (the user types one or more numbers). */
export const FALLBACK_CHECKBOX_HINT = 'Enter numbers separated by commas'

/** The hint the non-TTY `editor` fallback shows — a piped stream has no ctrl-d, so end of input finishes the block. */
export const FALLBACK_EDITOR_HINT = '(end of input finishes)'

/** The hint the non-TTY `confirm` fallback shows — a piped stream sends a whole line, so the answer is typed rather than pressed. */
export const FALLBACK_CONFIRM_HINT = '(y/n)'

/**
 * The format cue appended to a field's label for each control the walk reads as a line of text —
 * the terminal has no date picker, no color well, and no file chooser, so the accepted shape is
 * stated instead. A control with no entry needs none: `text` and `editor` accept any line,
 * `password` masks one, and `confirm`, `select`, and `checkbox` are answered by key rather than by
 * format. The form's own rules still decide whether the typed value is acceptable.
 */
export const CONTROL_HINTS: Readonly<Partial<Record<FieldControl, string>>> = Object.freeze({
	number: '(number)',
	date: '(YYYY-MM-DD)',
	time: '(HH:MM)',
	datetime: '(YYYY-MM-DDTHH:MM)',
	color: '(#rrggbb)',
	file: '(path)',
})

/** The instruction a `file` field with `multiple` shows before its entries — one path per line, and a blank line ends the list. */
export const FILE_HINT = 'One path per line, blank to finish'

/** The lead on the line listing an open `select`'s offered values, which a typed answer may ignore. */
export const SUGGESTION_LEAD = 'Suggestions'

/** The lead on the line listing the choices a `select` or `checkbox` shows but refuses, so a reader sees why one is missing from the list below. */
export const UNAVAILABLE_LEAD = 'Unavailable'

/** The mark on a locked field's line — the walk renders its value and moves on, because the form refuses an edit there. */
export const LOCKED_MARK = '(locked)'

/**
 * What a field is told when the walk read an answer the control cannot hold — a word typed into a
 * `number`, an off-list value typed into an open `select` whose choice is refused. The value binds
 * as absence and this message is invalidated onto the field, so the walk re-asks it with the reason
 * on screen.
 */
export const REFUSAL_MESSAGE = 'Enter a value this field accepts'
