import type { JSONRecord, Result } from '@orkestrel/contract'
import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { FieldChoice, FieldError, FormInterface, FormValues } from '@orkestrel/form'
import type { Style, StylerInterface } from '@orkestrel/console'

// The PURE, UNIVERSAL terminal core. `@orkestrel/form` owns every form concept — the schema, the
// twelve controls, the rules, the values, and the settle-once `answer` promise — and this package
// declares none of them a second time. What terminal owns is everything form has no opinion about:
// a key decoder, a presentation theme, the headless broker that PARKS a live form until somebody
// elsewhere answers it, the SSE bridge that carries one parked form to a machine with a keyboard,
// and the manager that routes parked forms between named endpoints. The server `Terminal` driver
// is the only impure part — it owns raw mode, stdin, and rendering, and it drives a form to
// settlement through {@link TerminalInterface}.

// === Key decoding

/**
 * One decoded keypress — the TTY-agnostic representation of a single key, the output of
 * {@link import('./helpers.js').parseKey}. A driver reads `name` and the modifier flags to decide
 * its transition; `sequence` is preserved so a printable character round-trips and an unknown
 * escape is never lost.
 *
 * @remarks
 * - `name` — the canonical key name: a control or navigation key (`return`, `backspace`, `tab`,
 *   `escape`, `up` / `down` / `left` / `right`, `space`, `home`, `end`, `delete`), a named ctrl
 *   combo (`c` with `ctrl` true for ctrl-c, likewise `d` / `u` / `a` / `e`), or the printable
 *   character itself (`'a'`, `'7'`, `'?'`). An unrecognized sequence yields `name: ''`; the decoder
 *   is total and never throws.
 * - `sequence` — the exact input bytes as a string (a `Uint8Array` is decoded UTF-8). The driver
 *   writes this verbatim for a printable key.
 * - `ctrl` / `meta` / `shift` — the modifier flags. `ctrl` is true for a C0 control byte, `meta`
 *   for an ESC-prefixed (Alt) sequence, `shift` for an uppercase-letter printable.
 */
export interface KeyEvent {
	readonly name: string
	readonly sequence: string
	readonly ctrl: boolean
	readonly meta: boolean
	readonly shift: boolean
}

// === Presentation

/**
 * One glyph slot a rendered field draws — the icon axis of a {@link PromptTheme}. A named value
 * set, not a toggle, so it stays a union.
 *
 * @remarks
 * - `question` — the leading mark on a field's label line.
 * - `pointer` — the cursor before the input or the focused choice row.
 * - `dot` / `selected` — an unfocused / focused row marker in a choice list.
 * - `checked` / `unchecked` — a checked / unchecked box in a multi-choice list.
 * - `success` / `error` — the mark on a settled field's line / on its failure line.
 */
export type PromptIcon =
	| 'question'
	| 'pointer'
	| 'dot'
	| 'selected'
	| 'checked'
	| 'unchecked'
	| 'success'
	| 'error'

/**
 * One styling slot a rendered field paints through — the semantic axis of a {@link PromptTheme}. A
 * role says what a fragment MEANS; the theme decides what that meaning looks like, so a consumer
 * re-maps styled output by naming roles rather than reimplementing a renderer.
 *
 * @remarks
 * - `question` — the leading mark on an active field's line.
 * - `pointer` — the cursor before the input or the focused choice row.
 * - `message` — the field's own label text.
 * - `content` — the field's primary content: the typed value, the mask run, an unfocused choice
 *   label, or a committed editor line. Its default is the EMPTY style, so unthemed content renders
 *   as bare text.
 * - `success` / `error` — a settled field's mark / a failure mark and its message.
 * - `selected` — a chosen value: the checked box, the focused choice marker, the confirm default
 *   letter.
 * - `focus` — the label of the row the cursor is on.
 * - `hint` — dim supplementary text: a default value, a key hint, a selection count, a committed
 *   answer.
 * - `muted` — a dim off-state mark: an unfocused choice marker, an unchecked box, a fallback index.
 * - `description` — a choice's one-line help text.
 */
export type PromptRole =
	| 'question'
	| 'pointer'
	| 'message'
	| 'content'
	| 'success'
	| 'error'
	| 'selected'
	| 'focus'
	| 'hint'
	| 'muted'
	| 'description'

