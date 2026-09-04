# Console

> One unified output-control system for a terminal, a browser, and a server. Over one shared substrate it composes a **style engine** (text style is DATA, rendered by a swappable renderer), **structured logging** (a leveled `Logger` whose record + `entry` event ARE the transport seam), **narrative reporting** (a `Reporter` of sections / steps / timings / tables / trees / boxes), **console & stream capture** (take control of `console.*` / `process.*` on the read side), and **live animations** (a self-driving `Spinner`, an update-driven `Progress`). The unifying ideas: **style as data** (a `Style` is a frozen record, not a baked escape string), the **`Sink` seam** (the one place text leaves the system — swap it to retarget), and the **`entry` / `capture` event** as the transport seam (records flow to file / JSON / remote transports off an emitter, never a second code path).
>
> The design is **one engine, environment sinks**. The cross-environment core owns the contract and all the universal logic; each environment provides only the platform output backend at the `Sink` seam: ANSI / SGR escape codes are the default (the `ANSIRenderer` + the `createConsoleSink`), the browser translates ANSI to `console.log('%c…', css)` at the sink (`createBrowserSink`), and the server writes to the real `process` streams with styling selected per target at construction by the precedence in the color-detection contract (`createServerSink`). The animations push the line-OVERWRITE decision down to the sink too: a `Spinner` / `Progress` writes a leading `\r` + its frame to EVERY sink, and each sink decides what that means — the server TTY sink writes it verbatim and the terminal redraws in place, core's console sink also writes it verbatim and `console.log` terminates the call so the frame lands on a fresh line, and the browser sink strips the `\r` for the same fresh-line degrade. The same code, a live redraw or a clean fallback per environment. Source: [`src/core`](../src/core) (surfaced through `@src/core`), with the browser sink in [`src/browser`](../src/browser) (`@src/browser`) and the server sink + process capture in [`src/server`](../src/server) (`@src/server`).

## Surface

Build a styled, leveled logger and a narrative reporter over the shared substrate; the SAME code retargets to any environment by swapping the `sink`:

```ts
import { Logger, Reporter, Spinner } from '@orkestrel/console'

const logger = new Logger({ name: 'http', level: 'info' }) // ANSI to the console by default
logger.info('request', { method: 'GET', path: '/' }) // a styled, leveled line + an `entry` event
logger.emitter.on('entry', (record) => archive(record)) // the transport seam — file / JSON / remote

const reporter = new Reporter()
reporter.section('Build')
reporter.step('bundling', { index: 2, total: 5 }) // [2/5] bundling
reporter.status('success', 'built in 1.2s') // ✔ built in 1.2s

const spinner = new Spinner({ message: 'deploying' })
spinner.start() // a self-driving glyph cycle, `\r`-redrawn by an overwrite-capable sink
spinner.succeed('deployed') // ✔ deployed — the timer cleared, the line committed
```

Style is **data**: a `Style` is a frozen `{ foreground?, background?, attributes }` record, and a `RendererInterface` turns it into output for one target. The `Styler` is the fluent surface — `styler.red.bold('hi')` accumulates a style and renders it through the injected renderer; swap the renderer (ANSI default → browser `%c`) and the style model never changes. Logging is **orthogonal to styling**: a `LogLevel` is one coherent ascending scale (`debug` < `info` < `warn` < `error`), and a level's color is a styling choice, never a pseudo-level. Every retention buffer (a logger's tail, a capture's buffers) is **bounded** — never an unbounded leak.

### Styling

The style engine — text style as DATA, rendered by a swappable renderer (ANSI default; a browser `%c` renderer at the same seam).

