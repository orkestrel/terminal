# Terminal

> The terminal side of a form. `@orkestrel/form` owns the document — the schema, the twelve
> controls, the rules, the values, and the settle-once `answer` promise — and this package declares
> none of it a second time. What terminal owns is everything form has no opinion about: a key
> decoder, a presentation theme, the pure per-field reducers, the headless broker that PARKS a live
> form until somebody elsewhere answers it, the SSE bridge that carries a parked form to a machine
> with a keyboard, and the manager that routes parked forms between named endpoints.
>
> **One contract, three surfaces.** [`src/core`](../src/core) declares one driving contract,
> `TerminalInterface`, with one method: `ask(form)` returns the settled `FormValues`. A form reaches
> a person three ways over it. The server `Terminal` ([`src/server`](../src/server)) IMPLEMENTS the
> contract against a real TTY — raw-mode stdin, live in-place re-render, a `node:readline` fallback
> when piped — and is the only impure part of the stack. The headless `Prompt` broker implements no
> terminal at all: it parks the live form, emits a wire-safe record, and drives that same form to
> settlement when an answer arrives. The `PromptClient` bridge receives a form parked elsewhere,
> rebuilds it locally, and drives it through a local `TerminalInterface`. `PromptFormInterface` and
> its six prompt methods are gone: a form is one question however many fields it holds, so the
> contract needs one method and this package holds no second form vocabulary.

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
// Bare return at `name`: the field binds as ABSENCE, `required` refuses it, the failure prints,
// and the walk asks again. It never resolves `{ name: '' }`.
```

The driver fills every answer as `fill(name, matchesAnswer(value) ? value : undefined)` — form's own
projection. Three consequences a caller sees directly:

- A bare return on a field with **no default** leaves that key out of the resolved values entirely.
  The key is absent, rather than present holding an empty string.
- A bare return on a field **with a default** binds the DECLARED default, never the value a previous
  pass held, so a rejected answer is never re-offered as the default.
- `required` therefore refuses a blank line, which the `''` sentinel silently accepted. A field that
  should accept an empty answer is a field with no `required` rule.

The rest of the vocabulary moved the same way: `numeric` is gone (a numeric-looking string is `text`
plus a `pattern` or `custom` rule; a real number is the `number` control), per-key validator
overrides are gone, a choice's `name` / `description` are now `value` / `label` / `help`, and a
per-choice `checked` is now the checkbox field's `default` list. Rule message copy belongs to form,
reachable through its `FormOptions.messages`.

## Build and pin

**Console.** Every view calls `StylerInterface.render` and `freezeStyle`, which
`@orkestrel/console` ships as of `0.0.7`. This package declares `^0.0.7`; on `0.0.x` that range pins
exactly the carrying release, so an ordinary registry install satisfies it.

**Form is pinned to a committed tarball.** `@orkestrel/form` is not published yet, so
`package.json` declares
`"@orkestrel/form": "file:vendor/orkestrel-form-0.0.1.tgz"` and the tarball is committed under
`vendor/`. The lockfile records that file spec and its integrity hash, so `npm ci` from a fresh
clone reproduces the exact dependency with no registry access.

Two standing conditions follow, and both end at the re-pin:

- **`@orkestrel/terminal` must not be published while the `file:` pin stands.** A published
  package cannot resolve a path inside this repository.
- **`npx scaffold audit` is dark.** It refuses the blueprint before it compares any path:

  ```text
  dependencies: @orkestrel/form declares the range file:vendor/orkestrel-form-0.0.1.tgz, which dependencies does not accept.
  Audit did not compare the target because the blueprint was refused.
  ```

  Drift detection stays off until the range is a registry range again. Read a green audit as
  unavailable here, not as clean.

**The re-pin, in five steps:**

1. Publish `@orkestrel/form@0.0.1` to the registry.
2. Run `npm install --save '@orkestrel/form@^0.0.1'` here. It rewrites the range and re-resolves the
   lockfile against the registry.
3. Delete `vendor/orkestrel-form-0.0.1.tgz`, and confirm the lockfile records a registry resolution
   rather than the file spec.
4. Run the gates, now including `npx scaffold audit`, which stops refusing the blueprint once the
   range is a registry range.
5. Bump `0.0.8` to `0.0.9` and publish `@orkestrel/terminal`.

## Surface

Ask one form three ways over one contract — at this keyboard, parked for somebody else, or carried
to a keyboard elsewhere:

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

// 1. The local TTY — answer at THIS keyboard.
const terminal = createTerminal()
const answers = await terminal.ask(createForm(schema))

// 2. The headless broker — PARK a live form, answer it from a transport.
const prompt = createPrompt()
const parked = createForm(schema)
const id = prompt.park(parked) // emits `pending`; the caller awaits `parked.answer`
prompt.answer(id, { name: 'Ada', role: 'admin' }) // fills and submits the AUTHORITATIVE form

// 3. The SSE bridge — receive a form parked elsewhere, drive it through a local terminal.
const client = createPromptClient({ url: 'http://host/forms', terminal })
await client.connect()
```

Everything below is exported. The core module is `@orkestrel/terminal`; the driver is
`@orkestrel/terminal/server`. No `@orkestrel/form` symbol is re-exported here — import a form
symbol from form.

### The driving contract

What a driver is, and what one step of a field reducer produces ([`src/core`](../src/core)).

| API                 | Kind      | Summary                                                                                                                                    |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TerminalInterface` | interface | The one driving contract — `ask(form)` walks a form to settlement and returns its `FormValues`. Implemented here by the server `Terminal`. |
| `PromptStatus`      | type      | Where one field's reducer stands after a key — `active` / `submit` / `cancel`. Names its axis, never `kind`.                               |
| `PromptStep`        | interface | One reducer step's output — the next `state`, the rendered `view`, the `status`, and, on `submit` only, the candidate `value` (data-only). |

### Key decoding

The TTY-agnostic decoder every driver reads keystrokes through ([`src/core`](../src/core)). Pure and
total: no `node:*`, no I/O, and no input throws.

| API           | Kind      | Summary                                                                                                                                     |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyEvent`    | interface | One decoded keypress — `name` / `sequence` / `ctrl` / `meta` / `shift` (data-only).                                                         |
| `parseKey`    | function  | Decode one keypress's bytes (`string` / `Uint8Array`) into a `KeyEvent` — TOTAL; an unrecognized sequence yields `name: ''`, never a throw. |
| `isPrintable` | function  | Whether a single character is printable — `parseKey`'s character fallback test, excluding the C0 controls and DEL.                          |
| `editLine`    | function  | Apply one line-editing key to a text buffer (the input / password / editor shared editing) — `undefined` when the key does not edit.        |

### Presentation

A theme is DATA — a glyph per icon slot and a console `Style` per semantic role — plus the four
shared line shapes every view is assembled from ([`src/core`](../src/core)).

