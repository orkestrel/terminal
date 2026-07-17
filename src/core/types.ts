import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { StylerInterface } from '@orkestrel/console'

// The PURE, UNIVERSAL prompt core — a key decoder, a declarative validation engine, and
// the six interactive prompts modelled as EVENT-FREE pure state machines. No `node:*`, no
// TTY, no I/O: just types, functions, and immutable state. A keypress is decoded into a
// `KeyEvent` ({@link parseKey}); a prompt is a `(state, key) → PromptStep` reducer that maps
// the event to the next state plus a rendered, styled `view` and a `status`; declarative
// rules compile into one `Validator` ({@link resolveValidation}). The server `Terminal`
// driver (T-c) is the ONLY impure part — it owns raw-mode / readline / stdin, feeds bytes
// through `parseKey` into these reducers, and writes the `view` to a sink. The view is
// rendered through the shared console {@link StylerInterface} (AGENTS — one style engine).

// === Key decoding

/**
 * One decoded keypress — the universal, TTY-agnostic representation of a single key, the
 * output of {@link import('./helpers.js').parseKey}. A reducer reads `name` (and the
 * modifier flags) to decide its transition; the raw `sequence` is preserved so a printable
 * character round-trips and an unknown escape is never lost.
 *
 * @remarks
 * - `name` — the canonical key name: a control / navigation key (`return`, `backspace`,
 *   `tab`, `escape`, `up` / `down` / `left` / `right`, `space`, `home`, `end`, `delete`),
 *   a named ctrl combo (`c` with `ctrl` true for ctrl-c, likewise `d` / `u` / `a` / `e`),
 *   or the printable character itself (`'a'`, `'7'`, `'?'`). An UNRECOGNIZED sequence
 *   yields `name: ''` (empty) — never a throw (the decoder is total).
 * - `sequence` — the exact input bytes as a string (a `Uint8Array` is decoded UTF-8). The
 *   driver writes this verbatim for a printable key; a reducer that needs the literal char
 *   reads it.
 * - `ctrl` / `meta` / `shift` — the modifier flags. `ctrl` is `true` for a C0 control byte
 *   (ctrl-c / ctrl-d / ctrl-u / ctrl-a / ctrl-e and the like); `meta` is `true` for an
 *   ESC-prefixed (Alt) sequence; `shift` is `true` for an uppercase-letter printable.
 */
export interface KeyEvent {
	readonly name: string
	readonly sequence: string
	readonly ctrl: boolean
	readonly meta: boolean
	readonly shift: boolean
}

// === Validation

/**
 * A single input validator — given the current input string, returns `true` when the input
 * is valid, or an error MESSAGE string when it is not. The atomic unit the validation engine
 * composes and the prompts apply on submit.
 *
 * @remarks
 * A `Validator` is total and pure — it never throws and never mutates. The `true | string`
 * shape (not `boolean`) is deliberate: an invalid result CARRIES its message, so a prompt
 * can render the exact reason. {@link import('./helpers.js').composeValidators} runs several
 * in order and returns the FIRST error (short-circuiting), so the most specific rule wins.
 */
export type Validator = (input: string) => true | string

/**
 * Declarative validation rules for a text prompt — each key toggles (or overrides) one
 * built-in check. {@link import('./helpers.js').resolveValidation} compiles a `ValidationRules`
 * (or a bare {@link Validator}) into ONE composed {@link Validator}.
 *
 * @remarks
 * Each rule is EITHER a primitive that turns on the built-in check, OR a {@link Validator}
 * that replaces it with custom logic:
 *
 * - `required` — `true` ⇒ input must be non-empty after trimming.
 * - `minimum` — a number ⇒ input must be at least that many characters.
 * - `maximum` — a number ⇒ input must be at most that many characters.
 * - `pattern` — a string ⇒ input must match that regex source.
 * - `email` — `true` ⇒ input must look like an email address.
 * - `url` — `true` ⇒ input must look like an HTTP(S) URL.
 * - `numeric` — `true` ⇒ input must be a number (integer or decimal).
 * - `integer` — `true` ⇒ input must be an integer.
 * - `alphanumeric` — `true` ⇒ input must contain only letters and digits.
 * - `custom` — an arbitrary {@link Validator} escape hatch.
 *
 * Rules compose in the fixed order above; the FIRST failing rule short-circuits and its
 * message is returned. A `false` / `undefined` rule is skipped.
 */
