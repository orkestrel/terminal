// Server-terminals constants — the cursor and line-clear ANSI sequences the interactive `Terminal`
// driver writes to redraw a field view IN PLACE, plus the copy the walk shows around those views:
// the per-control format hints, the readline-fallback prompts, and the marks for a locked field and
// an unavailable choice. UPPER_SNAKE, every member exported. Every sequence is built from the
// console module's own `CSI` prefix, so no raw control character appears in source and this module
// declares no second copy of that primitive.

import type { FieldControl } from '@orkestrel/form'
import { CSI } from '@orkestrel/console'

/**
 * Holds the cursor-UP sequence TEMPLATE (`ESC[{count}A`) — {@link import('./helpers.js').renderCursorUp}
 * interpolates the `{count}` placeholder with the number of lines to climb. Kept as a template so
 * the count stays out of the constant.
 */
export const CSI_UP = `${CSI}{count}A`

/**
 * Hides the cursor (`ESC[?25l`) — written before the driver starts redrawing a prompt so the cursor
 * does not flicker across the view during an in-place re-render; paired with {@link CURSOR_SHOW}.
 */
export const CURSOR_HIDE = `${CSI}?25l`

/** Shows the cursor (`ESC[?25h`) — restores the cursor after a prompt resolves / cancels (the {@link CURSOR_HIDE} pair). */
export const CURSOR_SHOW = `${CSI}?25h`

/**
 * Erases from the cursor down to the end of the screen (`ESC[J`) — wipes the WHOLE previous (possibly
 * multi-line `select` / `checkbox`) view in one write before the new view is rendered, so a redraw
 * never leaves orphaned rows below.
 */
export const CLEAR_DOWN = `${CSI}J`

/**
 * Holds the numbered-list prompt the non-TTY {@link import('./Terminal.js').Terminal} `select` fallback
 * appends — a piped (non-terminal) stream cannot navigate with arrow keys, so the choices are
 * printed numbered and the user types one number on a single readline line.
 */
export const FALLBACK_SELECT_HINT = 'Enter a number'

/** Holds the comma-separated multi-select hint the non-TTY `checkbox` fallback shows (the user types one or more numbers). */
export const FALLBACK_CHECKBOX_HINT = 'Enter numbers separated by commas'

/** Holds the hint the non-TTY `editor` fallback shows — a piped stream has no ctrl-d, so end of input finishes the block. */
export const FALLBACK_EDITOR_HINT = '(end of input finishes)'

/** Holds the hint the non-TTY `confirm` fallback shows — a piped stream sends a whole line, so the answer is typed rather than pressed. */
export const FALLBACK_CONFIRM_HINT = '(y/n)'

/**
 * Holds the format cue appended to a field's label for each control the walk reads as a line of text —
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

/** Holds the instruction a `file` field with `multiple` shows before its entries — one path per line, and a blank line ends the list. */
export const FILE_HINT = 'One path per line, blank to finish'

/** Holds the lead on the line listing an open `select`'s offered values, which a typed answer may ignore. */
export const SUGGESTION_LEAD = 'Suggestions'

/** Holds the lead on the line listing the choices a `select` or `checkbox` shows but refuses, so a reader sees why one is missing from the list below. */
export const UNAVAILABLE_LEAD = 'Unavailable'

/** Holds the mark on a locked field's line — the walk renders its value and moves on, because the form refuses an edit there. */
export const LOCKED_MARK = '(locked)'

/**
 * States what a field is told when the walk read an answer the control cannot hold — a word typed into a
 * `number`, an off-list value typed into an open `select` whose choice is refused. The value binds
 * as absence and this message is invalidated onto the field, so the walk re-asks it with the reason
 * on screen.
 */
export const REFUSAL_MESSAGE = 'Enter a value this field accepts'