| API                 | Kind      | Summary                                                                                                                                |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Color`             | type      | A named terminal color — the 8 base colors, their 8 bright variants, and `default` (the target's own ink, no code).                    |
| `Attribute`         | type      | A text-style effect — `bold` / `dim` / `italic` / `underline` / `inverse` / `strikethrough`, the standard SGR effects.                 |
| `Style`             | interface | Style as DATA — a frozen `{ foreground?, background?, attributes }` record; the one style value the whole system shares.               |
| `RendererInterface` | interface | The swappable style renderer — turns a `Style` + text into output for ONE target (ANSI default, browser `%c` at the same seam).        |
| `StylerOptions`     | interface | `createStyler` options — `renderer?` (the target, default ANSI) + `enabled?` (the no-color switch, default `true`).                    |
| `StylerInterface`   | interface | The fluent styling surface — a render FUNCTION carrying a chainable `Color` / `Attribute` accessor per token, immutable copy-on-write. |
| `ThemeStatus`       | interface | One narrative outcome's presentation — the `icon` glyph a `StatusLevel` shows and the `Style` its line renders in.                     |
| `Theme`             | interface | The app-wide semantic style vocabulary — `levels` / `statuses` / `accent` / `chrome`, each role bound to a `Style`.                    |
| `ThemeOptions`      | interface | `createTheme` options — the roles to override on `DEFAULT_THEME`; a status supplies its whole copied `{ icon, style }` record.         |
| `ANSIRenderer`      | class     | The cross-environment default `RendererInterface` — renders a `Style` as SGR escape codes (stateless, event-free).                     |
| `createStyler`      | function  | The fluent `StylerInterface` factory — ANSI by default; a `renderer` retargets it and `enabled: false` disables color.                 |
| `createTheme`       | function  | A `Theme` merged over `DEFAULT_THEME`, every style leaf snapshotted and deep-frozen, ready to share across entities.                   |
| `freezeStyle`       | function  | One `Style` snapshotted and deeply frozen, including an independent frozen copy of its `attributes`.                                   |
| `strip`             | function  | Every ANSI escape sequence removed from a string, leaving the plain visible text (total, re-entrant).                                  |
| `stripControls`     | function  | Every C0 control byte (except `\t` / `\n` / `\r`) plus DEL removed — a SEPARATE pass from `strip`, so `width` stays untouched.         |
| `width`             | function  | The VISIBLE width of a string — its length in code points after ANSI is stripped (the basis for terminal layout).                      |

### Logging

Structured logging — the immutable `LogRecord` + the `entry` event ARE the transport seam; `Sink` is the one output primitive.

| API                      | Kind      | Summary                                                                                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `LogLevel`               | type      | The severity scale — `debug` < `info` < `warn` < `error`; a logger gates by THRESHOLD (styling is orthogonal).                       |
| `LogRecord`              | interface | One immutable, serializable log entry — `level` / `message` / `time` (+ `name?` / `data?`); every sink / transport consumes it.      |
| `SinkInterface`          | interface | The minimal output primitive — the one seam text leaves the system through (`write(text, level?)`); swap it to retarget.             |
| `WriterSet`              | interface | The three write targets a level-routing sink chooses between — `log` / `warn` / `error`, each of the backend's own member type.      |
| `selectWriter`           | function  | The `WriterSet` member a `LogLevel` routes to — the one level-to-target decision every sink backend shares.                          |
| `createConsoleSink`      | function  | The default console `SinkInterface` factory — level-routed, writing through the `console` methods SNAPSHOTTED at creation.           |
| `Logger`                 | class     | The observable, leveled logger — builds a frozen `LogRecord`, gates it, retains a bounded tail, emits `entry`, writes a styled line. |
| `LoggerManager`          | class     | An event-free registry of named loggers plus a convenience fan-out.                                                                  |
| `LoggerEventMap`         | type      | A logger's observable events — `entry(record)` for every accepted record (the transport seam).                                       |
| `LogFormatFunction`      | type      | The line layout a logger writes — `(record, styler, theme) => string`; `formatRecord` is the default (the event owns the record).    |
| `LoggerOptions`          | interface | `Logger` options — `on?` / `error?` / `level?` / `name?` / `sink?` / `styler?` / `theme?` / `format?` / `limit?` / `silent?`.        |
| `LoggerInterface`        | interface | The leveled logger — `emitter` / `level` / `name` data + `debug` / `info` / `warn` / `error` / `entries` / `clear` / `destroy`.      |
| `LoggerManagerOptions`   | interface | `LoggerManager` options — the `level?` / `sink?` / `styler?` / `theme?` / `format?` / `limit?` / `silent?` logger defaults.          |
| `LoggerManagerInterface` | interface | The logger registry — a `count` data member + `register` / `logger` / `loggers` / the `debug`…`error` fan-out / `remove`.            |

### Reporting

Narrative reporting — pure width-aware LAYOUT renderers + a lean `Reporter` front-end, over the SAME styler + sink substrate.

| API                  | Kind      | Summary                                                                                                                                           |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Alignment`          | type      | Horizontal alignment within a fixed-width cell — `left` / `center` / `right` (a conventional value set, not a toggle).                            |
| `BorderStyle`        | type      | A box-drawing border weight — `single` / `double` / `round` / `heavy` (each a full junction set in `BORDER_CHARS`).                               |
| `BorderChars`        | interface | One complete box-drawing junction set for a `BorderStyle` — edges, corners, and the `T` / cross junctions a table needs.                          |
| `SeparatorOptions`   | interface | `renderSeparator` options — `title?` / `width?` / `fill?` / `styler?` / `style?` (a horizontal rule, optionally titled).                          |
| `BoxOptions`         | interface | `renderBox` options — content/layout plus `styler?` / `style?`; a Reporter supplies chrome only when neither styling key is given.                |
| `ColumnSpec`         | interface | One column of a `TableOptions` — its `label` and how its cells `align`.                                                                           |
| `TableOptions`       | interface | `renderTable` options — `columns` / `rows` / `border?` / `styler?` / `style?`; a Reporter supplies chrome only when neither styling key is given. |
| `TreeNode`           | interface | One node of a tree — a `label` plus optional `children`, recursively.                                                                             |
| `TreeOptions`        | interface | `renderTree` options — `root` / `border?` / `styler?` / `style?`; a Reporter supplies chrome only when neither styling key is given.              |
| `StatusLevel`        | type      | A narrative OUTCOME level — `success` / `error` / `warn` / `info`, each with its own icon + color (DISTINCT from `LogLevel`).                     |
| `StepPosition`       | interface | A step's place in a sequence — the `{ index, total }` a `step` renders as a `[2/5]` prefix.                                                       |
| `ReporterOptions`    | interface | `Reporter` options — `sink?` / `styler?` / `theme?` / `width?` (the shared substrate, semantic roles, and layout width).                          |
| `ReporterInterface`  | interface | The narrative reporter — `section` / `step` / `timing` / `status` / `table` / `tree` / `box` / `line` / `blank`.                                  |
| `Reporter`           | class     | The lean, event-free narrative reporter — formats through the shared styler + the pure renderers and writes to a sink.                            |
| `renderSeparator`    | function  | A horizontal rule, optionally carrying a centered title — pure `SeparatorOptions → string`, width-aware.                                          |
| `renderBox`          | function  | Content framed in box-drawing characters, optionally captioned — pure `BoxOptions → string`, width-aware.                                         |
| `renderTable`        | function  | A bordered grid of columns + rows with per-column alignment and width-aware sizing — pure `TableOptions → string`.                                |
| `renderTree`         | function  | A nested `TreeNode` tree whose connectors derive from the chosen `border` set — pure `TreeOptions → string`.                                      |
| `renderTreeChildren` | function  | The connector-prefixed lines for a `TreeNode` list; its third options argument requires `border` and groups optional `styler` / `style`.          |
| `renderBar`          | function  | A determinate progress-bar string (`█████░░░░░ 50% (5/10)`) rendered from a `BarOptions` — pure and width-aware.                                  |
| `align`              | function  | Text padded (or truncated) to exactly N VISIBLE columns by an `Alignment` — the cell-fitting primitive the renderers align with.                  |
| `paint`              | function  | Text colored through an optional styler and optional by-value `Style` (verbatim when the styler is absent) — the shared styling primitive.        |
| `repeatTo`           | function  | A (possibly multi-cell) unit tiled to exactly N VISIBLE columns, a trailing partial trimmed — the fill primitive for rules / edges.               |
| `cellAt`             | function  | The cell at an index of a (possibly ragged) row — `''` past the end, so a short row pads instead of throwing.                                     |
| `meetsLevel`         | function  | Whether a record at one `LogLevel` passes a logger gated at a threshold — the level gate's severity comparison.                                   |
| `formatTime`         | function  | A record's epoch-ms `time` as an ISO-8601 timestamp — the timestamp portion of the formatted log line.                                            |
| `formatRecord`       | function  | One styled line built from `(record, styler, theme)` — the default human line layout a logger writes.                                             |
| `formatDuration`     | function  | A millisecond duration as `…ms` (sub-second) or `…s` (2 d.p.) — the rendering behind `Reporter.timing`.                                           |
| `stringifyValue`     | function  | ONE captured console argument as a line fragment (Error → `name: message`, object → circular-safe JSON) — total.                                  |
| `formatArgs`         | function  | A captured `console.*` argument list as ONE space-joined line — the text of a `CapturedMessage` (total, never throws).                            |

### Capture

Console interception — take control of `console.*` on the READ side; a buffered, mirroring, forwarding interceptor with a lifecycle.

| API                   | Kind      | Summary                                                                                                                                 |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CaptureLevel`        | type      | One intercepted `console` method — `log` / `info` / `warn` / `error` / `debug` (names the ORIGINATING method, not a severity).          |
| `ConsoleMethod`       | type      | The patched `console.*` method shape — a variadic `(...args) => void`; the boundary type the capture snapshots + swaps.                 |
| `CapturedMessage`     | interface | One captured console call — an immutable, serializable `{ level, text, time }`; every consumer reads this exact shape.                  |
| `CaptureEventMap`     | type      | A capture's observable events — `capture(message)` per intercepted call + the `start` / `stop` lifecycle signals.                       |
| `CaptureOptions`      | interface | `Capture` options — `on?` / `error?` / `levels?` / `mirror?` / `sink?` / `limit?`.                                                      |
| `CaptureInterface`    | interface | The console interceptor — `emitter` / `active` data + `start` / `stop` / `messages` (whole buffer or one level) / `clear` / `destroy`.  |
| `CaptureResult`       | interface | The structured outcome of `createCaptureResult` — the wrapped function's `value` plus the `messages` it logged.                         |
| `RetentionInterface`  | interface | The bounded, level-keyed retention buffer a capture keeps its records in — one capped total buffer plus one capped bucket per level.    |
| `Retention`           | class     | The bounded, level-keyed retention engine both captures compose — generic over the record type each carries, so neither can drift.      |
| `Capture`             | class     | The observable console interceptor — buffers (total + by level), emits `capture`, optionally mirrors + forwards to a sink.              |
| `createCaptureResult` | function  | A function's `{ value, messages }` after running it with `console.*` captured for its duration (scoped, self-restoring; sync or async). |

### Errors

The one error type the console layer throws — an internal invariant or unreachable-guard violation.

| API                | Kind     | Summary                                                                                                                      |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleErrorCode` | type     | The machine-readable error code a `ConsoleError` carries — `INVARIANT`, the only code the package throws.                    |
| `ConsoleError`     | class    | Carries a `ConsoleErrorCode` and an optional `context` bag — thrown for an internal invariant violated at a defensive guard. |
| `isConsoleError`   | function | Whether an unknown caught value is a `ConsoleError` — the narrowing guard for a `catch`.                                     |

