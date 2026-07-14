// Server-terminals constants (the T-c branch) — the cursor / line-clear ANSI control sequences the
// interactive `Terminal` driver writes to redraw a prompt view IN PLACE, plus the readline-fallback
// defaults. UPPER_SNAKE, every member exported (AGENTS §5). Sequences are built from a named ESC
// byte via `String.fromCharCode` so no raw control character appears in source (the core
// terminals / console-module idiom).

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
 * Erase from the cursor to the end of the current line (`ESC[K`) — clears stale glyphs when a redrawn
 * line is shorter than the line it replaces, so no trailing characters from the previous view remain.
 */
export const CLEAR_LINE = `${CSI}K`

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
 * The numbered-list prompt the non-TTY {@link import('./Terminal.js').Terminal} `select` / `checkbox`
 * fallback appends — a piped (non-terminal) stream cannot navigate with arrow keys, so the choices are
 * printed numbered and the user types the number(s) on a single readline line.
 */
export const FALLBACK_SELECT_HINT = 'Enter a number'

/** The comma-separated multi-select hint the non-TTY `checkbox` fallback shows (the user types one or more numbers). */
export const FALLBACK_CHECKBOX_HINT = 'Enter numbers separated by commas'