| API                  | Kind      | Summary                                                                                                                                                     |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptIcon`         | type      | One glyph slot a rendered field draws — `question` / `pointer` / `dot` / `selected` / `checked` / `unchecked` / `success` / `error`.                        |
| `PromptRole`         | type      | One semantic styling slot — `question` / `pointer` / `message` / `content` / `success` / `error` / `selected` / `focus` / `hint` / `muted` / `description`. |
| `PromptTheme`        | interface | A resolved presentation — a glyph for every `PromptIcon` and a console `Style` for every `PromptRole` (data-only, deeply frozen).                           |
| `PromptThemeOptions` | interface | The PARTIAL theme an option bag carries — every icon and role optional, merged leaf by leaf over the default (data-only).                                   |
| `createPromptTheme`  | function  | Merge a partial theme over `DEFAULT_PROMPT_THEME` — supplied leaves replace, the rest keep their default; each style is frozen by console.                  |
| `promptHeader`       | function  | The styled question header (`? label`) every active field view leads with, themed by the `question` + `message` roles.                                      |
| `hintedHeader`       | function  | The question header plus a key hint painted with the `hint` role — the header alone when no hint is supplied.                                               |
| `submitHeader`       | function  | The styled committed header (`✔ label`) a field shows once it has an answer, themed by the `success` + `message` roles.                                     |
| `errorLine`          | function  | The styled failure line (`✖ message`) the driver writes for each refused field before it asks again.                                                        |

### The field reducers

The pure `(state, key) → PromptStep` machines the driver feeds decoded keys into
([`src/core`](../src/core)). Each is total and copy-on-write, and each produces a CANDIDATE value
only: the form validates, the form settles, and none of this code does either.

| API                   | Kind     | Summary                                                                                                                                    |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `createInputState`    | function | Build the initial state for a `TextField` — the sanitized label, the declared default, the styler, and the resolved theme.                 |
| `inputView`           | function | Render a text state — header, pointer, and the typed value (or the default shown as a hint).                                               |
| `inputReduce`         | function | The text reducer — printable extends, backspace shrinks, ctrl-u clears, return submits (an empty line falling back to the default).        |
| `createPasswordState` | function | Build the initial state for a `PasswordField` — like the text state, plus the mask glyph each character renders as.                        |
| `passwordView`        | function | Render a password state — the value replaced by the mask repeated, so the real value is never echoed.                                      |
| `passwordReduce`      | function | The password reducer — identical line editing to `inputReduce`, with a masked view and a masked committed line.                            |
| `createConfirmState`  | function | Build the initial state for a `ConfirmField` — the sanitized label and the declared default answer.                                        |
| `confirmView`         | function | Render a confirm state — the header plus the yes/no group, the DEFAULT letter capitalized and painted by the `selected` role.              |
| `confirmReduce`       | function | The confirm reducer — `y` submits true, `n` submits false, return takes the default, any other key is ignored.                             |
| `createSelectState`   | function | Build the initial state for a `SelectField` — the offered choices with the focus pre-placed on the declared default.                       |
| `selectView`          | function | Render a select state — a MULTI-LINE view, one row per choice, the focused row marked and its help shown.                                  |
| `selectReduce`        | function | The select reducer — up / down (and `k` / `j`) move the focus WRAPPING, return submits the focused choice's `value`.                       |
| `createCheckboxState` | function | Build the initial state for a `CheckboxField` — the choices, with every value in the field's `default` list pre-checked.                   |
| `checkboxView`        | function | Render a checkbox state — one box per choice plus the selected count.                                                                      |
| `checkboxReduce`      | function | The checkbox reducer — space toggles the focused box, return submits the checked values in choice order; the form applies the count rules. |
| `toggleIndex`         | function | Toggle one index in a readonly index list — copy-on-write, the primitive `checkboxReduce` calls.                                           |
| `createEditorState`   | function | Build the initial state for an `EditorField` — committed lines empty, the declared default held for an empty finish.                       |
| `editorView`          | function | Render an editor state — the finish hint, the committed lines, and the line in progress.                                                   |
| `editorReduce`        | function | The editor reducer — return commits a line, ctrl-d finishes (joining the lines, falling back to the default when empty).                   |

### Untrusted display

A schema that arrived over a wire is data from somebody else. These are the projection that makes it
safe to PRINT ([`src/core`](../src/core)).

| API                   | Kind     | Summary                                                                                                                                     |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanitizeDisplayText` | function | Clean one single-line display slot — console's ANSI `strip` and C0 `stripControls`, plus tab, line feed, and carriage return.               |
| `sanitizeSchema`      | function | Clean every terminal-readable string in a parsed schema while leaving every identity and answer string verbatim; field metadata is dropped. |
| `sanitizeThemeIcons`  | function | Clean every glyph a wire-supplied theme carries. A role needs no pass: its colors and attributes are fixed name sets.                       |

### The headless broker

The park-as-promise arm — no terminal here, so a transport forwards each `pending` record to whoever
can answer, and `answer` drives the parked form to settlement ([`src/core`](../src/core)).

| API                   | Kind      | Summary                                                                                                                                        |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptInterface`     | interface | The broker — `emitter` / `count` data plus `park` / `pending` / `answer` / `stop` / `destroy`.                                                 |
| `Prompt`              | class     | The observable broker — parks live forms, applies remote answers to the authoritative instance, abandons on timeout, release, or teardown.     |
| `createPrompt`        | function  | Create the `PromptInterface` broker.                                                                                                           |
| `PromptOptions`       | interface | `createPrompt` options — `on` / `error` / `timeout` / `timer` / `cap` (data-only).                                                             |
| `ParkRequest`         | interface | The parking envelope — `from` / `to`, the attribution edge a `TerminalManagerInterface` stamps; a direct caller passes no request (data-only). |
| `PendingForm`         | interface | One form PARKED — `id` / `schema` / `status` / `time` / optional `from` / `to`; the wire-safe record a transport carries (data-only).          |
| `PendingFormStatus`   | type      | The TICKET's status — `pending` / `answered` / `expired`. The form it carries has its own status; the two are separate facts.                  |
| `Parked`              | interface | The broker's per-form record — the authoritative live `form`, its wire `pending` record, and the `cancel` for its expiry deadline (data-only). |
| `AnswerError`         | type      | Why `answer` refused — `{ reason: 'unknown' }`, or `{ reason: 'rejected', errors }` carrying the authoritative form's own `FieldError` list.   |
| `PromptEventMap`      | type      | The broker's events — `pending(form)` / `answer(id, values)` / `expire(id)`; errors are `unknown`, and there is no listener-error event.       |
| `isPendingForm`       | function  | Narrow an unknown wire value to a `PendingForm` — the ENVELOPE only; `parseForm` owns the schema payload.                                      |
| `isPendingFormStatus` | const     | Narrow an unknown value to a `PendingFormStatus`.                                                                                              |
| `TimerHandler`        | type      | One injected timer — arms a deadline after `ms` and returns a `TimerCancel`; the broker's expiry seam and the client's backoff seam.           |
| `TimerCancel`         | type      | Cancel a pending deadline — idempotent, safe after the timer fired.                                                                            |
| `defaultTimer`        | function  | The default `TimerHandler` — a thin host `setTimeout` / `clearTimeout` wrapper.                                                                |

### The wire seam

The `http`-free frame shape a consumer's own HTTP spine mounts the broker over
([`src/core`](../src/core)).

| API                 | Kind      | Summary                                                                                                      |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `WireEvent`         | interface | One SSE-shaped frame — the `event` name, its already-stringified `data`, and an optional `id` (data-only).   |
| `isWireEvent`       | const     | Narrow an unknown value to a `WireEvent` — the guard a consumer's own transport applies to an inbound frame. |
| `serializePending`  | function  | Build the `pending` frame for a parked form — `id` the form's own id.                                        |
| `serializeExpire`   | function  | Build the `expire` frame for a parked form that expired or was released — `data` the JSON `{ id }` payload.  |
| `serializeShutdown` | function  | Build the `shutdown` frame a broker or manager sends when it is going away — no payload.                     |

### The SSE bridge

The client-side counterpart to the broker: receive a form parked elsewhere, rebuild it here, drive it
through a local terminal, and POST the answers back ([`src/core`](../src/core)). Universal — `fetch`
and SSE are web standards.

| API                     | Kind      | Summary                                                                                                                                |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptClientInterface` | interface | The bridge — `emitter` / `url` / `connected` data plus `connect` / `disconnect` / `destroy`.                                           |
| `PromptClient`          | class     | The observable bridge — ingests without waiting on a render, drives one form at a time, and retries an authoritative refusal.          |
| `createPromptClient`    | function  | Create the `PromptClientInterface` bridge.                                                                                             |
| `PromptClientOptions`   | interface | `createPromptClient` options — `url` / `terminal` required, plus `token` / `reconnect` / `delay` / `on` / `error` / `fetch` / `timer`. |
| `PromptClientEventMap`  | type      | The client's events — `connect` / `disconnect` / `expire(id)` / `error(unknown)`.                                                      |
| `FetchHandler`          | type      | A minimal `fetch` — the subset the client uses (open the stream, POST an answer); injected so a test drives it with no network.        |
| `FetchInit`             | interface | The request init the client passes its `FetchHandler` — `method` / `headers` / `body` / `signal` (data-only).                          |
| `globalFetch`           | function  | The default `FetchHandler` — the global `fetch` adapted to that minimal shape.                                                         |
| `isAbortError`          | function  | Whether a caught value is an `AbortError`, so a deliberate `disconnect` exits quietly instead of reconnecting.                         |
| `isInsecureRemote`      | function  | Whether a URL is a non-loopback `http://` endpoint — the client warns once when a `token` would cross it in cleartext.                 |