### Animations

Live activity animations — pure frame PRODUCERS over the SAME styler + sink substrate; the line-OVERWRITE is the sink's job.

| API                 | Kind      | Summary                                                                                                                               |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `BarOptions`        | interface | `renderBar` options — `current` / `total` / `width?` / `fill?` / `empty?` / `styler?` / `style?` (a determinate bar string).          |
| `SpinnerEventMap`   | type      | A spinner's observable events — `frame(line)` per advance / outcome + the `start` / `stop` timer-lifecycle signals.                   |
| `SpinnerOptions`    | interface | `Spinner` options — `on?` / `error?` / `message?` / `frames?` / `interval?` / `sink?` / `styler?` / `theme?`.                         |
| `SpinnerInterface`  | interface | The activity spinner — `emitter` / `active` / `message` data + `start` / `tick` / `update` / `succeed` / `fail` / `stop` / `destroy`. |
| `Spinner`           | class     | The self-driving, observable spinner — a timer-advanced glyph cycle writing `\r` + a frame line to its sink; leak-free.               |
| `ProgressReport`    | interface | One advance of a progress bar — the clamped `{ current, total }` the `update` event carries.                                          |
| `ProgressEventMap`  | type      | A progress bar's observable events — `update({current,total})` per report + a `succeed` signal on a successful finish.                |
| `ProgressOptions`   | interface | `Progress` options — `on?` / `error?` / `total` / `message?` / `width?` / `fill?` / `empty?` / `sink?` / `styler?` / `theme?`.        |
| `ProgressInterface` | interface | The progress bar — `emitter` / `active` / `succeeded` / `current` / `total` data + `update` / `succeed` / `fail` / `destroy`.         |
| `Progress`          | class     | The update-driven, observable progress bar — recomputes + writes `\r` + the bar on each `update`; no self-timer (the caller drives).  |

### Style constants

The SGR code data the ANSI renderer maps through, and the styler's color / attribute axes (`src/core`). All `Object.freeze`d data; the SGR numbers are the fixed ECMA-48 spec.

| API                | Kind  | Summary                                                                                                                                 |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `FOREGROUND_CODES` | const | Each `Color`'s SGR FOREGROUND parameter (30–37 / 90–97); `default` is absent (emits no code).                                           |
| `BACKGROUND_CODES` | const | Each `Color`'s SGR BACKGROUND parameter (40–47 / 100–107); `default` is absent.                                                         |
| `ATTRIBUTE_CODES`  | const | Each `Attribute`'s SGR "on" parameter (`bold` 1, `dim` 2, `italic` 3, `underline` 4, `inverse` 7, `strikethrough` 9).                   |
| `EMPTY_STYLE`      | const | The EMPTY `Style` (no colors, no attributes) — the neutral base a styler builds from; deeply frozen.                                    |
| `DEFAULT_THEME`    | const | The default `Theme` — every role bound to its default `Style`, assembled from `LEVEL_COLORS` / `STATUS_ICONS` / `STATUS_COLORS`.        |
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

The level order + label colors, the box-drawing junction sets, status icons / colors, and default widths / glyphs (`src/core`). All `Object.freeze`d data; the box-drawing + braille glyphs are fixed Unicode. There is no separate tree-connector table: a tree derives its branch / corner / guide runs from the same `BORDER_CHARS` set a box or a table draws with, so a box, a table, and a tree all answer to one `border`.

| API                   | Kind  | Summary                                                                                                                |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `LEVEL_SEVERITY`      | const | Each `LogLevel`'s numeric severity — the ascending order (`debug` 0 < `info` 1 < `warn` 2 < `error` 3) the gate reads. |
| `LEVEL_COLORS`        | const | Each `LogLevel`'s default label `Color` — its VISUAL treatment (orthogonal to leveling); excludes `default`.           |
| `DEFAULT_LOG_LIMIT`   | const | The default bounded-retention cap for a logger (`1000`); retention is always bounded.                                  |
| `DEFAULT_LOG_LEVEL`   | const | The default `LogLevel` threshold a logger gates at — `info`.                                                           |
| `LOG_LEVELS`          | const | Every `LogLevel` in ascending severity — the level axis (drives exhaustive tests).                                     |
| `BORDER_CHARS`        | const | The complete `BorderChars` junction set for each `BorderStyle` — the standard Unicode box-drawing glyphs.              |
| `STATUS_ICONS`        | const | Each `StatusLevel`'s icon glyph — `success` ✔, `error` ✖, `warn` ⚠, `info` ℹ.                                          |
| `STATUS_COLORS`       | const | Each `StatusLevel`'s `Color` — `success` green, `error` red, `warn` yellow, `info` blue; excludes `default`.           |
| `STATUS_LEVELS`       | const | Every `StatusLevel` — the outcomes a `status` line supports.                                                           |
| `DEFAULT_WIDTH`       | const | The default visible width for the width-aware renderers + the reporter's `section` rule — `80`.                        |
| `DEFAULT_PADDING`     | const | The default horizontal padding inside a box's edges — one cell.                                                        |
| `DEFAULT_BORDER`      | const | The default `BorderStyle` when none is given — `single`.                                                               |
| `DEFAULT_ALIGN`       | const | The default cell `Alignment` when none is given — `left`.                                                              |
| `SEPARATOR_FILL`      | const | The default fill character `renderSeparator` draws its rule with — `─`.                                                |
| `SEPARATOR_TITLE_GAP` | const | The single padding cell on each side of a separator's embedded title.                                                  |
| `SECOND_MS`           | const | The millisecond threshold (`1000`) where `formatDuration` switches from `…ms` to `…s`.                                 |

### Capture & animation constants

The intercepted-method set, the bounded-buffer cap, the level projection, and the spinner frames / bar glyphs / track width (`src/core`). All `Object.freeze`d data.