/**
 * A resolved PRESENTATION — the glyph for every {@link PromptIcon} and the console {@link Style}
 * for every {@link PromptRole}. Plain JSON data with no functions, so it crosses the wire with the
 * form it decorates. Built by {@link import('./helpers.js').createPromptTheme}.
 *
 * @remarks
 * A role's value is the console module's own {@link Style} — the one style model the whole console
 * and terminal system shares — so a renderer paints a role through
 * {@link import('@orkestrel/console').StylerInterface} and this package holds no second style
 * vocabulary. A `Style` carries a foreground, a background, and an attribute list, so a role can
 * express a background color, which a styler's accessor chain cannot name.
 */
export interface PromptTheme {
	readonly icons: Readonly<Record<PromptIcon, string>>
	readonly roles: Readonly<Record<PromptRole, Style>>
}

/**
 * The PARTIAL {@link PromptTheme} an option bag carries — every icon and every role is optional,
 * and {@link import('./helpers.js').createPromptTheme} merges what is supplied over
 * {@link import('./constants.js').DEFAULT_PROMPT_THEME} leaf by leaf. Supplying one icon or one
 * role leaves every other slot at its default.
 */
export interface PromptThemeOptions {
	readonly icons?: Readonly<Partial<Record<PromptIcon, string>>>
	readonly roles?: Readonly<Partial<Record<PromptRole, Style>>>
}

// === Reducer state

/**
 * The immutable state a text field's reducer carries — built by
 * {@link import('./helpers.js').createInputState}, rendered by
 * {@link import('./helpers.js').inputView}, and advanced by
 * {@link import('./helpers.js').inputReduce}.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `default` — the declared default a bare return submits.
 * - `styler` — the console styler every role is painted through.
 * - `theme` — the resolved {@link PromptTheme}.
 * - `value` — the characters typed so far.
 */
export interface InputState {
	readonly message: string
	readonly default: string
	readonly styler: StylerInterface
	readonly theme: PromptTheme
	readonly value: string
}

/**
 * The immutable state a password field's reducer carries — the text state with the mask glyph in
 * place of a default, because a secret is never seeded from the schema.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `mask` — the glyph each typed character renders as.
 * - `styler` / `theme` — the console styler and the resolved {@link PromptTheme}.
 * - `value` — the characters typed so far, rendered only as the mask repeated.
 */
export interface PasswordState {
	readonly message: string
	readonly mask: string
	readonly styler: StylerInterface
	readonly theme: PromptTheme
	readonly value: string
}

/**
 * The immutable state a confirm field's reducer carries. It holds no typed value, because the
 * answer is the key itself.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `default` — the answer a bare return submits, and the letter the view capitalizes.
 * - `styler` / `theme` — the console styler and the resolved {@link PromptTheme}.
 */
export interface ConfirmState {
	readonly message: string
	readonly default: boolean
	readonly styler: StylerInterface
	readonly theme: PromptTheme
}

/**
 * The immutable state a select field's reducer carries.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `choices` — the choices the list offers, in declared order.
 * - `styler` / `theme` — the console styler and the resolved {@link PromptTheme}.
 * - `focused` — the index the cursor sits on, pre-placed on the declared default.
 */
export interface SelectState {
	readonly message: string
	readonly choices: readonly FieldChoice[]
	readonly styler: StylerInterface
	readonly theme: PromptTheme
	readonly focused: number
}

/**
 * The immutable state a checkbox field's reducer carries — the select state plus the ticked set.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `choices` — the choices the list offers, in declared order.
 * - `styler` / `theme` — the console styler and the resolved {@link PromptTheme}.
 * - `focused` — the index the cursor sits on.
 * - `checked` — the ticked indices, in the order they were ticked; the reducer sorts them into
 *   choice order when it submits.
 */
export interface CheckboxState {
	readonly message: string
	readonly choices: readonly FieldChoice[]
	readonly styler: StylerInterface
	readonly theme: PromptTheme
	readonly focused: number
	readonly checked: readonly number[]
}

/**
 * The immutable state an editor field's reducer carries — the committed lines and the line still
 * being typed, kept apart so a return commits one without ending the field.
 *
 * @remarks
 * - `message` — the sanitized label the header renders.
 * - `default` — the text an empty finish falls back to.
 * - `styler` / `theme` — the console styler and the resolved {@link PromptTheme}.
 * - `lines` — the lines already committed with a return.
 * - `current` — the line in progress.
 */
