# Console

> One unified output-control system for a terminal, a browser, and a server. It composes five concerns over one shared substrate: a **style engine** (text style is DATA, rendered by a swappable renderer), **structured logging** (a leveled `Logger` whose record + `entry` event ARE the transport seam), **narrative reporting** (a `Reporter` of sections / steps / timings / tables / trees / boxes), **console & stream capture** (take control of `console.*` / `process.*` on the read side), and **live animations** (a self-driving `Spinner`, an update-driven `Progress`). The unifying ideas: **style as data** (a `Style` is a frozen record, not a baked escape string), the **`Sink` seam** (the one place text leaves the system — swap it to retarget), and the **`entry` / `capture` event** as the transport seam (records flow to file / JSON / remote transports off an emitter, never a second code path).
>
> The design is **one engine, environment sinks**. The cross-environment core owns the contract and all the universal logic; each environment provides only the platform output backend at the `Sink` seam: ANSI / SGR escape codes are the default (the `ANSIRenderer` + the `createConsoleSink`), the browser translates ANSI to `console.log('%c…', css)` at the sink (`createBrowserSink`), and the server writes to the real `process` streams — ANSI verbatim on a TTY, [`strip`](#styling)ped to clean text down a pipe (`createServerSink`). The animations push the line-OVERWRITE decision down to the sink too: a `Spinner` / `Progress` writes a leading `\r` + its frame, and a TTY sink overwrites the line natively while a browser / plain sink degrades to a fresh line — the same code, a live redraw or a clean fallback per environment. Source: [`src/core`](../../src/core) (surfaced through `@src/core`), with the browser sink in [`src/browser`](../../src/browser) (`@src/browser`) and the server sink + process capture in [`src/server`](../../src/server) (`@src/server`).

## Surface

Build a styled, leveled logger and a narrative reporter over the shared substrate; the SAME code retargets to any environment by swapping the `sink`:

```ts
import { createLogger, createReporter, createSpinner } from '@src/core'

const logger = createLogger({ name: 'http', level: 'info' }) // ANSI to the console by default
logger.info('request', { method: 'GET', path: '/' }) // a styled, leveled line + an `entry` event
logger.emitter.on('entry', (record) => archive(record)) // the transport seam — file / JSON / remote

const reporter = createReporter()
reporter.section('Build')
reporter.step('bundling', { index: 2, total: 5 }) // [2/5] bundling
reporter.status('success', 'built in 1.2s') // ✔ built in 1.2s

const spinner = createSpinner({ message: 'deploying' })
spinner.start() // a self-driving glyph cycle, `\r`-redrawn by an overwrite-capable sink
spinner.success('deployed') // ✔ deployed — the timer cleared, the line committed
```

Style is **data**: a `Style` is a frozen `{ foreground?, background?, attributes }` record, and a `RendererInterface` turns it into output for one target. The `Styler` is the fluent surface — `styler.red.bold('hi')` accumulates a style and renders it through the injected renderer; swap the renderer (ANSI default → browser `%c`) and the style model never changes. Logging is **orthogonal to styling**: a `LogLevel` is one coherent ascending scale (`debug` < `info` < `warn` < `error`), and a level's color is a styling choice, never a pseudo-level. Every retention buffer (a logger's tail, a capture's buffers) is **bounded** — never an unbounded leak.

### Styling

The style engine — text style as DATA, rendered by a swappable renderer (ANSI default; a browser `%c` renderer at the same seam).

| API                  | Kind      | Summary                                                                                                                                     |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Color`              | type      | A named terminal color — the 8 base colors, their 8 bright variants, and `default` (the target's own ink, no code).                         |
| `Attribute`          | type      | A text-style effect — `bold` / `dim` / `italic` / `underline` / `inverse` / `strikethrough` (the six standard SGR effects).                 |
| `Style`              | interface | Style as DATA — a frozen `{ foreground?, background?, attributes }` record; the one style value the whole system shares.                    |
| `RendererInterface`  | interface | The swappable style renderer — turns a `Style` + text into output for ONE target (ANSI default, browser `%c` at the same seam).             |
| `StylerOptions`      | interface | `createStyler` options — `renderer?` (the target, default ANSI) + `enabled?` (the no-color switch, default `true`).                         |
| `StylerInterface`    | interface | The fluent styling surface — a render FUNCTION carrying a chainable `Color` / `Attribute` accessor per token, immutable copy-on-write.      |
| `ANSIRenderer`       | class     | The cross-environment default `RendererInterface` — renders a `Style` as SGR escape codes (stateless, event-free).                          |
| `createANSIRenderer` | function  | Create the default ANSI `RendererInterface`.                                                                                                |
| `Styler`             | class     | The styling engine behind `StylerInterface` — builds a `Style` and renders it through the injected renderer; immutable, event-free.         |
| `createStyler`       | function  | Create the fluent `StylerInterface` (ANSI by default; pass a `renderer` to retarget, `enabled: false` to disable color).                    |
| `strip`              | function  | Remove every ANSI escape sequence from a string, returning the plain visible text (total, re-entrant).                                      |
| `stripControls`      | function  | Remove every C0 control byte (except `\t` / `\n` / `\r`) plus DEL from a string — a SEPARATE pass from `strip`, so `width` stays untouched. |
| `width`              | function  | The VISIBLE width of a string — its length in code points after ANSI is stripped (the basis for terminal layout).                           |

### Logging

Structured logging — the immutable `LogRecord` + the `entry` event ARE the transport seam; `Sink` is the one output primitive.

| API                      | Kind      | Summary                                                                                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `LogLevel`               | type      | The severity scale — `debug` < `info` < `warn` < `error`; a logger gates by THRESHOLD (styling is orthogonal).                       |
| `LogRecord`              | interface | One immutable, serializable log entry — `level` / `message` / `time` (+ `name?` / `data?`); every sink / transport consumes it.      |
| `SinkInterface`          | interface | The minimal output primitive — the one seam text leaves the system through (`write(text, level?)`); swap it to retarget.             |
| `createConsoleSink`      | function  | Create the default console `SinkInterface` — routes by level, writes through the `console` methods SNAPSHOTTED at creation.          |
| `Logger`                 | class     | The observable, leveled logger — builds a frozen `LogRecord`, gates it, retains a bounded tail, emits `entry`, writes a styled line. |
| `createLogger`           | function  | Create an observable, leveled `LoggerInterface` — the entry point into structured logging.                                           |
| `LoggerManager`          | class     | An event-free §9 registry of named loggers plus a convenience fan-out.                                                               |
| `createLoggerManager`    | function  | Create an event-free `LoggerManagerInterface` — a registry of named loggers + fan-out.                                               |
| `LoggerEventMap`         | type      | A logger's observable events (§13) — `entry(record)` for every accepted record (the transport seam).                                 |
| `LoggerOptions`          | interface | `createLogger` options — `on?` / `error?` / `level?` / `name?` / `sink?` / `styler?` / `limit?` / `silent?`.                         |
| `LoggerInterface`        | interface | The leveled logger — `emitter` / `level` / `name` data + `debug` / `info` / `warn` / `error` / `entries` / `clear` / `destroy`.      |
| `LoggerManagerOptions`   | interface | `createLoggerManager` options — the `level?` / `sink?` / `styler?` / `limit?` / `silent?` defaults flowed into every minted logger.  |
| `LoggerManagerInterface` | interface | The logger registry — a `count` data member + `register` / `logger` / `loggers` / the `debug`…`error` fan-out / `remove` / `clear`.  |

### Reporting

Narrative reporting — pure width-aware LAYOUT renderers + a lean `Reporter` front-end, over the SAME styler + sink substrate.

| API                  | Kind      | Summary                                                                                                                             |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Alignment`          | type      | Horizontal alignment within a fixed-width cell — `left` / `center` / `right` (a conventional value set, not a toggle).              |
| `BorderStyle`        | type      | A box-drawing border weight — `single` / `double` / `round` / `heavy` (each a full junction set in `BORDER_CHARS`).                 |
| `BorderChars`        | interface | One complete box-drawing junction set for a `BorderStyle` — edges, corners, and the `T` / cross junctions a table needs.            |
| `SeparatorOptions`   | interface | `renderSeparator` options — `title?` / `width?` / `fill?` / `styler?` (a horizontal rule, optionally titled).                       |
| `BoxOptions`         | interface | `renderBox` options — `content` / `title?` / `padding?` / `border?` / `width?` / `styler?` (content framed in box characters).      |
| `ColumnSpec`         | interface | One column of a `TableOptions` — its `label` and how its cells `align`.                                                             |
| `TableOptions`       | interface | `renderTable` options — `columns` / `rows` / `border?` / `styler?` (a bordered, width-aware grid).                                  |
| `TreeNode`           | interface | One node of a tree — a `label` plus optional `children`, recursively.                                                               |
| `TreeOptions`        | interface | `renderTree` options — a `root` `TreeNode` + an optional `styler` (a nested tree drawn with box connectors).                        |
| `StatusLevel`        | type      | A narrative OUTCOME level — `success` / `error` / `warn` / `info`, each with its own icon + color (DISTINCT from `LogLevel`).       |
| `StepPosition`       | interface | A step's place in a sequence — the `{ index, total }` a `step` renders as a `[2/5]` prefix.                                         |
| `ReporterOptions`    | interface | `createReporter` options — `sink?` / `styler?` / `width?` (the shared substrate + the default layout width).                        |
| `ReporterInterface`  | interface | The narrative reporter — `section` / `step` / `timing` / `status` / `table` / `tree` / `box` / `line` / `blank`.                    |
| `Reporter`           | class     | The lean, event-free narrative reporter — formats through the shared styler + the pure renderers and writes to a sink.              |
| `createReporter`     | function  | Create a lean, event-free `ReporterInterface` — the entry point into narrative reporting.                                           |
| `renderSeparator`    | function  | Render a horizontal rule, optionally carrying a centered title — pure `SeparatorOptions → string`, width-aware.                     |
| `renderBox`          | function  | Render content framed in box-drawing characters, optionally captioned — pure `BoxOptions → string`, width-aware.                    |
| `renderTable`        | function  | Render a bordered grid of columns + rows with per-column alignment and width-aware sizing — pure `TableOptions → string`.           |
| `renderTree`         | function  | Render a nested `TreeNode` tree with box-drawing connectors — pure `TreeOptions → string`.                                          |
| `renderTreeChildren` | function  | Render the connector-prefixed lines for a `TreeNode` list — the exported recursive core behind `renderTree`.                        |
| `renderBar`          | function  | Render a determinate progress-bar string (`█████░░░░░ 50% (5/10)`) — pure `ProgressBarOptions → string`, width-aware.               |
| `align`              | function  | Pad (or truncate) text to exactly N VISIBLE columns by an `Alignment` — the cell-fitting primitive the renderers align with.        |
| `paint`              | function  | Color text through an optional styler (verbatim when absent) — the ONE optional-styling primitive every renderer applies.           |
| `repeatTo`           | function  | Tile a (possibly multi-cell) unit to exactly N VISIBLE columns, trimming a trailing partial — the fill primitive for rules / edges. |
| `cellAt`             | function  | The cell at an index of a (possibly ragged) row — `''` past the end, so a short row pads instead of throwing.                       |
| `meetsLevel`         | function  | Whether a record at one `LogLevel` passes a logger gated at a threshold — the level gate's severity comparison.                     |
| `formatTime`         | function  | Format a record's epoch-ms `time` as an ISO-8601 timestamp — the timestamp portion of the formatted log line.                       |
| `formatRecord`       | function  | Format a `LogRecord` into one styled line through a styler — the default human line layout a logger writes.                         |
| `formatDuration`     | function  | Format a millisecond duration as `…ms` (sub-second) or `…s` (2 d.p.) — the rendering behind `Reporter.timing`.                      |
| `stringifyValue`     | function  | Stringify ONE captured console argument into a line fragment (Error → `name: message`, object → circular-safe JSON) — total.        |
| `formatArgs`         | function  | Stringify a captured `console.*` argument list into ONE space-joined line — the text of a `CapturedMessage` (total, never throws).  |

### Capture

Console interception — take control of `console.*` on the READ side; a buffered, mirroring, forwarding interceptor with a lifecycle.

| API                | Kind      | Summary                                                                                                                                |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CaptureLevel`     | type      | One intercepted `console` method — `log` / `info` / `warn` / `error` / `debug` (names the ORIGINATING method, not a severity).         |
| `ConsoleMethod`    | type      | The patched `console.*` method shape — a variadic `(...args) => void`; the boundary type the capture snapshots + swaps (§14).          |
| `CapturedMessage`  | interface | One captured console call — an immutable, serializable `{ level, text, time }`; every consumer reads this exact shape.                 |
| `CaptureEventMap`  | type      | A capture's observable events (§13) — `capture(message)` per intercepted call + the `start` / `stop` lifecycle signals.                |
| `CaptureOptions`   | interface | `createCapture` options — `on?` / `error?` / `levels?` / `mirror?` / `sink?` / `limit?`.                                               |
| `CaptureInterface` | interface | The console interceptor — `emitter` / `active` data + `start` / `stop` / `messages` (whole buffer or one level) / `clear` / `destroy`. |
| `CaptureResult`    | interface | The structured outcome of `withCapture` — the wrapped function's `value` plus the `messages` it logged.                                |
| `Capture`          | class     | The observable console interceptor — buffers (total + by level), emits `capture`, optionally mirrors + forwards to a sink.             |
| `createCapture`    | function  | Create an observable `CaptureInterface` — console interception on the read side (inactive until `start()`).                            |
| `withCapture`      | function  | Run a function with `console.*` captured for its duration (scoped, self-restoring) — returns `{ value, messages }` (sync or async).    |

### Errors

The one error type the console layer throws — an internal invariant / unreachable-guard violation (AGENTS §12).

| API                | Kind     | Summary                                                                                                                      |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleErrorCode` | type     | The machine-readable error code a `ConsoleError` carries — `INVARIANT` (the one throw site in this codebase today).          |
| `ConsoleError`     | class    | Carries a `ConsoleErrorCode` and an optional `context` bag — thrown for an internal invariant violated at a defensive guard. |
| `isConsoleError`   | function | Narrow an unknown caught value to a `ConsoleError`.                                                                          |

### Animations

Live activity animations — pure frame PRODUCERS over the SAME styler + sink substrate; the line-OVERWRITE is the sink's job.

| API                  | Kind      | Summary                                                                                                                                  |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ProgressBarOptions` | interface | `renderBar` options — `current` / `total` / `width?` / `fill?` / `empty?` / `styler?` (a determinate bar string).                        |
| `SpinnerEventMap`    | type      | A spinner's observable events (§13) — `frame(line)` per advance / outcome + the `start` / `stop` timer-lifecycle signals.                |
| `SpinnerOptions`     | interface | `createSpinner` options — `on?` / `error?` / `message?` / `frames?` / `interval?` / `sink?` / `styler?`.                                 |
| `SpinnerInterface`   | interface | The activity spinner — `emitter` / `active` / `message` data + `start` / `tick` / `update` / `success` / `failure` / `stop` / `destroy`. |
| `Spinner`            | class     | The self-driving, observable spinner — a timer-advanced glyph cycle writing `\r` + a frame line to its sink; leak-free.                  |
| `createSpinner`      | function  | Create a self-driving, observable `SpinnerInterface` — a live activity spinner (inactive until `start()`).                               |
| `ProgressEventMap`   | type      | A progress bar's observable events (§13) — `update({current,total})` per report + a `complete` signal on a successful finish.            |
| `ProgressOptions`    | interface | `createProgress` options — `on?` / `error?` / `total` (required) / `message?` / `width?` / `sink?` / `styler?`.                          |
| `ProgressInterface`  | interface | The progress bar — `emitter` / `active` / `completed` / `current` / `total` data + `update` / `complete` / `failure` / `destroy`.        |
| `Progress`           | class     | The update-driven, observable progress bar — recomputes + writes `\r` + the bar on each `update`; no self-timer (the caller drives).     |
| `createProgress`     | function  | Create an update-driven, observable `ProgressInterface` — a live progress bar.                                                           |

### Style constants

The SGR code data the ANSI renderer maps through, and the styler's color / attribute axes (`src/core`). All `Object.freeze`d data; the SGR numbers are the fixed ECMA-48 spec.

| API                | Kind  | Summary                                                                                                                                 |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `FOREGROUND_CODES` | const | Each `Color`'s SGR FOREGROUND parameter (30–37 / 90–97); `default` is absent (emits no code).                                           |
| `BACKGROUND_CODES` | const | Each `Color`'s SGR BACKGROUND parameter (40–47 / 100–107); `default` is absent.                                                         |
| `ATTRIBUTE_CODES`  | const | Each `Attribute`'s SGR "on" parameter (`bold` 1, `dim` 2, `italic` 3, `underline` 4, `inverse` 7, `strikethrough` 9).                   |
| `EMPTY_STYLE`      | const | The EMPTY `Style` (no colors, no attributes) — the neutral base a styler builds from; deeply frozen.                                    |
| `COLORS`           | const | Every named `Color` except `default` — the colors the styler exposes as chainable accessors.                                            |
| `ATTRIBUTES`       | const | Every `Attribute` — the attributes the styler exposes as chainable accessors.                                                           |
| `RESET_CODE`       | const | The SGR RESET parameter (`0`) — terminates a styled run.                                                                                |
| `ESC`              | const | The ESC control character (`U+001B`) beginning every ANSI escape sequence.                                                              |
| `BEL`              | const | The BEL control character (`U+0007`) that can terminate an OSC sequence.                                                                |
| `CSI`              | const | The Control Sequence Introducer (`ESC[`) opening every SGR sequence.                                                                    |
| `RESET`            | const | The full SGR reset sequence (`ESC[0m`) appended after a styled run.                                                                     |
| `ANSI_PATTERN`     | const | The global `RegExp` matching any ANSI escape (CSI / OSC / DCS / PM / APC / SOS / nF / Fp / Fe / Fs) — `strip` removes every occurrence. |
| `CONTROL_PATTERN`  | const | The global `RegExp` matching a C0 control byte (except `\t` / `\n` / `\r`) plus DEL — `stripControls` removes every occurrence.         |

### Logging & reporting constants

The level order + label colors, the box-drawing junction sets, status icons / colors, tree connectors, and default widths / glyphs (`src/core`). All `Object.freeze`d data; the box-drawing + braille glyphs are fixed Unicode.

| API                   | Kind  | Summary                                                                                                                |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `LEVEL_SEVERITY`      | const | Each `LogLevel`'s numeric severity — the ascending order (`debug` 0 < `info` 1 < `warn` 2 < `error` 3) the gate reads. |
| `LEVEL_COLORS`        | const | Each `LogLevel`'s default label `Color` — its VISUAL treatment (orthogonal to leveling); excludes `default`.           |
| `DEFAULT_LOG_LIMIT`   | const | The default bounded-retention cap for a logger (`1000`); retention is always bounded.                                  |
| `DEFAULT_LOG_LEVEL`   | const | The default `LogLevel` threshold a logger gates at — `info`.                                                           |
| `LEVELS`              | const | Every `LogLevel` in ascending severity — the level axis (drives exhaustive tests).                                     |
| `BORDER_CHARS`        | const | The complete `BorderChars` junction set for each `BorderStyle` — the standard Unicode box-drawing glyphs.              |
| `STATUS_ICONS`        | const | Each `StatusLevel`'s icon glyph — `success` ✔, `error` ✖, `warn` ⚠, `info` ℹ.                                          |
| `STATUS_COLORS`       | const | Each `StatusLevel`'s `Color` — `success` green, `error` red, `warn` yellow, `info` blue; excludes `default`.           |
| `STATUS_LEVELS`       | const | Every `StatusLevel` — the outcomes a `status` line supports.                                                           |
| `TREE_CHARS`          | const | The tree connectors `renderTree` draws — the `├─` branch, `└─` corner, `│ ` guide, and gap.                            |
| `DEFAULT_WIDTH`       | const | The default visible width for the width-aware renderers + the reporter's `section` rule — `80`.                        |
| `DEFAULT_PADDING`     | const | The default horizontal padding inside a box's edges — one cell.                                                        |
| `DEFAULT_BORDER`      | const | The default `BorderStyle` when none is given — `single`.                                                               |
| `DEFAULT_ALIGN`       | const | The default cell `Alignment` when none is given — `left`.                                                              |
| `SEPARATOR_FILL`      | const | The default fill character `renderSeparator` draws its rule with — `─`.                                                |
| `SEPARATOR_TITLE_GAP` | const | The single padding cell on each side of a separator's embedded title.                                                  |
| `SECOND_MS`           | const | The millisecond threshold (`1000`) where `formatDuration` switches from `…ms` to `…s`.                                 |

### Capture & animation constants

The default intercepted-method set, the bounded-buffer cap, the level projection, and the spinner frames / bar glyphs / track width (`src/core`). All `Object.freeze`d data.

| API                        | Kind  | Summary                                                                                                              |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `CAPTURE_LEVELS`           | const | Every `CaptureLevel` — the `console.*` methods a `Capture` intercepts (`log` / `info` / `warn` / `error` / `debug`). |
| `DEFAULT_CAPTURE_LEVELS`   | const | The default set of `CaptureLevel`s a `Capture` patches when `levels` is omitted — all five.                          |
| `DEFAULT_CAPTURE_LIMIT`    | const | The default bounded-buffer cap for a `Capture` (`1000`) — total + each by-level bucket; always bounded.              |
| `CAPTURE_LEVEL_MAP`        | const | Each `CaptureLevel`'s `LogLevel` for the optional sink forward (`log` → `info`, else the matching level).            |
| `SPINNER_FRAMES`           | const | The default spinner frame cycle — the ten braille-pattern glyphs (`⠋⠙⠹…`).                                           |
| `DEFAULT_SPINNER_INTERVAL` | const | The default timer period between spinner frames — `80` ms (≈12.5 fps).                                               |
| `BAR_FILL`                 | const | The default FILLED-cell glyph `renderBar` draws with — the full block `█`.                                           |
| `BAR_EMPTY`                | const | The default EMPTY-cell glyph `renderBar` draws with — the light-shade block `░`.                                     |
| `DEFAULT_BAR_WIDTH`        | const | The default visible cell count of a progress-bar TRACK — `30`.                                                       |

### Browser sink

The browser `%c` console sink — translates the core's ANSI output into a `console.log('%c…', css)` call at the OUTPUT boundary ([`src/browser`](../../src/browser), surfaced through `@src/browser`). The core owns the `SinkInterface` contract + the style DATA model; this module owns only the browser-side translation.

| API                 | Kind      | Summary                                                                                                                             |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleOutput`     | interface | The `console.log`-ready output `ansiToConsole` produces — a `%c`-segmented `format` string + the parallel `styles` CSS array.       |
| `StyleAccumulator`  | interface | The mutable scan state `ansiToConsole` carries while translating SGR codes to CSS — a `foreground` / `background` + attribute list. |
| `createBrowserSink` | function  | Create the browser `%c` `SinkInterface` — translates ANSI `text` to a `console[method](format, ...styles)` call; level-routing.     |
| `ansiToConsole`     | function  | Translate an ANSI-styled string into a browser `ConsoleOutput` (`%c` format + CSS array) — pure, total, and `%`-safe.               |
| `escapePercent`     | function  | Double every literal `%` in a text segment to `%%` — the `%`-escape that keeps the console from reading a stray `%` as a directive. |
| `parseParameters`   | function  | Parse an SGR parameter list (`'1;31'` → `[1, 31]`) into its numeric codes — a bare / empty field becomes a `0` reset.               |

### Browser sink constants

The SGR → CSS translation data the browser sink maps ANSI runs through (`src/browser`). The number↔name mapping is derived from core's code maps, never re-hardcoded; the browser module reads core's `RESET_CODE` directly (no local re-export).

| API              | Kind  | Summary                                                                                                                 |
| ---------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `COLOR_HEX`      | const | Each named `Color`'s hex value — the 16 standard terminal colors a browser console renders the same names as.           |
| `ATTRIBUTE_CSS`  | const | Each text-attribute SGR number → its CSS declaration (`bold` → `font-weight:bold`, …; `inverse` best-effort).           |
| `FOREGROUND_CSS` | const | Each SGR FOREGROUND parameter → its `color:<hex>` CSS, derived from core's `COLORS` × `FOREGROUND_CODES` × `COLOR_HEX`. |
| `BACKGROUND_CSS` | const | Each SGR BACKGROUND parameter → its `background:<hex>` CSS, derived the same way.                                       |
| `DIRECTIVE`      | const | The browser console directive (`%c`) that switches the active style — one prefixes every styled run.                    |
| `SGR_PATTERN`    | const | The global `RegExp` matching one SGR sequence and CAPTURING its parameters — the scanner walks every styled run.        |

### Server sink + process capture

The server output backend — a TTY-aware `Sink` over the real `process` streams + a RAW process-stream capture ([`src/server`](../../src/server), surfaced through `@src/server`). The core owns the `SinkInterface` / `LogLevel` contracts + the `console` `Capture`; this module owns the server-only stream backend.

| API                       | Kind      | Summary                                                                                                                                            |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamTargetInterface`   | interface | The minimal writable-stream shape the server sink + capture address — `write(text)` + optional `isTTY` / `columns`.                                |
| `ServerSinkOptions`       | interface | `createServerSink` options — `out?` / `err?` (the streams) + `columns?` (a fixed width override); all optional.                                    |
| `ServerSinkInterface`     | interface | A `SinkInterface` that also exposes the terminal's `columns` width — feed it to a `Reporter` / `Progress` layout.                                  |
| `StreamLevel`             | type      | Which process stream a `CapturedChunk` came from — `stdout` / `stderr` (the "level" axis of `ProcessCaptureInterface`).                            |
| `StreamWriteFunction`     | type      | The patched `process.*.write` method shape — `NodeJS.WriteStream['write']` verbatim; the boundary type the capture snapshots + swaps.              |
| `StreamWriteCallback`     | type      | The optional write-completion callback `process.*.write` accepts — `(error?) => void`; the wrapper forwards it to the mirror.                      |
| `CapturedChunk`           | interface | One intercepted process-stream write — an immutable `{ level, text, time }`; the server analogue of `CapturedMessage`.                             |
| `ProcessCaptureEventMap`  | type      | A process capture's observable events (§13) — `capture(chunk)` per write + the `start` / `stop` signals.                                           |
| `ProcessCaptureOptions`   | interface | `createProcessCapture` options — `on?` / `error?` / `levels?` / `mirror?` / `sink?` / `limit?`.                                                    |
| `ProcessCaptureInterface` | interface | The raw process-stream interceptor — `emitter` / `active` data + `start` / `stop` / `messages` (whole buffer or one stream) / `clear` / `destroy`. |
| `ProcessCapture`          | class     | The observable interceptor of `process.stdout.write` / `process.stderr.write` — owns ALL server output; never throws, bounded.                     |
| `createServerSink`        | function  | Create the server TTY `ServerSinkInterface` — routes by level to the process streams, ANSI verbatim on a TTY / stripped down a pipe.               |
| `createProcessCapture`    | function  | Create an observable `ProcessCaptureInterface` — the server "own ALL output" capture over the raw `process.*.write`.                               |
| `isStreamTarget`          | function  | Whether a value is a usable `StreamTargetInterface` (a record with a callable `write`) — the boundary guard (§14), total.                          |
| `columnsOf`               | function  | The width of a stream target — its live `columns` when a TTY, else the `DEFAULT_COLUMNS` fallback; total, re-read per call.                        |
| `decodeChunk`             | function  | Decode one `process.*.write` chunk (`string` / `Uint8Array`) to text — TOTAL, never throws (so the capture wrapper can't crash).                   |
| `isBufferEncoding`        | function  | Whether a value is a `BufferEncoding` accepted by `Buffer.toString` — backs `decodeChunk`'s encoding handling.                                     |

### Server sink constants

The default stream set, buffer cap, no-TTY column fallback, and the stream → log-level projection (`src/server`). All `Object.freeze`d data.

| API                      | Kind  | Summary                                                                                                           |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `STREAM_LEVELS`          | const | The two process streams a capture can intercept, in `stdout`-then-`stderr` order — the `StreamLevel` universe.    |
| `DEFAULT_CAPTURE_LEVELS` | const | The default set of `StreamLevel`s a process capture patches when `levels` is omitted — both streams.              |
| `DEFAULT_CAPTURE_LIMIT`  | const | The default bounded-buffer cap for a process capture (`1000`) — total + each per-stream bucket; always bounded.   |
| `DEFAULT_COLUMNS`        | const | The terminal width a server sink reports when the out stream is not a TTY and no explicit width was given — `80`. |
| `STREAM_LEVEL_MAP`       | const | Each `StreamLevel`'s `LogLevel` for the optional sink forward — `stdout` → `info`, `stderr` → `error`.            |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed. Each type's `readonly` data members (e.g. `emitter` / `active` / `message` / `level` / `name` / `current` / `total` / `completed` / `columns`) stay in the Surface rows above and are not repeated here. Each implementing class implements its interface exactly, so this doubles as the per-instance method surface (AGENTS §22).

**Data-only / callable surfaces (no `## Methods` subsection).** `StylerInterface` is a CALLABLE — it has a single call signature `(text) => string` and chainable `Color` / `Attribute` accessors (data getters), but no NAMED methods, so it has no Methods table. `ServerSinkInterface` adds only a `columns` data member to `SinkInterface` (its `write` is the inherited contract below). Every `*Options` / `*EventMap` / `LogRecord` / `Style` / `BorderChars` / `ColumnSpec` / `TreeNode` / `StepPosition` / `CapturedMessage` / `CapturedChunk` / `CaptureResult` / `ConsoleOutput` / `StyleAccumulator` / `StreamTargetInterface` row is a data / options shape with no behavioral methods.

#### `RendererInterface`

| Method   | Returns  | Behavior                                                                                               |
| -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `render` | `string` | Render `text` wrapped in the target codes for a `Style` — the empty style / empty string pass through. |

#### `SinkInterface`

| Method  | Returns | Behavior                                                                                                          |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `write` | `void`  | Write one already-formatted chunk; the optional `level` lets a stream-aware sink ROUTE (a plain sink ignores it). |

#### `LoggerInterface`

| Method    | Returns                | Behavior                                                              |
| --------- | ---------------------- | --------------------------------------------------------------------- |
| `debug`   | `void`                 | Log at `debug` — dropped unless the logger's `level` is `debug`.      |
| `info`    | `void`                 | Log at `info`.                                                        |
| `warn`    | `void`                 | Log at `warn`.                                                        |
| `error`   | `void`                 | Log at `error`.                                                       |
| `entries` | `readonly LogRecord[]` | The bounded tail of recent records, oldest first (capped at `limit`). |
| `clear`   | `void`                 | Drop every retained record (does not touch listeners).                |
| `destroy` | `void`                 | Tear down — clear retention and destroy the emitter.                  |

#### `LoggerManagerInterface`

| Method     | Returns                        | Behavior                                                                                       |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `register` | `LoggerInterface`              | Mint + store a logger named `name` (the manager's defaults flow in); a re-register overwrites. |
| `logger`   | `LoggerInterface \| undefined` | Look up one registered logger by name.                                                         |
| `loggers`  | `readonly LoggerInterface[]`   | List the registered loggers in insertion order.                                                |
| `debug`    | `void`                         | Fan out a `debug` log to every registered logger.                                              |
| `info`     | `void`                         | Fan out an `info` log to every registered logger.                                              |
| `warn`     | `void`                         | Fan out a `warn` log to every registered logger.                                               |
| `error`    | `void`                         | Fan out an `error` log to every registered logger.                                             |
| `remove`   | `void` / `boolean`             | Remove ALL (`remove()`) / one (`remove(name)`) / a batch (`remove(names)`).                    |
| `clear`    | `void`                         | Empty the registry.                                                                            |

#### `ReporterInterface`

| Method    | Returns | Behavior                                                                           |
| --------- | ------- | ---------------------------------------------------------------------------------- |
| `section` | `void`  | Write a titled separator block — a section heading framed by a rule.               |
| `step`    | `void`  | Write a step line, optionally prefixed with its `[index/total]` position.          |
| `timing`  | `void`  | Write a timing line — `label … 1.23s` (sub-second shown as `…ms`).                 |
| `status`  | `void`  | Write an icon + colored outcome line for a `StatusLevel` (`error` → error stream). |
| `table`   | `void`  | Render a `TableOptions` grid through `renderTable` and write it.                   |
| `tree`    | `void`  | Render a `TreeOptions` tree through `renderTree` and write it.                     |
| `box`     | `void`  | Render a `BoxOptions` frame through `renderBox` and write it.                      |
| `line`    | `void`  | Write one raw line (colored if styling is embedded) — no prefix, no icon.          |
| `blank`   | `void`  | Write `count` blank lines (default `1`).                                           |

#### `CaptureInterface`

| Method     | Returns                      | Behavior                                                                                                                            |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `start`    | `void`                       | Snapshot the configured `console.*` and install the interceptors — a no-op when already `active`.                                   |
| `stop`     | `void`                       | Restore the snapshot-original `console.*` — a no-op when not `active`.                                                              |
| `messages` | `readonly CapturedMessage[]` | No arg → a copy of the whole captured buffer, oldest first (capped at `limit`); with a `CaptureLevel` → a copy of just that bucket. |
| `clear`    | `void`                       | Drop every buffered message; does NOT stop interception.                                                                            |
| `destroy`  | `void`                       | Tear down — `stop()` then destroy the emitter.                                                                                      |

#### `SpinnerInterface`

| Method    | Returns | Behavior                                                                                       |
| --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `start`   | `void`  | Arm the periodic timer and render the first frame — a no-op when already `active`.             |
| `tick`    | `void`  | Advance one frame: build the line, emit `frame`, write `\r` + line to the sink.                |
| `update`  | `void`  | Change the message; re-renders immediately when `active`.                                      |
| `success` | `void`  | Stop with a SUCCESS line — clear the timer, write + emit `✔ message` + newline.                |
| `failure` | `void`  | Stop with a FAILURE line — clear the timer, write + emit `✖ message` + newline (error stream). |
| `stop`    | `void`  | Clear the timer and LEAVE the current line — a no-op when not `active`.                        |
| `destroy` | `void`  | Tear down — `stop()` then destroy the emitter.                                                 |

#### `ProgressInterface`

| Method     | Returns | Behavior                                                                                                  |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `update`   | `void`  | Report progress: clamp `current`, re-render, emit `update`, write `\r` + bar. Ignored once terminal.      |
| `complete` | `void`  | Finish successfully — render a FULL bar + newline, emit a final `update` then `complete`.                 |
| `failure`  | `void`  | Finish unsuccessfully — render the bar at its current fill + newline to the error stream (no `complete`). |
| `destroy`  | `void`  | Tear down — destroy the emitter.                                                                          |

#### `ProcessCaptureInterface`

| Method     | Returns                    | Behavior                                                                                                                          |
| ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `start`    | `void`                     | Begin intercepting the configured process streams (idempotent; emits `start`).                                                    |
| `stop`     | `void`                     | Restore the pristine `process.*.write` references (idempotent; emits `stop`).                                                     |
| `messages` | `readonly CapturedChunk[]` | No arg → a copy of the full captured buffer, oldest first (capped at `limit`); with a `StreamLevel` → a copy of just that bucket. |
| `clear`    | `void`                     | Drop every buffered chunk; interception is unaffected.                                                                            |
| `destroy`  | `void`                     | Stop interception (restoring the streams) and tear down the emitter.                                                              |

## Contract

These invariants hold across `src/core` ↔ `src/browser` ↔ `src/server` ↔ `console.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the console source trees (`src/core` plus the `src/browser` and `src/server` environment backends), and every export appears as a Surface row — exhaustive, both directions (AGENTS §22).
2. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`ANSIRenderer` / `Logger` / `LoggerManager` / `Reporter` / `Capture` / `Spinner` / `Progress` / `ProcessCapture`) implements every method of its interface and adds none beyond it (AGENTS §22). A renamed / added / removed method breaks the gate until the table is reconciled.
3. **One coherent `LogLevel`; styling orthogonal to level.** A `LogLevel` is one ascending-severity scale (`debug` < `info` < `warn` < `error`, ordered by `LEVEL_SEVERITY`); a logger gates by THRESHOLD via `meetsLevel`. A level's color (`LEVEL_COLORS`) is a STYLING choice, never a separate level — there are no `success` / `ready` pseudo-levels (those that look like outcomes are the reporter's `StatusLevel`, a narrative axis with no ordering or gating).
4. **Style is DATA + a swappable renderer.** A `Style` is a frozen `{ foreground?, background?, attributes }` record, NOT a baked escape string; a `RendererInterface` turns it into output for one target. The cross-environment default is the `ANSIRenderer` (SGR codes); a browser `%c` renderer implements the SAME contract over the SAME `Style`, so retargeting swaps the renderer and never the style model. The `Styler` is immutable copy-on-write (a later color of a channel wins; a repeated attribute is idempotent), so a base styler is freely reusable.
5. **The `Sink` seam + the no-capture-loop.** `SinkInterface` is the ONE place text leaves the system — redirect output by supplying a different sink, with no change to the logger / reporter / animation. The default `createConsoleSink` (and `createBrowserSink` / `createServerSink`) SNAPSHOTS the underlying `console` / `process` write at creation and writes through that snapshot, so a `Capture` / `ProcessCapture` installed AFTERWARD can never feed the system's own output back into itself — create sinks (and loggers) BEFORE installing a capture.
6. **The record + `entry` / `capture` event is the transport seam.** A `Logger` ALWAYS emits an accepted record on `entry` (even when `silent` — silence suppresses only the SINK WRITE), and a `Capture` / `ProcessCapture` emits every intercepted call on `capture`; file / JSON / remote transports ride that emitter rather than a second code path. Listener isolation is the emitter's (§13): a listener throw routes to the emitter's OWN `error` handler, never onto the domain `EventMap`, so a buggy transport / capture listener can never perturb logging — nor (for the captures) escape into the host's `console.*` / `process.*.write` call.
7. **Bounded retention.** Every buffer is capped, never unbounded: a logger's `entries()` tail at `DEFAULT_LOG_LIMIT`, a `Capture` / `ProcessCapture`'s total buffer AND each per-level / per-stream bucket at `DEFAULT_CAPTURE_LIMIT` — oldest dropped first. A long-running logger or capture can never grow without bound.
8. **The environment split — one engine, environment sinks.** The cross-environment core owns the contract (`Style` / `SinkInterface` / `LogLevel`) and all the universal logic; each environment supplies only the platform output backend at the `Sink` seam. ANSI in core (`ANSIRenderer` + `createConsoleSink`); the browser translates ANSI to `console.log('%c…', css)` AT THE SINK (`createBrowserSink` over the pure, total, `%`-safe `ansiToConsole`); the server writes to the real `process` streams — ANSI verbatim on a TTY, `strip`ped to clean text down a pipe (`createServerSink`). The browser / server modules import the core contracts (never redeclare them) and add only their backend.
9. **Animations: redraw deferred to the sink + timer leak-freedom.** A `Spinner` / `Progress` builds a frame line and writes a leading `\r` + that line to its sink, then emits it — the actual line-OVERWRITE is the SINK's job: a TTY `ServerSink` overwrites on the `\r` for a smooth animation, a browser / plain sink drops the leading `\r` and degrades to a fresh, non-overwriting line (the locked decision). A `Spinner`'s internal timer is ALWAYS cleared on `success` / `failure` / `stop` / `destroy`, so it never leaks; a `Progress` has no self-timer (the caller drives `update`). Both are universal — `setInterval` + the one styler + the one sink, no `node:*`, no `process.stdout`.
10. **Capture never-throws, non-reentrant, pristine restore.** A `Capture` / `ProcessCapture` builds its record through a TOTAL stringify / decode (`formatArgs` / `decodeChunk`), so intercepting `console.*` / `process.*.write` can never throw and crash the host. Each is PROCESS-GLOBAL + NON-REENTRANT — it patches the one global, so at most one may be active at a time; `start()` is idempotent (never double-patches) and `stop()` restores the EXACT snapshot reference, leaving the global pristine. A `ProcessCapture` additionally returns the snapshot-original's backpressure boolean so a caller's `write` handling keeps working.
11. **`width()`-aware rendering.** Every layout (`renderSeparator` / `renderBox` / `renderTable` / `renderTree` / `renderBar`, via `align` / `repeatTo`) measures on the VISIBLE `width` (ANSI stripped, counted in code points), so an already-styled cell or title keeps its columns — its escape codes never break the layout.

What ships is the **cross-environment core** (the style engine, structured logging, narrative reporting, the `console` `Capture`, and the live animations) plus the two environment backends (the browser `%c` sink, the server TTY sink + raw-stream `ProcessCapture`). Deliberately **not** part of this surface yet, by the same "build only what earns its keep" discipline: a file / JSON / remote sink (those ride the shipped `entry` transport seam — a consumer writes the sink), east-asian (wide-glyph) width handling (`width` counts code points, documented), and a multi-capture coordinator (capture is process-global by design).

## Patterns

### A styled, leveled logger

```ts
import { createLogger } from '@src/core'

const logger = createLogger({ name: 'http', level: 'info' })
logger.debug('verbose') // dropped — below the `info` threshold
logger.info('request', { method: 'GET', path: '/' }) // a styled line: time · INFO · [http] · message · data
logger.warn('slow', { ms: 900 }) // WARN in yellow, routed to the sink's warn stream
logger.entries() // the bounded tail — [the info record, the warn record]

// The `entry` event is the transport seam — tee every accepted record to a file / JSON / remote sink.
logger.emitter.on('entry', (record) => archive(record)) // fires even when the logger is `silent`
logger.clear() // drop retained entries (listeners are untouched)
logger.destroy() // clear() then destroy the emitter
```

### A logger registry

```ts
import { createLoggerManager } from '@src/core'

const manager = createLoggerManager({ level: 'info' })
manager.register('http') // mints + stores a logger named 'http', the manager's defaults flow in
manager.info('booted') // fan out an `info` log to every registered logger
manager.remove('http') // remove one by name (also: remove() for all, remove(['a', 'b']) for a batch)
manager.clear() // empty the registry
```

### A reporter narration

```ts
import { createReporter } from '@src/core'

const reporter = createReporter()
reporter.section('Deploy') // ── Deploy ──────────────
reporter.step('uploading', { index: 1, total: 3 }) // [1/3] uploading
reporter.timing('upload', 1234) // upload … 1.23s
reporter.table({
	columns: [{ label: 'Service' }, { label: 'Status', align: 'right' }],
	rows: [
		['api', 'ok'],
		['web', 'ok'],
	],
}) // a bordered, width-aware grid
reporter.tree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } }) // nested box-connectors
reporter.box({ content: 'hello', title: 'Note' }) // content framed in box-drawing characters
reporter.line('raw text') // one raw line, no prefix, no icon
reporter.blank() // one blank line (reporter.blank(3) — three)
reporter.status('success', 'all green') // ✔ all green
```

### Scoping third-party `console.*` with `withCapture`

```ts
import { withCapture } from '@src/core'

// Create your loggers BEFORE this — they snapshot the real console, so they are never recaptured.
const { value, messages } = withCapture(() => {
	noisyLibrary() // its console.log / console.error are intercepted, not printed
	return computeResult()
})
value // the function's own return value
messages.map((m) => `${m.level}: ${m.text}`) // the third-party output, captured

// Async works too — awaited before `console` is restored:
const out = await withCapture(async () => fetchAndLog())
```

### Capture lifecycle

```ts
import { createCapture } from '@src/core'

const capture = createCapture()
capture.start() // snapshot the configured console.* and install the interceptors
console.log('hello')
capture.messages() // the whole buffer — [{ level: 'log', text: 'hello', time: … }]
capture.clear() // drop every buffered message; does NOT stop interception
capture.stop() // restore the snapshot-original console.*
capture.destroy() // stop() then destroy the emitter
```

### A spinner and a progress bar

```ts
import { createProgress, createSpinner } from '@src/core'

const spinner = createSpinner({ message: 'connecting' })
spinner.start() // a self-driving glyph cycle; a TTY sink redraws on the `\r`
spinner.tick() // advance one frame by hand: emits `frame`, writes `\r` + line
spinner.update('handshaking') // the message changes, re-rendered at once
spinner.success('connected') // ✔ connected — timer cleared, line committed

const failing = createSpinner({ message: 'connecting' })
failing.start()
failing.failure('unreachable') // ✖ unreachable — timer cleared, error stream
failing.destroy() // stop() then destroy the emitter

const progress = createProgress({ total: 100, message: 'downloading' })
progress.update(40) // ████████████░░░░░░░░░░░░░░░░░░ 40% (40/100) downloading
progress.update(80, 'almost there')
progress.complete('done') // a full bar, committed with a newline

const interrupted = createProgress({ total: 100, message: 'downloading' })
interrupted.update(30)
interrupted.failure('connection lost') // the bar at its current fill, error stream, no `complete`
interrupted.destroy() // tear down the emitter
```

### The browser — `%c` styling in DevTools

```ts
import { createLogger } from '@src/core'
import { createBrowserSink } from '@src/browser'

// The SAME core logger; only the sink changes. ANSI is translated to `%c` at the sink,
// so a DevTools console renders the same 16 colors a terminal would.
const logger = createLogger({ name: 'app', sink: createBrowserSink() })
logger.error('boom') // → console.error('%c…', 'color:#cd0000;…') in DevTools
```

### The server — a TTY sink and a process capture

```ts
import { createLogger, createReporter } from '@src/core'
import { createProcessCapture, createServerSink } from '@src/server'

const sink = createServerSink() // process.stdout / process.stderr; ANSI verbatim on a TTY, stripped to a pipe
const logger = createLogger({ name: 'server', sink })
logger.error('boom') // → process.stderr (the error stream)
const reporter = createReporter({ sink, width: sink.columns }) // size the layout to the live terminal

// Own ALL output — a direct process.stdout.write, library output, child-process pipes (not just console.*):
const capture = createProcessCapture({ levels: ['stderr'], mirror: true })
capture.start()
process.stderr.write('a library diagnostic\n') // captured AND still shown (mirror: true)
capture.messages('stderr') // [{ level: 'stderr', text: 'a library diagnostic\n', time: … }]
capture.clear() // drop buffered chunks; interception is unaffected
capture.stop()
capture.destroy() // stop() then tear down the emitter
```

### One logger, different sink per environment (the cross-env one-liner)

```ts
import { createLogger } from '@src/core'
import { createBrowserSink } from '@src/browser'
import { createServerSink } from '@src/server'

// The Logger code is identical everywhere — only the sink is chosen per environment.
const sink = inBrowser ? createBrowserSink() : createServerSink()
const logger = createLogger({ name: 'app', sink }) // ANSI in core, `%c` in the browser, TTY/streams on the server
logger.info('ready') // styled the same way, routed to the right backend, with no other change
```

### The pure layout + formatting helpers directly

```ts
import {
	cellAt,
	createANSIRenderer,
	createStyler,
	formatDuration,
	formatTime,
	paint,
	renderBox,
	renderTable,
} from '@src/core'

const renderer = createANSIRenderer()
renderer.render('hi', { foreground: 'red', attributes: [] }) // wraps 'hi' in the red SGR codes

const styler = createStyler()
paint(styler, 'label') // colors 'label' through styler, or returns it verbatim when styler is undefined

renderBox({ content: 'hello\nworld', title: 'Note' }) // content framed in box-drawing characters
renderTable({
	columns: [{ label: 'Service' }, { label: 'Status', align: 'right' }],
	rows: [['api', 'ok']],
}) // a bordered, width-aware grid

cellAt(['a', 'b'], 5) // '' — past the end, so a short row pads instead of throwing
formatTime(0) // '1970-01-01T00:00:00.000Z'
formatDuration(1230) // '1.23s'
```

### Server helpers directly

```ts
import { columnsOf, isBufferEncoding } from '@src/server'

columnsOf(process.stdout) // the live TTY width, or the DEFAULT_COLUMNS fallback off a TTY
isBufferEncoding('utf8') // true — a value accepted by Buffer#toString
isBufferEncoding('nope') // false
```

## Tests

- [`tests/guides/parity.test.ts`](../../tests/guides/src/parity.test.ts) — the `## Surface` ↔ source bijection across `src/core` and the `src/browser` + `src/server` backends (value + type exports), plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/ANSIRenderer.test.ts`](../../tests/src/core/ANSIRenderer.test.ts) — the ANSI renderer: foreground / background / attribute SGR codes, multi-attribute composition, `default` / unset / empty-style / empty-string pass-through.
- [`tests/src/core/Styler.test.ts`](../../tests/src/core/Styler.test.ts) — the fluent styler: chainable `Color` / `Attribute` accessors, immutability + composition either way, last-color-wins / idempotent-attribute, the `enabled` verbatim switch, and a swapped renderer.
- [`tests/src/core/Logger.test.ts`](../../tests/src/core/Logger.test.ts) — the logger: the level gate (drop below threshold), the frozen `LogRecord`, bounded `entries()` retention + `clear`, the `entry` transport event (fires even when `silent`), the styled line, and the emitter's listener-isolation (`error` handler) emit-safety.
- [`tests/src/core/LoggerManager.test.ts`](../../tests/src/core/LoggerManager.test.ts) — the registry: `register` (defaults flow in, re-register overwrites) / `logger` / `loggers` / `count`, the `debug`…`error` fan-out, and `remove` ALL / one / batch.
- [`tests/src/core/Reporter.test.ts`](../../tests/src/core/Reporter.test.ts) — the reporter verbs: `section` / `step` (with / without position) / `timing` / `status` (icon + color, `error` → error stream) / `table` / `tree` / `box` / `line` / `blank`.
- [`tests/src/core/Capture.test.ts`](../../tests/src/core/Capture.test.ts) — the console interceptor: snapshot-at-`start` + restore, capture (total + by level) + bounded buffers, the `capture` event + `start` / `stop` lifecycle, `mirror` / `sink` forwarding, idempotency, and the no-capture-loop.
- [`tests/src/core/Spinner.test.ts`](../../tests/src/core/Spinner.test.ts) — the spinner: deterministic `tick()` frame advance + the `\r` write, idempotent `start`, the leak-free timer (armed / always cleared, fake timers), `update`, `success` / `failure` outcome lines, and the `frame` / `start` / `stop` events.
- [`tests/src/core/Progress.test.ts`](../../tests/src/core/Progress.test.ts) — the progress bar: `update` clamp + render + `\r` write, the `update` event, terminal `complete` (full bar + `complete` event) / `failure` (error stream, no complete), and the post-terminal ignore.
- [`tests/src/core/helpers.test.ts`](../../tests/src/core/helpers.test.ts) — the pure helpers: `strip` / `width` (ANSI-aware, code points), `meetsLevel` / `formatTime` / `formatRecord`, `align` / `paint` / `repeatTo` / `cellAt`, `renderSeparator` / `renderBox` / `renderTable` / `renderTree` / `renderBar`, `formatDuration`, and the total `stringifyValue` / `formatArgs` (Error / cycle / BigInt).
- [`tests/src/core/factories.test.ts`](../../tests/src/core/factories.test.ts) — each `create*` returns a working instance of its interface, `createConsoleSink`'s level routing + snapshot, and `withCapture` (sync + async, restore-on-throw).
- [`tests/src/browser/helpers.test.ts`](../../tests/src/browser/helpers.test.ts) — `ansiToConsole` in real Chromium: SGR runs → `%c` segments + parallel CSS, the reset clear, last-color-wins, the plain-text short-circuit, and `%`-safety; plus `escapePercent` / `parseParameters`.
- [`tests/src/browser/factories.test.ts`](../../tests/src/browser/factories.test.ts) — `createBrowserSink` in real Chromium: the ANSI → `%c` `console[method](format, ...styles)` call, level routing, the leading-`\r` animation degrade, and the snapshot (no capture loop).
- [`tests/src/server/helpers.test.ts`](../../tests/src/server/helpers.test.ts) — the server helpers: `isStreamTarget` (the boundary guard), `columnsOf` (live TTY width / fallback), and the total `decodeChunk` (string / Buffer / Uint8Array / bad encoding) + `isBufferEncoding`.
- [`tests/src/server/factories.test.ts`](../../tests/src/server/factories.test.ts) — `createServerSink` over a fake `StreamTargetInterface`: level routing to `out` / `err`, ANSI verbatim on a TTY vs. stripped off one, and the live / fixed `columns`.
- [`tests/src/server/ProcessCapture.test.ts`](../../tests/src/server/ProcessCapture.test.ts) — the process capture over a `process.*.write` probe: snapshot-at-`start` + pristine restore, capture (total + per-stream) + bounded buffers, the `capture` / `start` / `stop` events, `mirror` (backpressure passed through) / `sink` forwarding, idempotency, and the never-throw decode.

## See also

- [`AGENTS.md`](../../AGENTS.md) — the rules; §11 immutability, §13 the emitter pattern (listener isolation), §22 documentation-as-contracts.
- [`emitter.md`](emitter.md) — the typed emitter the `Logger` / `Capture` / `Spinner` / `Progress` own for their `entry` / `capture` / `frame` events.
- [`README.md`](../README.md) — the guides index.