| API                        | Kind  | Summary                                                                                                                         |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CAPTURE_LEVELS`           | const | Every `CaptureLevel` — the `console.*` methods a `Capture` intercepts by default (`log` / `info` / `warn` / `error` / `debug`). |
| `DEFAULT_CAPTURE_LIMIT`    | const | The default bounded-buffer cap for a `Capture` (`1000`) — total + each by-level bucket; always bounded.                         |
| `CAPTURE_LEVEL_MAP`        | const | Each `CaptureLevel`'s `LogLevel` for the optional sink forward (`log` → `info`, else the matching level).                       |
| `SPINNER_FRAMES`           | const | The default spinner frame cycle — the ten braille-pattern glyphs (`⠋⠙⠹…`).                                                      |
| `DEFAULT_SPINNER_INTERVAL` | const | The default timer period between spinner frames — `80` ms (≈12.5 fps).                                                          |
| `BAR_FILL`                 | const | The default FILLED-cell glyph `renderBar` draws with — the full block `█`.                                                      |
| `BAR_EMPTY`                | const | The default EMPTY-cell glyph `renderBar` draws with — the light-shade block `░`.                                                |
| `DEFAULT_BAR_WIDTH`        | const | The default visible cell count of a progress-bar TRACK — `30`.                                                                  |

### Browser sink

The browser `%c` console sink — translates the core's ANSI output into a `console.log('%c…', css)` call at the OUTPUT boundary ([`src/browser`](../src/browser), surfaced through `@src/browser`). The core owns the `SinkInterface` contract + the style DATA model; this module owns only the browser-side translation.

| API                  | Kind      | Summary                                                                                                                                                        |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserPalette`     | interface | Partial browser CSS overrides — named `color?` / `attribute?` entries replace only those entries; every omission keeps its default.                            |
| `BrowserSinkOptions` | interface | `createBrowserSink` options — an optional partial `palette?` for the browser's named color and attribute CSS mappings.                                         |
| `ConsoleOutput`      | interface | The `console.log`-ready output `ansiToConsole` produces — a `%c`-segmented `format` string + the parallel `styles` CSS array.                                  |
| `StyleAccumulator`   | interface | The immutable scan state `ansiToConsole` replaces while translating SGR codes to CSS — an optional `foreground` / `background` plus a readonly attribute list. |
| `createBrowserSink`  | function  | The browser `%c` `SinkInterface` factory — level-routed ANSI translation with an optional partial `BrowserPalette`.                                            |
| `ansiToConsole`      | function  | ANSI text translated into a `%c` `ConsoleOutput`; an optional partial `BrowserPalette` overrides CSS per named lookup.                                         |
| `escapePercent`      | function  | A text segment with every literal `%` doubled to `%%` — the escape that keeps the console from reading a stray `%` as a directive.                             |
| `scanParameters`     | function  | The numeric codes of an SGR parameter list (`'1;31'` → `[1, 31]`) — a bare / empty field becomes a `0` reset.                                                  |

### Browser sink constants

The SGR → CSS translation data the browser sink maps ANSI runs through (`src/browser`). The number↔name mapping is derived from core's code maps, never re-hardcoded; the browser module reads core's `RESET_CODE` directly (no local re-export).

| API             | Kind  | Summary                                                                                                          |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `COLOR_HEX`     | const | Each named `Color`'s hex value — the 16 standard terminal colors a browser console renders the same names as.    |
| `ATTRIBUTE_CSS` | const | Each text-attribute SGR number → its CSS declaration (`bold` → `font-weight:bold`, …; `inverse` best-effort).    |
| `DIRECTIVE`     | const | The browser console directive (`%c`) that switches the active style — one prefixes every styled run.             |
| `SGR_PATTERN`   | const | The global `RegExp` matching one SGR sequence and CAPTURING its parameters — the scanner walks every styled run. |

### Server sink + process capture

The server output backend — a TTY-aware `Sink` over the real `process` streams + a RAW process-stream capture ([`src/server`](../src/server), surfaced through `@src/server`). The core owns the `SinkInterface` / `LogLevel` contracts + the `console` `Capture`; this module owns the server-only stream backend. Color DETECTION lives here and only here: `inferStyled` reads the environment, `createServerSink` fixes each target's `styled` fact at construction, and nothing in core or the browser probes for color (the color-detection contract).

| API                       | Kind      | Summary                                                                                                                                            |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamTargetInterface`   | interface | The minimal writable-stream shape the server sink + capture address — `write(text)` + optional `isTTY` / `columns`.                                |
| `ServerSinkOptions`       | interface | `createServerSink` options — `stdout?` / `stderr?` / `styled?` / `environment?` / `columns?`; all optional.                                        |
| `ServerSinkInterface`     | interface | A `SinkInterface` exposing the `stdout` target's construction-time `styled` fact and the terminal's live or fixed `columns` width.                 |
| `StreamLevel`             | type      | Which process stream a `CapturedChunk` came from — `stdout` / `stderr` (the "level" axis of `ProcessCaptureInterface`).                            |
| `StreamWriteFunction`     | type      | The patched `process.*.write` method shape — `NodeJS.WriteStream['write']` verbatim; the boundary type the capture snapshots + swaps.              |
| `StreamWriteCallback`     | type      | The optional write-completion callback `process.*.write` accepts — `(error?) => void`; the wrapper forwards it to the mirror.                      |
| `CapturedChunk`           | interface | One intercepted process-stream write — an immutable `{ level, text, time }`; the server analogue of `CapturedMessage`.                             |
| `ProcessCaptureEventMap`  | type      | A process capture's observable events — `capture(chunk)` per write + the `start` / `stop` signals.                                                 |
| `ProcessCaptureOptions`   | interface | `ProcessCapture` options — `on?` / `error?` / `levels?` / `mirror?` / `sink?` / `limit?`.                                                          |
| `ProcessCaptureInterface` | interface | The raw process-stream interceptor — `emitter` / `active` data + `start` / `stop` / `messages` (whole buffer or one stream) / `clear` / `destroy`. |
| `ProcessCapture`          | class     | The observable interceptor of `process.stdout.write` / `process.stderr.write` — owns ALL server output; never throws, bounded.                     |
| `createServerSink`        | function  | The server `ServerSinkInterface` factory — per-target construction-time color inference, level routing, and plain-target stripping.                |
| `isStreamTarget`          | function  | Whether a value is a usable `StreamTargetInterface` (a record with a callable `write`) — the boundary guard, total.                                |
| `inferColumns`            | function  | The width of a stream target — its live `columns` when a TTY, else the `DEFAULT_COLUMNS` fallback; total, re-read per call.                        |
| `inferStyled`             | function  | One target's styled fact: `FORCE_COLOR`, then non-empty `NO_COLOR`, then `isTTY === true`; pure and global-free.                                   |
| `decodeChunk`             | function  | One `process.*.write` chunk (`string` / `Uint8Array`) decoded to text — TOTAL, never throws (so the capture wrapper can't crash).                  |
| `isBufferEncoding`        | function  | Whether a value is a `BufferEncoding` accepted by `Buffer.toString` — backs `decodeChunk`'s encoding handling.                                     |

### Server sink constants

The default stream set, buffer cap, no-TTY column fallback, and the stream → log-level projection (`src/server`). All `Object.freeze`d data.

| API                    | Kind  | Summary                                                                                                                |
| ---------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `STREAM_LEVELS`        | const | The two process streams a capture intercepts by default, in `stdout`-then-`stderr` order — the `StreamLevel` universe. |
| `DEFAULT_STREAM_LIMIT` | const | The default bounded-buffer cap for a process capture (`1000`) — total + each per-stream bucket; always bounded.        |
| `DEFAULT_COLUMNS`      | const | The terminal width a server sink reports when the `stdout` stream is not a TTY and no explicit width was given — `80`. |
| `STREAM_LEVEL_MAP`     | const | Each `StreamLevel`'s `LogLevel` for the optional sink forward — `stdout` → `info`, `stderr` → `error`.                 |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed. Each type's `readonly` data members, for example `emitter` / `active` / `message` / `level` / `name` / `current` / `total` / `succeeded` / `columns`, stay in the preceding Surface rows and are not repeated here. Each implementing class implements its interface exactly, so this doubles as the per-instance method surface.

**Data-only / callable surfaces (no `## Methods` subsection).** `ServerSinkInterface` adds `styled` and `columns` data members to `SinkInterface` (its `write` is the inherited contract in the following `SinkInterface` table). Every `*Options` / `*EventMap` / `LogRecord` / `Style` / `Theme` / `ThemeStatus` / `BorderChars` / `ColumnSpec` / `TreeNode` / `StepPosition` / `ProgressReport` / `WriterSet` / `CapturedMessage` / `CapturedChunk` / `CaptureResult` / `BrowserPalette` / `ConsoleOutput` / `StyleAccumulator` / `StreamTargetInterface` row is a data / options shape with no behavioral methods.

#### `RendererInterface`