export interface ValidationRules {
	readonly required?: boolean | Validator
	readonly minimum?: number | Validator
	readonly maximum?: number | Validator
	readonly pattern?: string | Validator
	readonly email?: boolean | Validator
	readonly url?: boolean | Validator
	readonly numeric?: boolean | Validator
	readonly integer?: boolean | Validator
	readonly alphanumeric?: boolean | Validator
	readonly custom?: Validator
}

// === Choices

/** A choice item in a {@link SelectOptions} prompt — its displayed `name`, its resolved `value`, and an optional one-line `description`. */
export interface PromptChoice {
	readonly name: string
	readonly value: string
	readonly description?: string
}

/** A choice item in a {@link CheckboxOptions} prompt — a {@link PromptChoice} plus an optional initial `checked` state. */
export interface CheckboxChoice {
	readonly name: string
	readonly value: string
	readonly description?: string
	readonly checked?: boolean
}

// === Prompt step (the reducer output)

/**
 * The discriminant of a {@link PromptStep} — where the prompt stands after a key. `active`:
 * keep prompting (the input was consumed, or rejected by validation). `submit`: the prompt
 * resolved with its `value`. `cancel`: the user aborted (ctrl-c). Names its axis (the prompt's
 * progression), never `kind` (AGENTS §4.4).
 */
export type PromptStatus = 'active' | 'submit' | 'cancel'

/**
 * The result of one reducer step — the next `state`, the rendered `view`, the `status`, and,
 * on `submit`, the resolved `value`. The whole contract between a pure prompt reducer and the
 * impure driver: the driver applies the next `state`, writes the `view`, and — when `status`
 * is `submit` — reads `value`.
 *
 * @typeParam T - The prompt's resolved value type (`string` for input / password / select /
 *   editor, `boolean` for confirm, `readonly string[]` for checkbox).
 * @typeParam S - The prompt's concrete state shape ({@link InputState}, {@link SelectState}, …) —
 *   carried directly so `state` stays precisely typed with no union narrowing or assertion.
 *
 * @remarks
 * - `state` — the next immutable prompt state (feed it to the next reduce call). On `submit` /
 *   `cancel` it is the final state.
 * - `view` — the styled string to render NOW (possibly MULTI-LINE for `select` / `checkbox`),
 *   built through the state's {@link StylerInterface}. On an invalid `submit` it carries the
 *   error; the driver re-renders it each step.
 * - `status` — the {@link PromptStatus}: `active` to continue, `submit` when resolved, `cancel`
 *   on abort.
 * - `value` — present ONLY on a `submit` step, carrying the prompt's resolved value.
 */
export interface PromptStep<T, S> {
	readonly state: S
	readonly view: string
	readonly status: PromptStatus
	readonly value?: T
}

// === Input prompt

/** Options for a single-line text {@link import('./helpers.js').inputReduce} prompt. */
export interface InputOptions {
	readonly message: string
	readonly default?: string
	readonly validate?: Validator | ValidationRules
	readonly styler?: StylerInterface
}

/**
 * The immutable state of a text input prompt — its options, the resolved validator + styler,
 * the accumulated `value`, and the current `error` (when the last submit failed validation).
 *
 * @remarks
 * Built by {@link import('./helpers.js').createInputState}; advanced by
 * {@link import('./helpers.js').inputReduce}. `value` accumulates printable characters and
 * shrinks on backspace; `error` holds the validation message shown in the view after a
 * rejected submit (cleared on the next keystroke).
 */
export interface InputState {
	readonly message: string
	readonly default: string
	readonly validator: Validator
	readonly styler: StylerInterface
	readonly value: string
	readonly error?: string
}

// === Password prompt

/** Options for a masked password {@link import('./helpers.js').passwordReduce} prompt. */
export interface PasswordOptions {
	readonly message: string
	readonly mask?: string
	readonly validate?: Validator | ValidationRules
	readonly styler?: StylerInterface
}

/**
 * The immutable state of a password prompt — like {@link InputState} but with a `mask`
 * character the view renders in place of each input character.
 *
 * @remarks
 * Built by {@link import('./helpers.js').createPasswordState}; advanced by
 * {@link import('./helpers.js').passwordReduce}. The `value` is the real (unmasked) input;
 * the view shows `mask` repeated `value.length` times.
 */
