# Terminal

> The terminal side of a form: a key decoder, a presentation theme, the pure per-field reducers,
> the headless broker that parks a live form until somebody elsewhere answers it, the SSE bridge
> that carries a parked form to a machine with a keyboard, and the manager that routes parked
> forms between named endpoints.

`@orkestrel/form` owns the document — the schema, the controls, the rules, the values, and the
settle-once `answer` promise — and this package declares none of it a second time. One contract
carries the rest: [`src/core`](../src/core) declares `TerminalInterface`, whose `ask(form)` returns
the settled `FormValues`, and the local TTY, the headless broker, and the SSE bridge each reach a
person over it. The server `Terminal` ([`src/server`](../src/server)) implements that contract
against a real TTY — raw-mode stdin, live in-place re-render, a `node:readline` fallback when
piped — and is the only impure part of the stack. `PromptFormInterface` and its per-control prompt
methods are gone: a form is one question however many fields it holds, so the contract needs `ask`
alone and this package holds no second form vocabulary.

## The blank line binds as absence

A bare return no longer answers `''`. It binds `undefined`.

```ts
import { createForm } from '@orkestrel/form'
import { createTerminal } from '@orkestrel/terminal/server'

const form = createForm({
	fields: [{ control: 'text', name: 'name', label: 'Name', rule: { required: true } }],
})
const terminal = createTerminal()
const values = await terminal.ask(form)
// Bare return at `name`: the field binds as absence, `required` refuses it, the failure prints,
// and the walk asks again. It never resolves `{ name: '' }`.
```

The driver fills every answer as `fill(name, matchesAnswer(value) ? value : undefined)` — form's own
projection. The consequences a caller sees directly:

- A bare return on a field with **no default** leaves that key out of the resolved values entirely.
  The key is absent, rather than present holding an empty string.
- A bare return on a field **with a default** binds the declared default, never the value a previous
  pass held, so a rejected answer is never re-offered as the default.
- `required` therefore refuses a blank line. A field with no `required` rule accepts an empty
  answer.

The rest of the vocabulary moved the same way: `numeric` is gone (a numeric-looking string is `text`
plus a `pattern` or `custom` rule; a real number is the `number` control), per-key validator
overrides are gone, a choice's `name` / `description` are now `value` / `label` / `help`, and a
per-choice `checked` is now the checkbox field's `default` list. Rule message copy belongs to form,
reachable through its `FormOptions.messages`.

## Surface

Ask one form over one contract — at this keyboard, parked for somebody else, or carried to a
keyboard elsewhere:

```ts
import { createForm } from '@orkestrel/form'
import { createPrompt, createPromptClient } from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const schema = {
	label: 'Deploy',
	fields: [
		{ control: 'text', name: 'name', label: 'Your name', rule: { required: true } },
		{
			control: 'select',
			name: 'role',
			label: 'Role',
			default: 'admin',
			choices: [
				{ value: 'admin', label: 'Admin' },
				{ value: 'viewer', label: 'Viewer', help: 'read-only' },
			],
		},
	],
}

// 1. The local TTY — answer at this keyboard.
const terminal = createTerminal()
const answers = await terminal.ask(createForm(schema))

// 2. The headless broker — park a live form, answer it from a transport.
const prompt = createPrompt()
const parked = createForm(schema)
const id = prompt.park(parked) // emits `pending`; the caller awaits `parked.answer`
prompt.answer(id, { name: 'Ada', role: 'admin' }) // fills and submits the authoritative form

// 3. The SSE bridge — receive a form parked elsewhere, drive it through a local terminal.
const client = createPromptClient({ url: 'http://host/forms', terminal })
await client.connect()
```

Everything that follows is exported. The core module is `@orkestrel/terminal`; the driver is
`@orkestrel/terminal/server`. No `@orkestrel/form` symbol is re-exported here — import a form
symbol from form.

### The driving contract

What a driver is, and what one step of a field reducer produces ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`.

| API                 | Kind      | Shape                              | Summary                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalInterface` | interface | `{} plus ask`                      | Declares the contract for asking a form of a human at a keyboard — `ask` and nothing beside it, because a form is one question however many fields it holds. The server `Terminal` implements it against a real TTY; a `PromptClientInterface` holds one to answer forms parked elsewhere.              |
| `PromptStatus`      | type      | `'active' \| 'submit' \| 'cancel'` | Names where one field's reducer stands after a key. `active`: keep asking, because the key was consumed or the answer was refused. `submit`: the field resolved with its `value`. `cancel`: the user aborted with ctrl-c. Names its axis, never `kind`.                                                 |
| `PromptStep`        | interface | `{ state, view, status, value? }`  | Represents the result of one reducer step — the next `state`, the rendered `view`, the `status`, and, on `submit` alone, the candidate `value`. The whole contract between a pure reducer and the impure driver: the driver applies the next `state`, writes the `view`, and reads `value` on `submit`. |

### Key decoding

The TTY-agnostic decoder every driver reads keystrokes through ([`src/core`](../src/core)). Pure and
total: no `node:*`, no I/O, and no input throws.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to.

| API           | Kind      | Shape                                                   | Summary                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyEvent`    | interface | `{ name?, sequence, ctrl, meta, shift }`                | Represents one decoded keypress — the TTY-agnostic representation of a single key, the output of `parseKey`. A driver reads `name` and the modifier flags to decide its transition; `sequence` is preserved so a printable character round-trips and an unknown escape is never lost.                                                                                            |
| `parseKey`    | function  | `(input: string \| Uint8Array) => KeyEvent`             | Decodes one keypress's bytes into a `KeyEvent` — total, never throws. A `Uint8Array` is read as UTF-8; the resulting string is matched against the known control bytes and the CRLF pair (`CONTROL_NAMES`) and escape sequences (`SEQUENCE_NAMES`), falling back to a single printable character. An unrecognized sequence carries no `name`, with the raw `sequence` preserved. |
| `isPrintable` | function  | `(character: string) => boolean`                        | Checks whether a single character is printable — the fallback test `parseKey` applies after the control bytes and the escape sequences, so the C0 controls and DEL are excluded.                                                                                                                                                                                                 |
| `editLine`    | function  | `(value: string, key: KeyEvent) => string \| undefined` | Applies a single line-editing `KeyEvent` to a text buffer — the editing shared by input, password, and editor. A printable key appends its character; `backspace` drops the last character; `space` appends a space; ctrl-u clears the line; a key that edits nothing returns `undefined`.                                                                                       |

### Presentation

A theme is data — a glyph per icon slot and a console `Style` per semantic role — plus the shared
line shapes every view is assembled from ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to.

| API                  | Kind      | Shape                                                                                                                                      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptIcon`         | type      | `'question' \| 'pointer' \| 'dot' \| 'selected' \| 'checked' \| 'unchecked' \| 'success' \| 'error'`                                       | Names one glyph slot a rendered field draws — the icon axis of a `PromptTheme`. A named value set, not a toggle, so it stays a union.                                                                                                                                                                                                                                                                                                    |
| `PromptRole`         | type      | `'question' \| 'pointer' \| 'message' \| 'content' \| 'success' \| 'error' \| 'selected' \| 'focus' \| 'hint' \| 'muted' \| 'description'` | Names one styling slot a rendered field paints through — the semantic axis of a `PromptTheme`. A role says what a fragment means; the theme decides what that meaning looks like, so a consumer re-maps styled output by naming roles rather than reimplementing a renderer.                                                                                                                                                             |
| `PromptTheme`        | interface | `{ icons, roles }`                                                                                                                         | Represents a resolved presentation — the glyph for every `PromptIcon` and the console `Style` for every `PromptRole`. Plain JSON data with no functions, so it crosses the wire with the form it decorates. Built by `createPromptTheme`.                                                                                                                                                                                                |
| `PromptThemeOptions` | interface | `{ icons?, roles? }`                                                                                                                       | Represents the partial `PromptTheme` an option bag carries — every icon and every role is optional, and `createPromptTheme` merges what is supplied over `DEFAULT_PROMPT_THEME` leaf by leaf. Supplying one icon or one role leaves every other slot at its default.                                                                                                                                                                     |
| `createPromptTheme`  | function  | `(options?: PromptThemeOptions) => PromptTheme`                                                                                            | Builds a complete `PromptTheme` by merging a partial one over `DEFAULT_PROMPT_THEME`, leaf by leaf — each supplied icon replaces that glyph, each supplied role replaces that `Style`, and everything else keeps its default. Each supplied style is snapshotted through the console module's own `freezeStyle`, so the result is deeply frozen and a caller mutating its own attribute list afterwards cannot reach into a built theme. |
| `renderPromptHeader` | function  | `(styler: StylerInterface, theme: PromptTheme, message: string) => string`                                                                 | Renders the styled question header (`? message`) — the leading line every active prompt view shares, themed by the `question` + `message` roles.                                                                                                                                                                                                                                                                                         |
| `renderHintedHeader` | function  | `(styler: StylerInterface, theme: PromptTheme, message: string, hint?: string) => string`                                                  | Renders a question header followed by a key hint painted with the `hint` role, or the header alone when no hint is supplied.                                                                                                                                                                                                                                                                                                             |
| `renderSubmitHeader` | function  | `(styler: StylerInterface, theme: PromptTheme, message: string) => string`                                                                 | Renders the styled submit line (`✔ message`) — the committed header an interactive prompt shows after it resolves, themed by the `success` + `message` roles.                                                                                                                                                                                                                                                                            |
| `renderErrorLine`    | function  | `(styler: StylerInterface, theme: PromptTheme, message: string) => string`                                                                 | Renders the styled failure line (`✖ message`) a form driver writes for each refused field before it asks that field again.                                                                                                                                                                                                                                                                                                               |

### The field reducers

The pure `(state, key) → PromptStep` machines the driver feeds decoded keys into
([`src/core`](../src/core)). Each is total and copy-on-write, and each produces a candidate value
only: the form validates, the form settles, and none of this code does either.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to.

