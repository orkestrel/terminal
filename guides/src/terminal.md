# Terminal

> The interactive prompt system — `input` / `password` / `confirm` / `select` / `checkbox` / `editor`, with ONE async contract (`PromptFormInterface`) and THREE implementations riding one pure prompt core. The TRI-SURFACE: the server TTY `Terminal` answers a prompt at this machine's keyboard (raw-mode stdin, live in-place re-render, a `node:readline` fallback when piped); the headless `Prompt` broker PARKS each prompt as a Promise and resolves it when an answer arrives over a transport (remote / programmatic / a host elicitation bridge); the `PromptClient` SSE bridge receives prompts parked elsewhere and dispatches each to a LOCAL terminal. All three sit on ONE pure prompt core — the `parseKey` key decoder, the six event-free `(state, key) → PromptStep` reducers, and the declarative validation engine — and that core is universal (no `node:*`, no TTY, no I/O). The ONLY impure part of the whole stack is the server `Terminal`'s raw-mode / readline driver.
>
> The design is **one pure core, three drivers**. The cross-environment core ([`src/core`](../../src/core), surfaced through `@src/core`) owns the universal prompt logic — the decoder, the reducers, the validation, the broker, and the SSE bridge — all pure types + functions + immutable state. The server backend ([`src/server`](../../src/server), surfaced through `@src/server`) owns ONLY the `Terminal` raw-mode driver, the one piece that touches a real `process.stdin`. Validation is **declarative DATA** (a `ValidationRules` bag, not a closure), so it crosses the wire: the broker serializes the rules, the client rebuilds the validator from them — the reason a remotely-parked prompt validates exactly as a local one. The reducers render their `view` through the shared console [`StylerInterface`](console.md) (AGENTS — one style engine), so the driver only feeds bytes in and writes the rendered string out.

## Surface

Drive a prompt three ways over ONE contract — a local TTY, a headless broker, or an SSE bridge — all on the pure core:

```ts
import { createPrompt } from '@src/core'
import { createTerminal } from '@src/server'

// 1. The local TTY (the server Terminal) — answer at THIS keyboard.
const terminal = createTerminal()
const name = await terminal.input({ message: 'Your name', validate: { required: true } })
const proceed = await terminal.confirm({ message: 'Continue?', default: true })

// 2. The headless broker — PARK each prompt, answer it from a transport.
const prompt = createPrompt()
prompt.emitter.on('pending', (pending) => send(pending)) // forward to whoever can answer
const remote = await prompt.input({ message: 'Your name' }) // parks; resolves on answer()
// ...elsewhere: prompt.answer(id, 'Ada')

// 3. The SSE bridge — receive remote prompts, dispatch each to a LOCAL terminal.
import { createPromptClient } from '@src/core'
const client = createPromptClient({ url: 'http://host/prompts', terminal })
await client.connect() // streams remote prompts to `terminal`, POSTs answers back
```

The core is **pure + total**: every reducer is a `(state, key) → PromptStep` that copies-on-write and never throws; `parseKey` decodes any byte sequence into a `KeyEvent` (an unknown sequence yields `name: ''`, never a throw). Validation is **data**: a `ValidationRules` bag compiles (via `resolveValidation`) into ONE composed `Validator` that short-circuits on the first failing rule — and because the rules are data, the broker serializes them over the wire and the client reconstructs the validator. The choices and options carry no behaviour — they are plain records the `create*State` factories normalize.

### Pure prompt core

The universal logic — the key decoder, the six event-free reducers + their state factories + view renderers, the declarative validation engine, the choice normalizers, and the broker/bridge wiring helpers ([`src/core`](../../src/core)). All pure, all exported, all unit-tested (AGENTS §5); no `node:*`, no I/O.