export interface PasswordState {
	readonly message: string
	readonly mask: string
	readonly validator: Validator
	readonly styler: StylerInterface
	readonly value: string
	readonly error?: string
}

// === Confirm prompt

/** Options for a yes/no {@link import('./helpers.js').confirmReduce} confirmation prompt. */
export interface ConfirmOptions {
	readonly message: string
	readonly default?: boolean
	readonly styler?: StylerInterface
}

/**
 * The immutable state of a confirm prompt — its message, the default answer, and the styler.
 *
 * @remarks
 * Built by {@link import('./helpers.js').createConfirmState}; advanced by
 * {@link import('./helpers.js').confirmReduce}. `y` / `Y` submits `true`, `n` / `N` submits
 * `false`, and `enter` takes the `default` (rendered with the active letter capitalized in the
 * `(Y/n)` hint).
 */
export interface ConfirmState {
	readonly message: string
	readonly default: boolean
	readonly styler: StylerInterface
}

// === Select prompt

/**
 * Options for a single-selection {@link import('./helpers.js').selectReduce} prompt.
 *
 * @remarks
 * `choices` accepts bare strings (used as both `name` and `value`) or full {@link PromptChoice}
 * objects; {@link import('./helpers.js').createSelectState} normalizes them. `default` pre-focuses
 * the choice whose `value` matches it.
 */
export interface SelectOptions {
	readonly message: string
	readonly choices: readonly (string | PromptChoice)[]
	readonly default?: string
	readonly styler?: StylerInterface
}

/**
 * The immutable state of a select prompt — the normalized choices, the styler, and the
 * `focused` index (the highlighted row).
 *
 * @remarks
 * Built by {@link import('./helpers.js').createSelectState}; advanced by
 * {@link import('./helpers.js').selectReduce}. `up` / `down` move `focused` (wrapping at the
 * ends); `return` submits the focused choice's `value`.
 */
export interface SelectState {
	readonly message: string
	readonly choices: readonly PromptChoice[]
	readonly styler: StylerInterface
	readonly focused: number
}

// === Checkbox prompt

/**
 * Options for a multi-selection {@link import('./helpers.js').checkboxReduce} prompt.
 *
 * @remarks
 * `choices` accepts bare strings or full {@link CheckboxChoice} objects (with an optional
 * initial `checked`); {@link import('./helpers.js').createCheckboxState} normalizes them.
 * `min` / `max` gate submission — a submit with fewer than `min` or more than `max` selected
 * is rejected (the prompt stays active with the reason in the view).
 */
export interface CheckboxOptions {
	readonly message: string
	readonly choices: readonly (string | CheckboxChoice)[]
	readonly min?: number
	readonly max?: number
	readonly styler?: StylerInterface
}

/**
 * The immutable state of a checkbox prompt — the normalized choices, the styler, the `focused`
 * index, the set of `checked` indices, the optional `min` / `max` gate, and the current `error`.
 *
 * @remarks
 * Built by {@link import('./helpers.js').createCheckboxState}; advanced by
 * {@link import('./helpers.js').checkboxReduce}. `up` / `down` move `focus` (wrapping); `space`
 * toggles the focused index in `checked`; `return` submits the checked values in choice order
 * (rejected, with `error`, when the count is outside `[min, max]`). `checked` is modelled as a
 * readonly index array (plain JSON data, copy-on-write — no `Set` to clone).
 */
export interface CheckboxState {
	readonly message: string
	readonly choices: readonly CheckboxChoice[]
	readonly styler: StylerInterface
	readonly focused: number
	readonly checked: readonly number[]
	readonly min?: number
	readonly max?: number
	readonly error?: string
}

// === Editor prompt

/** Options for a multi-line {@link import('./helpers.js').editorReduce} editor prompt (terminated by ctrl-d). */
export interface EditorOptions {
	readonly message: string
	readonly default?: string
	readonly validate?: Validator | ValidationRules
	readonly styler?: StylerInterface
}

/**
 * The immutable state of an editor prompt — the committed `lines`, the in-progress `current`
 * line, plus the resolved validator + styler, the default, and the current `error`.
 *
 * @remarks
 * Built by {@link import('./helpers.js').createEditorState}; advanced by
 * {@link import('./helpers.js').editorReduce}. A printable key appends to `current`; `return`
 * commits `current` to `lines` and starts a fresh line; ctrl-d finishes, submitting
 * `lines + current` joined by newlines (or `default` when empty). The whole text is validated
 * on finish.
 */