export interface EditorState {
	readonly message: string
	readonly default: string
	readonly styler: StylerInterface
	readonly theme: PromptTheme
	readonly lines: readonly string[]
	readonly current: string
}

// === Reducer output

/**
 * Where one field's reducer stands after a key. `active`: keep asking, because the key was
 * consumed or the answer was refused. `submit`: the field resolved with its `value`. `cancel`: the
 * user aborted with ctrl-c. Names its axis, never `kind`.
 */
export type PromptStatus = 'active' | 'submit' | 'cancel'

/**
 * The result of one reducer step — the next `state`, the rendered `view`, the `status`, and, on
 * `submit`, the resolved `value`. The whole contract between a pure reducer and the impure driver:
 * the driver applies the next `state`, writes the `view`, and reads `value` on `submit`.
 *
 * @typeParam T - The value this field resolves to, as its control admits it.
 * @typeParam S - The reducer's concrete state shape, carried directly so `state` stays precisely
 *   typed with no union narrowing and no assertion.
 *
 * @remarks
 * - `state` — the next immutable state; feed it to the next reduce call. On `submit` or `cancel` it
 *   is the final state.
 * - `view` — the styled string to render now, possibly multi-line. On a refused `submit` it carries
 *   the failure; the driver re-renders it each step.
 * - `value` — present ONLY on a `submit` step.
 */
export interface PromptStep<T, S> {
	readonly state: S
	readonly view: string
	readonly status: PromptStatus
	readonly value?: T
}

// === Failure codes

/**
 * The machine-readable condition carried by a {@link import('./errors.js').TerminalError} — the
 * axis a `catch` branches on. Names its axis (the failure condition), never `kind`.
 *
 * @remarks
 * Every code here is terminal's own. A refusal that belongs to the form — a malformed schema, a
 * value a control cannot hold, a write to a settled form — arrives as the dependency's own
 * `FormError` and is never re-coded.
 *
 * - `EXPIRE` — `park` was called on an already-`destroy`ed broker: the given form is destroyed and
 *   the call throws before minting an id. A parked form that times out is abandoned instead, not
 *   coded `EXPIRE` — the broker destroys it and the caller's `answer` promise rejects on the
 *   form's own lifecycle with the Form package's `ABANDONED` error.
 * - `CANCEL` — the user aborted at the server `Terminal` driver with ctrl-c.
 * - `DRIVER` — the driver could not read the terminal it was given.
 * - `DEADLOCK` — an endpoint was asked to answer its own question.
 * - `TARGET` — the named endpoint cannot be reached.
 * - `LIMIT` — the broker's optional `cap` on concurrently parked forms was already reached. The
 *   new call is refused WITHOUT parking: no id, no `pending` event, no timer.
 * - `DESTROYED` — a call reached an already-destroyed {@link TerminalManagerInterface}.
 */
export type TerminalErrorCode =
	| 'EXPIRE'
	| 'CANCEL'
	| 'DRIVER'
	| 'DEADLOCK'
	| 'TARGET'
	| 'LIMIT'
	| 'DESTROYED'

// === The interactive driver

/**
 * The contract for asking a form of a human at a keyboard — one method, because a form is one
 * question however many fields it holds. The server `Terminal` implements it against a real TTY;
 * a {@link PromptClientInterface} holds one to answer forms parked elsewhere.
 *
 * @remarks
 * `ask` drives the form the caller passes: it walks the schema's fields in order, binds each
 * keystroke through the form's own `fill`, submits, and returns the settled values. The returned
 * promise is the form's `answer`, so a caller holding the form can await either one. Ctrl-c at an
 * interactive driver is the one exception: it rejects THIS promise with a `TerminalError` coded
 * `CANCEL` and leaves the form `editing`, so the form's own `answer` stays pending for its owner.
 *
 * A driver never owns the form's lifetime. To interrupt an active walk, destroy the form: it
 * abandons, `answer` rejects, and the driver stops rendering on the form's `abandon` event. That
 * is the only cancellation channel, which is why this contract needs no second method.
 */
export interface TerminalInterface {
	ask(form: FormInterface): Promise<FormValues>
}

