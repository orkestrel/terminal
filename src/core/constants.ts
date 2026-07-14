// The constant DATA the pure prompt core reads — the control-byte → key-name decode table
// {@link parseKey} consults, the default mask, the validation regex patterns the rule engine
// tests against, the prompt-view icon glyphs, and the default rule error messages. UPPER_SNAKE,
// `Object.freeze`d, every member exported (AGENTS §5). Control bytes are built with
// `String.fromCharCode` so no raw control character appears in source (the console-module idiom).

// === Control bytes (named, no raw control characters in source)

/** Carriage return (`\r`, U+000D) — Enter on most terminals. */
export const RETURN = String.fromCharCode(13)
/** Line feed (`\n`, U+000A) — Enter on some terminals / pasted input. */
export const NEWLINE = String.fromCharCode(10)
/** Tab (`\t`, U+0009). */
export const TAB = String.fromCharCode(9)
/** Escape (ESC, U+001B) — the lone byte, and the lead byte of every CSI / SS3 sequence. */
export const ESCAPE = String.fromCharCode(27)
/** Backspace (BS, U+0008) — Ctrl+H / some terminals' Backspace. */
export const BACKSPACE = String.fromCharCode(8)
/** Delete (DEL, U+007F) — the usual Backspace byte on a Unix TTY. */
export const DELETE = String.fromCharCode(127)
/** Space (U+0020). */
export const SPACE = ' '
/** Ctrl+C (ETX, U+0003) — interrupt / cancel. */
export const CTRL_C = String.fromCharCode(3)
/** Ctrl+D (EOT, U+0004) — end-of-transmission / finish (the editor's commit key). */
export const CTRL_D = String.fromCharCode(4)
/** Ctrl+U (NAK, U+0015) — clear the current line. */
export const CTRL_U = String.fromCharCode(21)
/** Ctrl+A (SOH, U+0001) — move to start of line. */
export const CTRL_A = String.fromCharCode(1)
/** Ctrl+E (ENQ, U+0005) — move to end of line. */
export const CTRL_E = String.fromCharCode(5)

/**
 * The Control Sequence Introducer lead (`ESC[`) for the navigation keys — the prefix of the
 * arrow / home / end / delete sequences {@link SEQUENCE_NAMES} is keyed by. Named `KEY_CSI`
 * (not `CSI`) so it never collides with the console module's SGR `CSI` (both barrel through
 * `@src/core`).
 */
export const KEY_CSI = `${ESCAPE}[`
/** The Single Shift Three lead (`ESCO`) — the alternate arrow-key prefix some terminals emit (`ESC O A`). */
export const KEY_SS3 = `${ESCAPE}O`

/**
 * The exact escape SEQUENCE → canonical key NAME table {@link import('./helpers.js').parseKey}
 * consults for the navigation / editing keys. Covers BOTH the CSI form (`ESC[A`…) and the SS3
 * form (`ESCOA`…) of the four arrows, plus the `home` / `end` / `delete` CSI sequences (with
 * their numeric-tilde variants). The source of truth for the multi-byte key decode; frozen.
 *
 * @remarks
 * Terminals disagree on these: a cursor key is `ESC[A` (normal) or `ESCOA` (application mode),
 * and Home / End / Delete each have a letter form (`ESC[H` / `ESC[F`) and a numeric form
 * (`ESC[1~` / `ESC[4~` / `ESC[3~`). Every accepted spelling maps to one name so a reducer never
 * sees the wire encoding.
 */
export const SEQUENCE_NAMES: Readonly<Record<string, string>> = Object.freeze({
	[`${KEY_CSI}A`]: 'up',
	[`${KEY_CSI}B`]: 'down',
	[`${KEY_CSI}C`]: 'right',
	[`${KEY_CSI}D`]: 'left',
	[`${KEY_SS3}A`]: 'up',
	[`${KEY_SS3}B`]: 'down',
	[`${KEY_SS3}C`]: 'right',
	[`${KEY_SS3}D`]: 'left',
	[`${KEY_CSI}H`]: 'home',
	[`${KEY_CSI}F`]: 'end',
	[`${KEY_CSI}1~`]: 'home',
	[`${KEY_CSI}4~`]: 'end',
	[`${KEY_CSI}3~`]: 'delete',
	[`${KEY_CSI}7~`]: 'home',
	[`${KEY_CSI}8~`]: 'end',
})

/**
 * The single control BYTE → key descriptor table {@link import('./helpers.js').parseKey}
 * consults for the one-byte keys. Each entry carries the canonical `name` and whether it is a
 * `ctrl` combination. The source of truth for the single-byte key decode; frozen.
 *
 * @remarks
 * `return` / `newline` map to `return` (one canonical Enter name); `delete` / `backspace` both
 * map to `backspace` (the two Backspace bytes); the Ctrl combos (`c` / `d` / `u` / `a` / `e`)
 * carry `ctrl: true` so a reducer can match `key.ctrl && key.name === 'c'`. `escape` / `tab` /
 * `space` are plain named keys.
 */