export interface EditorState {
	readonly message: string
	readonly default: string
	readonly validator: Validator
	readonly styler: StylerInterface
	readonly lines: readonly string[]
	readonly current: string
	readonly error?: string
}

// === Prompt kind

/**
 * The six prompt KINDS this core provides — the value family a higher-level broker (T-b)
 * dispatches on. Names the prompt axis; a named value set (not a toggle), so it stays a union.
 */
export type PromptType = 'input' | 'password' | 'confirm' | 'select' | 'checkbox' | 'editor'

/**
 * The machine-readable condition carried by a {@link import('./errors.js').TerminalError} — the
 * axis a `catch` branches on. Names its axis (the failure condition), never `kind` (AGENTS §4.4).
 *
 * @remarks
 * - `EXPIRE` — a parked broker prompt was not answered before its `timeout` (or the broker was
 *   `destroy`ed while it was still pending); the prompt's Promise rejects with this.
 * - `CANCEL` — the user aborted an interactive prompt (ctrl-c) at the server `Terminal` (T-c)
 *   driver; the awaited prompt call rejects with this so a caller can branch on `error.code`.
 */
export type TerminalErrorCode = 'EXPIRE' | 'CANCEL' | 'DRIVER' | 'DEADLOCK' | 'TARGET'

// === The async prompt contract (T-b)

/**
 * The shared ASYNC prompt contract — the six prompt forms as Promise-returning methods. The
 * ONE vocabulary BOTH the headless {@link PromptInterface} broker (this module) and the server
 * `Terminal` driver (T-c) implement, so a prompt issued through this surface resolves the same
 * way on every surface (local TTY, headless broker, remote bridge).
 *
 * @remarks
 * Each method takes the prompt's `*Options` and resolves to that form's value type:
 * - `input` / `password` / `select` / `editor` → a `string`
 * - `confirm` → a `boolean`
 * - `checkbox` → a `readonly string[]` (the checked values, in choice order)
 *
 * This is a behavioral CONTRACT (the method surface), not an observable entity — the broker and
 * the driver add their own emitter / lifecycle on top. The {@link PromptClient} dispatches a
 * remote {@link PendingPrompt} to a LOCAL `PromptFormInterface` (so a human at this machine
 * answers a prompt parked elsewhere).
 */
export interface PromptFormInterface {
	input(options: InputOptions): Promise<string>
	password(options: PasswordOptions): Promise<string>
	confirm(options: ConfirmOptions): Promise<boolean>
	select(options: SelectOptions): Promise<string>
	checkbox(options: CheckboxOptions): Promise<readonly string[]>
	editor(options: EditorOptions): Promise<string>
}

// === The headless prompt broker (T-b)

/**
 * The lifecycle status of a parked {@link PendingPrompt} — where a brokered prompt stands.
 * Names its axis (the pending prompt's progression), never `kind` (AGENTS §4.4).
 *
 * @remarks
 * - `pending` — parked, awaiting an {@link PromptInterface.answer} (the Promise is unresolved).
 * - `answered` — answered and accepted (the Promise resolved with the validated value).
 * - `expired` — timed out (or torn down by `destroy`) before an answer (the Promise rejected).
 */
export type PendingPromptStatus = 'pending' | 'answered' | 'expired'

/**
 * One prompt PARKED by the broker — an id-keyed, wire-safe record of a {@link PromptFormInterface}
 * call awaiting a remote answer. The value a `pending` listener receives and the broker serializes
 * over SSE to a {@link PromptClient}.
 *
 * @remarks
 * - `id` — the unique id (minted via `crypto.randomUUID()`); the key for {@link PromptInterface.answer}.
 * - `form` — which prompt form was called ({@link PromptType}); the discriminant a client
 *   dispatches on (named for its axis — the prompt form — never `kind` / `type`).
 * - `message` — the prompt's question (lifted out of `options` for direct display).
 * - `options` — the WIRE-SAFE options (a `validate` FUNCTION dropped; the declarative
 *   {@link ValidationRules} data + `choices` / `default` / `mask` kept — see
 *   {@link import('./helpers.js').serializePromptOptions}). A client reconstructs the validator
 *   from the rules via {@link resolveValidation}.
 * - `status` — the current {@link PendingPromptStatus}.
 * - `time` — the creation timestamp (ms since epoch).
 * - `from` / `to` — the OPTIONAL attribution edge a {@link TerminalManagerInterface} stamps on a
 *   parked prompt (which endpoint asked, which endpoint must answer); absent for a bare broker
 *   {@link PromptInterface} used directly (no manager attribution).
 */