| Method   | Returns  | Behavior                                                                                               |
| -------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `render` | `string` | Render `text` wrapped in the target codes for a `Style` — the empty style / empty string pass through. |

#### `StylerInterface`

`StylerInterface` is also a CALLABLE: its call signature `(text) => string` renders the accumulated style, and its chainable `Color` / `Attribute` accessors are data getters that stay in the preceding Surface row. `render` is its one named method — the same styling reached by VALUE instead of by accessor name.

| Method   | Returns  | Behavior                                                                                                                  |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `render` | `string` | Render `text` in a `Style` merged OVER the accumulated one — its colors win, its attributes join; verbatim when disabled. |

#### `SinkInterface`

| Method  | Returns | Behavior                                                                                                                                                                                                                                  |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write` | `void`  | Write one already-formatted chunk — one line without its terminator, or a `\r`-leading redraw frame written as-is; a tick frame has no terminator and a final frame carries its own. The optional `level` lets a stream-aware sink ROUTE. |

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

#### `RetentionInterface`

| Method    | Returns        | Behavior                                                                                                                   |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `add`     | `void`         | Retain one record in the whole buffer and in its level's bucket, evicting the oldest of each past `limit`.                 |
| `records` | `readonly T[]` | No arg → a copy of the whole buffer, oldest first; with a level → a copy of that bucket, empty for a level with no bucket. |
| `clear`   | `void`         | Drop every retained record from the whole buffer and every bucket; further records are still retained.                     |

#### `CaptureInterface`

| Method     | Returns                      | Behavior                                                                                                                            |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `start`    | `void`                       | Snapshot the configured `console.*` and install the interceptors — a no-op when already `active`.                                   |
| `stop`     | `void`                       | Restore the snapshot-original `console.*` — a no-op when not `active`.                                                              |
| `messages` | `readonly CapturedMessage[]` | No arg → a copy of the whole captured buffer, oldest first (capped at `limit`); with a `CaptureLevel` → a copy of only that bucket. |
| `clear`    | `void`                       | Drop every buffered message; does NOT stop interception.                                                                            |
| `destroy`  | `void`                       | Tear down — `stop()` then destroy the emitter.                                                                                      |

#### `SpinnerInterface`

| Method    | Returns | Behavior                                                                                      |
| --------- | ------- | --------------------------------------------------------------------------------------------- |
| `start`   | `void`  | Arm the periodic timer and render the first frame — a no-op when already `active`.            |
| `tick`    | `void`  | Advance one frame: build the line, emit `frame`, write `\r` + line to the sink.               |
| `update`  | `void`  | Change the message; re-renders immediately when `active`.                                     |
| `succeed` | `void`  | Stop with a SUCCESS line — clear the timer, write + emit `✔ message` + newline.               |
| `fail`    | `void`  | Stop with an ERROR line — clear the timer, write + emit `✖ message` + newline (error stream). |
| `stop`    | `void`  | Clear the timer and LEAVE the current line — a no-op when not `active`.                       |
| `destroy` | `void`  | Tear down — `stop()` then destroy the emitter.                                                |

#### `ProgressInterface`

| Method    | Returns | Behavior                                                                                                 |
| --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `update`  | `void`  | Report progress: clamp `current`, re-render, emit `update`, write `\r` + bar. Ignored once terminal.     |
| `succeed` | `void`  | Finish successfully — render a FULL bar + newline, emit a final `update` then `succeed`.                 |
| `fail`    | `void`  | Finish unsuccessfully — render the bar at its current fill + newline to the error stream (no `succeed`). |
| `destroy` | `void`  | Tear down — destroy the emitter.                                                                         |

#### `ProcessCaptureInterface`

| Method     | Returns                    | Behavior                                                                                                                          |
| ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `start`    | `void`                     | Begin intercepting the configured process streams (idempotent; emits `start`).                                                    |
| `stop`     | `void`                     | Restore the pristine `process.*.write` references (idempotent; emits `stop`).                                                     |
| `messages` | `readonly CapturedChunk[]` | No arg → a copy of the full captured buffer, oldest first (capped at `limit`); with a `StreamLevel` → a copy of only that bucket. |
| `clear`    | `void`                     | Drop every buffered chunk; interception is unaffected.                                                                            |
| `destroy`  | `void`                     | Stop interception (restoring the streams) and tear down the emitter.                                                              |

## Contract

These invariants hold across `src/core` ↔ `src/browser` ↔ `src/server` ↔ `console.md`:

1. **DOC ↔ SOURCE bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the console source trees (`src/core` plus the `src/browser` and `src/server` environment backends), and every export appears as a Surface row — exhaustive, both directions.
2. **DOC ↔ SOURCE method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`ANSIRenderer` / `Logger` / `LoggerManager` / `Reporter` / `Capture` / `Spinner` / `Progress` / `ProcessCapture`) implements every method of its interface and adds none beyond it. A renamed / added / removed method breaks the gate until the table is reconciled.
3. **One coherent `LogLevel`; styling orthogonal to level.** A `LogLevel` is one ascending-severity scale (`debug` < `info` < `warn` < `error`, ordered by `LEVEL_SEVERITY`); a logger gates by THRESHOLD through `meetsLevel`. A level's color (`LEVEL_COLORS`) is a STYLING choice, never a separate level — there are no `success` / `ready` pseudo-levels (those that look like outcomes are the reporter's `StatusLevel`, a narrative axis with no ordering or gating).
4. **Style is DATA + a swappable renderer.** A `Style` is a frozen `{ foreground?, background?, attributes }` record, NOT a baked escape string; a `RendererInterface` turns it into output for one target. The cross-environment default is the `ANSIRenderer` (SGR codes); a browser `%c` renderer implements the SAME contract over the SAME `Style`, so retargeting swaps the renderer and never the style model. The `Styler` is immutable copy-on-write (a later color of a channel wins; a repeated attribute is idempotent), so a base styler is freely reusable.
5. **A theme is the application's vocabulary; an option is this instance's presentation.** A `Theme` binds the semantic roles the WHOLE application shares to `Style` values — a label style per `LogLevel` under `levels`, an icon + style per `StatusLevel` under `statuses`, one `accent` (spinner glyph, bar fill, step prefix) and one `chrome` (separators, box / table / tree connectors, a log line's timestamp / name / data surround). Hand ONE theme to the logger, the reporter, the spinner, and the progress bar and every surface speaks it; `createTheme` merges per role — and per entry within `levels` / `statuses` — over `DEFAULT_THEME`, snapshots every style leaf, and deep-freezes each snapshot, so an override restyles one role and later caller mutation cannot change it. A per-entity option carries what only THAT instance draws with: a spinner's `frames`, a progress bar's `fill` / `empty`, a box's / table's / tree's `border`. The test is which axis the value keys on: a domain axis (level, status, accent, chrome) is a theme role; a glyph one instance happens to use is an option, and it never enters the theme.
6. **The `Sink` seam + the no-capture-loop.** `SinkInterface` is the ONE place text leaves the system — redirect output by supplying a different sink, with no change to the logger / reporter / animation. The default `createConsoleSink` (and `createBrowserSink` / `createServerSink`) SNAPSHOTS the underlying `console` / `process` write at creation and writes through that snapshot, so a `Capture` / `ProcessCapture` installed AFTERWARD can never feed the system's own output back into itself — create sinks (and loggers) BEFORE installing a capture.
7. **`format` owns the human line; the record + `entry` / `capture` event owns the machine record.** A `Logger` ALWAYS emits an accepted record on `entry`, and a `Capture` / `ProcessCapture` emits every intercepted call on `capture`; a file / JSON / remote transport rides that emitter rather than a second code path, and it rides `entry` rather than `format` — the record is already structured there, so no transport parses a line back apart. `format` (a `LogFormatFunction`, defaulting to `formatRecord`) decides only what the human line looks like, and the order is fixed: gate, freeze the record, retain it, emit `entry`, then — unless `silent` — `format` and write. `silent` suppresses the WRITE and never invokes `format`, so a silent logger still feeds every transport and pays nothing for a line nobody reads. A formatter throw is a programmer error: it propagates to the `logger.info` caller and prevents that logger's write after its record and event have left. A manager fans out sequentially, so the throw also stops every remaining logger for that call before retention or `entry`. Listener isolation is the emitter's: a listener throw routes to the emitter's OWN `error` handler, never onto the domain `EventMap`, so a buggy transport / capture listener can never perturb logging — nor (for the captures) escape into the host's `console.*` / `process.*.write` call.
8. **Bounded retention.** Every buffer is capped, never unbounded: a logger's `entries()` tail at `DEFAULT_LOG_LIMIT`, a `Capture` / `ProcessCapture`'s total buffer AND each per-level / per-stream bucket at `DEFAULT_CAPTURE_LIMIT` / `DEFAULT_STREAM_LIMIT` — oldest dropped first. A long-running logger or capture can never grow without bound. Both captures buffer through the ONE `Retention` engine (`RetentionInterface`, generic over the record type each carries), so their retention semantics cannot drift apart.
9. **The environment split — one engine, environment sinks.** The cross-environment core owns the contract (`Style` / `SinkInterface` / `LogLevel`) and all the universal logic; each environment supplies only the platform output backend at the `Sink` seam. ANSI lives in core (`ANSIRenderer` + `createConsoleSink`); the browser translates ANSI to `console.log('%c…', css)` AT THE SINK (`createBrowserSink` over the pure, total, `%`-safe `ansiToConsole`); the server writes to the real `process` streams with styling selected per target at construction by the precedence in the color-detection contract. The browser / server modules import the core contracts (never redeclare them) and add only their backend.
10. **Color detection is the server sink's alone.** `createServerSink` decides each target's styling ONCE, at construction: `options.styled` when supplied; otherwise `inferStyled(target, options.environment ?? process.env)` checks a PRESENT `FORCE_COLOR` first (only the exact value `'0'` disables), then a present, non-empty `NO_COLOR`, then the target's own `isTTY === true`. The sink stores that fact per target (`stdout` and `stderr` can differ), keys its ANSI stripping off it, and exposes the `stdout` fact as `styled`. Nothing else reads the environment: core's `createStyler` takes `enabled` from its caller and defaults to `true`, and the browser sink always styles. The server pairing is `createStyler({ enabled: sink.styled })` — one styling fact drives both ANSI generation and sink stripping.
11. **Animations: every sink gets the frame, the sink decides the redraw + timer leak-freedom.** A `Spinner` / `Progress` builds a frame line and writes a leading `\r` + that line to its sink, then emits it — every sink receives the SAME frame and the line-OVERWRITE is the SINK's decision. A `ServerSink` writes the frame straight to the stream and appends no newline (a plain target loses the frame's ANSI, never its `\r`), so a terminal returns to column 0 and redraws in place. Core's `createConsoleSink` also writes it verbatim, and because `console.log` terminates each call the frame lands as a fresh line rather than an overwrite — the plain-environment degrade, with no `\r`-specific branch in core. `createBrowserSink` strips the leading `\r` (a DevTools console cannot overwrite a line, and the stray control character would be rendered) and writes a fresh line — the locked browser degrade. A `Spinner`'s internal timer is ALWAYS cleared on `succeed` / `fail` / `stop` / `destroy`, so it never leaks; a `Progress` has no self-timer (the caller drives `update`). Both are universal — `setInterval` + the one styler + the one sink, no `node:*`, no `process.stdout`.
12. **Capture never-throws, non-reentrant, pristine restore.** A `Capture` / `ProcessCapture` builds its record through a TOTAL stringify / decode (`formatArgs` / `decodeChunk`), so intercepting `console.*` / `process.*.write` can never throw and crash the host. Each is PROCESS-GLOBAL + NON-REENTRANT — it patches the one global, so at most one may be active at a time; `start()` is idempotent (never double-patches) and `stop()` restores the EXACT snapshot reference, leaving the global pristine. A `ProcessCapture` additionally returns the snapshot-original's backpressure boolean so a caller's `write` handling keeps working.
13. **`width()`-aware rendering.** Every layout (`renderSeparator` / `renderBox` / `renderTable` / `renderTree` / `renderBar`, through `align` / `repeatTo`) measures on the VISIBLE `width` (ANSI stripped, counted in code points), so an already-styled cell or title keeps its columns — its escape codes never break the layout. Caller text arrives line-broken either way: the `renderBox` function splits its `content` on a line feed OR a CRLF pair, so a body written on Windows frames byte-identically to the same body written on POSIX, and no carriage return from a CRLF break reaches a framed row. A LONE carriage return is not a separator — it stays inside its line, because a bare `\r` is the animation frame's cursor control (the animation contract), and cutting a frame on it would break the redraw the sink decides.

What ships is the **cross-environment core** (the style engine, structured logging, narrative reporting, the `console` `Capture`, and the live animations) plus the two environment backends (the browser `%c` sink, the server TTY sink + raw-stream `ProcessCapture`). Deliberately **not** part of this surface, by the same "build only what earns its keep" discipline:

- **A file / JSON / remote sink.** Those ride the shipped `entry` transport seam — a consumer writes the sink.
- **East-asian (wide-glyph) width handling.** `width` counts code points, so a wide glyph (CJK, most emoji) counts as one column while a terminal gives it two — a layout holding one renders wider than it measured, and its border stops lining up.
- **256-color and 24-bit color depth.** `Color` stays the closed 16-name union, and that is a decision rather than an omission. That union is what generates the fluent styler — one chainable accessor per name, `styler.brightCyan.bold('…')` — and an open numeric or hex axis has no accessor set to generate. A consumer who wants different ink behind those names already has it: `BrowserPalette` maps each name to exact CSS. A consumer who wants true color implements one `RendererInterface`, which receives the `Style` DATA and emits whatever its target understands — the 24-bit seam is already open, and it costs the style model every environment shares nothing.
- **A multi-capture coordinator.** Capture is process-global by design.

## Patterns

### A styled, leveled logger

```ts
import { Logger } from '@orkestrel/console'