### The terminal manager

A named registry of brokers, so several parties can ask forms of each other BY NAME with a `from` →
`to` edge on every parked record ([`src/core`](../src/core)).

| API                        | Kind      | Summary                                                                                                                                                |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TerminalManagerInterface` | interface | The registry — `emitter` / `count` data plus `terminal` / `terminals` / `add` / `ask` / `pending` / `answer` / `open` / `save` / `remove` / `destroy`. |
| `TerminalManager`          | class     | The observable registry — mints and reuses named brokers, attributes each ask, refuses `TARGET` and `DEADLOCK`, persists config.                       |
| `createTerminalManager`    | function  | Create the registry. It returns `TerminalManagerInterface`, implemented exactly by `TerminalManager`.                                                  |
| `TerminalManagerOptions`   | interface | `createTerminalManager` options — `store`, the manager-wide `timeout` / `timer` / `cap` default, and `on` / `error` (data-only).                       |
| `TerminalManagerEventMap`  | type      | The manager's events — every mounted broker's `pending(form)` / `answer(to, id, values)` / `expire(to, id)`, attributed by name.                       |
| `TerminalAnswerError`      | type      | Why a manager `answer` refused — an `AnswerError`, plus `{ reason: 'terminal' }` when no endpoint is mounted under that name.                          |

### The terminal store

The point-access persistence seam for a manager's endpoint CONFIG — config only, because a parked
form is process-bound and is never resurrected ([`src/core`](../src/core)).

| API                           | Kind      | Summary                                                                                                               |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `TerminalStoreInterface`      | interface | The store contract — async `get` / `set` / `delete`, keyed by the snapshot's own `id`.                                |
| `TerminalSnapshot`            | interface | One endpoint's persisted config — `id` (the endpoint name) and its optional `timeout` (data-only).                    |
| `TerminalSnapshotRow`         | interface | One opaque persisted row — `id` plus `snapshot: unknown`, the shape a `TableInterface`-backed store reads and writes. |
| `isTerminalSnapshot`          | const     | Narrow a stored value back to a `TerminalSnapshot` on read — a non-empty `id` and an optional numeric `timeout`.      |
| `MemoryTerminalStore`         | class     | The in-memory twin — a process-lifetime `Map`; no idle TTL, no eviction.                                              |
| `DatabaseTerminalStore`       | class     | The database twin — one opaque JSON column over a `TableInterface`, narrowed with `isTerminalSnapshot` on read.       |
| `createMemoryTerminalStore`   | function  | Create the in-memory store.                                                                                           |
| `createDatabaseTerminalStore` | function  | Create the database-backed store (default driver: an in-memory `@orkestrel/database` driver).                         |

### The terminal error

Terminal's own failure type. A refusal that belongs to the FORM — a malformed schema, a value a
control cannot hold, a write to a settled form — arrives as form's own `FormError` and is never
re-coded ([`src/core`](../src/core)).

| API                 | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalErrorCode` | type     | The machine-readable condition — `EXPIRE` (a park reached a destroyed broker) / `CANCEL` (ctrl-c at the driver) / `DRIVER` (the fallback was given an input it cannot read) / `DEADLOCK` (an ask would close a `from` → `to` cycle) / `TARGET` (an unknown endpoint) / `LIMIT` (the broker's `cap`) / `DESTROYED` (a call reached a destroyed manager). |
| `TerminalError`     | class    | The error those conditions throw or reject with — a `code` plus an optional `context` bag.                                                                                                                                                                                                                                                              |
| `isTerminalError`   | function | Narrow an unknown caught value to a `TerminalError`, then branch on `error.code`.                                                                                                                                                                                                                                                                       |

### The core constants

The decode tables, the default mask, the theme defaults, and the broker and SSE defaults
([`src/core`](../src/core)). UPPER_SNAKE, `Object.freeze`d data; every control byte is built through
`String.fromCharCode`, so no raw control character appears in source.

| API                          | Kind  | Summary                                                                                                                                     |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETURN`                     | const | Carriage return (`\r`, U+000D) — Enter on most terminals.                                                                                   |
| `NEWLINE`                    | const | Line feed (`\n`, U+000A) — Enter on some terminals, and in pasted input.                                                                    |
| `TAB`                        | const | Tab (U+0009).                                                                                                                               |
| `ESCAPE`                     | const | Escape (U+001B) — the lone byte, and the lead byte of every CSI and SS3 sequence. Both modules export it as the same byte.                  |
| `BACKSPACE`                  | const | Backspace (U+0008) — Ctrl+H, and Backspace on some terminals.                                                                               |
| `DELETE`                     | const | Delete (U+007F) — the usual Backspace byte on a Unix TTY.                                                                                   |
| `SPACE`                      | const | Space (U+0020).                                                                                                                             |
| `CTRL_C`                     | const | Ctrl+C (U+0003) — cancel.                                                                                                                   |
| `CTRL_D`                     | const | Ctrl+D (U+0004) — the editor's finish key.                                                                                                  |
| `CTRL_U`                     | const | Ctrl+U (U+0015) — clear the current line.                                                                                                   |
| `CTRL_A`                     | const | Ctrl+A (U+0001) — move to start of line.                                                                                                    |
| `CTRL_E`                     | const | Ctrl+E (U+0005) — move to end of line.                                                                                                      |
| `KEY_CSI`                    | const | The Control Sequence Introducer lead (`ESC[`) — named so it never collides with console's own `CSI`.                                        |
| `KEY_SS3`                    | const | The Single Shift Three lead (`ESCO`) — the alternate arrow-key prefix some terminals emit.                                                  |
| `SEQUENCE_NAMES`             | const | The escape-SEQUENCE to key-NAME table `parseKey` consults — both forms of the arrows, plus home / end / delete.                             |
| `CONTROL_NAMES`              | const | The control-BYTE (or CRLF pair) to key-descriptor table `parseKey` consults — each entry's canonical `name` and whether it is a ctrl combo. |
| `DEFAULT_MASK`               | const | The glyph a password field renders each character as when it declares no `mask` — `*`.                                                      |
| `PROMPT_ICONS`               | const | The six terminal-owned glyphs `DEFAULT_PROMPT_THEME` is assembled from, beside console's own success and error marks.                       |
| `PROMPT_ROLES`               | const | Every `PromptRole` in one frozen list — the role axis's source of truth, walked when a partial theme is merged.                             |
| `DEFAULT_PROMPT_THEME`       | const | The theme every field renders with unless options supply another — the default glyphs and a `Style` per role.                               |
| `DEFAULT_PROMPT_TIMEOUT_MS`  | const | How long the broker parks an unanswered form before abandoning it — 5 minutes.                                                              |
| `DEFAULT_RECONNECT_DELAY_MS` | const | How long the client waits before each reconnect attempt — 2 seconds.                                                                        |
| `SSE_EVENTS`                 | const | The `event:` names the broker emits and the client dispatches on — `pending` / `expire` / `shutdown`.                                       |
| `HEADER_TOKEN`               | const | The auth-token request header the client sends when a `token` is configured.                                                                |
| `ACCEPT_EVENT_STREAM`        | const | The `Accept` header value that opens the broker's stream (`text/event-stream`).                                                             |
| `SSE_BUFFER_LIMIT`           | const | How many characters the client's SSE parser buffers before treating the stream as hostile — 1 MiB.                                          |

### The server Terminal

The local-TTY arm and the only impure part of the stack ([`src/server`](../src/server)). It reads
raw-mode stdin, drives the core reducers, renders each view in place, and falls back to
`node:readline` when piped. Every form contract is imported from core and none is redeclared here.

| API                     | Kind      | Summary                                                                                                                                 |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Terminal`              | class     | The interactive driver — walks one form's fields, binds each answer through the form's own `fill`, re-asks what the form refused.       |
| `createTerminal`        | function  | Create the `TerminalInterface` driver over the resolved streams — the env-symmetric sibling of `createPrompt` and `createPromptClient`. |
| `TerminalOptions`       | interface | `createTerminal` options — `input` / `output` / `theme`, all optional; a bare `createTerminal()` drives the real process streams.       |
| `InputStreamInterface`  | interface | The minimal input stream the driver reads — required `on` / `off`, optional `setRawMode` / `resume` / `pause` / `isTTY`.                |
| `OutputStreamInterface` | interface | The minimal output stream the driver writes — required `write`, optional `isTTY`.                                                       |

### The server helpers

The stream guards, the cursor math behind the in-place re-render, and the per-field line projections
the walk renders with ([`src/server`](../src/server)). All pure, all exported, all unit-tested.

| API               | Kind     | Summary                                                                                                                                      |
| ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `isInputStream`   | function | Whether a value is a usable `InputStreamInterface` (callable `on` / `off`) — the input boundary guard, total.                                |
| `isOutputStream`  | function | Whether a value is a usable `OutputStreamInterface` (callable `write`) — the output boundary guard, total.                                   |
| `isReadable`      | function | Whether a value is a Node readable stream (callable `read` / `pipe` / `on`) — narrows the input to the `node:readline` boundary.             |
| `rawCapable`      | function | Whether an input can be driven in RAW mode (`isTTY === true` AND a callable `setRawMode`) — selects raw mode over the readline fallback.     |
| `lineCount`       | function | How many terminal LINES a rendered view occupies — one more than its newline count. The basis of the in-place re-render.                     |
| `moveUp`          | function | The cursor-UP sequence (`ESC[{count}A`), or `''` when `count <= 0`.                                                                          |
| `redrawPrefix`    | function | The reposition-and-clear prefix written before re-rendering in place — climb, return to column 0, erase to end of screen.                    |
| `fieldToText`     | function | Project any field read as one LINE — `text` and the six controls a terminal has no widget for — into the `TextField` the text reducer takes. |
| `valueToText`     | function | Project one held answer into read-only text — a scalar as itself, a boolean as `yes` / `no`, a list joined by commas, absence as nothing.    |
| `enabledChoices`  | function | The choices a field actually OFFERS — the form refuses a disabled choice at every door, so the walk never puts one in front of the cursor.   |
| `disabledChoices` | function | The choices a field SHOWS but refuses — the complement, so a withheld choice is named rather than silently missing.                          |
| `groupHeader`     | function | The section header the walk writes when it enters a new field group.                                                                         |
| `lockedLine`      | function | The read-only line a LOCKED field renders — its label, the locked mark, and the answer the form already holds.                               |
| `suggestionLine`  | function | The line listing an OPEN select's offered values above its text prompt, because an open select admits an answer the list does not offer.     |
| `unavailableLine` | function | The line naming the choices a field shows but refuses, written above the list the walk drives.                                               |
| `numberedList`    | function | The numbered choice list the non-TTY fallback prints, since a piped stream cannot navigate with arrow keys.                                  |

### The server constants

The cursor and clear sequences the driver writes, and the fixed copy the walk renders
([`src/server`](../src/server)). Sequences are built from a named ESC byte, so no raw control
character appears in source.

| API                      | Kind  | Summary                                                                                                  |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------- |
| `CSI`                    | const | The Control Sequence Introducer (`ESC[`) — the prefix of every sequence below.                           |
| `CSI_UP`                 | const | The cursor-UP TEMPLATE (`ESC[{count}A`) — `moveUp` interpolates `{count}`.                               |
| `CURSOR_HIDE`            | const | Hide the cursor — written before a redraw so it does not flicker; paired with `CURSOR_SHOW`.             |
| `CURSOR_SHOW`            | const | Show the cursor — restored when a field settles or the walk ends.                                        |
| `CLEAR_DOWN`             | const | Erase from the cursor to the end of the screen — wipes a whole multi-line view before the new one.       |
| `CARRIAGE_RETURN`        | const | A carriage return — returns the cursor to column 0 so a redraw starts at the line's left edge.           |
| `LINE_FEED`              | const | A line feed — the terminator the driver writes after a committed line.                                   |
| `CONTROL_HINTS`          | const | The format cue `fieldToText` appends per control — the `(YYYY-MM-DD)` on a date label, and its siblings. |
| `FILE_HINT`              | const | The instruction shown above a multiple-file list — one path per line, blank to finish.                   |
| `SUGGESTION_LEAD`        | const | The lead word on an open select's suggestion line.                                                       |
| `UNAVAILABLE_LEAD`       | const | The lead word on the line naming refused choices.                                                        |
| `LOCKED_MARK`            | const | The mark a locked field's read-only line carries.                                                        |
| `REFUSAL_MESSAGE`        | const | The invalidation message the driver writes when an answer is one the control cannot hold.                |
| `FALLBACK_SELECT_HINT`   | const | The prompt the non-TTY select fallback reads its index on.                                               |
| `FALLBACK_CHECKBOX_HINT` | const | The prompt the non-TTY checkbox fallback reads its comma-separated indices on.                           |
| `FALLBACK_EDITOR_HINT`   | const | The hint the non-TTY editor shows, since ctrl-d is a raw-mode key and end of input finishes here.        |
| `FALLBACK_CONFIRM_HINT`  | const | The hint the non-TTY confirm shows, since it reads a typed line rather than a single key.                |

## Methods

One table per behavioral interface, keyed by its backticked name, listing exactly its
call-signature members. Each interface's readonly data members stay in its Surface row above and are
not repeated here. Each implementing class implements its interface exactly, so each table is also
the instance method surface of the class that implements it.

A `*Options` / `*EventMap` / `PendingForm` / `Parked` / `KeyEvent` / `PromptStep` / `WireEvent` /
`FetchInit` / `TerminalSnapshot` / `TerminalSnapshotRow` row is data with no behavior, and
`PromptStatus` / `PendingFormStatus` / `TerminalErrorCode` / `AnswerError` / `TerminalAnswerError` /
`TimerHandler` / `TimerCancel` / `FetchHandler` are unions or callable function types. None carries a
method table.

#### `TerminalInterface`

The one driving contract. The server `Terminal` implements it.

| Method | Returns               | Behavior                                                                                                  |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `ask`  | `Promise<FormValues>` | Walk the given form to settlement and resolve its values. See the ctrl-c exception in the Contract below. |

#### `PromptInterface`

The headless broker.

| Method    | Returns                                               | Behavior                                                                                                                          |
| --------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `park`    | `string`                                              | Park a live form, mint its id, emit `pending`, and arm the expiry deadline. Returns the id; the caller already holds the promise. |
| `pending` | `readonly PendingForm[]` / `PendingForm \| undefined` | List every parked record (`pending()`), or look one up by id (`pending(id)`).                                                     |
| `answer`  | `Result<FormValues, AnswerError>`                     | Fill and submit the AUTHORITATIVE parked form. Accepted, it settles and the record is dropped; refused, the form stays parked.    |
| `stop`    | `boolean` / `void`                                    | Release a batch (`stop(ids)`, array overload first), one id, or every parked form. The broker stays usable.                       |
| `destroy` | `void`                                                | Tear down — abandon every parked form, cancel every deadline, then destroy the emitter. Idempotent.                               |

#### `PromptClientInterface`

The SSE bridge.

| Method       | Returns         | Behavior                                                                                                               |
| ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `connect`    | `Promise<void>` | Open the stream and pump it, queueing each received form for the local terminal; reconnects on the `delay` backoff.    |
| `disconnect` | `void`          | Stop the current connection AND the reconnect loop. An active local render continues; a later `connect()` may restart. |
| `destroy`    | `void`          | Tear down permanently — disconnect, drop the queue, abandon the active local form, and destroy the emitter.            |

#### `TerminalManagerInterface`

The multi-endpoint registry.

| Method      | Returns                                   | Behavior                                                                                                         |
| ----------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `terminal`  | `PromptInterface \| undefined`            | Look up one endpoint's broker by name.                                                                           |
| `terminals` | `readonly string[]`                       | List every mounted endpoint name, in insertion order.                                                            |
| `add`       | `PromptInterface`                         | Mint, or return the existing unchanged, broker for `name`. Idempotent; it never clobbers a live endpoint.        |
| `ask`       | `Promise<FormValues>`                     | Park `form` from `from` to `to` and resolve with the settled values. Rejects `TARGET` or `DEADLOCK`.             |
| `pending`   | `readonly PendingForm[]`                  | List every endpoint's parked records (`pending()`), or scope to one endpoint (`pending(to)`).                    |
| `answer`    | `Result<FormValues, TerminalAnswerError>` | Route an answer to the named endpoint's broker; `{ reason: 'terminal' }` when no endpoint carries that name.     |
| `open`      | `Promise<PromptInterface \| undefined>`   | Return the live broker for `name`, or restore an EMPTY one from the `store`. Parked forms are never resurrected. |
| `save`      | `Promise<boolean>`                        | Persist an endpoint's config snapshot; false with no store, or an unknown name.                                  |
| `remove`    | `boolean` / `void`                        | Remove a batch (`remove(names)`, the array overload declared FIRST), one endpoint, or every endpoint.            |
| `destroy`   | `void`                                    | Tear down every broker, then the manager's own emitter.                                                          |

#### `TerminalStoreInterface`

The persistence seam both store twins implement exactly.

| Method   | Returns                                  | Behavior                                                                  |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `get`    | `Promise<TerminalSnapshot \| undefined>` | Resolve the snapshot stored for `id`, or `undefined` when none is.        |
| `set`    | `Promise<void>`                          | Insert or replace under the snapshot's OWN `id`; there is no id argument. |
| `delete` | `Promise<void>`                          | Drop a snapshot by id. An absent id is a no-op, never a throw.            |

#### `InputStreamInterface`

The stream shape the driver reads. Only `on` and `off` are required; a stream missing `setRawMode`
takes the `node:readline` fallback.

| Method       | Returns | Behavior                                                                     |
| ------------ | ------- | ---------------------------------------------------------------------------- |
| `on`         | `void`  | Subscribe a `'data'` chunk listener — the irreducible event seam.            |
| `off`        | `void`  | Unsubscribe that listener. The driver always pairs it, so no listener leaks. |
| `setRawMode` | `void`  | Switch the TTY in and out of raw mode. Absent on a piped stream.             |
| `resume`     | `void`  | Start the flow of `'data'` events.                                           |
| `pause`      | `void`  | Stop it again on cleanup.                                                    |

#### `OutputStreamInterface`

The stream shape the driver writes.

| Method  | Returns            | Behavior                                                                                       |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `write` | `boolean` / `void` | Push one chunk — a rendered view, a group header, or a cursor sequence. The return is ignored. |

## Contract

These invariants hold across `src/core`, `src/server`, and this guide.

1. **DOC ↔ SOURCE bijection.** Every row in the `## Surface` tables is a real export of the two
   source trees, and every export appears as a row — exhaustive, both directions. Every `## Methods`
   table lists exactly its interface's call-signature members, and each implementing class implements
   every one of them and adds none beyond. `ESCAPE` is exported by both modules as the same byte; the
   parity gate concatenates the trees and dedupes, so one row covers both.
2. **The form is the unit.** `park(form)` takes a LIVE form and returns its id. It wraps no promise,
   because the caller already holds one: the form's own `answer`. The parked form is AUTHORITATIVE —
   `answer(id, values)` fills and submits that instance, so every rule it carries decides, including
   a `custom` validator the wire could not carry. The wire record is `PendingForm`
   `{ id, schema, status, time, from?, to? }`; `form`, `message`, and `options` are gone, and
   `schema` is form's own `serializeForm` projection, which drops every `custom` validator on the way
   out.
3. **Absence is `undefined`.** The driver binds every answer as
   `fill(name, matchesAnswer(value) ? value : undefined)`, so a blank line is ABSENCE and `required`
   refuses it. A field with no default and a bare return leaves its key out of the resolved values
   entirely. A field WITH a default binds the declared default, never a value a previous pass held.
   The `''` sentinel is gone. The blank-line-binds-absence rule is per-control: an empty checkbox
   binds `[]`, which `matchesAnswer` counts as an answer, so `required` cannot refuse an unchecked
   checkbox the way it refuses a blank text line.
4. **A refusal is structured, and the client retries it.** `answer` returns
   `Result<FormValues, AnswerError>`. `{ reason: 'unknown' }` means no form is parked under that id,
   or the one that was has already settled. `{ reason: 'rejected', errors }` carries the
   authoritative form's own `FieldError` list, and the parked form STAYS parked. The client seeds a
   fresh local form with the values it sent, applies each failure through `invalidate`, and asks
   again — until the answer is accepted, the id comes back `unknown`, the form expires, or the client
   is shut down. That loop is what makes a server-side `custom` rule enforceable, because the rule
   never crossed the wire and the client could not have checked it. There is no retry counter: the
   lifecycle bounds the loop. A retry cannot withdraw an earlier answer: the parked form is
   authoritative and RETAINS every prior fill, so a corrected retry can only add or replace the
   fields the last refusal named. A parked form settled OUT OF BAND — its form destroyed or
   submitted through some path other than this `answer` call — leaves the broker's own record
   `pending`: the record is marked `answered` or `expired` only inside `#answer` and `#expire`, so a
   later `answer` for that id does not come back `unknown`. It is submitted against the now-settled
   form and comes back `{ reason: 'rejected', errors }` instead.
5. **Ctrl-c is the one exception to "the promise is the form's answer".** `ask` normally resolves or
   rejects with the form's own `answer`, so a caller holding the form can await either. Ctrl-c at the
   driver rejects `ask` with a `TerminalError` coded `CANCEL` and LEAVES THE FORM `editing`, with its
   own `answer` still pending for whoever owns it. A driver never owns a form's lifetime: to
   interrupt the FORM, destroy it, and the walk stops on its abandon.
6. **Expiry and release abandon the form.** An unanswered form is destroyed after `timeout` ms
   through the INJECTED timer; `expire` fires and the caller's promise rejects with form's own
   `ABANDONED` error, not a `TerminalError`. `stop(id)`, `stop(ids)`, and `stop()` use that same
   `expired` status and `expire` event while leaving the broker usable. `destroy()` releases every
   still-parked form the same way, then destroys the broker. `park` itself throws `TerminalError` —
   `EXPIRE` when the broker is already destroyed, `LIMIT` when `cap` was already reached — and in
   both cases destroys the form it refused, without minting an id, emitting `pending`, or arming a
   timer.
7. **Display is sanitized; identity and answers are not.** Every string a wire schema renders passes
   through `sanitizeDisplayText` — labels, help, placeholders, masks, choice labels and help, file
   accept entries, and pattern source text — which strips ANSI sequences, every C0 control, DEL, tab,
   line feed, and carriage return. Schema, group, and field NAMES, group references, choice VALUES,
   and every DEFAULT stay verbatim, because rewriting them would sever the local rendering copy from
   the authoritative form: the client would answer under keys the parked form does not have, and
   every retry would produce the same rejection forever. Field metadata is dropped, since terminal
   neither renders nor interprets it. A preserved identity or answer string that reaches the SCREEN —
   a prefilled default, a locked held value, an open select's suggested values, a group or label
   fallback, an authoritative rejection message — is sanitized at that output boundary only, and the
   submitted value stays byte-for-byte what arrived. The server driver's `#report` sanitizes BOTH
   operands it writes — the field's label (falling back to its raw name) and the failure message —
   so a hostile field name never reaches the screen through a refusal line. A form carrying refusals
   when `ask` is called renders them at walk entry, before any field is filled, so a caller who
   re-asks an already-invalid form sees why before typing anything.
8. **A wire `pattern` never executes locally, and its cost is bounded in length only.** Form
   evaluates a `pattern` rule with a real `RegExp`, at construction and on every fill, so the client
   strips `rule.pattern` from each LOCAL rendering form before building it. Every other rule stays.
   The authoritative parked form still holds and runs the original pattern, so a pattern refusal
   comes back as a `FieldError`, is applied through `invalidate`, and re-renders — the rule is
   enforced exactly once, at the broker. The residual is honest: form's `PATTERN_LIMIT` bounds a
   pattern SOURCE's length, never its matching TIME, so a catastrophically backtracking pattern short
   enough to pass that limit costs the machine that runs it. That machine is the broker, which owns
   the schema it parked. A broker that parks a schema it did not author owns that decision.
9. **The reducers are pure, total, and copy-on-write.** Each `*Reduce` is a total
   `(state, key) → PromptStep` — it never throws, never mutates the state it is given, and always
   returns a rendered `view` and a `status`. A key it does not consume returns the same state with
   `status: 'active'`. `value` is present ONLY on a `submit` step, and it is a CANDIDATE: the form
   validates it after the driver fills it. `parseKey` is equally total — a known control byte or
   escape sequence maps to its canonical name, a printable character names itself, and anything else
   yields `name: ''` with the raw sequence preserved, so the driver cannot crash on a stray byte.
10. **Twelve controls, seven reducers.** `text`, `number`, `date`, `time`, `datetime`, `color`, and
    each `file` entry are read as one line of text through `fieldToText`, which appends that
    control's format cue to the label; `password`, `confirm`, `editor`, `select`, and `checkbox`
    each drive their own reducer. An OPEN select is a suggestion list plus a typed line, because
    `open` means the answer need not come from the list. A disabled choice is named on an
    unavailable line and never offered, since the form refuses its value at every door. A `hidden`
    field and a field currently in `form.disabled` are skipped; a `locked` field renders read-only
    and is still submitted; entering a group writes its label as a section header. Coercion is
    form's own `parseValue`, and an answer the control cannot hold binds as absence and invalidates
    the field, so it comes back with the reason on screen rather than vanishing.
11. **An unanswerable form is abandoned, not looped.** After the walk the form is submitted. A
    refusal prints every failure, then re-walks only the erroring fields the walk can EDIT. When
    that set is empty — every failure sits on a hidden, locked, or runtime-disabled field — or the
    input stream has already ended, the form is destroyed and `ask` rejects on its `answer`. Asking
    again could not change the answer, so it does not ask again.
12. **Ingestion never waits on a render.** The client's SSE reader is synchronous: each decoded
    record is narrowed by `isPendingForm`, parsed by form's `parseForm`, sanitized, and queued. One
    form is driven at a time while the stream keeps reading, so an unanswered form never starves the
    connection. An `expire` destroys the active local form or drops the queued entry; `shutdown`
    disconnects, clears the queue, and interrupts the active render while leaving the client
    reusable; `destroy` does the same permanently. An id already in flight is ignored, so a
    reconnect that replays buffered events cannot double-answer.
13. **The manager attributes every ask and refuses a cycle.** `add(name, options?)` mints or reuses
    one broker per endpoint and re-emits its events attributed by name. `ask(from, to, form)`
    requires `to` to be mounted, records the `from` → `to` edge keyed by the parked form's id, and
    parks through `to`'s broker: an unknown `to` rejects `TARGET`, and an edge that would close a
    transitive cycle over the current in-flight edges rejects `DEADLOCK` without parking. The edge
    clears on acceptance, expiry, removal, and teardown — but NOT on a rejection, because the ask is
    still live. `open` restores an empty broker from the store; `save` persists the endpoint's
    configured timeout.
14. **The wire seam carries no HTTP.** `serializePending`, `serializeExpire`, and
    `serializeShutdown` build a `WireEvent`, so a consumer mounts the broker on their own HTTP spine
    without this package importing `node:http`, and `isWireEvent` narrows an inbound frame. The
    answer POST body is exactly `{ id, values }`.
15. **The core / server split.** Core owns everything universal — the decoder, the reducers and their
    views, the theme, the sanitizer, the broker, the bridge, the manager, and the store — with no
    `node:*`, no TTY, and no I/O. The server module owns only raw mode, the cursor, the re-render,
    and the readline fallback, and imports every contract from core. Every view is painted through
    console's `StylerInterface`, so this package holds no second style vocabulary.

**A view line wider than the terminal leaves residue.** The in-place re-render climbs
`lineCount(view)`, the view's NEWLINE count, while a line the terminal wraps occupies more physical
rows than that. `redrawPrefix` therefore returns to the start of the wrap's LAST row and erases from
there down, leaving the earlier rows of the previous view on screen above the new one. Keep every
label, choice, help string, and hint inside the narrowest terminal you support, or drive the
non-TTY fallback, which writes each line fresh and never re-renders in place. A resize mid-walk is
the same limit from the other side. Closing it needs a columns fact on the output stream
(`OutputStreamInterface` carries `write` and an optional `isTTY`, and nothing else) and
cursor-COLUMN tracking in the redraw, which tracks lines only.

**Fixed, not seams.** A theme moves glyphs and styled fragments. The rest of a view is fixed by
design: the layout (the single spaces between header, pointer, and value; the two-space gap before a
choice's help; the parentheses around the confirm group; the `N selected` summary), the cursor and
clear mechanics, and the fallback's numbered-list format. Build a bespoke view from the exported
reducers and view helpers rather than reading these as extension points.

**Deliberately not here.** The SSE-server END of the bridge: the broker emits `pending` on its
emitter and a consumer mounts it on their own HTTP spine with an answer POST route, and this package
ships the bridge rather than that spine. Cursor movement WITHIN a line: the reducers edit at the end
of the buffer, and `ctrl-a` / `ctrl-e` decode but no left / right insertion is modelled.

## Patterns

### Ask one form at this keyboard

```ts
import { createForm } from '@orkestrel/form'
import { isTerminalError } from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const terminal = createTerminal() // process.stdin / process.stdout by default
const form = createForm({
	label: 'Sign up',
	fields: [
		{ control: 'text', name: 'name', label: 'Your name', rule: { required: true, minimum: 2 } },
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
	result.error.errors // the AUTHORITATIVE form's own FieldError list; the form stays parked
}
prompt.answer(id, { name: 'Ada' }) // { success: true, value: { name: 'Ada' } }
const values = await form.answer // { name: 'Ada' }

prompt.destroy() // abandon every still-parked form, then destroy the emitter
```

### Bridge a parked form to a keyboard elsewhere

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
	terminal: createTerminal(), // the LOCAL TerminalInterface each remote form is driven through
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

```ts
import {
	createPrompt,
	serializeExpire,
	serializePending,
	serializeShutdown,
} from '@orkestrel/terminal'

const prompt = createPrompt()
prompt.emitter.on('pending', (form) => {
	writeSSE(serializePending(form)) // { event: 'pending', data: '{...}', id: form.id }
})
prompt.emitter.on('expire', (id) => writeSSE(serializeExpire(id))) // { event: 'expire', data: '{"id":"..."}' }
onShutdown(() => writeSSE(serializeShutdown())) // { event: 'shutdown', data: '' }
```

### Narrow what arrives from the wire

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

```ts
import { sanitizeDisplayText, sanitizeSchema, sanitizeThemeIcons } from '@orkestrel/terminal'

sanitizeDisplayText('Q\rOVERWRITE\nNEXT\tX') // 'QOVERWRITENEXTX'

const clean = sanitizeSchema({
	fields: [
		{
			control: 'select',
			name: 'ro\u0000le', // an IDENTITY: preserved byte for byte
			label: '\u001b[31mRole', // DISPLAY: the ANSI run is stripped
			default: 'ad\u0000min', // an ANSWER: preserved byte for byte
			choices: [{ value: 'ad\u0000min', label: 'Ad\u0000min' }], // value preserved, label cleaned
			meta: { anything: true }, // dropped: terminal neither renders nor interprets it
		},
	],
})
clean.fields[0] // name and default unchanged; label 'Role'; choice label 'Admin'; no meta

sanitizeThemeIcons({ icons: { pointer: '=>\u0007' } }) // every supplied glyph loses its control bytes
```

### Drive the field reducers directly

```ts
import {
	checkboxReduce,
	checkboxView,
	confirmReduce,
	confirmView,
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createSelectState,
	editLine,
	editorReduce,
	editorView,
	inputReduce,
	inputView,
	isPrintable,
	parseKey,
	passwordReduce,
	passwordView,
	selectReduce,
	selectView,
	toggleIndex,
} from '@orkestrel/terminal'

// No TTY and no broker: this is what the driver does with each field, one key at a time.
let text = createInputState({ control: 'text', name: 'name', label: 'Name' })
inputView(text) // '? Name › ' — the header, the pointer, and the value so far
text = inputReduce(text, parseKey('A')).state
inputReduce(text, parseKey('\r')) // { status: 'submit', value: 'A', ... }

let password = createPasswordState({ control: 'password', name: 'token', label: 'Token' })
password = passwordReduce(password, parseKey('s')).state
passwordView(password) // the header and one mask glyph; the real value is never echoed

const confirm = createConfirmState({ control: 'confirm', name: 'ok', label: 'Continue?' })
confirmView(confirm) // '? Continue? (y/N)'
confirmReduce(confirm, parseKey('y')) // { status: 'submit', value: true, ... }

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
select = selectReduce(select, parseKey('\u001b[B')).state // down, wrapping at the ends
selectView(select) // a MULTI-LINE view with the focused row marked

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
checkbox = checkboxReduce(checkbox, parseKey(' ')).state // space toggles the focused box
checkboxView(checkbox) // one box per choice, then the selected count
toggleIndex(checkbox.checked, 1) // the copy-on-write primitive the reducer calls

let editor = createEditorState({ control: 'editor', name: 'notes', label: 'Notes' })
editor = editorReduce(editor, parseKey('h')).state
editorView(editor) // the finish hint, the committed lines, and the line in progress

// The shared line editing, and the printable test behind it.
editLine('hi', parseKey('!')) // 'hi!'
editLine('hi', parseKey('\u001b[A')) // undefined — a navigation key does not edit the line
isPrintable('a') // true
```

### Re-theme what a walk draws

```ts
import {
	createPromptTheme,
	createSelectState,
	DEFAULT_PROMPT_THEME,
	errorLine,
	hintedHeader,
	promptHeader,
	selectView,
	submitHeader,
} from '@orkestrel/terminal'
import { createStyler } from '@orkestrel/console'
import { createTerminal } from '@orkestrel/terminal/server'

// A theme is DATA: a glyph per icon slot, a console `Style` per semantic role. Every slot you do
// not name keeps its default, and each supplied style is frozen through console's own freezeStyle.
const theme = createPromptTheme({
	icons: { pointer: '=>', selected: '*' },
	roles: {
		message: { foreground: 'magenta', attributes: ['bold'] },
		hint: { attributes: ['italic'] },
	},
})
theme.icons.question // '?' — untouched
DEFAULT_PROMPT_THEME.roles.content // the EMPTY style: unthemed content renders as bare text

// Pass the partial bag to the driver; every view it renders is painted through it.
const terminal = createTerminal({ theme: { icons: { pointer: '=>' } } })

// Or render the shared line shapes yourself. Each state factory takes the styler and the partial
// theme after the field, so a view is themed by what built its state.
const styler = createStyler()
promptHeader(styler, theme, 'Role') // '? Role'
hintedHeader(styler, theme, 'Role', 'arrows move') // '? Role arrows move'
submitHeader(styler, theme, 'Role') // '✔ Role'
errorLine(styler, theme, 'Role: This field is required') // '✖ Role: This field is required'
selectView(
	createSelectState(
		{ control: 'select', name: 'role', choices: [{ value: 'admin', label: 'Admin' }] },
		styler,
		{ icons: { pointer: '=>' } },
	),
) // the '=>' cursor, every other slot at its default
```

### Route forms between named endpoints

```ts
import { createTerminalManager, isTerminalError } from '@orkestrel/terminal'
import { createForm } from '@orkestrel/form'

const manager = createTerminalManager()
manager.add('agent') // mint, or return unchanged, the 'agent' endpoint's broker
manager.add('user')
manager.terminals() // ['agent', 'user']
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
await manager.open('agent') // the live broker, or an EMPTY one restored from the store

manager.add('bounded', { cap: 100 }) // refuse a 101st park with LIMIT instead of growing memory
manager.remove(['agent']) // the array overload is declared FIRST
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

```ts
import {
	createTerminal,
	disabledChoices,
	enabledChoices,
	fieldToText,
	groupHeader,
	isInputStream,
	isOutputStream,
	isReadable,
	lineCount,
	lockedLine,
	moveUp,
	numberedList,
	rawCapable,
	redrawPrefix,
	suggestionLine,
	unavailableLine,
	valueToText,
} from '@orkestrel/terminal/server'
import { createPromptTheme } from '@orkestrel/terminal'
import { createStyler } from '@orkestrel/console'

// The two stream shapes are minimal on purpose, so a test drives a whole walk with no real TTY.
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
isOutputStream(output) // true — callable write
rawCapable(input) // true: a TTY with setRawMode, so the walk runs interactively
isReadable(process.stdin) // true — the node:readline boundary the fallback narrows to

// The cursor math behind the in-place re-render.
lineCount('one\ntwo\nthree') // 3
moveUp(2) // the ESC[2A cursor-up sequence; '' when the count is not positive
redrawPrefix(3) // climb 2 lines, return to column 0, erase to end of screen

// The per-field projections the walk renders with.
fieldToText({ control: 'date', name: 'born', label: 'Birthday' })
// { control: 'text', name: 'born', label: 'Birthday (YYYY-MM-DD)' }
valueToText(true) // 'yes' — the word the confirm reducer commits
valueToText(['read', 'write']) // 'read, write'

// Each line below comes back already painted through the theme. The comments show it with the
// styling stripped.
const styler = createStyler()
const theme = createPromptTheme()
const choices = [
	{ value: 'admin', label: 'Admin' },
	{ value: 'root', label: 'Root', disabled: true },
]
enabledChoices(choices) // the offered choices — the form refuses a disabled value at every door
disabledChoices(choices) // the withheld ones, named rather than silently missing
groupHeader(styler, theme, 'Account') // the section header a new group writes
lockedLine(styler, theme, 'Code', valueToText('fixed')) // '○ Code (locked) fixed'
suggestionLine(styler, theme, choices) // 'Suggestions: admin, root' — an open select's offered values
unavailableLine(styler, theme, disabledChoices(choices)) // 'Unavailable: Root'
numberedList(styler, theme, enabledChoices(choices)) // '  1) Admin' — the non-TTY fallback's list
```

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection across
  `src/core` and `src/server`, the interface ↔ implementing-class method bijection, and that every
  documented name resolves to a real export.
- [`tests/integration.test.ts`](../tests/integration.test.ts) — the whole round trip over a real
  loopback socket: a parked form, a real HTTP/SSE fixture forwarding the broker's own wire frames, a
  real client, and a real TTY walk that settles the AUTHORITATIVE form; plus a hostile schema driven
  end to end with no control byte in the rendered output, proven against a failing control.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — `parseKey` totality, the
  six reducers over every key path, `editLine`, the theme merge and glyph sanitization, schema
  sanitization with its hostile negative control, the wire guards and serializers, and the host
  seams.
- [`tests/src/core/Prompt.test.ts`](../tests/src/core/Prompt.test.ts) — the broker: parking a live
  form with its serialized schema, exact authoritative `FieldError`s on refusal, acceptance settling
  the form, `unknown` for an absent or settled id, expiry and teardown abandoning through the
  injected timer, and the `cap` refusal.
- [`tests/src/core/PromptClient.test.ts`](../tests/src/core/PromptClient.test.ts) — the bridge over a
  scripted `fetch`: parse, sanitize, render, POST `{ id, values }`, the retry with seeded values and
  exact invalidations, expiry and shutdown interrupting an active render, the in-flight dedupe, the
  token header, and permanent `destroy`.
- [`tests/src/core/TerminalManager.test.ts`](../tests/src/core/TerminalManager.test.ts) — idempotent
  `add`, the attributed ask, `TARGET` and transitive `DEADLOCK`, edge lifetime across rejection,
  acceptance, expiry and removal, durable `open` / `save`, every `remove` scope, and `destroy`.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — each core factory
  returns a working instance of its interface with its seams forwarded.
- [`tests/src/core/MemoryTerminalStore.test.ts`](../tests/src/core/MemoryTerminalStore.test.ts) — the
  shared store case matrix against the memory twin.
- [`tests/src/core/DatabaseTerminalStore.test.ts`](../tests/src/core/DatabaseTerminalStore.test.ts) —
  the same matrix against the one-table twin, plus the read-boundary guard on an off-shape row.
- [`tests/src/server/Terminal.test.ts`](../tests/src/server/Terminal.test.ts) — the walk over a
  scripted TTY: all twelve controls settling one form, the blank line binding as absence, a refused
  value re-asked, an open select accepting a value outside its list, hidden / disabled / locked /
  group handling, the unanswerable form abandoned, ctrl-c leaving the form editing, and the shared
  readline fallback; plus the `#report` output-boundary regression — a hostile field NAME carrying
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