// === The headless broker

/**
 * The lifecycle status of a parked {@link PendingForm} — where the TICKET stands, which is not
 * where the form stands. A ticket is `pending` until somebody answers it; the form it carries has
 * its own status, and the two are separate facts about separate entities.
 *
 * @remarks
 * - `pending` — parked, awaiting {@link PromptInterface.answer}.
 * - `answered` — answered and accepted, so the parked form settled.
 * - `expired` — timed out, released by `stop`, or torn down by `destroy`, before an answer.
 */
export type PendingFormStatus = 'pending' | 'answered' | 'expired'

/**
 * One form PARKED by the broker — an id-keyed, wire-safe record of a live form awaiting a remote
 * answer. The value a `pending` listener receives and the broker serializes over SSE to a
 * {@link PromptClientInterface}.
 *
 * @remarks
 * - `id` — the unique id, minted with `crypto.randomUUID()`; the key for
 *   {@link PromptInterface.answer}.
 * - `schema` — the parked form's schema projected to JSON by the dependency's own `serializeForm`.
 *   Every `custom` validator is dropped on the way out, so an authoritative rule the wire cannot
 *   carry stays server-side and is enforced when the answer comes back.
 * - `status` — the ticket's {@link PendingFormStatus}.
 * - `time` — the creation timestamp, ms since epoch.
 * - `from` / `to` — the attribution edge a {@link TerminalManagerInterface} stamps on a parked
 *   form: which endpoint asked, which endpoint must answer. Both absent for a bare broker used
 *   directly.
 */
export interface PendingForm {
	readonly id: string
	readonly schema: JSONRecord
	readonly status: PendingFormStatus
	readonly time: number
	readonly from?: string
	readonly to?: string
}

/**
 * One injected timer — arms a deadline `callback` to fire after `ms`, returning a
 * {@link TimerCancel} that cancels it. The broker's timeout seam: the default wraps the host
 * `setTimeout` and `clearTimeout`; a test injects a deterministic timer that captures the callback
 * and fires it on demand, with no real time and no global patching.
 */
export type TimerHandler = (callback: () => void, ms: number) => TimerCancel

/** Cancel a pending {@link TimerHandler} deadline — idempotent, safe to call after the timer fired. */
export type TimerCancel = () => void

/**
 * One parked form's runtime state inside the broker — the live form, the wire-safe record the
 * broker exposes, and the cancel for its expiry timer.
 *
 * @remarks
 * `form` is the AUTHORITATIVE form the caller parked, not a copy: an answer fills and submits this
 * one, so a `custom` rule that never crossed the wire still decides. Expiry destroys it, which
 * abandons it and settles the caller's promise through the form's own lifecycle. `pending` is the
 * wire record, whose `status` tracks the ticket.
 */
export interface Parked {
	readonly form: FormInterface
	readonly pending: PendingForm
	readonly cancel: TimerCancel
}

/**
 * The broker's event map — lean, errors `unknown`, no listener-error event.
 *
 * @remarks
 * - `pending` — a form was parked; a transport forwards the wire record to remote clients.
 * - `answer` — a parked form was answered and accepted, carrying its id and the settled values.
 * - `expire` — a parked form timed out or was released unanswered, carrying its id.
 */
export type PromptEventMap = {
	readonly pending: readonly [form: PendingForm]
	readonly answer: readonly [id: string, values: FormValues]
	readonly expire: readonly [id: string]
}

/**
 * Options for {@link import('./factories.js').createPrompt} and every {@link PromptInterface}
 * broker, including one a {@link TerminalManagerInterface} mounts per endpoint.
 *
 * @remarks
 * - `on` — initial {@link PromptEventMap} listeners.
 * - `error` — the emitter's listener-error handler.
 * - `timeout` — ms a parked form waits before it expires and is abandoned (default
 *   {@link import('./constants.js').DEFAULT_PROMPT_TIMEOUT_MS}).
 * - `timer` — the injected {@link TimerHandler}, default the host `setTimeout`; supply a
 *   deterministic timer to drive expiry in tests without real time.
 * - `cap` — the maximum number of forms this broker holds parked at once, default unbounded. Once
 *   `count` reaches `cap` a new park is refused with a
 *   {@link import('./errors.js').TerminalError} coded `LIMIT`, without parking, minting an id,
 *   emitting `pending`, or arming a timer. The runaway-asker memory ceiling.
 */