export const CONTROL_NAMES: Readonly<
	Record<string, { readonly name: string; readonly ctrl: boolean }>
> = Object.freeze({
	[RETURN]: Object.freeze({ name: 'return', ctrl: false }),
	[NEWLINE]: Object.freeze({ name: 'return', ctrl: false }),
	[TAB]: Object.freeze({ name: 'tab', ctrl: false }),
	[ESCAPE]: Object.freeze({ name: 'escape', ctrl: false }),
	[BACKSPACE]: Object.freeze({ name: 'backspace', ctrl: false }),
	[DELETE]: Object.freeze({ name: 'backspace', ctrl: false }),
	[SPACE]: Object.freeze({ name: 'space', ctrl: false }),
	[CTRL_C]: Object.freeze({ name: 'c', ctrl: true }),
	[CTRL_D]: Object.freeze({ name: 'd', ctrl: true }),
	[CTRL_U]: Object.freeze({ name: 'u', ctrl: true }),
	[CTRL_A]: Object.freeze({ name: 'a', ctrl: true }),
	[CTRL_E]: Object.freeze({ name: 'e', ctrl: true }),
})

// === Prompt defaults

/** The default mask glyph a {@link import('./types.js').PasswordState} renders each input character as — `*`. */
export const DEFAULT_MASK = '*'

// === Validation patterns

/** Matches an email address — a non-trivial `local@domain.tld` shape. The `email` rule tests against this. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Matches an HTTP(S) URL. The `url` rule tests against this. */
export const URL_PATTERN = /^https?:\/\/.+/

/** Matches a numeric value (integer or decimal, optional sign). The `numeric` rule tests against this. */
export const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/

/** Matches an integer (optional sign). The `integer` rule tests against this. */
export const INTEGER_PATTERN = /^-?\d+$/

/** Matches an alphanumeric string (letters and digits only). The `alphanumeric` rule tests against this. */
export const ALPHANUMERIC_PATTERN = /^[a-zA-Z0-9]+$/

// === Default rule error messages

/**
 * Each built-in validation rule's default error message — what the composed {@link
 * import('./types.js').Validator} returns when that rule fails (the `minimum` / `maximum`
 * messages are interpolated with the configured length at build time). Frozen; the source of
 * truth for the rule-failure copy.
 */
export const RULE_MESSAGES = Object.freeze({
	required: 'This field is required',
	minimum: 'Must be at least {count} characters',
	maximum: 'Must be at most {count} characters',
	pattern: 'Must match pattern: {pattern}',
	email: 'Must be a valid email address',
	url: 'Must be a valid URL',
	numeric: 'Must be a numeric value',
	integer: 'Must be an integer',
	alphanumeric: 'Must contain only letters and digits',
	invalid: 'Invalid input',
})

// === Prompt-view icons (glyphs only — the styler colors them at render time)

/**
 * The prompt-view icon glyphs the reducers render the prompt line and choice rows with. PLAIN
 * glyphs — color is applied by the {@link import('./types.js').PromptState}'s
 * {@link import('../console/index.js').StylerInterface} at render time, never baked into the
 * constant (AGENTS — styling orthogonal to data; the rework fixes scsr's ANSI-in-the-icon).
 * Frozen.
 *
 * @remarks
 * - `question` — the leading mark on a prompt's message line.
 * - `pointer` — the cursor before the input / the focused choice row.
 * - `dot` / `selected` — an unfocused / focused row marker in a select list.
 * - `checked` / `unchecked` — a checked / unchecked box in a checkbox list.
 */
export const PROMPT_ICONS = Object.freeze({
	question: '?',
	pointer: '›',
	dot: '○',
	selected: '●',
	checked: '☑',
	unchecked: '☐',
})

// === Broker + SSE-bridge defaults (T-b)

/** How long (ms) the {@link import('./types.js').PromptInterface} broker parks an unanswered prompt before it expires — 5 minutes. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 300_000

/** How long (ms) the {@link import('./types.js').PromptClientInterface} waits before each reconnect attempt — 2 seconds. */
export const DEFAULT_RECONNECT_DELAY_MS = 2_000

/**
 * The SSE `event:` names the broker emits and the {@link import('./types.js').PromptClient}
 * dispatches on. Frozen; the source of truth for the wire event vocabulary.
 *
 * @remarks
 * - `pending` — a serialized {@link import('./types.js').PendingPrompt} to dispatch + answer.
 * - `expire` — an `{ id }` payload: the broker expired a parked prompt (the client drops it).
 * - `shutdown` — the broker is going away; the client tears itself down.
 */
export const SSE_EVENTS = Object.freeze({
	pending: 'pending',
	expire: 'expire',
	shutdown: 'shutdown',
})

/** The auth-token request header the {@link import('./types.js').PromptClient} sends when a `token` is configured. */
export const HEADER_TOKEN = 'x-taverna-token'

/** The `Accept` header value that opens the broker's SSE stream. */
export const ACCEPT_EVENT_STREAM = 'text/event-stream'