export interface PendingPrompt {
	readonly id: string
	readonly form: PromptType
	readonly message: string
	readonly options: Readonly<Record<string, unknown>>
	readonly status: PendingPromptStatus
	readonly time: number
	readonly from?: string
	readonly to?: string
}

/**
 * One injected timer — arms a deadline `callback` to fire after `ms`, returning a
 * {@link TimerCancel} that cancels it. The broker's timeout seam: the default wraps the host
 * `setTimeout` / `clearTimeout`; a test injects a deterministic timer that captures the callback
 * and fires it on demand (no real time, no global fake-timer patching).
 */
export type TimerHandler = (callback: () => void, ms: number) => TimerCancel

/** Cancel a pending {@link TimerHandler} deadline — idempotent, safe to call after the timer fired. */
export type TimerCancel = () => void

/**
 * One parked prompt's runtime state inside the broker — the wire-safe {@link PendingPrompt} record
 * it exposes, plus the live machinery that settles that prompt's Promise. `respond` is the per-form
 * gate-and-resolve closure: it validates + type-checks an answer and (on accept) resolves the parked
 * Promise, returning whether it accepted; it closes over the form's precisely-typed `resolve`, so no
 * per-form generic leaks into `answer`. `expire` rejects the parked Promise; `cancel` clears the
 * injected expiry timer ({@link TimerCancel}).
 */
export interface Parked {
	readonly prompt: PendingPrompt
	readonly respond: (value: unknown) => unknown
	readonly expire: () => void
	readonly cancel: TimerCancel
}

/**
 * The broker's event map (AGENTS §13) — lean, errors `unknown`, no listener-error event.
 *
 * @remarks
 * - `pending` — a prompt was parked (carries the wire-safe {@link PendingPrompt}); a transport
 *   forwards it to remote clients.
 * - `answer` — a parked prompt was answered (carries its `id` + the accepted `value`).
 * - `expire` — a parked prompt timed out (or was torn down) unanswered (carries its `id`).
 */
export type PromptEventMap = {
	pending: [prompt: PendingPrompt]
	answer: [id: string, value: unknown]
	expire: [id: string]
}

/**
 * Options for {@link import('./factories.js').createPrompt} / the {@link PromptInterface} broker.
 *
 * @remarks
 * - `on` — initial {@link PromptEventMap} listeners (AGENTS §8/§13).
 * - `error` — the emitter's listener-error handler (AGENTS §13).
 * - `timeout` — ms a parked prompt waits before it expires + its Promise rejects (default
 *   {@link import('./constants.js').DEFAULT_PROMPT_TIMEOUT_MS}).
 * - `timer` — the injected {@link TimerHandler} (default the host `setTimeout`); supply a
 *   deterministic timer to drive expiry in tests without real time.
 */
export interface PromptOptions {
	readonly on?: EmitterHooks<PromptEventMap>
	readonly error?: EmitterErrorHandler
	readonly timeout?: number
	readonly timer?: TimerHandler
}

/**
 * The union of a resolved prompt's value shapes — a `string` (`input` / `password` / `select` /
 * `editor`), a `boolean` (`confirm`), or a `readonly string[]` (`checkbox`, the checked values in
 * choice order). The type a {@link Ticket}'s `value` Promise resolves to.
 */
export type PromptValue = string | boolean | readonly string[]

/**
 * The union of every prompt form's options bag — the `options` a {@link ParkRequest} carries,
 * narrowed at the call site by the paired {@link PromptType}.
 */
export type PromptFormOptions =
	| InputOptions
	| PasswordOptions
	| ConfirmOptions
	| SelectOptions
	| CheckboxOptions
	| EditorOptions

/**
 * The request to {@link PromptInterface.park} a prompt directly — the general form the six
 * `PromptFormInterface` methods each wrap via a private `gateFor(form, options)` dispatch.
 *
 * @remarks
 * - `form` — which {@link PromptType} to park.
 * - `options` — that form's options bag ({@link PromptFormOptions}).
 * - `from` / `to` — set ONLY by a {@link TerminalManagerInterface} (the attribution edge); a
 *   direct broker caller leaves both `undefined`.
 */