| API                          | Kind      | Summary                                                                                                                                                                    |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyEvent`                   | interface | One decoded keypress — `name` / `sequence` / `ctrl` / `meta` / `shift`; the TTY-agnostic unit a reducer reads (data-only).                                                 |
| `parseKey`                   | function  | Decode one keypress's bytes (`string` / `Uint8Array`) into a `KeyEvent` — TOTAL; an unknown sequence yields `name: ''`, never throws.                                      |
| `isPrintable`                | function  | Whether a single character is printable (non-control) — `parseKey`'s char-fallback test (excludes C0 controls + DEL).                                                      |
| `Validator`                  | type      | The atomic input check `(input) => true \| string` — `true` passes, a string is the error message it carries; total, pure.                                                 |
| `ValidationRules`            | interface | Declarative validation — `required` / `minimum` / `maximum` / `pattern` / `email` / `url` / `numeric` / `integer` / `alphanumeric` / `custom` (data-only).                 |
| `resolveValidation`          | function  | Compile a `Validator` or `ValidationRules` (or nothing) into ONE composed `Validator` — always returns a validator (always-passing when empty).                            |
| `evaluateRule`               | function  | Evaluate ONE built-in rule against an input — its error message on failure, else `undefined`; the atomic check the engine wraps.                                           |
| `buildRuleValidator`         | function  | Wrap a named rule + its primitive check into a `Validator` (returns `true` or the rule's message).                                                                         |
| `appendRule`                 | function  | Append a rule-backed `Validator` to a list when the rule is enabled — a `false` / `undefined` rule skipped, a function added verbatim.                                     |
| `composeValidators`          | function  | Compose several `Validator`s into ONE short-circuiting validator — returns the FIRST error, or `true` when all pass (empty passes).                                        |
| `passing`                    | function  | The always-passing `Validator` — the resolved validator when no rules were supplied.                                                                                       |
| `PromptChoice`               | interface | A select choice — `name` / `value` / optional `description` (data-only).                                                                                                   |
| `CheckboxChoice`             | interface | A checkbox choice — a `PromptChoice` plus an optional initial `checked` (data-only).                                                                                       |
| `normalizeChoice`            | function  | Normalize a select choice input into a full `PromptChoice` (a bare string becomes both `name` and `value`).                                                                |
| `normalizeCheckboxChoice`    | function  | Normalize a checkbox choice input into a full `CheckboxChoice` (a bare string becomes both `name` and `value`).                                                            |
| `promptHeader`               | function  | The styled prompt-message header (`? message`) — the leading line every active prompt view shares.                                                                         |
| `submitHeader`               | function  | The styled submit line (`✔ message`) — the committed header shown once a prompt resolves.                                                                                  |
| `errorLine`                  | function  | The styled error line (`✖ message`) — appended beneath a view when the last submit failed validation.                                                                      |
| `PromptStatus`               | type      | A `PromptStep`'s discriminant — `active` / `submit` / `cancel` (names the prompt's progression, not `kind`).                                                               |
| `PromptStep`                 | interface | One reducer step's output — the next `state`, the rendered `view`, the `status`, and (on submit) the `value` (data-only).                                                  |
| `InputOptions`               | interface | A single-line text `inputReduce` prompt's options — `message` / `default?` / `validate?` / `styler?` (data-only).                                                          |
| `InputState`                 | interface | A text input prompt's immutable state — options + resolved validator/styler + accumulated `value` + current `error` (data-only).                                           |
| `createInputState`           | function  | Build the initial `InputState` from `InputOptions` — resolving the validator + styler, seeding an empty value.                                                             |
| `inputView`                  | function  | Render an `InputState` as a styled view — header, typed value (or dimmed default hint), and any error.                                                                     |
| `inputReduce`                | function  | The pure input reducer `(state, key) → PromptStep<string>` — printable extends, backspace shrinks, ctrl-u clears, return submits.                                          |
| `PasswordOptions`            | interface | A masked-password `passwordReduce` prompt's options — `message` / `mask?` / `validate?` / `styler?` (data-only).                                                           |
| `PasswordState`              | interface | A password prompt's immutable state — like `InputState` but with a `mask` the view renders per character (data-only).                                                      |
| `createPasswordState`        | function  | Build the initial `PasswordState` from `PasswordOptions` — resolving the validator + styler + mask, seeding an empty value.                                                |
| `passwordView`               | function  | Render a `PasswordState` as a styled view — header, value masked to `mask` repeated, and any error.                                                                        |
| `passwordReduce`             | function  | The pure password reducer `(state, key) → PromptStep<string>` — identical line-editing to input, but the view masks the value.                                             |
| `ConfirmOptions`             | interface | A yes/no `confirmReduce` prompt's options — `message` / `default?` / `styler?` (data-only).                                                                                |
| `ConfirmState`               | interface | A confirm prompt's immutable state — `message` / `default` / `styler` (data-only).                                                                                         |
| `createConfirmState`         | function  | Build the initial `ConfirmState` from `ConfirmOptions` — defaulting the answer to `false`.                                                                                 |
| `confirmView`                | function  | Render a `ConfirmState` as a styled view — header plus a `(Y/n)` hint with the default letter emphasized.                                                                  |
| `confirmReduce`              | function  | The pure confirm reducer `(state, key) → PromptStep<boolean>` — `y`/`n` submit, return takes the default, ctrl-c cancels.                                                  |
| `SelectOptions`              | interface | A single-selection `selectReduce` prompt's options — `message` / `choices` / `default?` / `styler?` (data-only).                                                           |
| `SelectState`                | interface | A select prompt's immutable state — normalized choices, styler, and the `focused` index (data-only).                                                                       |
| `createSelectState`          | function  | Build the initial `SelectState` from `SelectOptions` — normalizing choices and pre-focusing the default.                                                                   |
| `selectView`                 | function  | Render a `SelectState` as a MULTI-LINE styled view — header then one row per choice, the focused row marked.                                                               |
| `selectReduce`               | function  | The pure select reducer `(state, key) → PromptStep<string>` — up/down move the focus (wrapping), return submits the focused value.                                         |
| `CheckboxOptions`            | interface | A multi-selection `checkboxReduce` prompt's options — `message` / `choices` / `min?` / `max?` / `styler?` (data-only).                                                     |
| `CheckboxState`              | interface | A checkbox prompt's immutable state — choices, styler, `focused`, the `checked` index list, `min` / `max`, and `error` (data-only).                                        |
| `createCheckboxState`        | function  | Build the initial `CheckboxState` from `CheckboxOptions` — normalizing choices, seeding the checked set, carrying min/max.                                                 |
| `checkboxView`               | function  | Render a `CheckboxState` as a MULTI-LINE styled view — header, one box per choice (focused + checked marked), a count, and any error.                                      |
| `checkboxReduce`             | function  | The pure checkbox reducer `(state, key) → PromptStep<readonly string[]>` — space toggles, return submits in choice order gated by min/max.                                 |
| `toggleIndex`                | function  | Toggle an index in a readonly index list — copy-on-write, returning the new list (the checkbox check-set primitive).                                                       |
| `gateSelection`              | function  | The min/max gate for a checkbox submit — the rejection message when the count is out of range, else `undefined`.                                                           |
| `EditorOptions`              | interface | A multi-line `editorReduce` prompt's options (terminated by ctrl-d) — `message` / `default?` / `validate?` / `styler?` (data-only).                                        |
| `EditorState`                | interface | An editor prompt's immutable state — committed `lines`, in-progress `current`, resolved validator/styler, default, and `error` (data-only).                                |
| `createEditorState`          | function  | Build the initial `EditorState` from `EditorOptions` — resolving the validator + styler, seeding empty lines.                                                              |
| `editorView`                 | function  | Render an `EditorState` as a MULTI-LINE styled view — header (with a Ctrl+D hint), committed lines, the in-progress line, and any error.                                   |
| `editorReduce`               | function  | The pure editor reducer `(state, key) → PromptStep<string>` — printable extends, return commits a line, ctrl-d finishes through the validator.                             |
| `editLine`                   | function  | Apply one line-editing `KeyEvent` to a text buffer (the input/password/editor shared editing) — `undefined` when the key doesn't edit.                                     |
| `PromptType`                 | type      | The six prompt KINDS — `input` / `password` / `confirm` / `select` / `checkbox` / `editor` (a named set; the broker dispatches on it).                                     |
| `serializePromptOptions`     | function  | The WIRE-SAFE form of a prompt's options — drops the styler + function validators, KEEPS the declarative rules + choices/default/mask.                                     |
| `serializeValidationRules`   | function  | Flatten a `validate` option to wire-safe `ValidationRules` DATA — a function rule becomes `true`; a bare-function validate yields `undefined`.                             |
| `serializeChoices`           | function  | Strip functions from a `choices` option — each choice keeps its plain fields; a bare string passes through.                                                                |
| `reconstructValidationRules` | function  | Rebuild a wire-decoded `validate` payload into a `ValidationRules` bag — keeps only primitive rule values; the inverse of serialize.                                       |
| `resolveOption`              | function  | Read one wire option by key, narrowed by a guard — `undefined` when absent or off-shape (§14, never an `as`).                                                              |
| `resolveChoices`             | function  | Read a wire `choices` option as bare strings / full choices — each element narrowed by a guard, off-shape elements stringified.                                            |
| `isPromptType`               | const     | Narrow an unknown value to a `PromptType` — one of the six prompt forms (a §14 wire guard, total; built via `literalOf`).                                                  |
| `isPendingPromptStatus`      | const     | Narrow an unknown value to a `PendingPromptStatus` — `pending` / `answered` / `expired` (a §14 wire guard, total; built via `literalOf`).                                  |
| `isPendingPrompt`            | const     | Narrow an unknown wire value to a `PendingPrompt` — the guard a `PromptClient` applies to each decoded SSE `pending` payload (§14, never an `as`; built via `recordOf`).   |
| `isPromptChoice`             | function  | Narrow an unknown value to a `PromptChoice` — the wire guard `resolveChoices` filters a select `choices` payload through (§14, total).                                     |
| `isCheckboxChoice`           | function  | Narrow an unknown value to a `CheckboxChoice` — the wire guard `resolveChoices` filters a checkbox `choices` payload through (§14, total).                                 |
| `dispatchPendingPrompt`      | function  | Dispatch a `PendingPrompt` to the matching `PromptFormInterface` method — the bridge step that drives a local terminal with a remote prompt.                               |
| `defaultTimer`               | function  | The default `TimerHandler` — a thin host `setTimeout` / `clearTimeout` wrapper (the broker expiry + client backoff seam).                                                  |
| `globalFetch`                | function  | The default `FetchHandler` — the global `fetch` adapted to the minimal injected shape the `PromptClient` uses.                                                             |
| `isAbortError`               | function  | Whether a caught value is an `AbortError` — so the client treats a deliberate `disconnect` as a quiet exit, not a fault.                                                   |
| `parseWireJSON`              | function  | Parse a JSON wire string TOTAL — a malformed / empty payload yields `undefined` (never a throw); the client decodes SSE data through it.                                   |
| `isInsecureRemote`           | function  | Whether a URL is a non-loopback `http://` endpoint — the `PromptClient` warns once when a `token` is sent over it in cleartext.                                            |
| `sanitizeChoiceLabels`       | function  | Control-strip every choice's `name` / `description` (bare strings too) — the `dispatchPendingPrompt` select/checkbox path runs remote choices through it before rendering. |

### The pure-core constants

The decode tables, default mask, validation patterns, prompt-view glyphs, rule messages, and broker / SSE-bridge defaults the core reads ([`src/core`](../../src/core)). UPPER_SNAKE, `Object.freeze`d data; control bytes built via `String.fromCharCode` so no raw control character appears in source.