const logger = new Logger({ name: 'http', level: 'info' })
logger.debug('verbose') // dropped — below the `info` threshold
logger.info('request', { method: 'GET', path: '/' }) // a styled line: time · INFO · [http] · message · data
logger.warn('slow', { ms: 900 }) // WARN in yellow, routed to the sink's warn stream
logger.entries() // the bounded tail — [the info record, the warn record]

// The `entry` event is the transport seam — tee every accepted record to a file / JSON / remote sink.
logger.emitter.on('entry', (record) => archive(record)) // fires even when the logger is `silent`
logger.clear() // drop retained entries (listeners are untouched)
logger.destroy() // clear() then destroy the emitter
```

### The line a logger writes

```ts
import { Logger } from '@orkestrel/console'

// `format` owns the human line and nothing else — the record is already structured on `entry`.
const logger = new Logger({ format: (record) => `${record.level}: ${record.message}` })
logger.info('ready') // info: ready

// `silent` suppresses the WRITE only: the record is still emitted, and `format` is never invoked.
const quiet = new Logger({ silent: true, format: () => 'never built' })
quiet.emitter.on('entry', (record) => archive(record)) // still fires
quiet.info('archived') // nothing written, no formatter call
```

### A logger registry

```ts
import { LoggerManager } from '@orkestrel/console'