export interface ParkRequest {
	readonly form: PromptType
	readonly options: PromptFormOptions
	readonly from?: string
	readonly to?: string
}

/** The handle {@link PromptInterface.park} returns — the parked prompt's `id` plus the Promise that resolves (or rejects) with its {@link PromptValue}. */
export interface Ticket {
	readonly id: string
	readonly value: Promise<PromptValue>
}

/** The rejection reason a bare {@link PromptInterface.answer} returns — `'unknown'` (no such parked prompt) or `'rejected'` (failed validation / type-check). */
export type AnswerError = 'unknown' | 'rejected'

/** The outcome of a bare {@link PromptInterface.answer} call — the accepted `value` on success, else the {@link AnswerError}. */
export type AnswerResult =
	| { readonly success: true; readonly value: unknown }
	| { readonly success: false; readonly error: AnswerError }

/**
 * The headless prompt BROKER (observable §13) — implements {@link PromptFormInterface} by
 * PARKING each call as a {@link PendingPrompt} and returning a Promise that resolves when the
 * prompt is {@link answer}ed (or rejects on timeout). The local-TTY / headless / remote
 * tri-surface's headless arm: no terminal here — a transport forwards each `pending` to whoever
 * can answer, and {@link answer} resolves the parked Promise.
 *
 * @remarks
 * - **Park-as-Promise.** Each `input` / `password` / … call mints an id, parks a
 *   {@link PendingPrompt}, emits `pending`, and returns an unresolved Promise. {@link park} is the
 *   general entry point the six form methods wrap.
 * - **Answer validates.** {@link answer} validates `value` against the prompt's resolved
 *   validator AND type-checks it to the prompt form before accepting; a bad answer is rejected
 *   (an {@link AnswerResult} failure, the prompt stays `pending`).
 * - **Timeout → expire → reject.** An unanswered prompt expires after `timeout` ms — `expire`
 *   fires and the parked Promise rejects (a {@link import('./errors.js').TerminalError}). The
 *   timer is injectable for deterministic tests.
 * - **Accessors (§9.1).** `pending()` lists the parked prompts; `pending(id)` looks one up.
 */
export interface PromptInterface extends PromptFormInterface {
	readonly emitter: EmitterInterface<PromptEventMap>
	readonly count: number
	park(request: ParkRequest): Ticket
	pending(): readonly PendingPrompt[]
	pending(id: string): PendingPrompt | undefined
	answer(id: string, value: unknown): AnswerResult
	destroy(): void
}

// === The SSE prompt bridge (T-b)

/**
 * A minimal `fetch` — the subset of the global `fetch` the {@link PromptClient} uses (open the
 * SSE stream, POST an answer). Injected so a test drives the client with a controlled
 * `Response` (a scripted SSE `ReadableStream`) instead of a real network.
 */
export type FetchHandler = (input: string, init?: FetchInit) => Promise<Response>

/**
 * The request init the {@link PromptClient} passes to its {@link FetchHandler} — the `fetch`
 * `RequestInit` fields it actually sets (method / headers / body / abort signal).
 */
export interface FetchInit {
	readonly method?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly body?: string
	readonly signal?: AbortSignal
}

/**
 * The client's event map (AGENTS §13) — lean, errors `unknown`, no listener-error event.
 *
 * @remarks
 * - `connect` — the SSE stream opened.
 * - `disconnect` — the SSE stream closed (the server ended it, or {@link PromptClientInterface.disconnect}).
 * - `expire` — the remote broker signalled a parked prompt expired (carries its `id`).
 * - `error` — a connection / dispatch / POST fault (errors are `unknown`).
 */
export type PromptClientEventMap = {
	connect: []
	disconnect: []
	expire: [id: string]
	error: [error: unknown]
}