export interface PromptOptions {
	readonly on?: EmitterHooks<PromptEventMap>
	readonly error?: EmitterErrorHandler
	readonly timeout?: number
	readonly timer?: TimerHandler
	readonly cap?: number
}

/**
 * The parking envelope — everything the broker needs about a park that the form itself does not
 * say.
 *
 * @remarks
 * `from` and `to` are the attribution edge, set ONLY by a {@link TerminalManagerInterface}: which
 * endpoint asked, which endpoint must answer. A direct broker caller passes no request at all.
 */
export interface ParkRequest {
	readonly from?: string
	readonly to?: string
}

/**
 * Why {@link PromptInterface.answer} refused. Names its axis with `reason`.
 *
 * @remarks
 * - `unknown` — no form is parked under that id, or the one that was has already settled.
 * - `rejected` — the authoritative form refused the values, and `errors` is exactly what it
 *   reported. A client seeds its local form with the values it sent, applies each failure through
 *   the form's `invalidate`, and asks again; the parked form stays parked until it accepts or
 *   expires. This is the retry loop that makes a server-side `custom` rule enforceable, because
 *   that rule never crossed the wire and the client could not have checked it.
 */
export type AnswerError =
	| { readonly reason: 'unknown' }
	| { readonly reason: 'rejected'; readonly errors: readonly FieldError[] }

/**
 * The headless form BROKER — parks a live form until somebody elsewhere answers it. The headless
 * arm of the local-TTY / headless / remote trio: there is no terminal here, so a transport forwards
 * each `pending` record to whoever can answer, and {@link answer} drives the parked form to
 * settlement.
 *
 * @remarks
 * - **The form is the unit.** {@link park} takes a live form, mints an id, emits `pending`, and
 *   returns the id. It wraps no promise, because the caller already holds one: the form's own
 *   `answer`.
 * - **The parked form is authoritative.** {@link answer} fills and submits THAT form, so every rule
 *   it carries decides, including a `custom` validator the wire dropped. A refusal returns the
 *   form's own errors and leaves the form parked.
 * - **Timeout abandons.** An unanswered form is destroyed after `timeout` ms; `expire` fires and
 *   the caller's promise rejects on the form's own lifecycle. The timer is injectable.
 * - **Accessors.** `pending()` lists the parked records; `pending(id)` looks one up.
 * - **Batch stop.** The array overload is declared first: `stop(ids)` releases each listed parked
 *   form and reports whether all ids were parked; `stop(id)` releases one; `stop()` releases every
 *   parked form without destroying the broker. Release uses the existing expiry semantics.
 *
 * @example
 * ```ts
 * const prompt = createPrompt()
 * const first = prompt.park(createForm({ fields: [{ control: 'text', name: 'first' }] }))
 * const second = prompt.park(createForm({ fields: [{ control: 'text', name: 'second' }] }))
 * prompt.stop(first) // true
 * prompt.stop([second, 'missing']) // false; `second` was still released
 * prompt.stop() // release every remaining form; the broker stays usable
 * ```
 */
export interface PromptInterface {
	readonly emitter: EmitterInterface<PromptEventMap>
	readonly count: number
	park(form: FormInterface, request?: ParkRequest): string
	pending(): readonly PendingForm[]
	pending(id: string): PendingForm | undefined
	answer(id: string, values: FormValues): Result<FormValues, AnswerError>
	stop(ids: readonly string[]): boolean
	stop(id: string): boolean
	stop(): void
	destroy(): void
}

// === The SSE bridge

/**
 * A minimal `fetch` — the subset of the global `fetch` a {@link PromptClientInterface} uses: open
 * the SSE stream, POST an answer. Injected so a test drives the client with a scripted `Response`
 * instead of a real network.
 */
export type FetchHandler = (input: string, init?: FetchInit) => Promise<Response>

/**
 * The request init a {@link PromptClientInterface} passes to its {@link FetchHandler} — the
 * `RequestInit` fields it actually sets.
 */
export interface FetchInit {
	readonly method?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly body?: string
	readonly signal?: AbortSignal
}