const manager = new LoggerManager({ level: 'info' })
manager.register('http') // mints + stores a logger named 'http', the manager's defaults flow in
manager.info('booted') // fan out an `info` log to every registered logger
manager.remove('http') // remove one by name (also: remove(['a', 'b']) for a batch)
manager.remove() // no argument — empty the registry
```

### A reporter narration

```ts
import { Reporter } from '@orkestrel/console'

const reporter = new Reporter()
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
reporter.tree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } }) // root / ├─ a / └─ b
reporter.tree({
	root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] },
	border: 'double',
}) // the same tree, root / ╠═ a / ╚═ b
reporter.box({ content: 'hello', title: 'Note' }) // content framed in box-drawing characters
reporter.line('raw text') // one raw line, no prefix, no icon
reporter.blank() // one blank line (reporter.blank(3) — three)
reporter.status('success', 'all green') // ✔ all green
```

### One theme, every entity

```ts
import { createStyler, createTheme, Logger, Progress, Reporter, Spinner } from '@orkestrel/console'

// A theme is the app-wide vocabulary. Override a role; the rest keep their defaults.
const theme = createTheme({
	statuses: { success: { icon: '+', style: createStyler().brightMagenta.style } },
	accent: createStyler().magenta.style, // the spinner glyph, the bar fill, the step prefix
})

new Logger({ name: 'http', theme }).warn('slow') // …Z WARN [http] slow — WARN still in theme.levels.warn
new Reporter({ theme }).status('success', 'all green') // + all green — glyph and line both bright magenta
new Spinner({ message: 'deploying', theme }).tick() // ⠋ deploying — the glyph in the accent

// A per-entity option is THIS instance's presentation, never a shared role.
new Spinner({ message: 'deploying', frames: ['-', '\\', '|', '/'] }).tick() // - deploying
new Progress({ total: 10, width: 10, fill: '=', empty: '.' }).update(4) // ====...... 40% (4/10)
```

### Scoping third-party `console.*` with `createCaptureResult`

```ts
import { createCaptureResult } from '@orkestrel/console'

// Create your loggers BEFORE this — they snapshot the real console, so they are never recaptured.
const { value, messages } = createCaptureResult(() => {
	noisyLibrary() // its console.log / console.error are intercepted, not printed
	return computeResult()
})
value // the function's own return value
messages.map((m) => `${m.level}: ${m.text}`) // the third-party output, captured

// Async works too — awaited before `console` is restored:
const out = await createCaptureResult(async () => fetchAndLog())
```

### Capture lifecycle

```ts
import { Capture } from '@orkestrel/console'

const capture = new Capture()
capture.start() // snapshot the configured console.* and install the interceptors
console.log('hello')
capture.messages() // the whole buffer — [{ level: 'log', text: 'hello', time: … }]
capture.clear() // drop every buffered message; does NOT stop interception
capture.stop() // restore the snapshot-original console.*
capture.destroy() // stop() then destroy the emitter
```

### The bounded retention engine directly

```ts
import { Retention } from '@orkestrel/console'

// Both captures buffer through this one engine, so their retention semantics cannot drift apart.
const retention = new Retention<{ level: 'warn' | 'error'; text: string }>(['warn'], 2)
retention.add({ level: 'warn', text: 'first' })
retention.add({ level: 'error', text: 'second' }) // no `error` bucket — the whole buffer still keeps it
retention.records().length // 2 — the whole buffer, oldest first
retention.records('warn') // [{ level: 'warn', text: 'first' }] — only that bucket
retention.add({ level: 'warn', text: 'third' })
retention.records().length // 2 — 'first' was evicted; the whole buffer is capped at 2
retention.records('warn').length // 2 — each bucket is capped independently, also at 2
retention.clear()
retention.records() // []
```

### A spinner and a progress bar

```ts
import { Progress, Spinner } from '@orkestrel/console'

const spinner = new Spinner({ message: 'connecting' })
spinner.start() // a self-driving glyph cycle; a TTY sink redraws on the `\r`
spinner.tick() // advance one frame by hand: emits `frame`, writes `\r` + line
spinner.update('handshaking') // the message changes, re-rendered at once
spinner.succeed('connected') // ✔ connected — timer cleared, line committed

const failing = new Spinner({ message: 'connecting' })
failing.start()
failing.fail('unreachable') // ✖ unreachable — timer cleared, error stream
failing.destroy() // stop() then destroy the emitter

const progress = new Progress({ total: 100, message: 'downloading' })
progress.update(40) // ████████████░░░░░░░░░░░░░░░░░░ 40% (40/100) downloading
progress.update(80, 'almost there')
progress.succeed('done') // a full bar, committed with a newline

const interrupted = new Progress({ total: 100, message: 'downloading' })
interrupted.update(30)
interrupted.fail('connection lost') // the bar at its current fill, error stream, no `succeed`
interrupted.destroy() // tear down the emitter
```

### The browser — `%c` styling in DevTools

```ts
import { Logger } from '@orkestrel/console'
import { createBrowserSink } from '@orkestrel/console/browser'

// The SAME core logger; only the sink changes. ANSI is translated to `%c` at the sink,
// so a DevTools console renders the same 16 colors a terminal would.
const logger = new Logger({ name: 'app', sink: createBrowserSink() })
logger.error('boom') // → console.error('%c…', 'color:#cd0000;…') in DevTools
```

### The server — a TTY sink and a process capture

```ts
import { createStyler, Logger, Reporter } from '@orkestrel/console'
import { createServerSink, ProcessCapture } from '@orkestrel/console/server'

const sink = createServerSink() // FORCE_COLOR, then NO_COLOR, then isTTY — per target, at construction
const styler = createStyler({ enabled: sink.styled }) // keep generated ANSI paired with the sink's stdout stripping
const logger = new Logger({ name: 'server', sink, styler })
logger.error('boom') // → process.stderr (the error stream)
const reporter = new Reporter({ sink, width: sink.columns }) // size the layout to the live terminal

// `styled` overrides the inference outright — for a CI log that renders ANSI off a TTY, say.
const forced = createServerSink({ styled: true })
forced.styled // true, whatever the environment and the streams say

// Own ALL output — a direct process.stdout.write, library output, child-process pipes (not only console.*):
const capture = new ProcessCapture({ levels: ['stderr'], mirror: true })
capture.start()
process.stderr.write('a library diagnostic\n') // captured AND still shown (mirror: true)
capture.messages('stderr') // [{ level: 'stderr', text: 'a library diagnostic\n', time: … }]
capture.clear() // drop buffered chunks; interception is unaffected
capture.stop()
capture.destroy() // stop() then tear down the emitter
```

### One logger, different sink per environment (the cross-env one-liner)

```ts
import { Logger } from '@orkestrel/console'
import { createBrowserSink } from '@orkestrel/console/browser'
import { createServerSink } from '@orkestrel/console/server'

// The Logger code is identical everywhere — only the sink is chosen per environment.
const sink = inBrowser ? createBrowserSink() : createServerSink()
const logger = new Logger({ name: 'app', sink }) // ANSI in core, `%c` in the browser, TTY/streams on the server
logger.info('ready') // styled the same way, routed to the right backend, with no other change
```

### The pure layout + formatting helpers directly

```ts
import {
	ANSIRenderer,
	cellAt,
	createStyler,
	formatDuration,
	formatTime,
	paint,
	renderBox,
	renderTable,
} from '@orkestrel/console'