/**
 * Options for {@link import('./factories.js').createPromptClient} / the {@link PromptClientInterface}.
 *
 * @remarks
 * - `url` — the remote broker's SSE endpoint (GET opens the stream; answers POST back to it).
 * - `terminal` — the LOCAL {@link PromptFormInterface} each remote prompt is dispatched to, so a
 *   human at THIS machine answers a prompt issued elsewhere.
 * - `token` — an optional auth token, sent as the
 *   {@link import('./constants.js').HEADER_TOKEN} header on every request.
 * - `reconnect` — whether to reconnect after the stream drops (default `true`).
 * - `delay` — ms to wait before each reconnect attempt (default
 *   {@link import('./constants.js').DEFAULT_RECONNECT_DELAY_MS}).
 * - `on` — initial {@link PromptClientEventMap} listeners (AGENTS §8/§13).
 * - `error` — the emitter's listener-error handler (AGENTS §13).
 * - `fetch` — the injected {@link FetchHandler} (default the global `fetch`); supply a scripted
 *   fetch to drive the client deterministically in tests.
 * - `timer` — the injected {@link TimerHandler} for the reconnect backoff (default the host
 *   `setTimeout`); supply a deterministic timer to drive reconnection without real time.
 */
export interface PromptClientOptions {
	readonly url: string
	readonly terminal: PromptFormInterface
	readonly token?: string
	readonly reconnect?: boolean
	readonly delay?: number
	readonly on?: EmitterHooks<PromptClientEventMap>
	readonly error?: EmitterErrorHandler
	readonly fetch?: FetchHandler
	readonly timer?: TimerHandler
}

/**
 * The SSE prompt BRIDGE (observable §13) — the client-side counterpart to {@link PromptInterface}.
 * Connects to a remote broker's SSE endpoint, receives serialized {@link PendingPrompt}s,
 * dispatches EACH to a local {@link PromptFormInterface} terminal, and POSTs the answer back —
 * so a human at this machine answers prompts a broker parked elsewhere.
 *
 * @remarks
 * - **Connect.** {@link connect} opens the SSE stream (via the injected `fetch` + the core
 *   `SSEParser`) and resolves when the stream ends; it reconnects with the `delay` backoff
 *   unless `reconnect` is `false` or the client was {@link destroy}ed.
 * - **Dispatch + answer.** Each decoded prompt is narrowed (§14) and dispatched to `terminal`;
 *   the resolved value POSTs back to `url`.
 * - **`connected`** reflects whether the stream is currently open.
 */
export interface PromptClientInterface {
	readonly emitter: EmitterInterface<PromptClientEventMap>
	readonly url: string
	readonly connected: boolean
	connect(): Promise<void>
	disconnect(): void
	destroy(): void
}

// === The terminal manager (multi-endpoint broker registry)

/** Options for {@link import('./factories.js').createTerminal} / a manager-owned {@link PromptInterface} broker — the per-endpoint `timeout` + injected `timer`. */
export interface TerminalOptions {
	readonly timeout?: number
	readonly timer?: TimerHandler
}

/**
 * The manager's event map (AGENTS §13) — the name-attributed re-emission of every mounted
 * broker's events, so a caller subscribes once for ALL endpoints instead of per-broker.
 *
 * @remarks
 * - `pending` — an endpoint parked a prompt (carries the {@link PendingPrompt}, itself carrying
 *   `from` / `to`).
 * - `answer` — an endpoint's parked prompt was answered (`to` names the endpoint).
 * - `expire` — an endpoint's parked prompt timed out (`to` names the endpoint).
 */
export type TerminalManagerEventMap = {
	pending: [prompt: PendingPrompt]
	answer: [to: string, id: string, value: unknown]
	expire: [to: string, id: string]
}

/**
 * Options for {@link import('./factories.js').createTerminalManager} / the
 * {@link TerminalManagerInterface}.
 *
 * @remarks
 * - `store` — the optional {@link TerminalStoreInterface} backing `open` / `save`.
 * - `timeout` / `timer` — the manager-wide default for each endpoint's broker (overridable per
 *   {@link TerminalManagerInterface.add} call via {@link TerminalOptions}).
 * - `on` / `error` — the manager's {@link EmitterHooks} + {@link EmitterErrorHandler} (AGENTS §13).
 */