| API                   | Kind      | Shape                                                                                           | Summary                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputState`          | interface | `{ message, default, styler, theme, value }`                                                    | Represents the immutable state a text field's reducer carries — built by `createInputState`, rendered by `renderInputView`, and advanced by `reduceInput`.                                                                                                                                                                                                                                  |
| `createInputState`    | function  | `(field: TextField, styler?: StylerInterface, theme?: PromptThemeOptions) => InputState`        | Builds the initial text-field reducer state — the sanitized label, the declared default, the styler, and the resolved theme.                                                                                                                                                                                                                                                                |
| `renderInputView`     | function  | `(state: InputState) => string`                                                                 | Renders a text-field reducer state as a styled view — the header, the pointer, and the typed value, or the default shown as a hint while nothing is typed.                                                                                                                                                                                                                                  |
| `reduceInput`         | function  | `(state: InputState, key: KeyEvent) => PromptStep<string, InputState>`                          | Advances an input prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<string>` reducer. Printable characters extend the value; backspace shrinks it; ctrl-u clears it; ctrl-c cancels; return produces the candidate value, with an empty line falling back to the default.                                                                                                      |
| `PasswordState`       | interface | `{ message, mask, styler, theme, value }`                                                       | Represents the immutable state a password field's reducer carries — the text state with the mask glyph in place of a default, because a secret is never seeded from the schema.                                                                                                                                                                                                             |
| `createPasswordState` | function  | `(field: PasswordField, styler?: StylerInterface, theme?: PromptThemeOptions) => PasswordState` | Builds the initial password-field reducer state — the text-field state, plus the mask glyph each typed character renders as.                                                                                                                                                                                                                                                                |
| `renderPasswordView`  | function  | `(state: PasswordState) => string`                                                              | Renders a password-field reducer state as a styled view, with the value replaced by the mask repeated so the secret is never echoed.                                                                                                                                                                                                                                                        |
| `reducePassword`      | function  | `(state: PasswordState, key: KeyEvent) => PromptStep<string, PasswordState>`                    | Advances a password prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<string>` reducer. Identical line-editing to `reduceInput` (printable extends, backspace shrinks, ctrl-u clears, ctrl-c cancels) but the view masks the value. Return produces the candidate value.                                                                                                       |
| `ConfirmState`        | interface | `{ message, default, styler, theme }`                                                           | Represents the immutable state a confirm field's reducer carries. It holds no typed value, because the answer is the key itself.                                                                                                                                                                                                                                                            |
| `createConfirmState`  | function  | `(field: ConfirmField, styler?: StylerInterface, theme?: PromptThemeOptions) => ConfirmState`   | Builds the initial confirm-field reducer state — the sanitized label and the declared default answer.                                                                                                                                                                                                                                                                                       |
| `renderConfirmView`   | function  | `(state: ConfirmState) => string`                                                               | Renders a confirm-field reducer state as a styled view — the header and the yes/no group, with the default letter capitalized and painted by the `selected` role.                                                                                                                                                                                                                           |
| `reduceConfirm`       | function  | `(state: ConfirmState, key: KeyEvent) => PromptStep<boolean, ConfirmState>`                     | Advances a confirm prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<boolean>` reducer. `y` / `Y` submits `true`, `n` / `N` submits `false`, return on an empty line submits the `default`, ctrl-c cancels; any other key is ignored (stays active).                                                                                                                           |
| `SelectState`         | interface | `{ message, choices, styler, theme, focused }`                                                  | Represents the immutable state a select field's reducer carries — the choices the list offers and the index the cursor sits on.                                                                                                                                                                                                                                                             |
| `createSelectState`   | function  | `(field: SelectField, styler?: StylerInterface, theme?: PromptThemeOptions) => SelectState`     | Builds the initial select-field reducer state — the offered choices, with the focus pre-placed on the declared default.                                                                                                                                                                                                                                                                     |
| `renderSelectView`    | function  | `(state: SelectState) => string`                                                                | Renders a select-field reducer state as a multi-line styled view — one row per choice, with the focused row marked and its help shown.                                                                                                                                                                                                                                                      |
| `reduceSelect`        | function  | `(state: SelectState, key: KeyEvent) => PromptStep<string, SelectState>`                        | Advances a select prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<string>` reducer. `up` / `down` (and `k` / `j`) move the focus, wrapping at the ends; return submits the focused choice's `value`; ctrl-c cancels. An empty choice list can never submit (a higher layer guards against it); any other key is ignored.                                                     |
| `CheckboxState`       | interface | `{ message, choices, styler, theme, focused, checked }`                                         | Represents the immutable state a checkbox field's reducer carries — the select state plus the ticked set.                                                                                                                                                                                                                                                                                   |
| `createCheckboxState` | function  | `(field: CheckboxField, styler?: StylerInterface, theme?: PromptThemeOptions) => CheckboxState` | Builds the initial checkbox-field reducer state — the offered choices, with every value in the field's `default` list pre-checked.                                                                                                                                                                                                                                                          |
| `renderCheckboxView`  | function  | `(state: CheckboxState) => string`                                                              | Renders a checkbox-field reducer state as a multi-line styled view — one box per choice, and the selected count beneath them.                                                                                                                                                                                                                                                               |
| `reduceCheckbox`      | function  | `(state: CheckboxState, key: KeyEvent) => PromptStep<readonly string[], CheckboxState>`         | Advances a checkbox prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<readonly string[]>` reducer. `up` / `down` (and `k` / `j`) move the focus (wrapping); `space` toggles the focused index in the checked set; return submits the checked values in choice order; ctrl-c cancels. The form applies selection-count rules.                                                   |
| `toggleIndex`         | function  | `(indices: readonly number[], index: number) => readonly number[]`                              | Toggles `index` in a readonly index list — copy-on-write, returning the new sorted-by-insertion list; the primitive `reduceCheckbox` calls.                                                                                                                                                                                                                                                 |
| `EditorState`         | interface | `{ message, default, styler, theme, lines, current }`                                           | Represents the immutable state an editor field's reducer carries — the committed lines and the line still being typed, kept apart so a return commits one without ending the field.                                                                                                                                                                                                         |
| `createEditorState`   | function  | `(field: EditorField, styler?: StylerInterface, theme?: PromptThemeOptions) => EditorState`     | Builds the initial editor-field reducer state — the committed lines empty, and the declared default held for a finish with nothing typed.                                                                                                                                                                                                                                                   |
| `renderEditorView`    | function  | `(state: EditorState) => string`                                                                | Renders an editor-field reducer state as a multi-line styled view — the finish hint, the committed lines, and the line in progress.                                                                                                                                                                                                                                                         |
| `reduceEditor`        | function  | `(state: EditorState, key: KeyEvent) => PromptStep<string, EditorState>`                        | Advances an editor prompt by one `KeyEvent` — the pure `(state, key) → PromptStep<string>` reducer. Printable characters extend the current line; backspace shrinks it; return commits the current line and starts a fresh one; ctrl-d finishes, joining every line and falling back to the default when empty; ctrl-c cancels. The form validates the candidate after the driver fills it. |

### Untrusted display

A schema that arrived over a wire is data from somebody else. These are the projection that makes it
safe to print ([`src/core`](../src/core)).

| API                   | Kind     | Summary                                                                                                                                                                                                                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanitizeDisplayText` | function | Sanitizes text for one single-line display slot. Composes console's ANSI `strip` and C0 `stripControls` passes with removal of tab, line feed, and carriage return.                                                                                                             |
| `sanitizeSchema`      | function | Sanitizes every terminal-readable string in a parsed form schema, keeping every identity and answer string verbatim and dropping field metadata.                                                                                                                                |
| `sanitizeThemeIcons`  | function | Sanitizes every glyph a wire-supplied `PromptThemeOptions` carries for a single-line display slot. Only the icons need it: a role is guard-narrowed to a console `Style`, whose colors and attributes are fixed name sets, so no role can carry a byte a terminal would act on. |

### The headless broker

The park-as-promise arm — no terminal here, so a transport forwards each `pending` record to whoever
can answer, and `answer` drives the parked form to settlement ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                   | Kind      | Shape                                                              | Summary                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptInterface`     | interface | `{ emitter, count } plus park / pending / answer / stop / destroy` | Declares the headless form broker — parks a live form until somebody elsewhere answers it. The headless arm of the local-TTY, headless, and remote trio: there is no terminal here, so a transport forwards each `pending` record to whoever can answer, and `answer` drives the parked form to settlement.                                                      |
| `Prompt`              | class     | `PromptInterface`                                                  | Implements the headless form broker. It parks live forms, exposes their serialized schemas, applies remote answers to the authoritative form, and abandons a parked form on timeout, release, or teardown.                                                                                                                                                       |
| `createPrompt`        | function  | `(options?: PromptOptions) => PromptInterface`                     | Creates the headless `PromptInterface` broker. It parks live forms and applies remote answers to the authoritative instances.                                                                                                                                                                                                                                    |
| `PromptOptions`       | interface | `{ on?, error?, timeout?, timer?, cap? }`                          | Configures `createPrompt` and every `PromptInterface` broker, including one a `TerminalManagerInterface` mounts per endpoint.                                                                                                                                                                                                                                    |
| `ParkRequest`         | interface | `{ from?, to? }`                                                   | Represents the parking envelope — everything the broker needs about a park that the form itself does not say.                                                                                                                                                                                                                                                    |
| `PendingForm`         | interface | `{ id, schema, status, time, from?, to? }`                         | Represents one form parked by the broker — an id-keyed, wire-safe record of a live form awaiting a remote answer. The value a `pending` listener receives and the broker serializes over SSE to a `PromptClientInterface`.                                                                                                                                       |
| `PendingFormStatus`   | type      | `'pending' \| 'answered' \| 'expired'`                             | Names the lifecycle status of a parked `PendingForm` — where the ticket stands, which is not where the form stands. A ticket is `pending` until somebody answers it; the form it carries has its own status, and each is a separate fact about a separate entity.                                                                                                |
| `ParkedForm`          | interface | `{ form, pending, cancel }`                                        | Represents one parked form's runtime state inside the broker — the live form, the wire-safe record the broker exposes, and the cancel for its expiry timer.                                                                                                                                                                                                      |
| `AnswerError`         | type      | `{ reason: 'unknown' } \| { reason: 'rejected', errors }`          | Explains why `PromptInterface.answer` refused — `unknown` for an id no form is parked under, `rejected` for values the authoritative form itself refused, carrying the `FieldError` list it reported. Names its axis with `reason`.                                                                                                                              |
| `PromptEventMap`      | type      | `{ pending, answer, expire }`                                      | Declares the broker's event map — lean, errors `unknown`, no listener-error event.                                                                                                                                                                                                                                                                               |
| `isPendingForm`       | function  | `PendingForm`                                                      | Narrows an unknown wire value to a `PendingForm` envelope — the envelope alone, because the form package's `parseForm` owns the schema payload.                                                                                                                                                                                                                  |
| `isPendingFormStatus` | const     | `PendingFormStatus`                                                | Narrows an unknown value to a `PendingFormStatus`.                                                                                                                                                                                                                                                                                                               |
| `TimerHandler`        | type      | `(callback: () => void, ms: number) => TimerCancelFunction`        | Represents one injected timer — arms a deadline `callback` to fire after `ms`, returning a `TimerCancelFunction` that cancels it. The broker's timeout seam: the default wraps the host `setTimeout` and `clearTimeout`; a test injects a deterministic timer that captures the callback and fires it on demand, with no real time and no global patching.       |
| `TimerCancelFunction` | type      | `() => void`                                                       | Cancels a pending `TimerHandler` deadline — idempotent, safe to call after the timer fired.                                                                                                                                                                                                                                                                      |
| `defaultTimer`        | function  | `(callback: () => void, ms: number) => TimerCancelFunction`        | Implements the default `TimerHandler` — a thin host `setTimeout` / `clearTimeout` wrapper that arms `callback` after `ms` and returns a `TimerCancelFunction`. The deadline seam behind both the `Prompt` broker (its expiry) and the `PromptClient` (its reconnect backoff); a test injects a deterministic timer instead, so neither entity touches real time. |