const renderer = new ANSIRenderer()
renderer.render({ foreground: 'red', attributes: [] }, 'hi') // wraps 'hi' in the red SGR codes

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
import { inferColumns } from '@orkestrel/console/server'

inferColumns(process.stdout) // the live TTY width, or the DEFAULT_COLUMNS fallback off a TTY
```

### Server boundary guards directly

```ts
import { isBufferEncoding, isStreamTarget } from '@orkestrel/console/server'

isStreamTarget(process.stdout) // true — a record with a callable `write`
isStreamTarget({}) // false — no `write`
isBufferEncoding('utf8') // true — a value accepted by Buffer#toString
isBufferEncoding('nope') // false
```

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection across `src/core` and the `src/browser` + `src/server` backends (value + type exports), plus each interface ↔ implementing-class method bijection.
- [`tests/src/core/renderers/ANSIRenderer.test.ts`](../tests/src/core/renderers/ANSIRenderer.test.ts) — the ANSI renderer: foreground / background / attribute SGR codes, multi-attribute composition, `default` / unset / empty-style / empty-string pass-through.
- [`tests/src/core/Styler.test.ts`](../tests/src/core/Styler.test.ts) — the fluent styler: chainable `Color` / `Attribute` accessors, immutability + composition either way, last-color-wins / idempotent-attribute, the `enabled` verbatim switch, a swapped renderer, and `render` by value (the merge precedence, a themed role, the frozen merged style handed to the renderer).
- [`tests/src/core/loggers/Logger.test.ts`](../tests/src/core/loggers/Logger.test.ts) — the logger: the level gate (drop below threshold), the frozen `LogRecord`, bounded `entries()` retention + `clear`, the `entry` transport event (fires even when `silent`), the styled line, the themed level label, the `format` contract (the return written exactly, never invoked when `silent` or when the gate drops a record, a throw preventing only the write), the default snapshotted console sink, and the emitter's listener-isolation (`error` handler) emit-safety.
- [`tests/src/core/loggers/LoggerManager.test.ts`](../tests/src/core/loggers/LoggerManager.test.ts) — the registry: `register` (defaults flow in — `theme` / `format` included — and a register override wins, re-register overwrites) / `logger` / `loggers` / `count`, sequential `debug`…`error` fan-out including formatter-throw halt, and `remove` ALL / one / batch.
- [`tests/src/core/Reporter.test.ts`](../tests/src/core/Reporter.test.ts) — the reporter verbs: `section` / `step` (with / without position) / `timing` / `status` (the theme's icon + style, `error` → error stream) / `table` / `tree` / `box` / `line` / `blank`, each verb's bytes unchanged under the explicit default theme.
- [`tests/src/core/Capture.test.ts`](../tests/src/core/Capture.test.ts) — the console interceptor: snapshot-at-`start` + restore, capture (total + by level) + bounded buffers, the `capture` event + `start` / `stop` lifecycle, `mirror` / `sink` forwarding, idempotency, and the no-capture-loop.
- [`tests/src/core/Spinner.test.ts`](../tests/src/core/Spinner.test.ts) — the spinner: deterministic `tick()` frame advance + the `\r` write, idempotent `start`, the leak-free timer (armed / always cleared, fake timers), `update`, `succeed` / `fail` outcome lines (the theme's status icon + style), the accent glyph, and the `frame` / `start` / `stop` events.
- [`tests/src/core/Progress.test.ts`](../tests/src/core/Progress.test.ts) — the progress bar: `update` clamp + render + `\r` write, the `update` event, terminal `succeed` (full bar + `succeed` event) / `fail` (error stream, no succeed), the custom `fill` / `empty` glyphs with the accent on the filled run only, and the post-terminal ignore.
- [`tests/src/core/Retention.test.ts`](../tests/src/core/Retention.test.ts) — the shared retention engine both captures compose: oldest-first order in the whole buffer and per level, the independent cap on each, a record whose level has no bucket, the copy returned by every `records` call, `clear` leaving retention working, and the zero / one limits.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the pure helpers: `strip` / `width` (ANSI-aware, code points), `freezeStyle` snapshot and deep freeze, `meetsLevel` / `selectWriter` (every `LogLevel` plus an omitted one, and a backend folding two levels onto one target) / `formatTime` / `formatRecord`, `align` / `paint` / `repeatTo` / `cellAt`, `renderSeparator` / `renderBox` / `renderTable` / `renderTree` (every connector derived from the selected border set, an omitted `border` byte-identical to an explicit `single`) / `renderBar`, `formatDuration`, and the total `stringifyValue` / `formatArgs` (Error / cycle / BigInt).
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — the value factories: `createStyler`'s renderer / `enabled` options, `createTheme`'s per-role / per-entry merge over the frozen `DEFAULT_THEME` plus style-leaf snapshot isolation through live entities, `createConsoleSink`'s level routing + snapshot + the verbatim `\r` redraw frame (a real `Spinner` driven through a recorder, against a plain-write control), and `createCaptureResult` (sync + async, restore-on-throw).
- [`tests/src/browser/helpers.test.ts`](../tests/src/browser/helpers.test.ts) — `ansiToConsole` in real Chromium: SGR runs → `%c` segments + parallel CSS, the reset clear, last-color-wins, the plain-text short-circuit, `%`-safety, and a partial `BrowserPalette` overriding named colors / attributes while every omission stays byte-identical; plus `escapePercent` / `scanParameters`.
- [`tests/src/browser/factories.test.ts`](../tests/src/browser/factories.test.ts) — `createBrowserSink` in real Chromium: the ANSI → `%c` `console[method](format, ...styles)` call, level routing, a threaded `palette`, the leading-`\r` animation degrade (only the leading one), and the snapshot (no capture loop).
- [`tests/src/server/helpers.test.ts`](../tests/src/server/helpers.test.ts) — the server helpers: `inferStyled` over the full `FORCE_COLOR` × `NO_COLOR` × `isTTY` matrix, `inferColumns` (live TTY width / fallback), and the total `decodeChunk` (string / Buffer / Uint8Array / bad encoding).
- [`tests/src/server/validators.test.ts`](../tests/src/server/validators.test.ts) — the server boundary guards: `isStreamTarget` (the real process streams, any callable `write`, and every off-shape value rejected without throwing) and `isBufferEncoding` (the full Node encoding family, case-insensitive and hyphenated, against non-encodings and non-strings).
- [`tests/src/server/factories.test.ts`](../tests/src/server/factories.test.ts) — `createServerSink` over a fake `StreamTargetInterface`: level routing to `stdout` / `stderr`, injected-environment inference with a TTY `stdout` beside a piped `stderr`, a `styled` override, construction-time facts, the `\r` frame without an appended newline, and live / fixed `columns`.
- [`tests/src/server/ProcessCapture.test.ts`](../tests/src/server/ProcessCapture.test.ts) — the process capture over a `process.*.write` probe: snapshot-at-`start` + pristine restore, capture (total + per-stream) + bounded buffers, the `capture` / `start` / `stop` events, `mirror` (backpressure passed through) / `sink` forwarding, idempotency, and the never-throw decode.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; see § Design laws and § Documentation contract.
- [`emitter.md`](emitter.md) — the typed emitter the `Logger` / `Capture` / `Spinner` / `Progress` own for their `entry` / `capture` / `frame` events.
- [`README.md`](README.md) — the guides index.