export interface TerminalManagerOptions {
	readonly store?: TerminalStoreInterface
	readonly timeout?: number
	readonly timer?: TimerHandler
	readonly on?: EmitterHooks<TerminalManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/** The rejection reason a {@link TerminalManagerInterface.answer} call returns — an {@link AnswerError}, plus `'terminal'` (no such endpoint). */
export type TerminalAnswerError = AnswerError | 'terminal'

/** The outcome of a {@link TerminalManagerInterface.answer} call — the accepted `value` on success, else the {@link TerminalAnswerError}. */
export type TerminalAnswerResult =
	| { readonly success: true; readonly value: unknown }
	| { readonly success: false; readonly error: TerminalAnswerError }

/**
 * The multi-endpoint terminal MANAGER (§9.1/§9.2) — a registry of named {@link PromptInterface}
 * brokers (one per endpoint), so several parties (agents, tools, humans) can `ask` prompts of
 * each other by NAME, attributed with a `from` → `to` edge on every parked {@link PendingPrompt}.
 *
 * @remarks
 * - **Accessors (§9.1).** `terminal(name)` looks up one endpoint's broker; `terminals()` lists
 *   every mounted endpoint name.
 * - **`add`** mints (or returns the existing) broker for `name` — idempotent, never clobbers a
 *   live endpoint.
 * - **`ask`** is the attributed convenience: parks a prompt from `from` to `to` (auto-`add`ing
 *   `to` if absent) and resolves with the typed value, precisely overloaded per {@link PromptType}.
 * - **`pending()`** lists every endpoint's parked prompts; `pending(to)` scopes to one endpoint.
 * - **`answer`** routes to the named endpoint's broker.
 * - **`open`** restores (or returns the live) broker for `name` from the `store`.
 * - **`save`** persists an endpoint's config snapshot to the `store` (`false` when there is no
 *   store, or `name` is unknown).
 * - **Batch `remove` (§9.2).** The array overload is declared FIRST — `remove(names)` removes each
 *   listed endpoint (`true` when any of the named terminals was removed); `remove(name)` removes one.
 * - **`clear`** removes every endpoint without destroying the manager; **`destroy`** tears down
 *   every broker, then the manager's own emitter.
 */
export interface TerminalManagerInterface {
	readonly emitter: EmitterInterface<TerminalManagerEventMap>
	readonly count: number
	terminal(name: string): PromptInterface | undefined
	terminals(): readonly string[]
	add(name: string, options?: TerminalOptions): PromptInterface
	ask(
		from: string,
		to: string,
		form: 'input' | 'password' | 'editor',
		options: InputOptions | PasswordOptions | EditorOptions,
	): Promise<string>
	ask(from: string, to: string, form: 'confirm', options: ConfirmOptions): Promise<boolean>
	ask(from: string, to: string, form: 'select', options: SelectOptions): Promise<string>
	ask(
		from: string,
		to: string,
		form: 'checkbox',
		options: CheckboxOptions,
	): Promise<readonly string[]>
	pending(): readonly PendingPrompt[]
	pending(to: string): readonly PendingPrompt[]
	answer(to: string, id: string, value: unknown): TerminalAnswerResult
	open(name: string): Promise<PromptInterface | undefined>
	save(name: string): Promise<boolean>
	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	clear(): void
	destroy(): void
}

// === Transport-neutral bridge wire seams

/** One SSE-shaped wire frame — the `event` name, its `data` payload (already JSON-stringified), and an optional `id`. The transport-neutral shape {@link import('./helpers.js').serializePending} / {@link import('./helpers.js').serializeExpire} / {@link import('./helpers.js').serializeShutdown} build, with no `http` dependency. */
export interface WireEvent {
	readonly event: string
	readonly data: string
	readonly id?: string
}

// === Terminal store (config-only snapshot)

/** One endpoint's persisted CONFIG snapshot — `id` is the endpoint name; `timeout` its configured default. Parked Promises are process-bound and are never resurrected — `open` always restores an EMPTY broker. */
export interface TerminalSnapshot {
	readonly id: string
	readonly timeout?: number
}

/** One opaque persisted row — the shape a `TableInterface<TerminalSnapshotRow>`-backed store reads/writes; `snapshot` is narrowed with {@link import('./helpers.js').isTerminalSnapshot} on read. */
export interface TerminalSnapshotRow {
	readonly id: string
	readonly snapshot: unknown
}

/**
 * The point-access persistence seam (AGENTS §5 — Stores) for a {@link TerminalManagerInterface}'s
 * endpoint configs. Every primitive is async; `delete` of an absent id is a no-op.
 */
export interface TerminalStoreInterface {
	get(id: string): Promise<TerminalSnapshot | undefined>
	set(snapshot: TerminalSnapshot): Promise<void>
	delete(id: string): Promise<void>
}