### The wire seam

The `http`-free frame shape a consumer's own HTTP spine mounts the broker over
([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to.

| API                | Kind      | Shape                              | Summary                                                                                                                                                                                                                                            |
| ------------------ | --------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WireEvent`        | interface | `{ event, data, id? }`             | Represents one SSE-shaped wire frame — the `event` name, its already-stringified `data` payload, and an optional `id`. The transport-neutral shape `serializePending`, `serializeExpire`, and `serializeDestroy` build, with no `http` dependency. |
| `isWireEvent`      | const     | `WireEvent`                        | Narrows an unknown value to a transport-neutral `WireEvent` — the guard a consumer's own transport applies to an inbound frame.                                                                                                                    |
| `serializePending` | function  | `(form: PendingForm) => WireEvent` | Serializes a parked `PendingForm` into a `pending` `WireEvent`, whose frame `id` is the form's own id.                                                                                                                                             |
| `serializeExpire`  | function  | `(id: string) => WireEvent`        | Serializes a parked form's expiry or release into an `expire` `WireEvent`, whose `data` is the JSON `{ id }` payload.                                                                                                                              |
| `serializeDestroy` | function  | `() => WireEvent`                  | Serializes the `destroy` `WireEvent` a broker or manager sends when it is going away, which carries no payload.                                                                                                                                    |

### The SSE bridge

The client-side counterpart to the broker: receive a form parked elsewhere, rebuild it here, drive it
through a local terminal, and POST the answers back ([`src/core`](../src/core)). Universal — `fetch`
and SSE are web standards.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                     | Kind      | Shape                                                                        | Summary                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptClientInterface` | interface | `{ emitter, url, connected } plus connect / disconnect / destroy`            | Declares the SSE form bridge — the client-side counterpart to `PromptInterface`. It receives serialized `PendingForm` records from a remote broker, rebuilds each schema locally, drives it through a `TerminalInterface`, and POSTs the answer back, so a human at this machine answers forms a broker parked elsewhere. |
| `PromptClient`          | class     | `PromptClientInterface`                                                      | Implements the SSE form bridge. It ingests serialized forms from a remote broker without waiting on a render, drives one form at a time through a local terminal, posts each answer back, and asks again when the authoritative form refuses one.                                                                         |
| `createPromptClient`    | function  | `(options: PromptClientOptions) => PromptClientInterface`                    | Creates the SSE prompt `PromptClientInterface` bridge — it connects to a remote broker's SSE endpoint, dispatches each received form to a local `TerminalInterface`, and POSTs the answer back. Universal — `fetch` and SSE are web standards.                                                                            |
| `PromptClientOptions`   | interface | `{ url, terminal, token?, reconnect?, delay?, on?, error?, fetch?, timer? }` | Configures `createPromptClient` and the `PromptClientInterface`.                                                                                                                                                                                                                                                          |
| `PromptClientEventMap`  | type      | `{ connect, disconnect, expire, error }`                                     | Declares the client's event map — lean, errors `unknown`, no listener-error event.                                                                                                                                                                                                                                        |
| `FetchHandler`          | type      | `(input: string, init?: FetchInit) => Promise<Response>`                     | Represents a minimal `fetch` — the subset of the global `fetch` a `PromptClientInterface` uses: open the SSE stream, POST an answer. Injected so a test drives the client with a scripted `Response` instead of a real network.                                                                                           |
| `FetchInit`             | interface | `{ method?, headers?, body?, signal? }`                                      | Represents the request init a `PromptClientInterface` passes to its `FetchHandler` — the `RequestInit` fields it actually sets.                                                                                                                                                                                           |
| `globalFetch`           | function  | `(input: string, init?: FetchInit) => Promise<Response>`                     | Implements the default `FetchHandler` — the global `fetch`, adapted to the minimal injected shape the `PromptClient` uses.                                                                                                                                                                                                |
| `isAbortError`          | function  | `(error: unknown) => boolean`                                                | Checks whether a caught value is an `AbortError` — the `PromptClient` distinguishes a deliberate `disconnect` / teardown (an aborted `fetch`) from a real fault, so it exits its connect loop quietly instead of emitting `error` / reconnecting.                                                                         |
| `isInsecureRemote`      | function  | `(url: string) => boolean`                                                   | Checks whether `url` is an insecure remote endpoint — a plain `http://` URL whose host is not a loopback address. Pure string parsing (no `URL` global), so it stays total on malformed input; the `PromptClient` warns once when a `token` would cross such an endpoint in cleartext.                                    |

### The terminal manager

A named registry of brokers, so several parties can ask forms of each other by name with a `from` →
`to` edge on every parked record ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                        | Kind      | Shape                                                                                                          | Summary                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalManagerInterface` | interface | `{ emitter, count } plus terminal / terminals / add / ask / pending / answer / open / save / remove / destroy` | Declares a registry of named `PromptInterface` brokers, one per endpoint, so several parties (agents, tools, humans) can ask forms of each other by name, attributed with a `from` → `to` edge on every parked record.                                                                                                                                               |
| `TerminalManager`          | class     | `TerminalManagerInterface`                                                                                     | Registers named `PromptInterface` brokers, one per endpoint, so several parties can `ask` forms of each other by name with a `from` → `to` attribution edge on every parked form, and refuses `DEADLOCK` on a transitive cycle across every in-flight ask.                                                                                                           |
| `createTerminalManager`    | function  | `(options?: TerminalManagerOptions) => TerminalManagerInterface`                                               | Creates the multi-endpoint `TerminalManager` — a named registry of `PromptInterface` brokers so several parties can `ask` forms of each other by name, with a transitive cycle check that refuses `DEADLOCK` across every in-flight ask.                                                                                                                             |
| `TerminalManagerOptions`   | interface | `{ store?, timeout?, timer?, cap?, on?, error? }`                                                              | Configures `createTerminalManager` and the `TerminalManagerInterface`.                                                                                                                                                                                                                                                                                               |
| `TerminalManagerEventMap`  | type      | `{ pending, answer, expire }`                                                                                  | Declares the manager's event map — the name-attributed re-emission of every mounted broker's events, so a caller subscribes once for every endpoint instead of once per broker.                                                                                                                                                                                      |
| `TerminalAnswerError`      | type      | `AnswerError \| { reason: 'target' }`                                                                          | Explains why a `TerminalManagerInterface.answer` call refused — an `AnswerError` from the endpoint's own broker, or `target` when no endpoint is mounted under that name. That is the same condition `TerminalErrorCode`'s `TARGET` names for `TerminalManagerInterface.ask`, so one word carries it on both doors. One discriminant, `reason`, across every member. |

### The terminal store

The point-access persistence seam for a manager's endpoint config — config only, because a parked
form is process-bound and is never resurrected ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                           | Kind      | Shape                                                  | Summary                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalStoreInterface`      | interface | `{} plus get / set / delete`                           | Declares the point-access persistence seam for a `TerminalManagerInterface`'s endpoint configs. Every primitive is async; deleting an absent id is a no-op.                                                                                                                                                                                                               |
| `TerminalSnapshot`            | interface | `{ id, timeout? }`                                     | Represents one endpoint's persisted config snapshot — `id` is the endpoint name and `timeout` its configured default. Parked forms are process-bound and are never resurrected, so `open` always restores an empty broker.                                                                                                                                                |
| `TerminalSnapshotRow`         | interface | `{ id, snapshot }`                                     | Represents one opaque persisted row — the shape a table-backed store reads and writes. The store is a `TableInterface<TerminalSnapshotRow>`, and `snapshot` is narrowed with `isTerminalSnapshot` on read.                                                                                                                                                                |
| `isTerminalSnapshot`          | const     | `TerminalSnapshot`                                     | Narrows an unknown value to a `TerminalSnapshot` — a non-empty `id` and an optional numeric `timeout`, the read boundary a store applies to an untrusted persisted row.                                                                                                                                                                                                   |
| `MemoryTerminalStore`         | class     | `TerminalStoreInterface`                               | Implements the in-memory `TerminalStoreInterface` — a process-lifetime `Map` of `TerminalSnapshot` records keyed by endpoint id, the default store `createMemoryTerminalStore` builds and the exact twin of `DatabaseTerminalStore`. It carries no idle expiry and no eviction.                                                                                           |
| `DatabaseTerminalStore`       | class     | `TerminalStoreInterface`                               | Implements a `TerminalStoreInterface` backed by one table of the `databases` layer — an endpoint's durable config state is a row, so persistence reduces to keyed point-access (`get` / `set` / `delete`) over a `TableInterface`, the driver-pluggable twin of the plain-`Map` `MemoryTerminalStore`. A stored `snapshot` is narrowed with `isTerminalSnapshot` on read. |
| `createMemoryTerminalStore`   | function  | `() => TerminalStoreInterface`                         | Creates the in-memory `TerminalStoreInterface` — a process-lifetime `Map` of endpoint config snapshots, the default store backing a `TerminalManagerInterface`'s `open` / `save`.                                                                                                                                                                                         |
| `createDatabaseTerminalStore` | function  | `(driver?: DriverInterface) => TerminalStoreInterface` | Creates a `TerminalStoreInterface` backed by one table of the `databases` layer — the driver-pluggable twin of `createMemoryTerminalStore`, storing each endpoint's config snapshot as one opaque JSON column. The default driver is an in-memory `@orkestrel/database` driver.                                                                                           |

### The terminal error

Terminal's own failure type. A refusal that belongs to the form — a malformed schema, a value a
control cannot hold, a write to a settled form — arrives as form's own `FormError` and is never
re-coded ([`src/core`](../src/core)).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                 | Kind     | Shape                                                                                                          | Summary                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalErrorCode` | type     | `'EXPIRE' \| 'CANCEL' \| 'DRIVER' \| 'DEADLOCK' \| 'TARGET' \| 'LIMIT' \| 'DESTROYED'`                         | Names the machine-readable condition carried by a `TerminalError` — the axis a `catch` branches on. Names its axis (the failure condition), never `kind`.                                                                                                                                                           |
| `TerminalError`     | class    | `new (code: TerminalErrorCode, message: string, context?: Readonly<Record<string, unknown>>) => TerminalError` | Represents the error the terminal surfaces for its own refusals: parking on a destroyed or full broker, an unusable driver stream, a manager routing fault, or a ctrl-c cancellation. A parked form's own lifecycle failures reject through the form's `answer` with the form package's error, never with this one. |
| `isTerminalError`   | function | `TerminalError`                                                                                                | Narrows an unknown caught value to a `TerminalError`, so a caller can branch on its `code`.                                                                                                                                                                                                                         |

### The core constants

The decode tables, the default mask, the theme defaults, and the broker and SSE defaults
([`src/core`](../src/core)). UPPER_SNAKE, `Object.freeze`d data; every control byte is built through
`String.fromCharCode` or read from console's own `ESC` and `CSI`, so no raw control character
appears in source.

A `Shape` cell holds the constant's declared type.

| API                          | Kind  | Shape                                                                                                                                                                      | Summary                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETURN`                     | const | `string`                                                                                                                                                                   | Names the carriage return byte (`\r`, U+000D) — Enter on most terminals.                                                                                                                                                                                                                                                                                                    |
| `NEWLINE`                    | const | `string`                                                                                                                                                                   | Names the line feed byte (`\n`, U+000A) — Enter on some terminals / pasted input.                                                                                                                                                                                                                                                                                           |
| `TAB`                        | const | `string`                                                                                                                                                                   | Names the tab byte (`\t`, U+0009).                                                                                                                                                                                                                                                                                                                                          |
| `BACKSPACE`                  | const | `string`                                                                                                                                                                   | Names the backspace byte (BS, U+0008) — Ctrl+H / some terminals' Backspace.                                                                                                                                                                                                                                                                                                 |
| `DELETE`                     | const | `string`                                                                                                                                                                   | Names the delete byte (DEL, U+007F) — the usual Backspace byte on a Unix TTY.                                                                                                                                                                                                                                                                                               |
| `SPACE`                      | const | `string`                                                                                                                                                                   | Names the space byte (U+0020).                                                                                                                                                                                                                                                                                                                                              |
| `CTRL_C`                     | const | `string`                                                                                                                                                                   | Names the Ctrl+C byte (ETX, U+0003) — interrupt / cancel.                                                                                                                                                                                                                                                                                                                   |
| `CTRL_D`                     | const | `string`                                                                                                                                                                   | Names the Ctrl+D byte (EOT, U+0004) — end-of-transmission / finish (the editor's commit key).                                                                                                                                                                                                                                                                               |
| `CTRL_U`                     | const | `string`                                                                                                                                                                   | Names the Ctrl+U byte (NAK, U+0015) — clear the current line.                                                                                                                                                                                                                                                                                                               |
| `CTRL_A`                     | const | `string`                                                                                                                                                                   | Names the Ctrl+A byte (SOH, U+0001) — move to start of line.                                                                                                                                                                                                                                                                                                                |
| `CTRL_E`                     | const | `string`                                                                                                                                                                   | Names the Ctrl+E byte (ENQ, U+0005) — move to end of line.                                                                                                                                                                                                                                                                                                                  |
| `KEY_SS3`                    | const | `string`                                                                                                                                                                   | Names the Single Shift Three lead (`ESCO`) — the alternate arrow-key prefix some terminals emit (`ESC O A`). Built from the console module's own `ESC`; the navigation keys' CSI lead is that module's `CSI`, which this package reuses rather than redeclaring.                                                                                                            |
| `SEQUENCE_NAMES`             | const | `Readonly<Record<string, string>>`                                                                                                                                         | Holds the exact escape sequence to canonical key name table `parseKey` consults for the navigation and editing keys. Covers the CSI form (`ESC[A`…) and the SS3 form (`ESCOA`…) of the arrows, plus the `home` / `end` / `delete` CSI sequences with their numeric-tilde variants. The source of truth for the multi-byte key decode; frozen.                               |
| `CONTROL_NAMES`              | const | `Readonly<Record<string, { readonly name: string; readonly ctrl: boolean }>>`                                                                                              | Holds the control byte (or CRLF pair) to key descriptor table `parseKey` consults for the one-byte keys and the two-byte CRLF Enter chunk. Each entry carries the canonical `name` and whether it is a `ctrl` combination. The source of truth for that decode; frozen.                                                                                                     |
| `DEFAULT_MASK`               | const | `string`                                                                                                                                                                   | Names the default mask glyph `createPasswordState` uses — `*`.                                                                                                                                                                                                                                                                                                              |
| `PROMPT_ICONS`               | const | `Readonly<{ readonly question: string; readonly pointer: string; readonly dot: string; readonly selected: string; readonly checked: string; readonly unchecked: string }>` | Holds the terminal-owned glyphs `DEFAULT_PROMPT_THEME` assembles its `icons` from, beside the console module's own success and error marks. Read only when the default theme is assembled; a view reads its resolved theme and never this constant. Frozen.                                                                                                                 |
| `PROMPT_ROLES`               | const | `readonly PromptRole[]`                                                                                                                                                    | Holds every `PromptRole`, in one frozen list — the role axis's source of truth. `createPromptTheme` walks it to merge a partial theme, and a consumer building a complete role map reads it rather than retyping every name.                                                                                                                                                |
| `DEFAULT_PROMPT_THEME`       | const | `PromptTheme`                                                                                                                                                              | Holds the `PromptTheme` every prompt renders with unless its options supply another — the glyph set assembled from `PROMPT_ICONS` plus the console `STATUS_ICONS` `success` / `error` marks, and the console `Style` each role is painted with. Deeply frozen through the console module's own `freezeStyle`; the baseline `createPromptTheme` merges a partial theme over. |
| `DEFAULT_PROMPT_TIMEOUT_MS`  | const | `number`                                                                                                                                                                   | Holds how long (ms) the `PromptInterface` broker parks an unanswered form before it expires — 5 minutes.                                                                                                                                                                                                                                                                    |
| `DEFAULT_RECONNECT_DELAY_MS` | const | `number`                                                                                                                                                                   | Holds how long (ms) the `PromptClientInterface` waits before each reconnect attempt — 2 seconds.                                                                                                                                                                                                                                                                            |
| `SSE_EVENTS`                 | const | `Readonly<{ readonly pending: string; readonly expire: string; readonly destroy: string }>`                                                                                | Holds the SSE `event:` names the broker emits and the `PromptClientInterface` dispatches on — `pending`, `expire`, and `destroy`. Frozen; the source of truth for the wire event vocabulary.                                                                                                                                                                                |
| `HEADER_TOKEN`               | const | `string`                                                                                                                                                                   | Names the auth-token request header the `PromptClientInterface` sends when a `token` is configured — `x-orkestrel-token`.                                                                                                                                                                                                                                                   |
| `ACCEPT_EVENT_STREAM`        | const | `string`                                                                                                                                                                   | Names the `Accept` header value that opens the broker's SSE stream — `text/event-stream`.                                                                                                                                                                                                                                                                                   |
| `SSE_BUFFER_LIMIT`           | const | `number`                                                                                                                                                                   | Sets the maximum number of characters the `PromptClientInterface` lets its SSE parser buffer before treating the stream as hostile — 1 MiB, comfortably above any legitimate prompt payload. Passed as the `limit` to `createSSEParser` so an unterminated or oversized `data:` field cannot grow the buffer without bound (a memory-exhaustion guard).                     |

### The server Terminal

The local-TTY arm and the only impure part of the stack ([`src/server`](../src/server)). It reads
raw-mode stdin, drives the core reducers, renders each view in place, and falls back to
`node:readline` when piped. Every form contract is imported from core and none is redeclared here.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                    | Kind      | Shape                                                       | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Terminal`             | class     | `TerminalInterface`                                         | Implements `TerminalInterface` for a human at this machine's keyboard — the interactive form driver, and the only impure part of the terminal stack. `ask` walks one form's fields in schema order, feeds raw-mode stdin bytes through `parseKey` into the matching pure reducer, renders each returned view in place, binds every answer through the form's own `fill`, and re-asks what the form refused. It owns no form logic: the schema, the rules, the values, and the settlement all belong to the form it is given, and this class owns only raw mode, the cursor, and the re-render. |
| `createTerminal`       | function  | `(options?: TerminalOptions) => TerminalInterface`          | Creates the interactive terminal form driver — the local-keyboard arm of the terminal trio, beside the core headless `createPrompt` broker and the SSE `createPromptClient` bridge. Where the broker parks a live form until somebody elsewhere answers it, a `Terminal` answers one here: it walks the form's fields in schema order, drives each control's pure reducer over raw-mode stdin, binds every answer through the form's own `fill`, and submits. It is the only impure part of the terminal stack.                                                                                |
| `TerminalOptions`      | interface | `{ input?, output?, theme? }`                               | Configures `createTerminal` — every member optional, so a bare `createTerminal()` walks a form over the real `process.stdin` / `process.stdout` with the default theme.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `InputStreamInterface` | interface | `{ isTTY? } plus on / off / setRawMode? / resume? / pause?` | Represents the minimal input-stream shape the driver reads — exactly the slice of a Node `tty.ReadStream` / `process.stdin` it touches, and no more. A `TerminalOptions` `input` is narrowed to this through `isInputStream`, never an assertion, so a test drives a whole form with a hand-built fake stream that emits scripted key chunks, never touches the real `process.stdin`, and asserts that raw mode is entered once and always cleaned up.                                                                                                                                         |

### The server helpers

The stream guards, the cursor math behind the in-place re-render, and the per-field line projections
the walk renders with ([`src/server`](../src/server)). All pure, all exported, all unit-tested.

| API                     | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isInputStream`         | function | Checks whether `value` is a usable `InputStreamInterface` — a record with callable `on` / `off` `'data'` subscription methods. A total type guard: it never throws and returns `false` for anything off-shape, so it narrows the one unavoidable input boundary (the real `process.stdin`, or a fake TTY a test injects) to the exact slice the driver reads, never an assertion.                                                                                                                                                          |
| `isReadable`            | function | Checks whether `value` is a Node `NodeJS.ReadableStream` — a total structural guard checking for the callable `read` / `pipe` / `on` that `node:readline`'s `createInterface` requires as its `input`. The non-TTY fallback narrows the resolved input stream through this before handing it to readline, never through an assertion, so a real piped `process.stdin` (or a `PassThrough` a test injects) crosses into the readline boundary honestly. Never throws; returns `false` for a minimal fake that isn't a full readable.        |
| `supportsRawMode`       | function | Checks whether an input stream can be driven in raw mode — it reports `isTTY === true` and exposes a callable `setRawMode`. The `Terminal` probes this to choose its path: true selects the interactive raw-mode fields, with arrow-key navigation and a live re-render; false selects the `node:readline` line-input fallback, because a piped or non-terminal stream cannot enter raw mode. Total — never throws.                                                                                                                        |
| `lineCount`             | function | Counts the terminal lines a rendered prompt `view` occupies — one more than its newline count, so a view with no newline is a single line and a view with N newlines spans N+1 lines. The basis of the in-place re-render: the driver records the line count of the view it wrote so the next redraw knows how far up to move the cursor before overwriting. Total; an empty string is one empty line.                                                                                                                                     |
| `renderCursorUp`        | function | Returns the cursor-up control sequence that moves the cursor up `count` lines (`ESC[{count}A`), or the empty string when `count` is zero or negative, because no movement is needed and `ESC[0A` is a wasted write. The pure step the in-place re-render uses to climb back over the previous view before clearing it. Total.                                                                                                                                                                                                              |
| `redrawPrefix`          | function | Returns the full reposition-and-clear prefix to write before re-rendering a prompt view in place — given the line count of the previous view, it moves the cursor up over those lines, returns it to column 0, and erases everything from there to the end of the screen, so the next view is drawn on a clean region and a taller previous view leaves no orphaned rows. Pure; the driver writes this immediately followed by the new view.                                                                                               |
| `fieldToText`           | function | Projects any field the walk reads as a line of text into the `TextField` the text reducer takes — `text` itself, and the controls a terminal has no widget for: `number`, `date`, `time`, `datetime`, `color`, and one `file` entry. The label carries that control's format cue from `CONTROL_HINTS`, and a declared `default` becomes the line a bare return submits. The projection carries no rule, because the authoritative form still evaluates the answer this line binds; it exists only so one reducer covers every one of them. |
| `valueToText`           | function | Projects one held answer into the text a read-only line shows — a scalar as itself, a boolean as `yes` / `no` (the word the confirm reducer commits), and a list joined by commas. Absence renders as nothing, because a locked field nobody has answered has nothing to show.                                                                                                                                                                                                                                                             |
| `filterEnabled`         | function | Returns the choices a `select` or `checkbox` field actually offers — the form refuses a disabled choice's value at every door, including a fill, so the walk never puts one in front of the cursor. Pair with `filterDisabled` to tell the reader what was withheld.                                                                                                                                                                                                                                                                       |
| `filterDisabled`        | function | Returns the choices a `select` or `checkbox` field shows but refuses — the complement of `filterEnabled`, rendered by `renderUnavailableLine` above the list so a reader sees why a declared choice is missing from it.                                                                                                                                                                                                                                                                                                                    |
| `renderGroupHeader`     | function | Renders the section header the walk writes when it enters a new field group, painted by the `message` role.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `renderLockedLine`      | function | Renders the read-only line a locked field shows — its label, the `LOCKED_MARK`, and the answer the form already holds. The walk writes this instead of a prompt, because the field is still validated and still submitted but must not be edited here.                                                                                                                                                                                                                                                                                     |
| `renderSuggestionLine`  | function | Renders the line listing an open select's offered values above its text prompt — a suggestion list, because an open select admits an answer the list does not offer.                                                                                                                                                                                                                                                                                                                                                                       |
| `renderUnavailableLine` | function | Renders the line naming the choices a field shows but refuses, written above the list the walk drives.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderNumberedList`    | function | Renders the numbered choice list the non-TTY fallback prints — a piped stream cannot navigate with arrow keys, so each offered choice is printed with the number the reader types back. One line per choice, with no trailing newline.                                                                                                                                                                                                                                                                                                     |

### The server constants

The cursor and clear sequences the driver writes, and the fixed copy the walk renders
([`src/server`](../src/server)). Sequences are built from console's own `CSI`, so no raw control
character appears in source.

A `Shape` cell holds the constant's declared type.

| API                      | Kind  | Shape                                             | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSI_UP`                 | const | `string`                                          | Holds the cursor-up sequence template (`ESC[{count}A`) — `renderCursorUp` interpolates the `{count}` placeholder with the number of lines to climb. Kept as a template so the count stays out of the constant.                                                                                                                                                                                                                                                                |
| `CURSOR_HIDE`            | const | `string`                                          | Hides the cursor (`ESC[?25l`) — written before the driver starts redrawing a prompt so the cursor does not flicker across the view during an in-place re-render; paired with `CURSOR_SHOW`.                                                                                                                                                                                                                                                                                   |
| `CURSOR_SHOW`            | const | `string`                                          | Shows the cursor (`ESC[?25h`) — restores the cursor after a prompt resolves / cancels (the `CURSOR_HIDE` pair).                                                                                                                                                                                                                                                                                                                                                               |
| `CLEAR_DOWN`             | const | `string`                                          | Erases from the cursor down to the end of the screen (`ESC[J`) — wipes the whole previous view, which a `select` or `checkbox` can spread over several lines, in one write before the new view is rendered, so a redraw never leaves orphaned rows behind.                                                                                                                                                                                                                    |
| `CONTROL_HINTS`          | const | `Readonly<Partial<Record<FieldControl, string>>>` | Holds the format cue appended to a field's label for each control the walk reads as a line of text — the terminal has no date picker, no color well, and no file chooser, so the accepted shape is stated instead. A control with no entry needs none: `text` and `editor` accept any line, `password` masks one, and `confirm`, `select`, and `checkbox` are answered by key rather than by format. The form's own rules still decide whether the typed value is acceptable. |
| `FILE_HINT`              | const | `string`                                          | Holds the instruction a `file` field with `multiple` shows before its entries — one path per line, and a blank line ends the list.                                                                                                                                                                                                                                                                                                                                            |
| `SUGGESTION_LEAD`        | const | `string`                                          | Holds the lead on the line listing an open `select`'s offered values, which a typed answer can ignore.                                                                                                                                                                                                                                                                                                                                                                        |
| `UNAVAILABLE_LEAD`       | const | `string`                                          | Holds the lead on the line listing the choices a `select` or `checkbox` shows but refuses, so a reader sees why one is missing from the list it heads.                                                                                                                                                                                                                                                                                                                        |
| `LOCKED_MARK`            | const | `string`                                          | Holds the mark on a locked field's line — the walk renders its value and moves on, because the form refuses an edit there.                                                                                                                                                                                                                                                                                                                                                    |
| `REFUSAL_MESSAGE`        | const | `string`                                          | States what a field is told when the walk read an answer the control cannot hold — a word typed into a `number`, an off-list value typed into an open `select` whose choice is refused. The value binds as absence and this message is invalidated onto the field, so the walk re-asks it with the reason on screen.                                                                                                                                                          |
| `FALLBACK_SELECT_HINT`   | const | `string`                                          | Holds the numbered-list prompt the non-TTY `Terminal` `select` fallback appends — a piped (non-terminal) stream cannot navigate with arrow keys, so the choices are printed numbered and the user types one number on a single readline line.                                                                                                                                                                                                                                 |
| `FALLBACK_CHECKBOX_HINT` | const | `string`                                          | Holds the comma-separated multi-select hint the non-TTY `checkbox` fallback shows (the user types one or more numbers).                                                                                                                                                                                                                                                                                                                                                       |
| `FALLBACK_EDITOR_HINT`   | const | `string`                                          | Holds the hint the non-TTY `editor` fallback shows — a piped stream has no ctrl-d, so end of input finishes the block.                                                                                                                                                                                                                                                                                                                                                        |
| `FALLBACK_CONFIRM_HINT`  | const | `string`                                          | Holds the hint the non-TTY `confirm` fallback shows — a piped stream sends a whole line, so the answer is typed rather than pressed.                                                                                                                                                                                                                                                                                                                                          |

## Methods

One table per behavioral interface, keyed by its backticked name, listing exactly its
call-signature members. Each interface's readonly data members stay in its Surface row and are not
repeated here. Each implementing class implements its interface exactly, so each table is also
the instance method surface of the class that implements it.

A `*Options` / `*EventMap` / `*State` / `PendingForm` / `ParkedForm` / `KeyEvent` / `PromptStep` /
`WireEvent` / `FetchInit` / `TerminalSnapshot` / `TerminalSnapshotRow` row is data with no behavior,
and `PromptStatus` / `PendingFormStatus` / `TerminalErrorCode` / `AnswerError` /
`TerminalAnswerError` / `TimerHandler` / `TimerCancelFunction` / `FetchHandler` are unions or callable
function types. None carries a method table.

#### `TerminalInterface`

The one driving contract. The server `Terminal` implements it.

| Method | Returns               | Summary                                                                                                      |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ask`  | `Promise<FormValues>` | Walks the given form to settlement and resolves its values. The Contract section names the ctrl-c exception. |

#### `PromptInterface`

The headless broker.

| Method    | Returns                                               | Summary                                                                                                                               |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `park`    | `string`                                              | Parks a live form, mints its id, emits `pending`, and arms the expiry deadline. Returns the id; the caller already holds the promise. |
| `pending` | `readonly PendingForm[]` / `PendingForm \| undefined` | Lists every parked record (`pending()`), or looks one up by id (`pending(id)`).                                                       |
| `answer`  | `Result<FormValues, AnswerError>`                     | Fills and submits the authoritative parked form. Accepted, it settles and the record is dropped; refused, the form stays parked.      |
| `stop`    | `boolean` / `void`                                    | Releases a batch (`stop(ids)`, the array overload declared first), one id, or every parked form. The broker stays usable.             |
| `destroy` | `void`                                                | Tears the broker down — abandons every parked form, cancels every deadline, then destroys the emitter. Idempotent.                    |

#### `PromptClientInterface`

The SSE bridge.

| Method       | Returns         | Summary                                                                                                                                |
| ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `connect`    | `Promise<void>` | Opens the stream and pumps it, queueing each received form for the local terminal; reconnects on the `delay` backoff.                  |
| `disconnect` | `void`          | Stops the current connection and the reconnect loop. An active local render continues, and a later `connect()` can restart the stream. |
| `destroy`    | `void`          | Tears the client down permanently — disconnects, drops the queue, abandons the active local form, and destroys the emitter.            |

#### `TerminalManagerInterface`

The multi-endpoint registry.

| Method      | Returns                                   | Summary                                                                                                                                       |
| ----------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminal`  | `PromptInterface \| undefined`            | Looks up one endpoint's broker by name.                                                                                                       |
| `terminals` | `readonly PromptInterface[]`              | Lists every mounted broker, in insertion order.                                                                                               |
| `add`       | `PromptInterface`                         | Mints, or returns unchanged, the broker for `name`. Idempotent; it never clobbers a live endpoint.                                            |
| `ask`       | `Promise<FormValues>`                     | Parks `form` from `from` to `to` and resolves with the settled values. Rejects `TARGET` or `DEADLOCK`.                                        |
| `pending`   | `readonly PendingForm[]`                  | Lists every endpoint's parked records (`pending()`), or scopes to one endpoint (`pending(to)`).                                               |
| `answer`    | `Result<FormValues, TerminalAnswerError>` | Routes an answer to the named endpoint's broker; `{ reason: 'target' }` when no endpoint carries that name.                                   |
| `open`      | `Promise<PromptInterface \| undefined>`   | Returns the live broker for `name`, or restores an empty one from the `store`. Parked forms are never resurrected.                            |
| `save`      | `Promise<boolean>`                        | Persists an endpoint's config snapshot; false with no store, or an unknown name.                                                              |
| `remove`    | `boolean` / `void`                        | Removes a batch (`remove(names)`, the array overload declared first, true only when every name was mounted), one endpoint, or every endpoint. |
| `destroy`   | `void`                                    | Tears down every broker, then the manager's own emitter.                                                                                      |

#### `TerminalStoreInterface`

The persistence seam `MemoryTerminalStore` and `DatabaseTerminalStore` each implement exactly.

| Method   | Returns                                  | Summary                                                                     |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `get`    | `Promise<TerminalSnapshot \| undefined>` | Resolves the snapshot stored for `id`, or `undefined` when none is.         |
| `set`    | `Promise<void>`                          | Inserts or replaces under the snapshot's own `id`; there is no id argument. |
| `delete` | `Promise<void>`                          | Drops a snapshot by id. An absent id is a no-op, never a throw.             |

#### `InputStreamInterface`

The stream shape the driver reads. Only `on` and `off` are required; a stream missing `setRawMode`
takes the `node:readline` fallback.

| Method       | Returns | Summary                                                                       |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| `on`         | `void`  | Subscribes a `'data'` chunk listener — the irreducible event seam.            |
| `off`        | `void`  | Unsubscribes that listener. The driver always pairs it, so no listener leaks. |
| `setRawMode` | `void`  | Switches the TTY in and out of raw mode. Absent on a piped stream.            |
| `resume`     | `void`  | Starts the flow of `'data'` events.                                           |
| `pause`      | `void`  | Stops it again on cleanup.                                                    |

## Contract

These invariants hold across `src/core`, `src/server`, and this guide.

1. **DOC ↔ SOURCE bijection.** Every row in the `## Surface` tables is a real export of the
   `src/core` and `src/server` trees, and every export appears as a row — exhaustive, both
   directions. Every `## Methods`
   table lists exactly its interface's call-signature members, and each implementing class implements
   every one of them and adds none beyond.
2. **The form is the unit.** `park(form)` takes a live form and returns its id. It wraps no promise,
   because the caller already holds one: the form's own `answer`. The parked form is authoritative —
   `answer(id, values)` fills and submits that instance, so every rule it carries decides, including
   a `custom` validator the wire could not carry. The wire record is `PendingForm`
   `{ id, schema, status, time, from?, to? }`; `form`, `message`, and `options` are gone, and
   `schema` is form's own `serializeForm` projection, which drops every `custom` validator on the way
   out.
3. **Absence is `undefined`.** The driver binds every answer as
   `fill(name, matchesAnswer(value) ? value : undefined)`, so a blank line is absence and `required`
   refuses it. A field with no default and a bare return leaves its key out of the resolved values
   entirely. A field with a default binds the declared default, never a value a previous pass held.
   The `''` sentinel is gone. The blank-line-binds-absence rule is per-control: an empty checkbox
   binds `[]`, which `matchesAnswer` counts as an answer, so `required` cannot refuse an unchecked
   checkbox the way it refuses a blank text line.
4. **A refusal is structured, and the client retries it.** `answer` returns
   `Result<FormValues, AnswerError>`. `{ reason: 'unknown' }` means no form is parked under that id,
   or the one that was has already settled. `{ reason: 'rejected', errors }` carries the
   authoritative form's own `FieldError` list, and the parked form stays parked. The client seeds a
   fresh local form with the values it sent, applies each failure through `invalidate`, and asks
   again — until the answer is accepted, the id comes back `unknown`, the form expires, or the client
   is destroyed. That loop is what makes a server-side `custom` rule enforceable, because the rule
   never crossed the wire and the client could not have checked it. There is no retry counter: the
   lifecycle bounds the loop. A retry cannot withdraw an earlier answer: the parked form is
   authoritative and retains every prior fill, so a corrected retry can only add or replace the
   fields the last refusal named. A parked form settled out of band — its form destroyed or
   submitted through some path other than this `answer` call — leaves the broker's own record
   `pending`: the record is marked `answered` or `expired` only inside `#answer` and `#expire`, so a
   later `answer` for that id does not come back `unknown`. It is submitted against the now-settled
   form and comes back `{ reason: 'rejected', errors }` instead.
5. **Ctrl-c is the one exception to "the promise is the form's answer".** `ask` normally resolves or
   rejects with the form's own `answer`, so a caller holding the form can await either. Ctrl-c at the
   driver rejects `ask` with a `TerminalError` coded `CANCEL` and leaves the form `editing`, with its
   own `answer` still pending for whoever owns it. A driver never owns a form's lifetime: to
   interrupt the form, destroy it, and the walk stops on its abandon.
6. **Expiry and release abandon the form.** An unanswered form is destroyed after `timeout` ms
   through the injected timer; `expire` fires and the caller's promise rejects with form's own
   `ABANDONED` error, not a `TerminalError`. `stop(id)`, `stop(ids)`, and `stop()` use that same
   `expired` status and `expire` event while leaving the broker usable. `destroy()` releases every
   still-parked form the same way, then destroys the broker. `park` itself throws `TerminalError` —
   `EXPIRE` when the broker is already destroyed, `LIMIT` when `cap` was already reached — and in
   both cases destroys the form it refused, without minting an id, emitting `pending`, or arming a
   timer.
7. **Display is sanitized; identity and answers are not.** Every string a wire schema renders passes
   through `sanitizeDisplayText` — labels, help, placeholders, masks, choice labels and help, file
   accept entries, and pattern source text — which strips ANSI sequences, every C0 control, DEL, tab,
   line feed, and carriage return. Schema, group, and field names, group references, choice values,
   and every default stays verbatim, because rewriting them would sever the local rendering copy from
   the authoritative form: the client would answer under keys the parked form does not have, and
   every retry would produce the same rejection forever. Field metadata is dropped, since terminal
   neither renders nor interprets it. A preserved identity or answer string that reaches the screen —
   a prefilled default, a locked held value, an open select's suggested values, a group or label
   fallback, an authoritative rejection message — is sanitized at that output boundary only, and the
   submitted value stays byte-for-byte what arrived. The server driver's `#report` sanitizes both
   operands it writes — the field's label (falling back to its raw name) and the failure message —
   so a hostile field name never reaches the screen through a refusal line. A form carrying refusals
   when `ask` is called renders them at walk entry, before any field is filled, so a caller who
   re-asks an already-invalid form sees why before typing anything.
8. **A wire `pattern` never executes locally, and its cost is bounded in length only.** Form
   evaluates a `pattern` rule with a real `RegExp`, at construction and on every fill, so the client
   strips `rule.pattern` from each local rendering form before building it. Every other rule stays.
   The authoritative parked form still holds and runs the original pattern, so a pattern refusal
   comes back as a `FieldError`, is applied through `invalidate`, and re-renders — the rule is
   enforced exactly once, at the broker. The residual is honest: form's `PATTERN_LIMIT` bounds a
   pattern source's length, never its matching time, so a catastrophically backtracking pattern short
   enough to pass that limit costs the machine that runs it. That machine is the broker, which owns
   the schema it parked. A broker that parks a schema it did not author owns that decision.
9. **The reducers are pure, total, and copy-on-write.** Each `reduce*` is a total
   `(state, key) → PromptStep` — it never throws, never mutates the state it is given, and always
   returns a rendered `view` and a `status`. A key it does not consume returns the same state with
   `status: 'active'`. `value` is present only on a `submit` step, and it is a candidate: the form
   validates it after the driver fills it. `parseKey` is equally total — a known control byte or
   escape sequence maps to its canonical name, a printable character names itself, and anything else
   carries no `name` with the raw sequence preserved, so the driver cannot crash on a stray byte.
   `KeyEvent.name` is therefore optional and absence is `undefined`: an undecoded key has no name
   rather than an empty one, and every reducer reads it as a key it does not consume.
10. **Every control reaches a reducer.** `text`, `number`, `date`, `time`, `datetime`, `color`, and
    each `file` entry are read as one line of text through `fieldToText`, which appends that
    control's format cue to the label; `password`, `confirm`, `editor`, `select`, and `checkbox`
    each drive their own reducer. An open select is a suggestion list plus a typed line, because
    `open` means the answer need not come from the list. A disabled choice is named on an
    unavailable line and never offered, since the form refuses its value at every door. A `hidden`
    field and a field in `form.disabled` are skipped; a `locked` field renders read-only
    and is still submitted; entering a group writes its label as a section header. Coercion is
    form's own `parseValue`, and an answer the control cannot hold binds as absence and invalidates
    the field, so it comes back with the reason on screen rather than vanishing.
11. **An unanswerable form is abandoned, not looped.** After the walk the form is submitted. A
    refusal prints every failure, then re-walks only the erroring fields the walk can edit. When
    that set is empty — every failure sits on a hidden, locked, or runtime-disabled field — or the
    input stream has already ended, the form is destroyed and `ask` rejects on its `answer`. Asking
    again could not change the answer, so it does not ask again.
12. **Ingestion never waits on a render.** The client's SSE reader is synchronous: each decoded
    record is narrowed by `isPendingForm`, parsed by form's `parseForm`, sanitized, and queued. One
    form is driven at a time while the stream keeps reading, so an unanswered form never starves the
    connection. An `expire` destroys the active local form or drops the queued entry; a `destroy`
    frame disconnects the client, clears the queue, and interrupts the active render while leaving
    the client reusable; the client's own `destroy()` does the same permanently. An id already in
    flight is ignored, so a reconnect that replays buffered events cannot double-answer.
13. **The manager attributes every ask and refuses a cycle.** `add(name, options?)` mints or reuses
    one broker per endpoint and re-emits its events attributed by name. `ask(from, to, form)`
    requires `to` to be mounted, records the `from` → `to` edge keyed by the parked form's id, and
    parks through `to`'s broker: an unknown `to` rejects `TARGET`, and an edge that would close a
    transitive cycle over the current in-flight edges rejects `DEADLOCK` without parking. The edge
    clears on acceptance, expiry, removal, and teardown — but not on a rejection, because the ask is
    still live. `open` restores an empty broker from the store; `save` persists the endpoint's
    configured timeout.
14. **The wire seam carries no HTTP.** `serializePending`, `serializeExpire`, and
    `serializeDestroy` build a `WireEvent`, so a consumer mounts the broker on their own HTTP spine
    without this package importing `node:http`, and `isWireEvent` narrows an inbound frame. The
    answer POST body is exactly `{ id, values }`.
15. **The core / server split.** Core owns everything universal — the decoder, the reducers and their
    views, the theme, the sanitizer, the broker, the bridge, the manager, and the store — with no
    `node:*`, no TTY, and no I/O. The server module owns only raw mode, the cursor, the re-render,
    and the readline fallback, and imports every contract from core. Every view is painted through
    console's `StylerInterface`, so this package holds no second style vocabulary.

**A view line wider than the terminal leaves residue.** The in-place re-render climbs
`lineCount(view)`, the view's NEWLINE count, while a line the terminal wraps occupies more physical
rows than that. `redrawPrefix` therefore returns to the start of the wrap's last row and erases from
there down, leaving the earlier rows of the previous view on screen above the new one. Keep every
label, choice, help string, and hint inside the narrowest terminal you support, or drive the
non-TTY fallback, which writes each line fresh and never re-renders in place. A resize mid-walk is
the same limit from the other side. Closing it needs the columns fact console's
`StreamTargetInterface` already carries, read from the resolved output stream, and cursor-column
tracking in the redraw, which tracks lines only.

**Fixed, not seams.** A theme moves glyphs and styled fragments. The rest of a view is fixed by
design: the layout (the single spaces between header, pointer, and value; the two-space gap before a
choice's help; the parentheses around the confirm group; the `N selected` summary), the cursor and
clear mechanics, and the fallback's numbered-list format. Build a bespoke view from the exported
reducers and view helpers rather than reading these as extension points.

**Deliberately not here.** The SSE-server end of the bridge: the broker emits `pending` on its
emitter and a consumer mounts it on their own HTTP spine with an answer POST route, and this package
ships the bridge rather than that spine. Cursor movement within a line: the reducers edit at the end
of the buffer, and `ctrl-a` / `ctrl-e` decode but no left / right insertion is modelled.

## Patterns

### Ask one form at this keyboard

This example asks a form through a local terminal.

```ts
import { createForm } from '@orkestrel/form'
import { isTerminalError } from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const terminal = createTerminal() // process.stdin / process.stdout by default
const form = createForm({
	label: 'Sign up',
	fields: [
		{ control: 'text', name: 'name', label: 'Your name', rule: { required: true, minimum: 2 } },
		{ control: 'text', name: 'email', label: 'Email', rule: { required: true, email: true } },
		{ control: 'password', name: 'token', label: 'Token' },
		{ control: 'confirm', name: 'terms', label: 'Accept the terms', rule: { required: true } },
		{
			control: 'select',
			name: 'role',
			label: 'Role',
			choices: [
				{ value: 'admin', label: 'Admin' },
				{ value: 'viewer', label: 'Viewer', help: 'read-only' },
			],
		},
	],
})

try {
	const values = await terminal.ask(form)
	deploy(values)
} catch (error) {
	// Ctrl-c: the walk ended, and the form is still `editing` for whoever owns it.
	if (isTerminalError(error) && error.code === 'CANCEL') form.destroy()
}
```

### Park a form, answer it from elsewhere

This example parks a form and accepts an answer after a refusal.

```ts
import { createForm } from '@orkestrel/form'
import { createPrompt } from '@orkestrel/terminal'

const prompt = createPrompt({ timeout: 60_000 })
prompt.emitter.on('pending', (parked) => send(parked)) // forward the wire record to who can answer
prompt.emitter.on('expire', (id) => log(`form ${id} was abandoned`))

const form = createForm({
	fields: [
		// A `custom` rule never crosses the wire, so only the parked form can enforce it.
		{
			control: 'text',
			name: 'name',
			rule: { required: true, custom: (value) => value !== 'root' || 'root is reserved' },
		},
	],
})
const id = prompt.park(form) // the id; the promise you await is `form.answer`
prompt.pending() // every parked record
prompt.pending(id) // this one, or undefined once it settles

// ...elsewhere, an answer arrives over the transport:
const result = prompt.answer(id, { name: 'root' })
if (!result.success && result.error.reason === 'rejected') {
	result.error.errors // the authoritative form's own FieldError list; the form stays parked
}
prompt.answer(id, { name: 'Ada' }) // { success: true, value: { name: 'Ada' } }
const values = await form.answer // { name: 'Ada' }

prompt.destroy() // abandon every still-parked form, then destroy the emitter
```

### Bridge a parked form to a keyboard elsewhere

This example bridges a parked form to another terminal.

```ts
import {
	createPromptClient,
	defaultTimer,
	globalFetch,
	isAbortError,
	isInsecureRemote,
} from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const client = createPromptClient({
	url: 'http://host/forms',
	terminal: createTerminal(), // the local TerminalInterface each remote form is driven through
	token: process.env.TOKEN,
	on: { connect: () => log('connected'), error: (error) => log(error) },
	fetch: globalFetch, // the default; inject a scripted fetch to drive this with no network
	timer: defaultTimer, // the default; inject a manual timer to drive the reconnect backoff
})

isInsecureRemote('http://host/forms') // true — a non-loopback http endpoint; the client warns once
isInsecureRemote('http://localhost:3000/forms') // false — loopback needs no warning
await client.connect() // streams parked forms in, POSTs { id, values } back, retries a refusal
client.disconnect() // stop streaming and stop reconnecting; a later connect() restarts it
client.destroy() // permanent: drop the queue, abandon the active local form, destroy the emitter

isAbortError(new DOMException('aborted', 'AbortError')) // true — a deliberate disconnect, not a fault
```

### Mount the broker on your own HTTP spine

This example projects broker events onto an application-owned HTTP transport.

```ts
import {
	createPrompt,
	serializeDestroy,
	serializeExpire,
	serializePending,
} from '@orkestrel/terminal'

const prompt = createPrompt()
prompt.emitter.on('pending', (form) => {
	writeSSE(serializePending(form)) // { event: 'pending', data: '{...}', id: form.id }
})
prompt.emitter.on('expire', (id) => writeSSE(serializeExpire(id))) // { event: 'expire', data: '{"id":"..."}' }
onTeardown(() => writeSSE(serializeDestroy())) // { event: 'destroy', data: '' }
```

### Narrow what arrives from the wire

This example narrows a wire payload before using it.

```ts
import {
	isPendingForm,
	isPendingFormStatus,
	isTerminalSnapshot,
	isWireEvent,
} from '@orkestrel/terminal'
import { parseForm } from '@orkestrel/form'

// A relay receives an opaque frame: narrow the envelope, then the payload, then the schema.
const frame: unknown = JSON.parse(received)
if (isWireEvent(frame) && frame.event === 'pending') {
	const payload: unknown = JSON.parse(frame.data)
	if (isPendingForm(payload)) {
		isPendingFormStatus(payload.status) // true — the ticket's own status
		const schema = parseForm(payload.schema) // form owns the payload; the guard owns the envelope
		if (schema !== undefined) render(schema)
	}
}
isPendingForm({ id: '7', schema: 'nope', status: 'pending', time: 0 }) // false — schema must be a record
isTerminalSnapshot({ id: 'agent', timeout: 30_000 }) // true — the store's read boundary
```

### Sanitize a schema you did not author

This example sanitizes an untrusted schema before rendering it.

```ts
import { sanitizeDisplayText, sanitizeSchema, sanitizeThemeIcons } from '@orkestrel/terminal'

sanitizeDisplayText('Q\rOVERWRITE\nNEXT\tX') // 'QOVERWRITENEXTX'

const clean = sanitizeSchema({
	fields: [
		{
			control: 'select',
			name: 'ro\u0000le', // an identity: preserved byte for byte
			label: '\u001b[31mRole', // display: the ANSI run is stripped
			default: 'ad\u0000min', // an answer: preserved byte for byte
			choices: [{ value: 'ad\u0000min', label: 'Ad\u0000min' }], // value preserved, label cleaned
			meta: { anything: true }, // dropped: terminal neither renders nor interprets it
		},
	],
})
clean.fields[0] // name and default unchanged; label 'Role'; choice label 'Admin'; no meta

sanitizeThemeIcons({ icons: { pointer: '=>\u0007' } }) // every supplied glyph loses its control bytes
```

### Drive the field reducers directly

This example drives each field reducer without a terminal.

```ts
import {
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createSelectState,
	editLine,
	isPrintable,
	parseKey,
	reduceCheckbox,
	reduceConfirm,
	reduceEditor,
	reduceInput,
	reducePassword,
	reduceSelect,
	renderCheckboxView,
	renderConfirmView,
	renderEditorView,
	renderInputView,
	renderPasswordView,
	renderSelectView,
	toggleIndex,
} from '@orkestrel/terminal'

// No TTY and no broker: this is what the driver does with each field, one key at a time.
let text = createInputState({ control: 'text', name: 'name', label: 'Name' })
renderInputView(text) // '? Name › ' — the header, the pointer, and the value so far
text = reduceInput(text, parseKey('A')).state
reduceInput(text, parseKey('\r')) // { status: 'submit', value: 'A', ... }

let password = createPasswordState({ control: 'password', name: 'token', label: 'Token' })
password = reducePassword(password, parseKey('s')).state
renderPasswordView(password) // the header and one mask glyph; the real value is never echoed

const confirm = createConfirmState({ control: 'confirm', name: 'ok', label: 'Continue?' })
renderConfirmView(confirm) // '? Continue? (y/N)'
reduceConfirm(confirm, parseKey('y')) // { status: 'submit', value: true, ... }

let select = createSelectState({
	control: 'select',
	name: 'role',
	label: 'Role',
	default: 'admin',
	choices: [
		{ value: 'admin', label: 'Admin' },
		{ value: 'viewer', label: 'Viewer' },
	],
})
select = reduceSelect(select, parseKey('\u001b[B')).state // down, wrapping at the ends
renderSelectView(select) // a multi-line view with the focused row marked

let checkbox = createCheckboxState({
	control: 'checkbox',
	name: 'scopes',
	label: 'Scopes',
	default: ['read'],
	choices: [
		{ value: 'read', label: 'Read' },
		{ value: 'write', label: 'Write' },
	],
})
checkbox = reduceCheckbox(checkbox, parseKey(' ')).state // space toggles the focused box
renderCheckboxView(checkbox) // one box per choice, then the selected count
toggleIndex(checkbox.checked, 1) // the copy-on-write primitive the reducer calls

let editor = createEditorState({ control: 'editor', name: 'notes', label: 'Notes' })
editor = reduceEditor(editor, parseKey('h')).state
renderEditorView(editor) // the finish hint, the committed lines, and the line in progress

// The shared line editing, and the printable test behind it.
editLine('hi', parseKey('!')) // 'hi!'
editLine('hi', parseKey('\u001b[A')) // undefined — a navigation key does not edit the line
isPrintable('a') // true
```

### Re-theme what a walk draws

This example supplies custom presentation roles and icons.

```ts
import {
	createPromptTheme,
	createSelectState,
	DEFAULT_PROMPT_THEME,
	renderErrorLine,
	renderHintedHeader,
	renderPromptHeader,
	renderSelectView,
	renderSubmitHeader,
} from '@orkestrel/terminal'
import { createStyler } from '@orkestrel/console'
import { createTerminal } from '@orkestrel/terminal/server'

// A theme is data: a glyph per icon slot, a console `Style` per semantic role. Every slot you do
// not name keeps its default, and each supplied style is frozen through console's own freezeStyle.
const theme = createPromptTheme({
	icons: { pointer: '=>', selected: '*' },
	roles: {
		message: { foreground: 'magenta', attributes: ['bold'] },
		hint: { attributes: ['italic'] },
	},
})
theme.icons.question // '?' — untouched
DEFAULT_PROMPT_THEME.roles.content // the empty style: unthemed content renders as bare text

// Pass the partial bag to the driver; every view it renders is painted through it.
const terminal = createTerminal({ theme: { icons: { pointer: '=>' } } })

// Or render the shared line shapes yourself. Each state factory takes the styler and the partial
// theme after the field, so a view is themed by what built its state.
const styler = createStyler()
renderPromptHeader(styler, theme, 'Role') // '? Role'
renderHintedHeader(styler, theme, 'Role', 'arrows move') // '? Role arrows move'
renderSubmitHeader(styler, theme, 'Role') // '✔ Role'
renderErrorLine(styler, theme, 'Role: This field is required') // '✖ Role: This field is required'
renderSelectView(
	createSelectState(
		{ control: 'select', name: 'role', choices: [{ value: 'admin', label: 'Admin' }] },
		styler,
		{ icons: { pointer: '=>' } },
	),
) // the '=>' cursor, every other slot at its default
```

### Route forms between named endpoints

This example routes forms through named manager endpoints.

```ts
import { createTerminalManager, isTerminalError } from '@orkestrel/terminal'
import { createForm } from '@orkestrel/form'

const manager = createTerminalManager()
manager.add('agent') // mint, or return unchanged, the 'agent' endpoint's broker
manager.add('user')
manager.terminals() // the 'agent' and 'user' brokers, in insertion order
manager.terminal('agent') // that endpoint's PromptInterface, or undefined

const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
const answers = manager.ask('user', 'agent', form) // parks from 'user' to 'agent'

// While that edge is live, the reverse ask would close a cycle, so it refuses without parking.
try {
	await manager.ask('agent', 'user', createForm({ fields: [{ control: 'text', name: 'x' }] }))
} catch (error) {
	if (isTerminalError(error) && error.code === 'DEADLOCK') log('would deadlock')
}
try {
	await manager.ask('user', 'nobody', createForm({ fields: [{ control: 'text', name: 'x' }] }))
} catch (error) {
	if (isTerminalError(error) && error.code === 'TARGET') log('no endpoint by that name')
}

const [parked] = manager.pending('agent')
manager.answer('agent', parked.id, { name: 'Ada' }) // { success: true, value: { name: 'Ada' } }
await answers // { name: 'Ada' }

await manager.save('agent') // persist the endpoint's configured timeout (needs a store)
await manager.open('agent') // the live broker, or an empty one restored from the store

manager.add('bounded', { cap: 100 }) // refuse a 101st park with LIMIT instead of growing memory
manager.remove(['agent']) // the array overload is declared first; it is true only when every name was mounted
manager.remove() // remove every endpoint; the manager stays usable
manager.destroy() // destroy every broker, then the manager's own emitter
```

**Operations notes.**

- **Never answer or ask synchronously from inside a `pending` listener.** The deadlock guard records
  an ask edge only after the parking call returns, so a synchronous call back into the manager runs
  ahead of that bookkeeping. Hop a microtask or a transport round trip first, which is exactly what a
  real remote answer does.
- **Remove ephemeral endpoints.** The registry never evicts an idle endpoint. An embedder minting a
  broker per short-lived session must `remove(name)` it when the session ends.
- **`TimerHandler` is the scaling lever.** The default arms one host timer per parked form. At high
  volume, inject a handler backed by one shared deadline wheel.
- **Set `cap` where the ask rate is unbounded.** With no cap, the worst-case parked count is bounded
  only by the park rate times the timeout.

### Persist endpoint config

This example persists and restores endpoint configuration.

```ts
import {
	createDatabaseTerminalStore,
	createMemoryTerminalStore,
	createTerminalManager,
} from '@orkestrel/terminal'

const memory = createMemoryTerminalStore()
await memory.set({ id: 'agent', timeout: 30_000 }) // keyed by the snapshot's own id
await memory.get('agent') // { id: 'agent', timeout: 30_000 }
await memory.delete('agent') // an absent id is a no-op

const database = createDatabaseTerminalStore() // an in-memory @orkestrel/database driver by default
await database.set({ id: 'agent', timeout: 30_000 })
await database.get('agent') // narrowed back from the opaque JSON column on read

createTerminalManager({ store: database })
```

### Drive the walk over injected streams

This example drives the terminal through injected streams.

```ts
import {
	createTerminal,
	fieldToText,
	filterDisabled,
	filterEnabled,
	isInputStream,
	isReadable,
	lineCount,
	redrawPrefix,
	renderCursorUp,
	renderGroupHeader,
	renderLockedLine,
	renderNumberedList,
	renderSuggestionLine,
	renderUnavailableLine,
	supportsRawMode,
	valueToText,
} from '@orkestrel/terminal/server'
import { createPromptTheme } from '@orkestrel/terminal'
import { createStyler } from '@orkestrel/console'

// The stream shapes are minimal on purpose, so a test drives a whole walk with no real TTY.
// `listeners` is a real emitter in a real test; the walk subscribes on entry and always pairs the
// `off`, so nothing leaks whichever way a field ends.
const input = {
	on: (event: 'data', listener: (chunk: string | Uint8Array) => void) => listeners.add(listener),
	off: (event: 'data', listener: (chunk: string | Uint8Array) => void) =>
		listeners.delete(listener),
	setRawMode: (mode: boolean) => raw.record(mode),
	resume: () => undefined,
	pause: () => undefined,
	isTTY: true,
}
const output = { write: (text: string) => written.push(text), isTTY: true }
const terminal = createTerminal({ input, output })

isInputStream(input) // true — callable on/off
supportsRawMode(input) // true: a TTY with setRawMode, so the walk runs interactively
isReadable(process.stdin) // true — the node:readline boundary the fallback narrows to

// The cursor math behind the in-place re-render.
lineCount('one\ntwo\nthree') // 3
renderCursorUp(2) // the ESC[2A cursor-up sequence; '' when the count is not positive
redrawPrefix(3) // climb 2 lines, return to column 0, erase to end of screen

// The per-field projections the walk renders with.
fieldToText({ control: 'date', name: 'born', label: 'Birthday' })
// { control: 'text', name: 'born', label: 'Birthday (YYYY-MM-DD)' }
valueToText(true) // 'yes' — the word the confirm reducer commits
valueToText(['read', 'write']) // 'read, write'

// Each line that follows comes back already painted through the theme. The comments show it with the
// styling stripped.
const styler = createStyler()
const theme = createPromptTheme()
const choices = [
	{ value: 'admin', label: 'Admin' },
	{ value: 'root', label: 'Root', disabled: true },
]
filterEnabled(choices) // the offered choices — the form refuses a disabled value at every door
filterDisabled(choices) // the withheld ones, named rather than silently missing
renderGroupHeader(styler, theme, 'Account') // the section header a new group writes
renderLockedLine(styler, theme, 'Code', valueToText('fixed')) // '○ Code (locked) fixed'
renderSuggestionLine(styler, theme, choices) // 'Suggestions: admin, root' — an open select's offered values
renderUnavailableLine(styler, theme, filterDisabled(choices)) // 'Unavailable: Root'
renderNumberedList(styler, theme, filterEnabled(choices)) // '  1) Admin' — the non-TTY fallback's list
```

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection across
  `src/core` and `src/server`, the interface ↔ implementing-class method bijection, that every
  documented name resolves to a real export, and the equality gate: every `Summary` cell against
  its declaration's description paragraph, the titled `Ask one form at this keyboard` fence against
  the `@example` block of that title (pinned so the titled pair cannot be retired silently), and
  the README pitch against this guide's tagline. It also runs the flagship fences and asserts the
  values their comments claim.
- [`tests/integration.test.ts`](../tests/integration.test.ts) — the whole round trip over a real
  loopback socket: a parked form, a real HTTP/SSE fixture forwarding the broker's own wire frames, a
  real client, and a real TTY walk that settles the authoritative form; plus a hostile schema driven
  end to end with no control byte in the rendered output, proven against a failing control.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — `parseKey` totality, the
  reducers over every key path, `editLine`, the theme merge and glyph sanitization, schema
  sanitization with its hostile negative control, the wire serializers, and the host seams.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — the wire guards:
  the ticket status, the pending-form envelope, the wire frame, and the store's read boundary.
- [`tests/src/core/Prompt.test.ts`](../tests/src/core/Prompt.test.ts) — the broker: parking a live
  form with its serialized schema, exact authoritative `FieldError`s on refusal, acceptance settling
  the form, `unknown` for an absent or settled id, expiry and teardown abandoning through the
  injected timer, and the `cap` refusal.
- [`tests/src/core/PromptClient.test.ts`](../tests/src/core/PromptClient.test.ts) — the bridge over a
  scripted `fetch`: parse, sanitize, render, POST `{ id, values }`, the retry with seeded values and
  exact invalidations, expiry and the `destroy` frame interrupting an active render, the in-flight
  dedupe, the token header, and permanent `destroy`.
- [`tests/src/core/TerminalManager.test.ts`](../tests/src/core/TerminalManager.test.ts) — idempotent
  `add`, the attributed ask, `TARGET` and transitive `DEADLOCK`, edge lifetime across rejection,
  acceptance, expiry and removal, durable `open` / `save`, every `remove` scope, and `destroy`.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — each core factory
  returns a working instance of its interface with its seams forwarded.
- [`tests/src/core/stores/MemoryTerminalStore.test.ts`](../tests/src/core/stores/MemoryTerminalStore.test.ts)
  — the shared store case matrix against the memory twin.
- [`tests/src/core/stores/DatabaseTerminalStore.test.ts`](../tests/src/core/stores/DatabaseTerminalStore.test.ts)
  — the same matrix against the one-table twin, plus the read-boundary guard on an off-shape row.
- [`tests/src/server/Terminal.test.ts`](../tests/src/server/Terminal.test.ts) — the walk over a
  scripted TTY: every control settling one form, the blank line binding as absence, a refused
  value re-asked, an open select accepting a value outside its list, hidden / disabled / locked /
  group handling, the unanswerable form abandoned, ctrl-c leaving the form editing, and the shared
  readline fallback; plus the `#report` output-boundary regression — a hostile field name carrying
  NUL/DEL bytes, proven sanitized in the rendered failure line against a raw-write negative control
  that does contain those bytes.
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the stream guards, the
  cursor math, the field projections, and the whole-form line shapes.
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createTerminal`
  returns the one-method whole-form interface over the resolved or injected streams.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules this package is written to.
- [`console.md`](console.md) — the `StylerInterface` every view is painted through, and the `strip` /
  `stripControls` the sanitizer composes.
- [`contract.md`](contract.md) — the `Result` and `Guard` vocabulary the broker's outcome and the
  wire guards are built from.
- [`emitter.md`](emitter.md) — the typed emitter the broker, the client, and the manager each expose.
- [`sse.md`](sse.md) — the parser the client decodes the broker's event stream with.
- [`database.md`](database.md) — the table the database store twin persists a snapshot through.
- [`README.md`](README.md) — the guides index, and where `@orkestrel/form` fits.