/**
 * The client's event map — lean, errors `unknown`, no listener-error event.
 *
 * @remarks
 * - `connect` — the SSE stream opened.
 * - `disconnect` — the SSE stream closed, by the server or by
 *   {@link PromptClientInterface.disconnect}.
 * - `expire` — the remote broker signalled that a parked form expired, carrying its id. The client
 *   destroys the local form rendering it, or drops it from the queue if it has not started.
 * - `error` — a connection, render, or POST fault.
 */
export type PromptClientEventMap = {
	readonly connect: readonly []
	readonly disconnect: readonly []
	readonly expire: readonly [id: string]
	readonly error: readonly [error: unknown]
}

/**
 * Options for {@link import('./factories.js').createPromptClient} and the
 * {@link PromptClientInterface}.
 *
 * @remarks
 * - `url` — the remote broker's SSE endpoint. A GET opens the stream; answers POST back to it.
 * - `terminal` — the LOCAL {@link TerminalInterface} each remote form is driven through, so a human
 *   at THIS machine answers a form parked elsewhere.
 * - `token` — an optional auth token, sent as the {@link import('./constants.js').HEADER_TOKEN}
 *   header on every request.
 * - `reconnect` — whether to reconnect after the stream drops, default true.
 * - `delay` — ms to wait before each reconnect attempt (default
 *   {@link import('./constants.js').DEFAULT_RECONNECT_DELAY_MS}).
 * - `on` — initial {@link PromptClientEventMap} listeners.
 * - `error` — the emitter's listener-error handler.
 * - `fetch` — the injected {@link FetchHandler}, default the global `fetch`.
 * - `timer` — the injected {@link TimerHandler} for the reconnect backoff, default the host
 *   `setTimeout`.
 */
export interface PromptClientOptions {
	readonly url: string
	readonly terminal: TerminalInterface
	readonly token?: string
	readonly reconnect?: boolean
	readonly delay?: number
	readonly on?: EmitterHooks<PromptClientEventMap>
	readonly error?: EmitterErrorHandler
	readonly fetch?: FetchHandler
	readonly timer?: TimerHandler
}

/**
 * The SSE form BRIDGE — the client-side counterpart to {@link PromptInterface}. It receives
 * serialized {@link PendingForm} records from a remote broker, rebuilds each schema locally, drives
 * it through a {@link TerminalInterface}, and POSTs the answer back, so a human at this machine
 * answers forms a broker parked elsewhere.
 *
 * @remarks
 * - **Connect.** {@link connect} opens the SSE stream through the injected `fetch` and resolves
 *   when the stream ends. It reconnects on the `delay` backoff unless `reconnect` is false or the
 *   client was destroyed.
 * - **Ingest, then render.** Ingestion never waits on a render. Each decoded record is narrowed,
 *   its schema parsed and sanitized, and queued; one form is driven at a time while the stream
 *   keeps reading, so an unanswered form never starves the connection.
 * - **Never trust the wire.** Every rendered string is sanitized, and a `pattern` that arrived over
 *   the wire is never executed locally. The authoritative form decides.
 * - **Refusal retries.** A rejected answer comes back with the parked form's own errors; the client
 *   applies them to the local form and asks again until the answer is accepted or the form expires.
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

// === The terminal manager

/**
 * The manager's event map — the name-attributed re-emission of every mounted broker's events, so a
 * caller subscribes once for ALL endpoints instead of once per broker.
 *
 * @remarks
 * - `pending` — an endpoint parked a form; the record itself carries `from` and `to`.
 * - `answer` — an endpoint's parked form was answered; `to` names the endpoint.
 * - `expire` — an endpoint's parked form expired; `to` names the endpoint.
 */
export type TerminalManagerEventMap = {
	readonly pending: readonly [form: PendingForm]
	readonly answer: readonly [to: string, id: string, values: FormValues]
	readonly expire: readonly [to: string, id: string]
}

/**
 * Options for {@link import('./factories.js').createTerminalManager} and the
 * {@link TerminalManagerInterface}.
 *
 * @remarks
 * - `store` — the optional {@link TerminalStoreInterface} backing `open` and `save`.
 * - `timeout` / `timer` / `cap` — the manager-wide default for each endpoint's broker, overridable
 *   per {@link TerminalManagerInterface.add} call.
 * - `on` / `error` — the manager's own emitter hooks and listener-error handler.
 */