| API                          | Kind  | Summary                                                                                                                               |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RETURN`                     | const | Carriage return (`\r`, U+000D) — Enter on most terminals.                                                                             |
| `NEWLINE`                    | const | Line feed (`\n`, U+000A) — Enter on some terminals / pasted input.                                                                    |
| `TAB`                        | const | Tab (`\t`, U+0009).                                                                                                                   |
| `ESCAPE`                     | const | Escape (ESC, U+001B) — the lone byte, and the lead byte of every CSI / SS3 / cursor sequence (in BOTH modules).                       |
| `BACKSPACE`                  | const | Backspace (BS, U+0008) — Ctrl+H / some terminals' Backspace.                                                                          |
| `DELETE`                     | const | Delete (DEL, U+007F) — the usual Backspace byte on a Unix TTY.                                                                        |
| `SPACE`                      | const | Space (U+0020).                                                                                                                       |
| `CTRL_C`                     | const | Ctrl+C (ETX, U+0003) — interrupt / cancel.                                                                                            |
| `CTRL_D`                     | const | Ctrl+D (EOT, U+0004) — end-of-transmission / finish (the editor's commit key).                                                        |
| `CTRL_U`                     | const | Ctrl+U (NAK, U+0015) — clear the current line.                                                                                        |
| `CTRL_A`                     | const | Ctrl+A (SOH, U+0001) — move to start of line.                                                                                         |
| `CTRL_E`                     | const | Ctrl+E (ENQ, U+0005) — move to end of line.                                                                                           |
| `KEY_CSI`                    | const | The Control Sequence Introducer lead (`ESC[`) for the navigation keys — named `KEY_CSI` so it never collides with console's `CSI`.    |
| `KEY_SS3`                    | const | The Single Shift Three lead (`ESCO`) — the alternate arrow-key prefix some terminals emit (`ESC O A`).                                |
| `SEQUENCE_NAMES`             | const | The escape-SEQUENCE → key-NAME table `parseKey` consults — both the CSI and SS3 forms of the arrows + home/end/delete.                |
| `CONTROL_NAMES`              | const | The control-BYTE → key-descriptor table `parseKey` consults — each entry's canonical `name` + whether it is a `ctrl` combo.           |
| `DEFAULT_MASK`               | const | The default mask glyph a `PasswordState` renders each input character as — `*`.                                                       |
| `EMAIL_PATTERN`              | const | Matches an email address (`local@domain.tld`) — the `email` rule tests against this.                                                  |
| `URL_PATTERN`                | const | Matches an HTTP(S) URL — the `url` rule tests against this.                                                                           |
| `NUMERIC_PATTERN`            | const | Matches a numeric value (integer or decimal, optional sign) — the `numeric` rule tests against this.                                  |
| `INTEGER_PATTERN`            | const | Matches an integer (optional sign) — the `integer` rule tests against this.                                                           |
| `ALPHANUMERIC_PATTERN`       | const | Matches an alphanumeric string (letters and digits only) — the `alphanumeric` rule tests against this.                                |
| `RULE_MESSAGES`              | const | Each built-in rule's default error message — what the composed `Validator` returns when that rule fails (min/max interpolated).       |
| `PROMPT_ICONS`               | const | The prompt-view icon glyphs the reducers render with — PLAIN glyphs, colored by the styler at render time (not baked in).             |
| `DEFAULT_PROMPT_TIMEOUT_MS`  | const | How long (ms) the broker parks an unanswered prompt before it expires — 5 minutes.                                                    |
| `DEFAULT_RECONNECT_DELAY_MS` | const | How long (ms) the `PromptClient` waits before each reconnect attempt — 2 seconds.                                                     |
| `SSE_EVENTS`                 | const | The SSE `event:` names the broker emits and the client dispatches on — `pending` / `expire` / `shutdown`.                             |
| `HEADER_TOKEN`               | const | The auth-token request header the `PromptClient` sends when a `token` is configured.                                                  |
| `ACCEPT_EVENT_STREAM`        | const | The `Accept` header value that opens the broker's SSE stream (`text/event-stream`).                                                   |
| `SSE_BUFFER_LIMIT`           | const | The max characters the `PromptClient`'s SSE parser buffers before treating the stream as hostile — 1 MiB (a memory-exhaustion guard). |

### The terminal error

A real error type (AGENTS §12) a parked broker prompt rejects with, or the server `Terminal` rejects with on ctrl-c ([`src/core`](../../src/core)).

| API                 | Kind     | Summary                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalErrorCode` | type     | The machine-readable condition on a `TerminalError` — `EXPIRE` (a parked prompt timed out / torn down) / `CANCEL` (ctrl-c) / `DRIVER` (a malformed answer to a parked prompt, or the server `Terminal` fallback lacking a readable input stream) / `DEADLOCK` (a `TerminalManager.ask` would close a transitive `from`→`to` cycle) / `TARGET` (a `TerminalManager.ask` names an unknown `to` endpoint). |
| `TerminalError`     | class    | The error a broker prompt's Promise rejects with — carries a `TerminalErrorCode` `code` + an optional `context` (the prompt id).                                                                                                                                                                                                                                                                        |
| `isTerminalError`   | function | Narrow an unknown caught value to a `TerminalError` — branch on `error.code`.                                                                                                                                                                                                                                                                                                                           |

### The headless broker

The PARK-as-Promise arm of the tri-surface — implements `PromptFormInterface` with no terminal, parking each call and resolving it when an answer arrives over a transport ([`src/core`](../../src/core)). Observable (§13).

| API                      | Kind      | Summary                                                                                                                                                                             |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptFormInterface`    | interface | The SHARED async prompt contract — the six prompt forms as Promise-returning methods; the ONE vocabulary all three surfaces implement.                                              |
| `PendingPromptStatus`    | type      | A parked prompt's lifecycle status — `pending` / `answered` / `expired` (names its axis, not `kind`).                                                                               |
| `PendingPrompt`          | interface | One prompt PARKED by the broker — an id-keyed, wire-safe record (`id` / `form` / `message` / `options` / `status` / `time` / optional `from` / `to`) (data-only).                   |
| `Parked`                 | interface | The broker's per-prompt record — a `PendingPrompt` plus the live `respond` / `expire` / `cancel` closures that settle its Promise.                                                  |
| `TimerHandler`           | type      | One injected timer — arms a deadline `callback` after `ms`, returning a `TimerCancel`; the broker's + client's deadline seam.                                                       |
| `TimerCancel`            | type      | Cancel a pending `TimerHandler` deadline — idempotent, safe after the timer fired.                                                                                                  |
| `PromptEventMap`         | type      | The broker's events (§13) — `pending(prompt)` / `answer(id, value)` / `expire(id)`; errors `unknown`, no listener-error event.                                                      |
| `PromptOptions`          | interface | `createPrompt` options — `on?` / `error?` / `timeout?` / `timer?` (data-only).                                                                                                      |
| `PromptValue`            | type      | The union of a resolved prompt's value shapes — `string` / `boolean` / `readonly string[]`; what a `Ticket`'s `value` Promise resolves to.                                          |
| `PromptFormOptions`      | type      | The union of every prompt form's options bag — the `options` a `ParkRequest` carries, narrowed by its paired `PromptType`.                                                          |
| `ParkRequest`            | interface | The request to `PromptInterface.park` a prompt directly — `form` / `options` plus `from?` / `to?` (set ONLY by a `TerminalManagerInterface`) (data-only).                           |
| `Ticket`                 | interface | The handle `PromptInterface.park` returns — the parked prompt's `id` plus the `value` Promise resolving (or rejecting) with a `PromptValue` (data-only).                            |
| `AnswerError`            | type      | The rejection reason a bare `PromptInterface.answer` returns — `'unknown'` (no such parked prompt) or `'rejected'` (failed validation / type-check).                                |
| `AnswerResult`           | type      | The outcome of a bare `PromptInterface.answer` call — `{ success: true, value }` on accept, else `{ success: false, error: AnswerError }` (a Result literal, never a bare boolean). |
| `PromptInterface`        | interface | The headless broker — `emitter` / `count` data + `park` / `pending` / `answer` / `destroy` (+ the inherited prompt forms).                                                          |
| `Prompt`                 | class     | The observable headless broker — parks each call as a `PendingPrompt`, resolves on `answer`, rejects on timeout / teardown.                                                         |
| `createPrompt`           | function  | Create the headless `PromptInterface` broker — the tri-surface's headless arm (forward `pending`, route `answer` back).                                                             |
| `serializePromptOptions` | function  | (Listed under the pure core — the broker serializes each prompt's options through it for the wire.)                                                                                 |

### Transport-neutral bridge wire seams

The `http`-free wire helpers a consumer's own HTTP/SSE spine mounts the broker over — an SSE frame shape plus the serializers that build one for each broker signal, and the guard that narrows an answer POST body ([`src/core`](../../src/core)).

| API                 | Kind      | Summary                                                                                                                          |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `WireEvent`         | interface | One SSE-shaped wire frame — `event` name, JSON-stringified `data`, optional `id` (data-only; no `http` dependency).              |
| `serializePending`  | function  | Serialize a parked `PendingPrompt` into a `WireEvent` — event `'pending'`, `id` the prompt's own id.                             |
| `serializeExpire`   | function  | Serialize a parked prompt's expiry into a `WireEvent` — event `'expire'`, `data` the JSON `{ id }` payload.                      |
| `serializeShutdown` | function  | The `WireEvent` a broker/manager sends when going away — event `'shutdown'`, no payload.                                         |
| `isAnswerPayload`   | function  | Narrow an unknown wire payload to an answer POST body — a non-empty `id` string plus a `value` key present (§14, never an `as`). |

### The SSE bridge

The client-side counterpart to the broker — connects to a remote broker's SSE endpoint, dispatches each received prompt to a LOCAL `PromptFormInterface`, and POSTs the answer back ([`src/core`](../../src/core)). Observable (§13); universal (`fetch` + SSE are web-standard).

| API                     | Kind      | Summary                                                                                                                                                 |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FetchHandler`          | type      | A minimal `fetch` — the subset the `PromptClient` uses (open the SSE stream, POST an answer); injected for hermetic tests.                              |
| `FetchInit`             | interface | The request init the `PromptClient` passes its `FetchHandler` — `method?` / `headers?` / `body?` / `signal?` (data-only).                               |
| `PromptClientEventMap`  | type      | The client's events (§13) — `connect` / `disconnect` / `expire(id)` / `error(unknown)`; no listener-error event.                                        |
| `PromptClientOptions`   | interface | `createPromptClient` options — `url` / `terminal` (required) + `token?` / `reconnect?` / `delay?` / `on?` / `error?` / `fetch?` / `timer?` (data-only). |
| `PromptClientInterface` | interface | The SSE bridge — `emitter` / `url` / `connected` data + `connect` / `disconnect` / `destroy`.                                                           |
| `PromptClient`          | class     | The observable SSE bridge — streams remote prompts to a local terminal, dedupes a replay, reconnects with a backoff.                                    |
| `createPromptClient`    | function  | Create the SSE `PromptClientInterface` bridge — dispatch remote prompts to a local `terminal`, POST answers back.                                       |

### The terminal manager

The multi-endpoint MANAGER — a named registry of `PromptInterface` brokers so several parties (agents, tools, humans) can `ask` prompts of each other by NAME, attributed with a `from` → `to` edge on every parked `PendingPrompt`, and guarded by a transitive DEADLOCK check across every in-flight ask ([`src/core`](../../src/core)). Observable (§13); §9.1 accessors + §9.2 array-overload-first batch removal.

| API                        | Kind      | Summary                                                                                                                                                       |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalOptions`          | interface | `add` / `createTerminalManager` per-endpoint options — `timeout?` / `timer?` (data-only).                                                                     |
| `TerminalManagerEventMap`  | type      | The manager's events (§13) — the name-attributed re-emission of every mounted broker's `pending` / `answer(to, id, value)` / `expire(to, id)`.                |
| `TerminalManagerOptions`   | interface | `createTerminalManager` options — `store?` / `timeout?` / `timer?` / `on?` / `error?` (data-only).                                                            |
| `TerminalAnswerError`      | type      | The rejection reason a `TerminalManagerInterface.answer` returns — an `AnswerError`, plus `'terminal'` (no such endpoint).                                    |
| `TerminalAnswerResult`     | type      | The outcome of a `TerminalManagerInterface.answer` call — `{ success: true, value }`, else `{ success: false, error: TerminalAnswerError }`.                  |
| `TerminalManagerInterface` | interface | The registry — `emitter` / `count` data + `terminal` / `terminals` / `add` / `ask` / `pending` / `answer` / `open` / `save` / `remove` / `clear` / `destroy`. |
| `TerminalManager`          | class     | The observable registry — mints/reuses named brokers, attributes `ask` edges, rejects `TARGET` / `DEADLOCK`, restores/persists via a store.                   |
| `createTerminalManager`    | function  | Create the `TerminalManagerInterface` registry.                                                                                                               |

### The terminal store

The point-access persistence seam (AGENTS §5 — Stores) for a `TerminalManagerInterface`'s endpoint CONFIG snapshots — config only, never live broker state (a parked Promise is process-bound and is never resurrected) ([`src/core`](../../src/core)). Two 10-rule twins over one interface.

| API                           | Kind      | Summary                                                                                                                                         |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalSnapshot`            | interface | One endpoint's persisted CONFIG snapshot — `id` (the endpoint name) + optional `timeout` (data-only).                                           |
| `TerminalSnapshotRow`         | interface | One opaque persisted row — `id` + `snapshot: unknown`, the shape a `TableInterface<TerminalSnapshotRow>`-backed store reads/writes (data-only). |
| `TerminalStoreInterface`      | interface | The store contract — async `get` / `set` / `delete`, keyed by the snapshot's own `id`.                                                          |
| `isTerminalSnapshot`          | const     | Narrow an unknown value to a `TerminalSnapshot` — a non-empty `id` plus an optional numeric `timeout` (§14, never an `as`).                     |
| `MemoryTerminalStore`         | class     | The in-memory twin — a process-lifetime `Map<string, TerminalSnapshot>`; no idle-TTL, no eviction.                                              |
| `DatabaseTerminalStore`       | class     | The `databases`-layer twin — one opaque JSON column over a `TableInterface<TerminalSnapshotRow>`, narrowed with `isTerminalSnapshot` on read.   |
| `createMemoryTerminalStore`   | function  | Create the in-memory `TerminalStoreInterface`.                                                                                                  |
| `createDatabaseTerminalStore` | function  | Create the database-backed `TerminalStoreInterface` (default driver: an in-memory `@orkestrel/database` driver).                                |

### The server Terminal (TTY driver)

The local-TTY arm of the tri-surface — the third `PromptFormInterface` surface and the ONLY impure part of the stack ([`src/server`](../../src/server), surfaced through `@src/server`). Reads raw-mode stdin, drives the pure core reducers, renders each view in place, and falls back to `node:readline` when piped. The core owns every prompt contract (imported, never redeclared); this module owns only the raw-mode / readline mechanics + the stream-boundary types.

| API                     | Kind      | Summary                                                                                                                                                                                              |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputStreamInterface`  | interface | The minimal input-stream shape the driver reads — `on` / `off` (`'data'`) + optional `setRawMode` / `resume` / `pause` / `isTTY` (§21, data-only).                                                   |
| `OutputStreamInterface` | interface | The minimal output-stream shape the driver writes — `write(text)` + optional `isTTY` (§21, data-only).                                                                                               |
| `TerminalOptions`       | interface | `createTerminal` options — `input?` / `output?` (both optional; a bare `createTerminal()` drives the real process streams) (data-only).                                                              |
| `TerminalInterface`     | interface | The interactive terminal prompt DRIVER — the third `PromptFormInterface` surface (the six prompt forms over the resolved streams).                                                                   |
| `Terminal`              | class     | The interactive driver — feeds raw-mode stdin through `parseKey` into the reducers, re-renders in place, falls back to readline.                                                                     |
| `createTerminal`        | function  | Create the `TerminalInterface` — the tri-surface's local-TTY arm, the env-symmetric sibling of `createPrompt` / `createPromptClient`.                                                                |
| `isInputStream`         | function  | Whether a value is a usable `InputStreamInterface` (callable `on` / `off`) — the input boundary guard (§14), total.                                                                                  |
| `isOutputStream`        | function  | Whether a value is a usable `OutputStreamInterface` (callable `write`) — the output boundary guard (§14), total.                                                                                     |
| `isReadable`            | function  | Whether a value is a Node `ReadableStream` (callable `read` / `pipe` / `on`) — narrows the input to the readline boundary (§14).                                                                     |
| `isWritable`            | function  | Whether a value is a Node `WritableStream` (callable `write` / `end`) — narrows the output to the readline boundary (§14).                                                                           |
| `rawCapable`            | function  | Whether an input stream can be driven in RAW mode (`isTTY === true` AND a callable `setRawMode`) — selects raw mode vs. the readline fallback; a plain predicate, not a `Guard` (no reserved `is*`). |
| `lineCount`             | function  | The number of terminal LINES a rendered view occupies (one more than its newline count) — the basis of the in-place re-render.                                                                       |
| `moveUp`                | function  | The cursor-UP control sequence (`ESC[{count}A`), or `''` when `count <= 0` — the pure step the re-render climbs over the prior view with.                                                            |
| `redrawPrefix`          | function  | The full reposition-and-clear prefix to write before re-rendering a view in place — climb, return to column 0, erase to end of screen.                                                               |

### The server-Terminal constants

The cursor / line-clear ANSI control sequences the `Terminal` writes to redraw a view in place, plus the readline-fallback hints ([`src/server`](../../src/server)). UPPER_SNAKE, `Object.freeze`d; sequences built from a named ESC byte so no raw control character appears in source.

| API                      | Kind  | Summary                                                                                                                    |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| `CSI`                    | const | The Control Sequence Introducer (`ESC[`) — the prefix of every cursor / erase sequence below.                              |
| `CSI_UP`                 | const | The cursor-UP sequence TEMPLATE (`ESC[{count}A`) — `moveUp` interpolates `{count}` with the lines to climb.                |
| `CURSOR_HIDE`            | const | Hide the cursor (`ESC[?25l`) — written before the driver redraws so the cursor doesn't flicker; paired with `CURSOR_SHOW`. |
| `CURSOR_SHOW`            | const | Show the cursor (`ESC[?25h`) — restores the cursor after a prompt resolves / cancels.                                      |
| `CLEAR_DOWN`             | const | Erase from the cursor down to the end of the screen (`ESC[J`) — wipes a whole multi-line view before the new one.          |
| `CARRIAGE_RETURN`        | const | A carriage return (`\r`, U+000D) — returns the cursor to column 0 so a redraw starts at the line's left edge.              |
| `LINE_FEED`              | const | A line feed (`\n`, U+000A) — the line terminator the driver writes after the final committed prompt view.                  |
| `FALLBACK_SELECT_HINT`   | const | The numbered-list prompt the non-TTY `select` / `checkbox` fallback appends (`Enter a number`).                            |
| `FALLBACK_CHECKBOX_HINT` | const | The comma-separated multi-select hint the non-TTY `checkbox` fallback shows (`Enter numbers separated by commas`).         |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name (or, where an interface extends another and a class implements both directly, by the CLASS name — see `Prompt` below), every call-signature member listed. Each type's `readonly` data members (`PromptInterface`'s `emitter` / `count`, `PromptClientInterface`'s `emitter` / `url` / `connected`) stay in the Surface rows above and are not repeated here. Each implementing class implements its interface exactly, so this doubles as the per-instance method surface (AGENTS §22).

**Data-only surfaces (no `## Methods` subsection).** Every `*Options` / `*State` / `*EventMap` / `KeyEvent` / `PromptStep` / `PromptChoice` / `CheckboxChoice` / `PendingPrompt` / `FetchInit` / `InputStreamInterface` / `OutputStreamInterface` row is a data / options / record shape with no behavioral methods. `PromptStatus` / `PendingPromptStatus` / `PromptType` / `TerminalErrorCode` / `Validator` / `TimerHandler` / `TimerCancel` / `FetchHandler` are unions / function types, not method-bearing interfaces. `Validator`, `TimerHandler`, `TimerCancel`, and `FetchHandler` are CALLABLE function types (a single call signature, no named methods), so they carry no method table either.

#### `PromptFormInterface`

The shared async contract all three surfaces (`Terminal` / `Prompt` / a `PromptClient`-driven terminal) implement. `PromptInterface` extends it (so the broker exposes these too) and `TerminalInterface` IS exactly it.

| Method     | Returns                      | Behavior                                                                     |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `input`    | `Promise<string>`            | Prompt for a single line of text (the empty line falls back to the default). |
| `password` | `Promise<string>`            | Prompt for masked text (no echoed default).                                  |
| `confirm`  | `Promise<boolean>`           | Prompt yes/no (return takes the default).                                    |
| `select`   | `Promise<string>`            | Prompt to pick ONE choice — resolves the focused choice's `value`.           |
| `checkbox` | `Promise<readonly string[]>` | Prompt to pick MANY choices — resolves the checked values in choice order.   |
| `editor`   | `Promise<string>`            | Prompt for multi-line text (finished by ctrl-d / EOF).                       |

#### `Prompt`

`PromptInterface` extends `PromptFormInterface`, and the `Prompt` class implements every member of both directly, so its full instance method surface (the six inherited prompt forms plus its own broker lifecycle) is documented here, keyed by the CLASS name rather than `PromptInterface` — this one table is the exact, exhaustive surface a `Prompt` instance exposes (AGENTS §22).

| Method     | Returns                                                   | Behavior                                                                                                                                                                    |
| ---------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`    | `Promise<string>`                                         | Prompt for a single line of text (empty falls back to the default) — parks it as a `PendingPrompt`.                                                                         |
| `password` | `Promise<string>`                                         | Prompt for masked text (no echoed default) — parks it as a `PendingPrompt`.                                                                                                 |
| `confirm`  | `Promise<boolean>`                                        | Prompt yes/no (return takes the default) — parks it as a `PendingPrompt`.                                                                                                   |
| `select`   | `Promise<string>`                                         | Prompt to pick ONE choice — parks it as a `PendingPrompt`.                                                                                                                  |
| `checkbox` | `Promise<readonly string[]>`                              | Prompt to pick MANY choices — parks it as a `PendingPrompt`.                                                                                                                |
| `editor`   | `Promise<string>`                                         | Prompt for multi-line text (finished by ctrl-d / EOF) — parks it as a `PendingPrompt`.                                                                                      |
| `park`     | `Ticket`                                                  | Park a prompt directly from a `ParkRequest` (`form` / `options` / optional `from` / `to`) — the general entry the six form methods wrap.                                    |
| `pending`  | `readonly PendingPrompt[]` / `PendingPrompt \| undefined` | List all parked prompts (`pending()`) / look one up by id (`pending(id)`) (§9.1).                                                                                           |
| `answer`   | `AnswerResult`                                            | Validate + type-check an answer for a parked prompt; on accept resolve its Promise and return `{ success: true, value }` (else `{ success: false, error }`, stays pending). |
| `destroy`  | `void`                                                    | Tear down — expire every still-pending prompt (their Promises reject) and destroy the emitter.                                                                              |

#### `PromptClientInterface`

The SSE bridge — its connection lifecycle methods.

| Method       | Returns         | Behavior                                                                                                            |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `connect`    | `Promise<void>` | Open the SSE stream and pump it, dispatching each remote prompt to the local terminal; reconnects with the backoff. |
| `disconnect` | `void`          | Stop the current connection AND prevent reconnect (a later `connect()` may restart).                                |
| `destroy`    | `void`          | Tear down — `disconnect()`, drop in-flight ids, and destroy the emitter.                                            |

#### `TerminalInterface`

The interactive TTY driver. `TerminalInterface` IS exactly `PromptFormInterface` (it adds no members), so its method surface is the six prompt forms documented above — it carries no Methods table of its own.

#### `TerminalManagerInterface`

The multi-endpoint registry — the `TerminalManager` class implements it directly, so this table is its exact instance method surface too (AGENTS §22).

| Method      | Returns                                                               | Behavior                                                                                                                      |
| ----------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `terminal`  | `PromptInterface \| undefined`                                        | Look up one endpoint's broker by name (§9.1).                                                                                 |
| `terminals` | `readonly string[]`                                                   | List every mounted endpoint name (§9.1).                                                                                      |
| `add`       | `PromptInterface`                                                     | Mint (or return the EXISTING, unchanged) broker for `name` — idempotent, never clobbers a live endpoint.                      |
| `ask`       | `Promise<string>` / `Promise<boolean>` / `Promise<readonly string[]>` | Park a prompt from `from` to `to` (auto-`add`ing `to`), precisely overloaded per `PromptType`; rejects `TARGET` / `DEADLOCK`. |
| `pending`   | `readonly PendingPrompt[]`                                            | List every endpoint's parked prompts (`pending()`) / scope to one endpoint (`pending(to)`) (§9.1).                            |
| `answer`    | `TerminalAnswerResult`                                                | Route an answer to the named endpoint's broker (`{ success: false, error: 'terminal' }` for an unknown endpoint).             |
| `open`      | `Promise<PromptInterface \| undefined>`                               | Restore (or return the live) broker for `name` from the `store` — an EMPTY broker, never resurrecting parked Promises.        |
| `save`      | `Promise<boolean>`                                                    | Persist an endpoint's config snapshot to the `store` (`false` when there is no store, or `name` is unknown).                  |
| `remove`    | `boolean`                                                             | Remove a batch (`remove(names)`, §9.2 array overload FIRST — `true` when any was removed) or one endpoint (`remove(name)`).   |
| `clear`     | `void`                                                                | Remove every endpoint without destroying the manager.                                                                         |
| `destroy`   | `void`                                                                | Tear down — destroy every broker, then the manager's own emitter.                                                             |

#### `TerminalStoreInterface`

The persistence seam both `MemoryTerminalStore` and `DatabaseTerminalStore` implement exactly.

| Method   | Returns                                  | Behavior                                                                   |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `get`    | `Promise<TerminalSnapshot \| undefined>` | Resolve the persisted snapshot for `id`, or `undefined` if none is stored. |
| `set`    | `Promise<void>`                          | Insert / replace under the snapshot's OWN `id` (no separate id param).     |
| `delete` | `Promise<void>`                          | Drop a snapshot by id; an absent id is a no-op (no throw).                 |

## Contract

These invariants hold across `src/core` ↔ `src/server` ↔ `terminal.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the terminal source trees (`src/core` plus the `src/server` env backend), and every export appears as a Surface row — exhaustive, both directions (AGENTS §22). (`ESCAPE` is exported by BOTH modules' `constants.ts` as the same ESC byte; the parity gate concatenates the trees and dedupes, so the one Surface row covers both.)
2. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`Prompt` / `PromptClient` / `Terminal` / `TerminalManager`) implements every method of its interface and adds none beyond it (AGENTS §22). A renamed / added / removed method breaks the gate until the table is reconciled.
3. **The reducers are pure, total, copy-on-write.** Each `*Reduce` is a total `(state, key) → PromptStep` — it never throws, never mutates `state` (it builds a NEW state on every transition), and always returns a rendered `view` + a `status`. A reducer that doesn't consume the key returns the state unchanged with `status: 'active'`. The driver applies `step.state`, writes `step.view`, and (when `status === 'submit'`) reads `step.value`; the `value` is present ONLY on a `submit` step.
4. **`parseKey` totality.** `parseKey` decodes any input (`string` / `Uint8Array`) into a `KeyEvent` and NEVER throws — a known control byte / escape sequence maps to its canonical `name` (via `CONTROL_NAMES` / `SEQUENCE_NAMES`), a printable character names itself (with `shift` for an uppercase letter), and an unrecognized sequence yields `name: ''` with the raw `sequence` preserved. The driver can therefore never crash on a stray byte.
5. **Validation is declarative DATA — so it crosses the wire.** A `ValidationRules` is a plain record, NOT a closure; `resolveValidation` compiles it (or a bare `Validator`, or nothing) into ONE composed `Validator` that runs the rules in the fixed order (required → minimum → maximum → pattern → email → url → numeric → integer → alphanumeric → custom) and returns the FIRST failing rule's message (short-circuiting), or `true`. Because the rules are data, the broker serializes them (`serializeValidationRules` flattens each function rule to `true`, keeping the built-in intent) and the client reconstructs the validator from them (`reconstructValidationRules` → `resolveValidation`) — so a remotely-parked prompt validates exactly as a local one. `resolveValidation` ALWAYS returns a validator (an absent / empty rule set yields an always-passing one), so a prompt's state unconditionally holds a real validator.
6. **The tri-surface — one contract, three impls.** ONE `PromptFormInterface` (the six async prompt methods) is implemented THREE ways: the server `Terminal` (local TTY), the headless `Prompt` broker (park-as-Promise), and a `PromptClient`-driven local terminal (a remote prompt dispatched to THIS machine). A prompt issued through this contract resolves the same way on every surface — the shared core supplies the state machine, the validation, and the decode, so the surfaces differ only in HOW the bytes/answers arrive.
7. **The broker: park-as-Promise + `answer` (a Result literal) / timeout → `expire`.** Each `Prompt` call (or a direct `park(request)`) mints an id (`crypto.randomUUID()`), parks a wire-safe `PendingPrompt`, emits `pending`, and returns an unresolved Promise (`park` also returns the `id` in its `Ticket`). `answer(id, value)` runs the prompt's per-form gate — it type-checks `value` to the form (`string` / `boolean` / `string[]`) AND (for the text forms) runs the resolved validator; a rejected answer returns `{ success: false, error }` (an `AnswerResult` — `'unknown'` for no such parked prompt, `'rejected'` for a failed gate) and the prompt stays `pending`, an accepted answer resolves the Promise, emits `answer`, removes the prompt, and returns `{ success: true, value }`. An unanswered prompt expires after `timeout` ms (via the INJECTED timer) — `expire` fires and the Promise rejects with a `TerminalError(code: 'EXPIRE')`; `destroy()` expires every still-pending prompt the same way. The timer is injectable, so expiry is driven without real time.
8. **The client: reconnect-replay-safe dedupe + `disconnect` stops reconnect.** The `PromptClient` opens the SSE stream, §14-narrows every decoded payload (`isPendingPrompt`, never an `as`), dispatches each prompt to the local `terminal`, and POSTs the resolved value back. A prompt already in flight (same id) is IGNORED, so a reconnection that replays buffered events can never double-answer. `connect()` reconnects after the stream drops with the `delay` backoff (the injected timer) — UNLESS `reconnect` is `false`, the client was `destroy`ed, or the drop was a deliberate `disconnect()`. `disconnect()` aborts the in-flight stream, cancels the backoff, and clears the connect loop's flag so it EXITS instead of reconnecting (a later `connect()` may restart it). A server `shutdown` event calls `disconnect()` (not `destroy()`) — the client stops streaming without auto-reconnect but STAYS REUSABLE; a later `connect()` recovers it.
9. **The server `Terminal`: raw-mode leak-freedom + cancel → `TerminalError('CANCEL')` + masking + the non-TTY fallback.** The driver enters raw mode exactly ONCE per prompt and ALWAYS cleans up — on submit, on cancel, and on a throw inside a step — leaving no raw mode and no leaked `'data'` listener (the cleanup closure is invoked on every exit path). Between keystrokes it re-renders the view IN PLACE (climb over the previous view's `lineCount` lines via `redrawPrefix`, clear down, write the new view), hiding the cursor for the duration and restoring it after. A ctrl-c cancels: the awaited prompt call rejects with a `TerminalError(code: 'CANCEL')` so a caller branches on `error.code`. A password's `view` masks the value (the real value is never echoed). When `input` is not a TTY (`rawCapable` is `false`), raw mode is unavailable, so the prompts fall back to `node:readline` line input (still validating) — `select` / `checkbox` present a numbered list read via a readline line, and `editor` reads lines until EOF; a fallback path with no readable input stream rejects `TerminalError('DRIVER', …)` rather than a bare `Error`. The streams are resolved through their §14 guards (`isInputStream` / `isOutputStream`, never an `as`), so a test drives every prompt with a fake TTY emitting scripted key chunks and recording the rendered output.
10. **The manager: named registry + attributed `ask` + transitive `DEADLOCK` + durable config.** `TerminalManager.add(name, options?)` mints (or reuses) one `Prompt` broker per endpoint and re-emits its `pending` / `answer` / `expire` events on the manager, attributed by `name` (`TerminalManagerEventMap`). `ask(from, to, form, options)` auto-`add`s `to` if absent, records the `from → to` edge in the in-flight edge set, and parks through `to`'s broker — it rejects `TerminalError('TARGET', …)` for an unknown `to`, and `TerminalError('DEADLOCK', …)` when the new edge would close a transitive cycle over every CURRENT in-flight edge (walked ancestor-first, mirroring an agent-tool ancestry guard); the edge clears on every settle path (answer / expire / `remove` / `clear` / `destroy`). `answer(to, id, value)` routes to `to`'s broker (`TerminalAnswerResult`, `'terminal'` for an unknown endpoint). `open(name)` restores an EMPTY broker from the `store` (never resurrecting a parked Promise); `save(name)` persists the endpoint's configured `timeout`. `remove` (§9.2, array overload first) destroys one or a batch of endpoints, expiring every prompt still parked on each (settling its `ask` ticket and clearing its edge); `clear` removes all; `destroy` is idempotent.
11. **Transport-neutral wire seams — no `http` dependency.** `serializePending` / `serializeExpire` / `serializeShutdown` build a `WireEvent` (`event` / `data` / optional `id`) for each broker signal, so a consumer's own HTTP/SSE spine mounts the broker without this package importing `node:http`; `isAnswerPayload` (§14) narrows an inbound answer POST body before it reaches `answer`.
12. **The core / server split — universal logic, one impure driver.** The cross-environment core owns EVERYTHING universal: the `parseKey` decoder, the six reducers + their state factories + view renderers, the declarative validation, the broker, and the SSE bridge — all pure types + functions + immutable state, no `node:*`, no TTY, no I/O. The server module owns ONLY the `Terminal` raw-mode / readline driver — the one piece that touches a real `process.stdin` / `process.stdout` — and the stream-boundary types; it imports every prompt contract from `@src/core` (never redeclares them). The view is rendered through the shared console `StylerInterface` (one style engine), so swapping the byte source (TTY vs. wire) never touches the prompt logic.

Deliberately **not** part of this surface yet, by the same "build only what earns its keep" discipline: the SSE-server END of the bridge (the broker emits `pending` on its `emitter` — a consumer mounts it on their own HTTP spine's SSE-stream seam + answers via a POST route; this package ships the bridge, not that spine), and a cursor-movement / line-edit-within-a-line capability (the reducers edit at the END of the buffer — `ctrl-a` / `ctrl-e` decode but no left/right insertion is modelled).

## Patterns

### A TTY prompt (the local Terminal)

```ts
import { createTerminal } from '@src/server'

const terminal = createTerminal() // process.stdin / process.stdout by default
const name = await terminal.input({
	message: 'Your name',
	validate: { required: true, minimum: 2 },
})
const role = await terminal.select({
	message: 'Pick a role',
	choices: ['admin', 'editor', { name: 'Viewer', value: 'viewer', description: 'read-only' }],
})
const scopes = await terminal.checkbox({
	message: 'Scopes',
	choices: ['read', 'write', 'deploy'],
	min: 1,
})
const proceed = await terminal.confirm({ message: 'Continue?', default: true })

// ctrl-c rejects with a TerminalError('CANCEL') — branch on the code:
import { isTerminalError } from '@src/core'
try {
	await terminal.password({ message: 'Token' }) // masked, never echoed
} catch (error) {
	if (isTerminalError(error) && error.code === 'CANCEL') return
}
```

### The headless broker (park + answer)

```ts
import { createPrompt } from '@src/core'

const prompt = createPrompt({ timeout: 60_000 })
prompt.emitter.on('pending', (pending) => send(pending)) // forward to whoever can answer
prompt.emitter.on('expire', (id) => log(`prompt ${id} timed out`))

const answer = prompt.input({ message: 'Your name', validate: { required: true } }) // parks — unresolved
// ...elsewhere, an answer arrives over the transport:
const result = prompt.answer(id, 'Ada') // { success: true, value: 'Ada' }; resolves the awaited input() above
if (!result.success) log(result.error) // 'unknown' | 'rejected'
prompt.pending() // the still-parked prompts
const name = await answer // 'Ada'
prompt.destroy() // expire every still-pending prompt (their Promises reject) and destroy the emitter
```

### Parking a prompt directly (the general entry)

```ts
import { createPrompt } from '@src/core'

const prompt = createPrompt()
const ticket = prompt.park({ form: 'input', options: { message: 'Your name' } })
ticket.id // the parked prompt's id
prompt.answer(ticket.id, 'Ada')
const value = await ticket.value // 'Ada' (a PromptValue)
```

### The SSE bridge (remote prompt → local terminal)

```ts
import { createPromptClient, createPrompt } from '@src/core'
import { createTerminal } from '@src/server'

// Issue prompts on a server through the broker; answer them on a CLIENT machine's terminal.
const client = createPromptClient({
	url: 'http://host/prompts',
	terminal: createTerminal(), // a local PromptFormInterface — answered at THIS keyboard
	on: { connect: () => log('connected'), error: (e) => log(e) },
})
await client.connect() // streams remote prompts to the terminal, POSTs answers back; reconnects on drop
client.disconnect() // stop streaming AND stop reconnecting
client.destroy() // disconnect(), drop in-flight ids, and destroy the emitter
```

### Driving a reducer directly (the pure path)

```ts
import { createInputState, inputReduce, parseKey } from '@src/core'

// No TTY, no broker — drive the pure state machine yourself (this is what a Terminal does internally).
let state = createInputState({ message: 'Name', validate: { required: true } })
for (const byte of ['A', 'd', 'a', '\r']) {
	const step = inputReduce(state, parseKey(byte))
	state = step.state
	render(step.view) // the styled view to show now
	if (step.status === 'submit') return step.value // 'Ada'
}
```

### A validated input (declarative rules)

```ts
import { resolveValidation } from '@src/core'

// The rules compile into ONE composed validator — first failing rule short-circuits.
const validate = resolveValidation({ required: true, minimum: 3, email: true })
validate('') // 'This field is required'
validate('ab') // 'Must be at least 3 characters'
validate('not-an-email') // 'Must be a valid email address'
validate('a@b.co') // true

// The same rules cross the wire: a broker prompt carries them as DATA (no closure),
// and the client rebuilds this exact validator from them.
```

### The validation engine's building blocks

```ts
import {
	appendRule,
	buildRuleValidator,
	composeValidators,
	evaluateRule,
	isPrintable,
	passing,
} from '@src/core'

isPrintable('a') // true — a printable, non-control character
isPrintable('\x7f') // false — DEL
evaluateRule('required', true, '') // 'This field is required'
evaluateRule('minimum', 3, 'ab') // 'Must be at least 3 characters'
const required = buildRuleValidator('required', true) // wraps ONE named rule into a Validator

const validators: Array<(input: string) => true | string> = []
appendRule(validators, 'required', true) // pushes the wrapped rule (a `false` / `undefined` check is skipped)
appendRule(validators, 'email', true)
const validate = composeValidators(...validators) // short-circuits on the FIRST failing rule
validate('') // 'This field is required'
validate('not-an-email') // 'Must be a valid email address'

passing('anything') // true — the always-passing Validator resolveValidation falls back to
```

### Driving every reducer directly (the pure path, each form)

```ts
import {
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createPasswordState,
	createSelectState,
	checkboxReduce,
	checkboxView,
	confirmReduce,
	confirmView,
	editLine,
	editorReduce,
	editorView,
	gateSelection,
	normalizeChoice,
	normalizeCheckboxChoice,
	parseKey,
	passing,
	passwordReduce,
	passwordView,
	promptHeader,
	selectReduce,
	selectView,
	submitHeader,
	errorLine,
	toggleIndex,
	inputView,
} from '@src/core'

// Passwords — identical line-editing to input(), but the view masks the value.
let password = createPasswordState({ message: 'Token' })
password = passwordReduce(password, parseKey('s')).state
passwordView(password) // the header + the masked value

// Confirm — y/n or return-takes-default.
const confirm = createConfirmState({ message: 'Continue?', default: true })
confirmView(confirm) // the header + a `(Y/n)` hint
confirmReduce(confirm, parseKey('y')) // { status: 'submit', value: true, ... }

// Select — up/down move the focus, wrapping.
let select = createSelectState({ message: 'Pick', choices: ['a', 'b', normalizeChoice('c')] })
select = selectReduce(select, parseKey('\x1b[B')).state // down
selectView(select) // a MULTI-LINE view, the focused row marked

// Checkbox — space toggles, return submits (gated by min/max).
let checkbox = createCheckboxState({ choices: ['x', normalizeCheckboxChoice('y')], min: 1 })
checkbox = checkboxReduce(checkbox, parseKey(' ')).state // toggles the focused index
checkboxView(checkbox) // a MULTI-LINE view with a selected-count summary
toggleIndex(checkbox.checked, 0) // copy-on-write toggle (the primitive `checkboxReduce` calls)
gateSelection(checkbox.checked.length, 1, undefined) // undefined once the min is met

// Editor — return commits a line, ctrl-d finishes through the validator.
let editor = createEditorState({ message: 'Notes' })
editor = editorReduce(editor, parseKey('h')).state
editorView(editor) // the committed lines + the in-progress line

// The shared header/error line renderers + the line-editing primitive:
promptHeader(select.styler, 'Pick') // '? Pick'
submitHeader(select.styler, 'Pick') // '✔ Pick'
errorLine(select.styler, 'bad input') // '✖ bad input'
inputView({ message: 'x', default: '', validator: passing, styler: select.styler, value: 'hi' })
editLine('hi', parseKey('!')) // 'hi!' — undefined when the key doesn't edit
```

### The wire serialize / reconstruct round-trip (T-b)

```ts
import {
	defaultTimer,
	dispatchPendingPrompt,
	globalFetch,
	isAbortError,
	isCheckboxChoice,
	isInsecureRemote,
	isPendingPrompt,
	isPendingPromptStatus,
	isPromptChoice,
	isPromptType,
	parseWireJSON,
	reconstructValidationRules,
	resolveChoices,
	resolveOption,
	sanitizeChoiceLabels,
	serializeChoices,
	serializePromptOptions,
	serializeValidationRules,
} from '@src/core'
import { isString } from '@orkestrel/contract'

// A broker serializes a prompt's raw options for the wire (drops the styler + function validators):
const wire = serializePromptOptions({ message: 'Name', validate: { required: true } })
serializeValidationRules({ required: true, custom: () => true }) // { required: true, custom: true }
serializeChoices(['a', { name: 'B', value: 'b' }]) // function-stripped, plain fields kept

// A client reconstructs the validator + choices from that wire data:
reconstructValidationRules(wire.validate) // { required: true } — primitives only
resolveOption(wire, 'message', isString) // 'Name', or undefined when absent/off-shape
resolveChoices({ choices: ['a', { name: 'B', value: 'b' }] }, isPromptChoice) // narrowed per element

// The §14 wire guards a decoded payload is narrowed through before use:
isPromptType('select') // true
isPendingPromptStatus('pending') // true
isPendingPrompt({ id: '1', form: 'input', message: 'x', options: {}, status: 'pending', time: 0 }) // true
isCheckboxChoice({ name: 'x', value: 'x' }) // true

// Cleartext-token guard + remote choice sanitizing:
isInsecureRemote('http://example.com') // true — non-loopback http
isInsecureRemote('http://localhost:3000') // false — loopback is fine
isInsecureRemote('https://example.com') // false — encrypted
sanitizeChoiceLabels(['plain', { name: 'B', value: 'b', description: 'ok' }]) // control chars stripped

// The bridge dispatch step + its wiring seams:
import { createTerminal } from '@src/server'
const pending = {
	id: '1',
	form: 'input' as const,
	message: 'Name',
	options: wire,
	status: 'pending' as const,
	time: Date.now(),
}
await dispatchPendingPrompt(createTerminal(), pending) // routes to the matching prompt form, returns its value

const cancel = defaultTimer(() => {}, 1_000) // the default TimerHandler (host setTimeout/clearTimeout)
cancel() // idempotent, safe after the timer fired
await globalFetch('http://host/prompts') // the default FetchHandler (the global fetch, adapted)
isAbortError(new DOMException('aborted', 'AbortError')) // true — a deliberate disconnect, not a fault
parseWireJSON('{"a":1}') // { a: 1 } — malformed / empty input yields undefined, never a throw
```

### Transport-neutral wire seams (mounting the broker on a custom HTTP/SSE spine)

```ts
import { isAnswerPayload, serializeExpire, serializePending, serializeShutdown } from '@src/core'
import { createPrompt } from '@src/core'

const prompt = createPrompt()
prompt.emitter.on('pending', (pending) => {
	const frame = serializePending(pending) // { event: 'pending', data: '...', id: pending.id }
	sendToClient(frame) // e.g. write an SSE frame over your own HTTP spine
})
prompt.emitter.on('expire', (id) => sendToClient(serializeExpire(id))) // { event: 'expire', data: '{"id":"..."}' }
sendToClient(serializeShutdown()) // { event: 'shutdown', data: '' } — sent when the broker/manager is going away

// Narrow an inbound answer POST body (§14, never an `as`) before it reaches `answer`:
const body: unknown = await readJSON(request)
if (isAnswerPayload(body)) prompt.answer(body.id, body.value)
```

### The multi-endpoint terminal manager (`ask` / `answer` / durable config)

```ts
import { createTerminalManager, isTerminalError } from '@src/core'

const manager = createTerminalManager()
manager.add('agent') // mint (or reuse, unchanged) the 'agent' endpoint's broker
manager.terminals() // ['agent']
manager.terminal('agent') // the mounted PromptInterface, or undefined

// `ask` attributes a from -> to edge and auto-adds `to` if absent:
const name = manager.ask('user', 'agent', 'input', { message: 'Your name' })
const [pending] = manager.pending('agent')
manager.answer('agent', pending.id, 'Ada') // { success: true, value: 'Ada' }
await name // 'Ada'

// A cycle over the in-flight edges rejects DEADLOCK; an unknown endpoint rejects TARGET:
try {
	await manager.ask('agent', 'user', 'input', { message: 'circular?' })
} catch (error) {
	if (isTerminalError(error) && error.code === 'DEADLOCK') log('would deadlock')
}

// Durable config (requires a `store`, e.g. createMemoryTerminalStore()):
await manager.save('agent') // persist the endpoint's configured timeout
await manager.open('agent') // restore an EMPTY broker (no parked Promises resurrected)

manager.remove(['agent']) // batch remove (§9.2 array overload first) — true when any was removed
manager.clear() // remove every endpoint, manager stays usable
manager.destroy() // destroy every broker, then the manager's own emitter
```

### The terminal store (memory + database twins)

```ts
import { createDatabaseTerminalStore, createMemoryTerminalStore } from '@src/core'

const memory = createMemoryTerminalStore()
await memory.set({ id: 'agent', timeout: 30_000 })
await memory.get('agent') // { id: 'agent', timeout: 30_000 }
await memory.delete('agent') // no-op if absent

const database = createDatabaseTerminalStore() // in-memory @orkestrel/database driver by default
await database.set({ id: 'agent', timeout: 30_000 })
await database.get('agent') // narrowed back from the opaque JSON column via isTerminalSnapshot
await database.delete('agent')

// A manager wires either twin as its `store`:
import { createTerminalManager } from '@src/core'
const manager = createTerminalManager({ store: database })
```

### The server stream + cursor helpers directly

```ts
import {
	isInputStream,
	isOutputStream,
	rawCapable,
	isReadable,
	isWritable,
	lineCount,
	moveUp,
	redrawPrefix,
} from '@src/server'

isInputStream(process.stdin) // true — callable on/off
isOutputStream(process.stdout) // true — callable write
isReadable(process.stdin) // true — the node:readline `input` boundary
isWritable(process.stdout) // true — the node:readline `output` boundary
rawCapable(process.stdin) // true on a real TTY with setRawMode; false off a TTY (selects the readline fallback)

lineCount('one\ntwo\nthree') // 3
moveUp(2) // the ESC[2A cursor-up sequence, or '' when count <= 0
redrawPrefix(3) // climb 2 lines, return to column 0, erase to end of screen — the in-place redraw prefix
```

## Tests

- [`tests/guides/src/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ source bijection across `src/core` and the `src/server` backend (value + type exports), plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — the pure core: `parseKey` totality (control bytes / arrow sequences both forms / printable / unknown), the validation engine (each built-in rule + composition + `resolveValidation`), the choice normalizers, the six reducers (every key path + copy-on-write + submit/cancel), the wire serialize/reconstruct round-trip + the §14 wire guards, and the broker/bridge wiring helpers.
- [`tests/src/core/Prompt.test.ts`](../../tests/src/core/Prompt.test.ts) — the broker: park-as-Promise + `pending` accessors + `count`, `answer` validate + type-check (accept / reject stays pending), timeout → `expire` → reject (manual timer), `destroy` expiry, and the `pending` / `answer` / `expire` events + emit-safety.
- [`tests/src/core/PromptClient.test.ts`](../../tests/src/core/PromptClient.test.ts) — the SSE bridge over a scripted `fetch`: connect + dispatch a `pending` to a local terminal + POST the answer, the replay dedupe (same id in flight ignored), `expire` / `shutdown` server signals, reconnect backoff (manual timer), `disconnect` stops the reconnect loop, and the `connect` / `disconnect` / `error` events.
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — `createPrompt` / `createPromptClient` / `createTerminalManager` / `createMemoryTerminalStore` / `createDatabaseTerminalStore` each return a working instance of their interface.
- [`tests/src/core/TerminalManager.test.ts`](../../tests/src/core/TerminalManager.test.ts) — the manager: registry accessors + idempotent `add`, attributed `ask` (auto-`add`, `TARGET` rejection), the transitive `DEADLOCK` guard across every in-flight edge (cleared on answer / expire / remove / clear / destroy), `pending` / `answer` routing, durable `open` / `save`, batch `remove` (§9.2), `clear`, `destroy`, and the name-attributed event re-emission.
- [`tests/src/core/stores.test.ts`](../../tests/src/core/stores.test.ts) — the shared 10-rule suite run against both `MemoryTerminalStore` and `DatabaseTerminalStore`: `get` / `set` / `delete`, upsert-by-own-id, absent-id no-op, and the `isTerminalSnapshot` narrow on a `DatabaseTerminalStore` read.
- [`tests/src/server/Terminal.test.ts`](../../tests/src/server/Terminal.test.ts) — the driver over a fake TTY emitting scripted key chunks: each prompt form resolves its value, cancel-on-ctrl-c rejects a `TerminalError('CANCEL')`, raw mode entered exactly once + always cleaned up (no leak), the in-place re-render output, password masking, and the non-TTY readline fallback (numbered list / EOF editor).
- [`tests/src/server/helpers.test.ts`](../../tests/src/server/helpers.test.ts) — the server helpers: the stream-boundary guards (`isInputStream` / `isOutputStream` / `isReadable` / `isWritable`), `rawCapable`, and the pure cursor-math (`lineCount` / `moveUp` / `redrawPrefix`).
- [`tests/src/server/factories.test.ts`](../../tests/src/server/factories.test.ts) — `createTerminal` returns a working `TerminalInterface` over the resolved (or injected) streams.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the rules; §11 immutability (copy-on-write reducers), §13 the emitter pattern (the broker / client listener isolation), §14 boundary narrowing (the wire + stream guards), §21 minimal interface (the stream shapes), §22 documentation-as-contracts.
- [`console.md`](console.md) — the `StylerInterface` the reducers render their `view` through (one style engine), and the `strip` / `width` the views are measured against.
- [`emitter.md`](emitter.md) — the typed emitter the `Prompt` broker / `PromptClient` own for their `pending` / `answer` / `expire` / `connect` events.
- [`sse.md`](sse.md) — the `SSEParser` the `PromptClient` decodes the broker's event stream with.
- [`README.md`](../README.md) — the guides index.