export interface TerminalManagerOptions {
	readonly store?: TerminalStoreInterface
	readonly timeout?: number
	readonly timer?: TimerHandler
	readonly cap?: number
	readonly on?: EmitterHooks<TerminalManagerEventMap>
	readonly error?: EmitterErrorHandler
}

/**
 * Why a {@link TerminalManagerInterface.answer} call refused — an {@link AnswerError} from the
 * endpoint's own broker, or `terminal` when no endpoint is mounted under that name. One
 * discriminant, `reason`, across both.
 */
export type TerminalAnswerError = AnswerError | { readonly reason: 'terminal' }

/**
 * The multi-endpoint terminal MANAGER — a registry of named {@link PromptInterface} brokers, one
 * per endpoint, so several parties (agents, tools, humans) can ask forms of each other BY NAME,
 * attributed with a `from` → `to` edge on every parked record.
 *
 * @remarks
 * - **Accessors.** `terminal(name)` looks up one endpoint's broker; `terminals()` lists every
 *   mounted endpoint name.
 * - **`add`** mints, or returns, the broker for `name`. Idempotent; it never clobbers a live
 *   endpoint.
 * - **`ask`** is the attributed convenience: it parks `form` from `from` to `to` and resolves with
 *   the settled values. It never mounts `to` — an unmounted target rejects with a
 *   {@link import('./errors.js').TerminalError} coded `TARGET`, so `add` the endpoint first.
 * - **`pending()`** lists every endpoint's parked records; `pending(to)` scopes to one endpoint.
 * - **`answer`** routes to the named endpoint's broker.
 * - **`open`** restores, or returns the live, broker for `name` from the `store`.
 * - **`save`** persists an endpoint's config snapshot; false when there is no store, or `name` is
 *   unknown.
 * - **Batch `remove`.** The array overload is declared FIRST: `remove(names)` removes every listed
 *   endpoint and reports true only when all of them were mounted; `remove(name)` removes one;
 *   `remove()` removes every endpoint without destroying the manager.
 * - **`destroy`** tears down every broker, then the manager's own emitter.
 */
export interface TerminalManagerInterface {
	readonly emitter: EmitterInterface<TerminalManagerEventMap>
	readonly count: number
	terminal(name: string): PromptInterface | undefined
	terminals(): readonly string[]
	add(name: string, options?: PromptOptions): PromptInterface
	ask(from: string, to: string, form: FormInterface): Promise<FormValues>
	pending(): readonly PendingForm[]
	pending(to: string): readonly PendingForm[]
	answer(to: string, id: string, values: FormValues): Result<FormValues, TerminalAnswerError>
	open(name: string): Promise<PromptInterface | undefined>
	save(name: string): Promise<boolean>
	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(): void
	destroy(): void
}

// === Transport-neutral wire seam

/**
 * One SSE-shaped wire frame — the `event` name, its already-stringified `data` payload, and an
 * optional `id`. The transport-neutral shape {@link import('./helpers.js').serializePending},
 * {@link import('./helpers.js').serializeExpire}, and
 * {@link import('./helpers.js').serializeShutdown} build, with no `http` dependency.
 */
export interface WireEvent {
	readonly event: string
	readonly data: string
	readonly id?: string
}

// === Terminal store

/**
 * One endpoint's persisted CONFIG snapshot — `id` is the endpoint name and `timeout` its configured
 * default. Parked forms are process-bound and are never resurrected, so `open` always restores an
 * EMPTY broker.
 */
export interface TerminalSnapshot {
	readonly id: string
	readonly timeout?: number
}

/**
 * One opaque persisted row — the shape a `TableInterface<TerminalSnapshotRow>`-backed store reads
 * and writes. `snapshot` is narrowed with {@link import('./validators.js').isTerminalSnapshot} on
 * read.
 */
export interface TerminalSnapshotRow {
	readonly id: string
	readonly snapshot: unknown
}

/**
 * The point-access persistence seam for a {@link TerminalManagerInterface}'s endpoint configs.
 * Every primitive is async; deleting an absent id is a no-op.
 */
export interface TerminalStoreInterface {
	get(id: string): Promise<TerminalSnapshot | undefined>
	set(snapshot: TerminalSnapshot): Promise<void>
	delete(id: string): Promise<void>
}
