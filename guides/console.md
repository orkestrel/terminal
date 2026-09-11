# Console

> A unified output-control system for a terminal, a browser, and a server: a style engine over
> frozen `Style` data, structured logging whose record and `entry` event are the transport seam,
> narrative reporting, console and stream capture, and live animations — one engine, environment
> sinks, with the platform backend swapped at the `Sink` seam.

ANSI / SGR escape codes are the default (the `ANSIRenderer` class with the `createConsoleSink`
factory), the browser translates ANSI to `console.log('%c…', css)` at its sink
(`createBrowserSink`), and the server writes to the real `process` streams with styling selected per
target at construction by the precedence in the color-detection contract (`createServerSink`). A
`Logger` composes leveled records, a `Reporter` narrates sections, steps, timings, tables, trees,
and boxes, a `Capture` and a `ProcessCapture` take control of `console.*` and `process.*` on the
read side, and a `Spinner` and a `Progress` drive live frames. A record reaches a file, JSON, or a
remote transport off the `entry` and `capture` events rather than off a second code path.

An animation pushes the line-overwrite decision down to the sink too: a `Spinner` or a `Progress`
writes a leading `\r` and its frame to every sink, and each sink decides what that means — the
server TTY sink writes it verbatim and the terminal redraws in place, the core console sink also
writes it verbatim and `console.log` terminates the call so the frame lands on a fresh line, and
the browser sink strips the `\r` for the same fresh-line degrade. The same code gives a live
redraw or a clean fallback per environment. Source: [`src/core`](../src/core) (surfaced through
`@src/core`), with the browser sink in [`src/browser`](../src/browser) (`@src/browser`) and the
server sink with the process capture in [`src/server`](../src/server) (`@src/server`).

## Surface

Build a styled, leveled logger and a narrative reporter over the shared substrate; the same code retargets to any environment by swapping the `sink`:

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

The style engine — text style as data, rendered by a swappable renderer (ANSI default; a browser `%c` renderer at the same seam).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                 | Kind      | Shape                                                                                                                                                                                                                                                | Summary                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Color`             | type      | `'black' \| 'red' \| 'green' \| 'yellow' \| 'blue' \| 'magenta' \| 'cyan' \| 'white' \| 'brightBlack' \| 'brightRed' \| 'brightGreen' \| 'brightYellow' \| 'brightBlue' \| 'brightMagenta' \| 'brightCyan' \| 'brightWhite' \| 'default'`            | Names a terminal color — the 8 standard base colors, their 8 bright variants, and `default` (the target's own default ink, emitting no color code).                                                                                                                                                                                                                                |
| `Attribute`         | type      | `'bold' \| 'dim' \| 'italic' \| 'underline' \| 'inverse' \| 'strikethrough'`                                                                                                                                                                         | Names a text-style attribute — `bold` / `dim` / `italic` / `underline` / `inverse` / `strikethrough`, the standard SGR text effects.                                                                                                                                                                                                                                               |
| `Style`             | interface | `{ foreground?, background?, attributes }`                                                                                                                                                                                                           | Represents text style as data — a frozen, readonly record of a foreground color, a background color, and a set of text attributes. The single style value the whole console / terminal system shares; a `RendererInterface` renders it for one target.                                                                                                                             |
| `RendererInterface` | interface | `{} plus render`                                                                                                                                                                                                                                     | Declares a swappable style renderer — the seam that turns style data into output for one target. The cross-environment default is the ANSI renderer (SGR escape codes); a browser `%c` / CSS renderer implements the same contract over the same `Style` model, so it drops in without touching the style data (the browser branch).                                               |
| `StylerOptions`     | interface | `{ renderer?, enabled? }`                                                                                                                                                                                                                            | Configures `createStyler` — `renderer` selects the output target, defaulting to the ANSI renderer, and `enabled` is the no-color switch, defaulting to `true`.                                                                                                                                                                                                                     |
| `StylerInterface`   | interface | `{ style, enabled, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite, bold, dim, italic, underline, inverse, strikethrough } plus render` | Declares the fluent, composable styling surface — the consumer-facing API. It is both a function (call it with text to render the accumulated style) and a record of chainable accessors: every `Color` and `Attribute` is a getter returning a new styler with that token added, so `styler.red.bold('hi')` and `styler.red(styler.bold('hi'))` both work and nothing is mutated. |
| `ThemeStatus`       | interface | `{ icon, style }`                                                                                                                                                                                                                                    | Represents one narrative outcome's presentation — the icon glyph a `StatusLevel` shows and the `Style` the line renders in.                                                                                                                                                                                                                                                        |
| `Theme`             | interface | `{ levels, statuses, accent, chrome }`                                                                                                                                                                                                               | Represents the app-wide semantic style vocabulary — each role bound to a `Style` value. Pass one theme to a logger / reporter / spinner / progress and every surface speaks it.                                                                                                                                                                                                    |
| `ThemeOptions`      | interface | `{ levels?, statuses?, accent?, chrome? }`                                                                                                                                                                                                           | Holds the options for `createTheme` — the roles to override on `DEFAULT_THEME`, a status supplying its whole copied `{ icon, style }` record.                                                                                                                                                                                                                                      |
| `ANSIRenderer`      | class     | `RendererInterface`                                                                                                                                                                                                                                  | Implements the cross-environment default `RendererInterface` — renders style data as ANSI SGR escape codes, stateless and event-free.                                                                                                                                                                                                                                              |
| `createStyler`      | function  | `(options?: StylerOptions) => StylerInterface`                                                                                                                                                                                                       | Creates the fluent, composable `StylerInterface` — ANSI by default, retargeted by a `renderer` and stripped of color by `enabled: false`.                                                                                                                                                                                                                                          |
| `createTheme`       | function  | `(options?: ThemeOptions) => Theme`                                                                                                                                                                                                                  | Creates a `Theme` — the app-wide semantic style vocabulary, merged role by role over `DEFAULT_THEME`. Hand one theme to a logger / reporter / spinner / progress and every surface speaks it; omit `options` for the defaults.                                                                                                                                                     |
| `freezeStyle`       | function  | `(style: Style) => Style`                                                                                                                                                                                                                            | Snapshots and deeply freezes one `Style` value, including an independent frozen copy of its `attributes`.                                                                                                                                                                                                                                                                          |
| `strip`             | function  | `(text: string) => string`                                                                                                                                                                                                                           | Removes every ANSI escape sequence from `text`, returning the plain visible string.                                                                                                                                                                                                                                                                                                |
| `stripControls`     | function  | `(text: string) => string`                                                                                                                                                                                                                           | Removes every non-printing C0 control character from `text` except `\t` / `\n` / `\r` (meaningful whitespace), plus DEL — a separate pass from `strip`, so `width` stays untouched.                                                                                                                                                                                                |
| `width`             | function  | `(text: string) => number`                                                                                                                                                                                                                           | Measures how many visible columns `text` occupies — its length after ANSI escapes are stripped, counted in Unicode code points (so an astral character such as an emoji counts as one, not the two UTF-16 units `String.length` would report).                                                                                                                                     |

### Logging

Structured logging — the immutable `LogRecord` + the `entry` event are the transport seam; `Sink` is the one output primitive.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                      | Kind      | Shape                                                                              | Summary                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LogLevel`               | type      | `'debug' \| 'info' \| 'warn' \| 'error'`                                           | Names the severity level of a `LogRecord` — one coherent, ascending scale, `debug` < `info` < `warn` < `error`, that a `LoggerInterface` gates by threshold.                                                                                                                                                                                                                               |
| `LogRecord`              | interface | `{ level, message, time, name?, data? }`                                           | Represents one immutable, serializable log entry. A `LoggerInterface` builds one per call, freezes it, retains a bounded tail of them, and emits it on `entry`; every sink / transport consumes this exact shape.                                                                                                                                                                          |
| `SinkInterface`          | interface | `{} plus write`                                                                    | Declares the minimal output primitive — the seam every formatted line is written through. A `Sink` is the one place text leaves the logging system; redirect output (to a file, a buffer, a test recorder, the browser `%c` path, a server TTY) by supplying a different `SinkInterface`, with no change to the logger.                                                                    |
| `WriterSet`              | interface | `{ log, warn, error }`                                                             | Groups the write targets a level-routing sink chooses between — each of the backend's own member type.                                                                                                                                                                                                                                                                                     |
| `selectWriter`           | function  | `<T>(level: LogLevel \| undefined, writers: WriterSet<T>) => T`                    | Selects the member of a `WriterSet` a `LogLevel` routes to — `error` to `error`, `warn` to `warn`, every other level and an omitted level to `log`.                                                                                                                                                                                                                                        |
| `createConsoleSink`      | function  | `() => SinkInterface`                                                              | Creates the default `SinkInterface` — a console sink that routes by level and writes through the `console` methods snapshotted at creation. The default output target behind the `Logger`.                                                                                                                                                                                                 |
| `Logger`                 | class     | `LoggerInterface`                                                                  | Implements an observable, leveled logger — the entry point into the structured-logging pipeline. Each `debug` / `info` / `warn` / `error` call builds a frozen `LogRecord`, gates it by severity, retains a bounded tail of accepted records, always emits it on `entry` (the transport seam), and — unless `silent` — formats it into a styled line and writes it to its `SinkInterface`. |
| `LoggerManager`          | class     | `LoggerManagerInterface`                                                           | Implements an event-free registry of named `Logger`s plus a convenience fan-out — the manager over the logging layer (a registry, never observable itself; each `Logger` owns its own `emitter`).                                                                                                                                                                                          |
| `LoggerEventMap`         | type      | `{ entry }`                                                                        | Declares the observable events a `LoggerInterface` emits — `entry(record)` for every accepted record, the transport seam.                                                                                                                                                                                                                                                                  |
| `LogFormatFunction`      | type      | `(record: LogRecord, styler: StylerInterface, theme: Theme) => string`             | Represents the line layout a logger writes — `(record, styler, theme) => string`, one `LogRecord` plus the styling substrate in and one finished line out. `formatRecord` is the default.                                                                                                                                                                                                  |
| `LoggerOptions`          | interface | `{ on?, error?, level?, name?, sink?, styler?, theme?, format?, limit?, silent? }` | Configures the `Logger` constructor — the `on` / `error` emitter keys, the `level` threshold, the logger's `name`, the `sink` / `styler` / `theme` / `format` line substrate, the retention `limit`, and the `silent` write switch.                                                                                                                                                        |
| `LoggerInterface`        | interface | `{ emitter, level, name? } plus debug, info, warn, error, entries, clear, destroy` | Declares an observable, leveled logger — builds a frozen `LogRecord` per call, gates it by severity, retains a bounded tail, emits it on `entry`, and (unless silent) writes a styled line to its `SinkInterface`.                                                                                                                                                                         |
| `LoggerManagerOptions`   | interface | `{ level?, sink?, styler?, theme?, format?, limit?, silent? }`                     | Configures the `LoggerManager` constructor — the `level` / `sink` / `styler` / `theme` / `format` / `limit` / `silent` defaults flowed into every logger it mints.                                                                                                                                                                                                                         |
| `LoggerManagerInterface` | interface | `{ count } plus register, logger, loggers, debug, info, warn, error, remove`       | Declares an event-free registry of named `LoggerInterface`s plus a convenience fan-out — the manager over the logging layer. It mints + stores loggers keyed by `name`, looks them up, removes them, and broadcasts a one-off log to every registered logger.                                                                                                                              |

### Reporting

Narrative reporting — pure width-aware layout renderers + a lean `Reporter` front-end, over the same styler and sink substrate.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                  | Kind      | Shape                                                                                                                                                        | Summary                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Alignment`          | type      | `'left' \| 'center' \| 'right'`                                                                                                                              | Names the horizontal text alignment within a fixed-width cell — `left` / `center` / `right`, the conventional set a `ColumnSpec` (and the box / separator title) aligns by.                                                                                                                                                                                                              |
| `BorderStyle`        | type      | `'single' \| 'double' \| 'round' \| 'heavy'`                                                                                                                 | Names a box-drawing border style — `single` / `double` / `round` / `heavy`, the standard Unicode line weights the renderers frame with, each selecting a full junction set in `BORDER_CHARS`.                                                                                                                                                                                            |
| `BorderChars`        | interface | `{ horizontal, vertical, topLeft, topRight, bottomLeft, bottomRight, cross, teeDown, teeUp, teeRight, teeLeft }`                                             | Represents one complete box-drawing junction set for a `BorderStyle` — the edges, the corners, and the `T` / cross junctions the box and table renderers need to frame content and rule a table.                                                                                                                                                                                         |
| `SeparatorOptions`   | interface | `{ title?, width?, fill?, styler?, style? }`                                                                                                                 | Configures `renderSeparator` — a horizontal rule, optionally carrying a centered title. Every key is optional.                                                                                                                                                                                                                                                                           |
| `BoxOptions`         | interface | `{ content, title?, padding?, border?, width?, styler?, style? }`                                                                                            | Configures `renderBox` — content framed in box-drawing characters. A `Reporter` supplies its own chrome style only when the caller gives neither `styler` nor `style`.                                                                                                                                                                                                                   |
| `ColumnSpec`         | interface | `{ label, align? }`                                                                                                                                          | Represents one column of a `TableOptions` — its header label and how its cells align.                                                                                                                                                                                                                                                                                                    |
| `TableOptions`       | interface | `{ columns, rows, border?, styler?, style? }`                                                                                                                | Configures `renderTable` — a bordered grid of columns + rows with per-column alignment and width-aware sizing. A `Reporter` supplies its own chrome style only when the caller gives neither `styler` nor `style`.                                                                                                                                                                       |
| `TreeNode`           | interface | `{ label, children? }`                                                                                                                                       | Represents one node of a `TreeOptions` tree — a label plus optional children, recursively.                                                                                                                                                                                                                                                                                               |
| `TreeOptions`        | interface | `{ root, border?, styler?, style? }`                                                                                                                         | Configures `renderTree` — a nested `TreeNode` tree drawn with box-drawing connectors. A `Reporter` supplies its own chrome style only when the caller gives neither `styler` nor `style`.                                                                                                                                                                                                |
| `StatusLevel`        | type      | `'success' \| 'error' \| 'warn' \| 'info'`                                                                                                                   | Names a narrative outcome level — `success` / `error` / `warn` / `info`, the states `ReporterInterface.status` reports, each with its own icon + color (`STATUS_ICONS` / `STATUS_COLORS`).                                                                                                                                                                                               |
| `StepPosition`       | interface | `{ index, total }`                                                                                                                                           | Represents where one step sits in a sequence — what `ReporterInterface.step` renders as a `[2/5]` prefix.                                                                                                                                                                                                                                                                                |
| `ReporterOptions`    | interface | `{ sink?, styler?, theme?, width? }`                                                                                                                         | Configures the `Reporter` constructor — the `sink` every line is written to, the `styler` and `theme` it formats through, and the `width` its layouts measure against.                                                                                                                                                                                                                   |
| `ReporterInterface`  | interface | `{} plus section, step, timing, status, table, tree, box, line, blank`                                                                                       | Declares a lean, event-free narrative reporter — the composable verb set for human / build-run output (sections, steps, timings, outcomes, tables, trees, boxes), formatting through the shared `StylerInterface` + layout renderers and writing to a `SinkInterface`.                                                                                                                   |
| `Reporter`           | class     | `ReporterInterface`                                                                                                                                          | Implements a lean, event-free narrative reporter — the composable verb set for human / build-run output. Each verb formats its line through the shared `StylerInterface` and the pure layout renderers (`renderSeparator` / `renderBox` / `renderTable` / `renderTree`) and writes it to a `SinkInterface` — the same styler + sink substrate the logger uses, never a second colorizer. |
| `renderSeparator`    | function  | `(options: SeparatorOptions) => string`                                                                                                                      | Renders a horizontal rule — an optional centered title embedded in a line of fill characters, to a fixed visible width. Pure: same `SeparatorOptions` → same string.                                                                                                                                                                                                                     |
| `renderBox`          | function  | `(options: BoxOptions) => string`                                                                                                                            | Renders `content` framed in box-drawing characters, optionally captioned, width-aware so styled content stays aligned inside the frame. Pure: same `BoxOptions` → same string.                                                                                                                                                                                                           |
| `renderTable`        | function  | `(options: TableOptions) => string`                                                                                                                          | Renders a bordered grid of `columns` + `rows` with per-column alignment and width-aware column sizing. Pure: same `TableOptions` → same string.                                                                                                                                                                                                                                          |
| `renderTree`         | function  | `(options: TreeOptions) => string`                                                                                                                           | Renders a nested `TreeNode` tree whose connectors derive from the chosen `border` set. Pure: same `TreeOptions` → same string.                                                                                                                                                                                                                                                           |
| `renderTreeChildren` | function  | `(nodes: readonly TreeNode[], prefix: string, options: Required<Pick<TreeOptions, 'border'>> & Pick<TreeOptions, 'style' \| 'styler'>) => readonly string[]` | Renders the connector-prefixed lines for a `TreeNode` list — the recursive core behind `renderTree`, whose third options argument requires `border` and groups the optional `styler` and `style`.                                                                                                                                                                                        |
| `renderBar`          | function  | `(options: BarOptions) => string`                                                                                                                            | Renders a determinate progress bar string — a filled / empty glyph track followed by the percentage and the `(current/total)` count (`█████░░░░░ 50% (5/10)`). Pure and width-aware: same `BarOptions` → same string.                                                                                                                                                                    |
| `align`              | function  | `(text: string, columns: number, alignment?: Alignment) => string`                                                                                           | Pads (or, when over budget, truncates) `text` to exactly `columns` visible columns, positioning it by `alignment`. The width primitive the box / table renderers align every cell with.                                                                                                                                                                                                  |
| `paint`              | function  | `(styler: StylerInterface \| undefined, text: string, style?: Style) => string`                                                                              | Colors `text` through `styler` and an optional by-value `Style`, or returns it verbatim when `styler` is `undefined` — the single optional-styling primitive every renderer applies to its border / title / connector glyphs.                                                                                                                                                            |
| `repeatTo`           | function  | `(unit: string, columns: number) => string`                                                                                                                  | Repeats `unit` until it fills exactly `columns` visible columns, trimming a trailing partial unit so the run is never over-wide — the fill primitive the separator + box edges draw with.                                                                                                                                                                                                |
| `cellAt`             | function  | `(row: readonly string[], index: number) => string`                                                                                                          | Returns the cell at `index` of a (possibly ragged) row — `''` when the row is shorter than the column count, so a short row pads out instead of throwing (the ragged-row guard `renderTable` reads every cell through).                                                                                                                                                                  |
| `meetsLevel`         | function  | `(threshold: LogLevel, level: LogLevel) => boolean`                                                                                                          | Checks whether a record at `level` passes a logger gated at `threshold` — that is, its severity is at or above the threshold's.                                                                                                                                                                                                                                                          |
| `formatTime`         | function  | `(time: number) => string`                                                                                                                                   | Formats a `LogRecord`'s `time` (epoch milliseconds) as an ISO-8601 timestamp string.                                                                                                                                                                                                                                                                                                     |
| `formatRecord`       | function  | `(record: LogRecord, styler: StylerInterface, theme: Theme) => string`                                                                                       | Formats a `LogRecord` into a single styled line — the default human line layout a `LoggerInterface` writes to its sink.                                                                                                                                                                                                                                                                  |
| `formatDuration`     | function  | `(ms: number) => string`                                                                                                                                     | Formats a millisecond duration as a compact human string — `…ms` below one second, `…s` (seconds to 2 decimal places) at or above one second. The timing rendering behind `ReporterInterface.timing`.                                                                                                                                                                                    |
| `stringifyValue`     | function  | `(value: unknown) => string`                                                                                                                                 | Stringifies one captured console argument into a line fragment — the per-argument rule behind `formatArgs`: an `Error` → `name: message`, a plain object / array → circular-safe JSON, anything else (string, number, boolean, `null`, `undefined`, symbol, function) → `String(value)`.                                                                                                 |
| `formatArgs`         | function  | `(args: readonly unknown[]) => string`                                                                                                                       | Stringifies a captured `console.*` argument list into one line — the text of a `CapturedMessage`. Each argument is rendered by `stringifyValue` and the parts are space-joined, mirroring how a console concatenates its arguments.                                                                                                                                                      |

### Capture

Console interception — take control of `console.*` on the read side; a buffered, mirroring, forwarding interceptor with a lifecycle.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                   | Kind      | Shape                                                                                                       | Summary                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CaptureLevel`        | type      | `'log' \| 'info' \| 'warn' \| 'error' \| 'debug'`                                                           | Identifies one intercepted `console` method — `log` / `info` / `warn` / `error` / `debug`, the names a `CaptureInterface` patches and reports under.                                                                                                                                                                                                            |
| `ConsoleMethod`       | type      | `(...args: unknown[]) => void`                                                                              | Names the console-method shape a `CaptureInterface` snapshots and swaps at the patch boundary — a variadic sink of arbitrary arguments.                                                                                                                                                                                                                         |
| `CapturedMessage`     | interface | `{ level, text, time }`                                                                                     | Represents one captured console call — an immutable, serializable record of a single intercepted `console.*` invocation. A `CaptureInterface` builds one per call, freezes it, buffers it (total + by level), and emits it on `capture`; every consumer reads this exact shape.                                                                                 |
| `CaptureEventMap`     | type      | `{ capture, start, stop }`                                                                                  | Declares the observable events a `CaptureInterface` emits — `capture(message)` per intercepted call, plus the `start` and `stop` lifecycle signals.                                                                                                                                                                                                             |
| `CaptureOptions`      | interface | `{ on?, error?, levels?, mirror?, sink?, limit? }`                                                          | Configures the `Capture` constructor — the `on` / `error` emitter keys, the `levels` intercepted, the `mirror` pass-through, the `sink` forward, and the buffer `limit`.                                                                                                                                                                                        |
| `CaptureInterface`    | interface | `{ emitter, active } plus start, stop, messages, clear, destroy`                                            | Declares an observable console interceptor — it takes control of the global `console.*` on the read side: while `active`, every configured `console.x` call is captured as a frozen `CapturedMessage`, buffered (total + by level, bounded), emitted on `capture`, and — per options — mirrored to the real console, forwarded to a `SinkInterface`, or both.   |
| `CaptureResult`       | interface | `{ value, messages }`                                                                                       | Represents the structured outcome of `createCaptureResult` — the wrapped function's own return `value` plus the `messages` it logged while it ran.                                                                                                                                                                                                              |
| `RetentionInterface`  | interface | `{} plus add, records, clear`                                                                               | Declares the bounded, level-keyed retention buffer a capture keeps its records in — one capped total buffer plus one capped bucket per level configured at construction.                                                                                                                                                                                        |
| `Retention`           | class     | `RetentionInterface`                                                                                        | Implements the bounded, level-keyed retention engine the console and process captures buffer through — one capped total buffer plus one capped bucket per level, generic over the record type each capture carries.                                                                                                                                             |
| `Capture`             | class     | `CaptureInterface`                                                                                          | Implements an observable console interceptor — it takes control of the global `console.*` on the read side. While `active`, every configured `console.x` call is captured as a frozen `CapturedMessage`, buffered (total + by level, bounded), emitted on `capture`, and — per options — mirrored to the real console, forwarded to a `SinkInterface`, or both. |
| `createCaptureResult` | function  | `<T>(fn: () => T \| Promise<T>, options?: CaptureOptions) => CaptureResult<T> \| Promise<CaptureResult<T>>` | Runs `fn` with the global `console.*` captured for its duration, returning the function's `value` plus the `CapturedMessage`s it logged — the scoped, self-restoring ergonomic form of the `Capture` class.                                                                                                                                                     |

### Errors

The one error type the console layer throws — an internal invariant or unreachable-guard violation.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                | Kind     | Shape                                                                                                        | Summary                                                                                                                                                  |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleErrorCode` | type     | `'INVARIANT'`                                                                                                | Names the machine-readable error code a `ConsoleError` carries — `INVARIANT`, the only code the package throws.                                          |
| `ConsoleError`     | class    | `new (code: ConsoleErrorCode, message: string, context?: Readonly<Record<string, unknown>>) => ConsoleError` | Carries a `ConsoleErrorCode` and an optional `context` bag — the error the console layer throws for an internal invariant violated at a defensive guard. |
| `isConsoleError`   | function | `ConsoleError`                                                                                               | Narrows an unknown caught value to a `ConsoleError` — the guard a `catch` branches on.                                                                   |

### Animations

Live activity animations — pure frame producers over the same styler and sink substrate; the line overwrite is the sink's job.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                 | Kind      | Shape                                                                                 | Summary                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BarOptions`        | interface | `{ current, total, width?, fill?, empty?, styler?, style? }`                          | Configures the pure `renderBar` renderer — a determinate progress bar string (`█████░░░░░ 50% (5/10)`), width-aware and styler-optional.                                                                                                                                                                                                                        |
| `SpinnerEventMap`   | type      | `{ frame, start, stop }`                                                              | Declares the observable events a `SpinnerInterface` emits — `frame(line)` per advance and per outcome, plus the `start` and `stop` timer-lifecycle signals.                                                                                                                                                                                                     |
| `SpinnerOptions`    | interface | `{ on?, error?, message?, frames?, interval?, sink?, styler?, theme? }`               | Configures the `Spinner` constructor — the `on` / `error` emitter keys, the `message` shown, the glyph `frames` and their `interval`, and the `sink` / `styler` / `theme` line substrate.                                                                                                                                                                       |
| `SpinnerInterface`  | interface | `{ emitter, active, message } plus start, tick, update, succeed, fail, stop, destroy` | Declares a self-driving, observable activity spinner — a glyph cycle that advances on a periodic timer, writing each `\r` + frame line to its `SinkInterface` and emitting it on `frame`. The line-overwrite is the sink's job (a TTY sink overwrites on the `\r`; a plain sink degrades to a fresh line).                                                      |
| `Spinner`           | class     | `SpinnerInterface`                                                                    | Implements a self-driving, observable activity spinner — a glyph cycle that advances on a periodic timer, writing each `\r` + frame line to its `SinkInterface` and emitting it on `frame`. The timer is always cleared on an outcome, so the spinner is leak-free.                                                                                             |
| `ProgressReport`    | interface | `{ current, total }`                                                                  | Reports one advance of a `ProgressInterface` — the clamped payload carried by the `update` event of `ProgressEventMap`.                                                                                                                                                                                                                                         |
| `ProgressEventMap`  | type      | `{ update, succeed }`                                                                 | Declares the observable events a `ProgressInterface` emits — `update(progress)` per report, plus a `succeed` signal on a successful finish.                                                                                                                                                                                                                     |
| `ProgressOptions`   | interface | `{ on?, error?, total, message?, width?, fill?, empty?, sink?, styler?, theme? }`     | Configures the `Progress` constructor — the `on` / `error` emitter keys, the required `total`, the `message` shown, the bar's `width` / `fill` / `empty` glyphs, and the `sink` / `styler` / `theme` line substrate.                                                                                                                                            |
| `ProgressInterface` | interface | `{ emitter, active, succeeded, current, total } plus update, succeed, fail, destroy`  | Declares an update-driven, observable progress bar — `update(current)` recomputes the bar through `renderBar`, writes `\r` + bar to its `SinkInterface`, and emits the `{ current, total }` on `update`. The line-overwrite is the sink's job (a TTY sink overwrites on the `\r`; a plain sink degrades to a fresh line). No self-timer — the caller drives it. |
| `Progress`          | class     | `ProgressInterface`                                                                   | Implements an update-driven, observable progress bar — `update` recomputes the bar through `renderBar`, writes `\r` + bar to its `SinkInterface`, and emits the `{ current, total }` on `update`. No self-timer, unlike `Spinner` — the caller drives it.                                                                                                       |

### Style constants

The SGR code data the ANSI renderer maps through, and the styler's color / attribute axes (`src/core`). All `Object.freeze`d data; the SGR numbers are the fixed ECMA-48 spec.

A `Shape` cell holds the constant's declared type.

| API                | Kind  | Shape                                                 | Summary                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOREGROUND_CODES` | const | `Readonly<Record<Exclude<Color, 'default'>, number>>` | Maps each `Color` to its SGR foreground parameter — the 8 base colors at 30–37 and their bright variants at 90–97. `default` is intentionally absent (it emits no code).                                                                                                                                                                                                           |
| `BACKGROUND_CODES` | const | `Readonly<Record<Exclude<Color, 'default'>, number>>` | Maps each `Color` to its SGR background parameter — the 8 base colors at 40–47 and their bright variants at 100–107. `default` is intentionally absent (it emits no code).                                                                                                                                                                                                         |
| `ATTRIBUTE_CODES`  | const | `Readonly<Record<Attribute, number>>`                 | Maps each `Attribute` to its SGR "on" parameter — `bold` 1, `dim` 2, `italic` 3, `underline` 4, `inverse` 7, `strikethrough` 9. The renderer composes several by joining their codes with `;` in one SGR sequence.                                                                                                                                                                 |
| `EMPTY_STYLE`      | const | `Style`                                               | Holds the empty `Style` — no foreground, no background, no attributes — frozen. The neutral starting point a base styler builds from, and what a renderer passes through unchanged (it carries no codes). Deeply frozen, so it is safe to share as the base.                                                                                                                       |
| `DEFAULT_THEME`    | const | `Theme`                                               | Holds the default `Theme` — every role bound to its default `Style`, assembled from `LEVEL_COLORS`, `STATUS_ICONS`, and `STATUS_COLORS` and deeply frozen.                                                                                                                                                                                                                         |
| `COLORS`           | const | `ReadonlyArray<Exclude<Color, 'default'>>`            | Lists every named `Color` except `default`, frozen — the colors the styler exposes as chainable accessors. The source of truth for the color axis; the styler drives its accessors from this array so the literals live in one place.                                                                                                                                              |
| `ATTRIBUTES`       | const | `readonly Attribute[]`                                | Lists every `Attribute`, frozen — the attributes the styler exposes as chainable accessors. The source of truth for the attribute axis.                                                                                                                                                                                                                                            |
| `RESET_CODE`       | const | `number`                                              | Holds the SGR RESET parameter (0) — terminates a styled run, clearing all colors and attributes.                                                                                                                                                                                                                                                                                   |
| `ESC`              | const | `string`                                              | Holds the escape control character (`U+001B`) that begins every ANSI escape sequence. Built with `String.fromCharCode` so no raw control character appears in source.                                                                                                                                                                                                              |
| `BEL`              | const | `string`                                              | Holds the bell control character (`U+0007`) that can terminate an OSC sequence.                                                                                                                                                                                                                                                                                                    |
| `CSI`              | const | `string`                                              | Holds the Control Sequence Introducer (`ESC[`) that opens every SGR sequence.                                                                                                                                                                                                                                                                                                      |
| `RESET`            | const | `string`                                              | Holds the full SGR reset sequence (`ESC[0m`) appended after a styled run.                                                                                                                                                                                                                                                                                                          |
| `ANSI_PATTERN`     | const | `RegExp`                                              | Matches any ANSI/VT escape sequence — CSI (SGR color/style plus cursor/erase/scroll, including colon-parameterized SGR), OSC / DCS / PM / APC / SOS string sequences (titles, hyperlinks, device strings), the `nF` charset-select family, and the two-byte `Fp` / `Fe` / `Fs` sequences (for example `ESC 7`, `ESC D`, `ESC c` RIS). Global, so `strip` removes every occurrence. |
| `CONTROL_PATTERN`  | const | `RegExp`                                              | Matches every C0 control character except `\t` / `\n` / `\r` (which are meaningful whitespace), plus DEL (`0x7F`) — the non-printing bytes `stripControls` removes. Global, ASCII-only source (no raw control-character literal), so a scan builds a fresh `RegExp` the same way as `ANSI_PATTERN` to avoid a mutated `lastIndex`.                                                 |

### Logging & reporting constants

The level order + label colors, the box-drawing junction sets, status icons / colors, and default widths / glyphs (`src/core`). All `Object.freeze`d data; the box-drawing + braille glyphs are fixed Unicode. There is no separate tree-connector table: a tree derives its branch / corner / guide runs from the same `BORDER_CHARS` set a box or a table draws with, so a box, a table, and a tree all answer to one `border`.

A `Shape` cell holds the constant's declared type.

| API                   | Kind  | Shape                                                      | Summary                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LEVEL_SEVERITY`      | const | `Readonly<Record<LogLevel, number>>`                       | Maps each `LogLevel` to its numeric severity — the ascending order the level gate compares through (`debug` 0 < `info` 1 < `warn` 2 < `error` 3). A record is kept when its level's severity is at or above the logger's threshold. The source of truth for level ordering.                                                                                |
| `LEVEL_COLORS`        | const | `Readonly<Record<LogLevel, Exclude<Color, 'default'>>>`    | Maps each `LogLevel` to its default label `Color` — the level's visual treatment, which is a styling choice orthogonal to the level itself (never a separate pseudo-level). The logger colors the level label through its styler with these; swapping a color never changes leveling. `debug` is cyan, `info` blue, `warn` yellow, `error` red.            |
| `DEFAULT_LOG_LIMIT`   | const | `number`                                                   | Sets the default bounded-retention cap for a `LoggerInterface` — `1000`, so at most that many recent records are kept and retention is always bounded.                                                                                                                                                                                                     |
| `DEFAULT_LOG_LEVEL`   | const | `LogLevel`                                                 | Sets the default `LogLevel` threshold a logger gates at when none is supplied — `info`.                                                                                                                                                                                                                                                                    |
| `LOG_LEVELS`          | const | `readonly LogLevel[]`                                      | Lists every `LogLevel`, in ascending severity order — the levels a logger exposes as methods and the manager fans out to. The source of truth for the level axis (drives exhaustive tests); aligned with `LEVEL_SEVERITY`.                                                                                                                                 |
| `BORDER_CHARS`        | const | `Readonly<Record<BorderStyle, BorderChars>>`               | Holds the complete `BorderChars` junction set for each `BorderStyle` — the standard Unicode box-drawing glyphs at each line weight, deeply frozen.                                                                                                                                                                                                         |
| `STATUS_ICONS`        | const | `Readonly<Record<StatusLevel, string>>`                    | Maps each `StatusLevel` to its icon glyph — the leading mark a `ReporterInterface.status` outcome line shows: `success` ✔, `error` ✖, `warn` ⚠, `info` ℹ. The narrative-outcome counterpart to a log level's label; frozen.                                                                                                                                |
| `STATUS_COLORS`       | const | `Readonly<Record<StatusLevel, Exclude<Color, 'default'>>>` | Maps each `StatusLevel` to its `Color` — the icon + message color a `status` line renders in (`success` green, `error` red, `warn` yellow, `info` blue). The visual treatment of a narrative outcome, colored through the reporter's styler; orthogonal to leveling, like `LEVEL_COLORS`. Excludes `default` so each value indexes a real styler accessor. |
| `STATUS_LEVELS`       | const | `readonly StatusLevel[]`                                   | Lists every `StatusLevel`, frozen — the outcomes a `status` line supports (drives exhaustive tests). The source of truth for the status axis; aligned with `STATUS_ICONS` / `STATUS_COLORS`.                                                                                                                                                               |
| `DEFAULT_WIDTH`       | const | `number`                                                   | Sets the default visible column width for the width-aware renderers — the separator rule and a `renderBox` with no explicit `width`, and the reporter's `section` rule. A sane terminal default (80 columns); a caller overrides it per-call or through `ReporterOptions.width`.                                                                           |
| `DEFAULT_PADDING`     | const | `number`                                                   | Sets the default horizontal padding inside a box's edges (`renderBox`) — one cell.                                                                                                                                                                                                                                                                         |
| `DEFAULT_BORDER`      | const | `BorderStyle`                                              | Sets the default `BorderStyle` the box / table renderers frame with when none is given — `single`.                                                                                                                                                                                                                                                         |
| `DEFAULT_ALIGN`       | const | `Alignment`                                                | Sets the default cell `Alignment` a `ColumnSpec` uses when none is given — `left`.                                                                                                                                                                                                                                                                         |
| `SEPARATOR_FILL`      | const | `string`                                                   | Holds the default fill character `renderSeparator` draws its rule with — `─`.                                                                                                                                                                                                                                                                              |
| `SEPARATOR_TITLE_GAP` | const | `string`                                                   | Holds the single padding cell on each side of a separator's embedded title (`title`) — keeps the title from butting against the rule. One space.                                                                                                                                                                                                           |
| `SECOND_MS`           | const | `number`                                                   | Sets the millisecond threshold at or above which `formatDuration` (and so `Reporter.timing`) switches from a `…ms` rendering to a `…s` (seconds, 2 d.p.) rendering — `1000`, exactly one second.                                                                                                                                                           |

### Capture & animation constants

The intercepted-method set, the bounded-buffer cap, the level projection, and the spinner frames / bar glyphs / track width (`src/core`). All `Object.freeze`d data.

A `Shape` cell holds the constant's declared type.

| API                        | Kind  | Shape                                      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CAPTURE_LEVELS`           | const | `readonly CaptureLevel[]`                  | Lists every `CaptureLevel`, frozen — the `console.*` methods a `CaptureInterface` intercepts by default (and the source of truth for the capture-level axis; drives exhaustive tests). The universal console methods: `log`, `info`, `warn`, `error`, `debug`.                                                                                                                                                                                                                                                                                   |
| `DEFAULT_CAPTURE_LIMIT`    | const | `number`                                   | Sets the default bounded-buffer cap for a `CaptureInterface` — `1000`, so at most that many recent `CapturedMessage`s are retained per buffer (the total buffer and each by-level bucket; oldest dropped first) and retention is always bounded.                                                                                                                                                                                                                                                                                                 |
| `CAPTURE_LEVEL_MAP`        | const | `Readonly<Record<CaptureLevel, LogLevel>>` | Maps each `CaptureLevel` to its `LogLevel` for the optional sink forward — the projection the Capture routes through when writing an intercepted call to a `SinkInterface`. `sink.write(text, CAPTURE_LEVEL_MAP[level])` is the call this map backs. `warn` / `error` / `debug` / `info` map to their matching `LogLevel`; `log` maps to `info` (a plain console log is informational — the default stream), so a stream-aware sink routes `warn` / `error` captures to the right stream. The source of truth for the capture-to-log projection. |
| `SPINNER_FRAMES`           | const | `readonly string[]`                        | Holds the default spinner frame cycle a `SpinnerInterface` advances through — the braille-pattern glyphs (`⠋⠙⠹…`, the U+2800 block) that read as a smoothly rotating dot.                                                                                                                                                                                                                                                                                                                                                                        |
| `DEFAULT_SPINNER_INTERVAL` | const | `number`                                   | Sets the default timer period between a `SpinnerInterface`'s frames — the `setInterval` interval `start()` arms, `80` ms (≈12.5 frames/second).                                                                                                                                                                                                                                                                                                                                                                                                  |
| `BAR_FILL`                 | const | `string`                                   | Holds the default filled-cell glyph `renderBar` draws the completed run of a progress bar with — the full block `█` (U+2588). A single visible cell; a consumer overrides it through `BarOptions.fill`.                                                                                                                                                                                                                                                                                                                                          |
| `BAR_EMPTY`                | const | `string`                                   | Holds the default empty-cell glyph `renderBar` draws the remaining run of a progress bar with — the light-shade block `░` (U+2591). A single visible cell; a consumer overrides it through `BarOptions.empty`.                                                                                                                                                                                                                                                                                                                                   |
| `DEFAULT_BAR_WIDTH`        | const | `number`                                   | Sets the default visible cell count of a progress-bar track — the glyph run `renderBar` fills, and the width a `ProgressInterface` sizes its bar to. `30` cells.                                                                                                                                                                                                                                                                                                                                                                                 |

### Browser sink

The browser `%c` console sink — translates the core's ANSI output into a `console.log('%c…', css)` call at the output boundary ([`src/browser`](../src/browser), surfaced through `@src/browser`). The core owns the `SinkInterface` contract + the style data model; this module owns only the browser-side translation.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to.

| API                  | Kind      | Shape                                                       | Summary                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BrowserPalette`     | interface | `{ color?, attribute? }`                                    | Holds partial browser CSS overrides for the core color and attribute axes — a named `color` or `attribute` entry replaces only that entry, and every omission keeps its default.                                                                                                                                                                 |
| `BrowserSinkOptions` | interface | `{ palette? }`                                              | Configures `createBrowserSink` — the optional `palette` partially overriding the browser's named color and attribute CSS mappings.                                                                                                                                                                                                               |
| `ConsoleOutput`      | interface | `{ format, styles }`                                        | Represents the `console.log`-ready output `ansiToConsole` produces from an ANSI-styled string — a format string of `%c`-prefixed segments and the parallel array of CSS declarations, ready to spread into a browser `console` call as `console.log(format, ...styles)`.                                                                         |
| `StyleAccumulator`   | interface | `{ foreground?, background?, attributes }`                  | Represents the immutable scan state `ansiToConsole` replaces while translating SGR codes to CSS — an optional `foreground` and `background` declaration plus a readonly list of attribute declarations.                                                                                                                                          |
| `createBrowserSink`  | function  | `(options?: BrowserSinkOptions) => SinkInterface`           | Creates the browser `%c` `SinkInterface` — the browser output backend. `write(text, level?)` translates the ANSI-styled `text` into a browser `console` call (`console[method](format, ...styles)`) through `ansiToConsole`, an optional partial `BrowserPalette` overriding the named color and attribute CSS.                                  |
| `ansiToConsole`      | function  | `(text: string, palette?: BrowserPalette) => ConsoleOutput` | Translates an ANSI-styled string into a browser `console.log`-ready `ConsoleOutput` — a `%c`-segmented format string and the parallel array of CSS declarations, an optional partial `BrowserPalette` overriding the CSS per named lookup.                                                                                                       |
| `escapePercent`      | function  | `(text: string) => string`                                  | Doubles every literal `%` in `text` to `%%` — the `%`-escape that keeps a browser console from reading a stray `%` (for example in `50%` or `%s`) as a format directive. The single escape the `ansiToConsole` translation applies to every text segment before assembling the format string (so only the `%c`s it inserts are real directives). |
| `scanParameters`     | function  | `(parameters: string) => readonly number[]`                 | Walks an SGR parameter list (the `;`-separated numeric string captured by `SGR_PATTERN`) and returns its numeric codes — `'1;31'` → `[1, 31]`, a bare or empty field becoming a `0` reset. It is total: every input yields a code list.                                                                                                          |

### Browser sink constants

The SGR → CSS translation data the browser sink maps ANSI runs through (`src/browser`). The number↔name mapping is derived from core's code maps, never re-hardcoded; the browser module reads core's `RESET_CODE` directly (no local re-export).

A `Shape` cell holds the constant's declared type.

| API             | Kind  | Shape                                                 | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COLOR_HEX`     | const | `Readonly<Record<Exclude<Color, 'default'>, string>>` | Maps each named `Color` to its hex value — the 16 standard terminal colors a browser DevTools console renders the same `Color` names as. The source of truth for the browser color axis: the ANSI renderer maps a `Color` name to an SGR number, and this maps the same name to the CSS color the `%c` sink paints with, so a browser shows the same 16 colors a terminal does.                                                                                                                    |
| `ATTRIBUTE_CSS` | const | `Readonly<Record<number, string>>`                    | Maps each text-`Attribute`'s SGR "on" number to its equivalent CSS declaration — the browser counterpart to the terminal's SGR text effects (`bold` 1 → `font-weight:bold`, `dim` 2 → `opacity:0.6`, `italic` 3 → `font-style:italic`, `underline` 4 → `text-decoration:underline`, `inverse` 7 → best-effort, `strikethrough` 9 → `text-decoration:line-through`).                                                                                                                                |
| `DIRECTIVE`     | const | `string`                                              | Names the browser console directive that switches the active style — one `%c` prefixes every styled run in the `ConsoleOutput` format string, consuming the next entry of the parallel CSS array. The single source of truth for the directive token.                                                                                                                                                                                                                                              |
| `SGR_PATTERN`   | const | `RegExp`                                              | Matches one SGR sequence (`ESC[ <params> m`) and captures its `;`-separated numeric parameters — the subset of ANSI `strip` cares about that carries style (color / attribute / reset), as opposed to cursor / erase / OSC sequences. Global, so the scanner walks every SGR run in a string; built from core's `ESC` so no control-character literal appears in source (the codebase idiom). The capture group is the parameter list (`''` for a bare `ESC[m`, which the spec treats as a reset). |

### Server sink + process capture

The server output backend — a TTY-aware `Sink` over the real `process` streams with a raw process-stream capture ([`src/server`](../src/server), surfaced through `@src/server`). The core owns the `SinkInterface` / `LogLevel` contracts + the `console` `Capture`; this module owns the server-only stream backend. Color detection lives here and only here: `inferStyled` reads the environment, `createServerSink` fixes each target's `styled` fact at construction, and nothing in core or the browser probes for color (the color-detection contract).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an optional member and `plus` introducing its call-signature members, and a type alias's own type literal with a union's arms escaped as `\|`. An extended interface's name comes before `plus`, with the members it adds after. A function row's `Shape` cell holds its signature, and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it implements, or its constructor signature where it implements none.

| API                       | Kind      | Shape                                                                                                    | Summary                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamTargetInterface`   | interface | `{ isTTY?, columns? } plus write`                                                                        | Declares the minimal writable-stream shape the server sink and process capture address — exactly the slice of a Node `tty.WriteStream` / `process.stdout` they touch and no more.                                                                                                                                                                                                                                          |
| `ServerSinkOptions`       | interface | `{ stdout?, stderr?, styled?, environment?, columns? }`                                                  | Holds the options for `createServerSink` — the `stdout` and `stderr` targets, the `styled` override, the `environment` inference reads, and an explicit `columns` width. All are optional, so a bare `createServerSink()` writes to the real process streams.                                                                                                                                                              |
| `ServerSinkInterface`     | interface | `SinkInterface plus { styled, columns }`                                                                 | Declares a `SinkInterface` that also exposes the `stdout` target's construction-time `styled` fact and the terminal's live or fixed `columns` width — the shape `createServerSink` returns.                                                                                                                                                                                                                                |
| `StreamLevel`             | type      | `'stdout' \| 'stderr'`                                                                                   | Names which process stream a `CapturedChunk` came from — `stdout` or `stderr`, the "level" axis of the process-stream `ProcessCaptureInterface` and the server analogue of the core `Capture`'s `CaptureLevel`.                                                                                                                                                                                                            |
| `StreamWriteFunction`     | type      | `NodeJS.WriteStream['write']`                                                                            | Names the process-stream `write` method a `ProcessCaptureInterface` snapshots and swaps at the patch boundary — `NodeJS.WriteStream['write']` verbatim, the write-side analogue of `ConsoleMethod`.                                                                                                                                                                                                                        |
| `StreamWriteCallback`     | type      | `(error?: Error \| null) => void`                                                                        | Names the completion callback `process.*.write` accepts as its last argument — `(error?) => void`, the Node `write` callback shape and the `StreamWriteFunction` companion.                                                                                                                                                                                                                                                |
| `CapturedChunk`           | interface | `{ level, text, time }`                                                                                  | Represents one intercepted process-stream write — the immutable, serializable record a `ProcessCaptureInterface` buffers and emits, the server analogue of the core `CapturedMessage`.                                                                                                                                                                                                                                     |
| `ProcessCaptureEventMap`  | type      | `{ capture, start, stop }`                                                                               | Declares the observable events a `ProcessCaptureInterface` emits — `capture(chunk)` per intercepted write, plus the `start` and `stop` signals.                                                                                                                                                                                                                                                                            |
| `ProcessCaptureOptions`   | interface | `{ on?, error?, levels?, mirror?, sink?, limit? }`                                                       | Holds the options for the `ProcessCapture` constructor — the `on` / `error` emitter keys, the `levels` intercepted, the `mirror` pass-through, the `sink` forward, and the buffer `limit`. Every field is optional, so a bare `new ProcessCapture()` buffers both streams without mirroring or forwarding.                                                                                                                 |
| `ProcessCaptureInterface` | interface | `{ emitter, active } plus start, stop, messages, clear, destroy`                                         | Declares an observable interceptor of the raw process output streams — the server's "own all output" capture, patching `process.stdout.write` / `process.stderr.write` on the low-level stream where the core `Capture` patches `console.*`.                                                                                                                                                                               |
| `ProcessCapture`          | class     | `ProcessCaptureInterface`                                                                                | Implements an observable interceptor of the raw process output streams — it takes control of `process.stdout.write` / `process.stderr.write` on the write side. While `active`, every write to a configured `StreamLevel` is captured as a frozen `CapturedChunk`, buffered (total + per-stream, bounded), emitted on `capture`, and — per options — mirrored to the real stream, forwarded to a `SinkInterface`, or both. |
| `createServerSink`        | function  | `(options?: ServerSinkOptions) => ServerSinkInterface`                                                   | Creates the server TTY `ServerSinkInterface` — the server output backend, whose `write(text, level?)` routes by level to the process streams and uses construction-time styled facts: it sends ANSI straight to a styled target (with a leading `\r` overwriting a terminal line natively) but `strip`s ANSI to clean text for a plain target.                                                                             |
| `isStreamTarget`          | function  | `StreamTargetInterface`                                                                                  | Checks whether `value` is a usable `StreamTargetInterface` — a record with a callable `write`. A total type guard: it never throws and returns `false` for anything off-shape, so it narrows the one unavoidable boundary (the real `process.stdout` / `process.stderr`, or a fake stream a test injects) to the exact slice the sink + capture touch — no `as`.                                                           |
| `inferColumns`            | function  | `(target: StreamTargetInterface) => number`                                                              | Infers the width in character cells of a stream target — its live `columns` when it is a TTY, else the non-interactive `DEFAULT_COLUMNS` fallback. The basis a `ServerSinkInterface` reports through `columns` so a `Reporter` / `Progress` can size its layout to the terminal.                                                                                                                                           |
| `inferStyled`             | function  | `(target: StreamTargetInterface, environment: Readonly<Record<string, string \| undefined>>) => boolean` | Infers whether one stream target receives styled output — a present `FORCE_COLOR` first, then a non-empty `NO_COLOR`, then `target.isTTY === true`.                                                                                                                                                                                                                                                                        |
| `decodeChunk`             | function  | `(chunk: unknown, encoding?: unknown) => string`                                                         | Decodes one `process.stdout.write` / `process.stderr.write` chunk to a string — total, never throws. The process write signature accepts `string \| Uint8Array` plus an optional encoding; the capture wrapper reuses this so intercepting a raw stream write can never crash the host (a throw inside `process.stdout.write` would take the program down).                                                                |
| `isBufferEncoding`        | function  | `BufferEncoding`                                                                                         | Checks whether `encoding` is a `BufferEncoding` accepted by `Buffer.prototype.toString` — a total guard used by `decodeChunk` to honor a process-write `encoding` argument only when it is a real Node encoding (otherwise utf-8 is assumed).                                                                                                                                                                              |

### Server sink constants

The default stream set, buffer cap, no-TTY column fallback, and the stream → log-level projection (`src/server`). All `Object.freeze`d data.

A `Shape` cell holds the constant's declared type.

| API                    | Kind  | Shape                                     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STREAM_LEVELS`        | const | `readonly StreamLevel[]`                  | Lists the process streams a `ProcessCaptureInterface` can intercept, in `stdout`-then-`stderr` order — the `StreamLevel` universe and the default configured set.                                                                                                                                                                                                                                                                                                                      |
| `DEFAULT_STREAM_LIMIT` | const | `number`                                  | Sets the default bounded-buffer cap for a `ProcessCaptureInterface` — `1000`, so at most that many recent `CapturedChunk`s are retained per buffer (the total buffer and each per-stream bucket; oldest dropped first) and retention is always bounded.                                                                                                                                                                                                                                |
| `DEFAULT_COLUMNS`      | const | `number`                                  | Sets the terminal width `createServerSink` reports through `ServerSinkInterface.columns` when the `stdout` stream is not a TTY (so `.columns` is `undefined`) and no explicit `options.columns` was supplied — the conventional 80-column default a non-interactive context (a pipe, a CI log) assumes.                                                                                                                                                                                |
| `STREAM_LEVEL_MAP`     | const | `Readonly<Record<StreamLevel, LogLevel>>` | Maps each `StreamLevel` to its `LogLevel` for the optional sink forward — the projection a process capture routes through when writing an intercepted chunk to a `SinkInterface`. `sink.write(text, STREAM_LEVEL_MAP[level])` is the call this map backs. `stderr` is conventionally the error/diagnostic stream → `error`; `stdout` is the normal output stream → `info`. The source of truth for the stream-to-log projection (the server analogue of the core `CAPTURE_LEVEL_MAP`). |

## Methods

The public methods of each behavioral interface — one table per type, keyed by its backticked name, every call-signature member listed. Each type's `readonly` data members, for example `emitter` / `active` / `message` / `level` / `name` / `current` / `total` / `succeeded` / `columns`, stay in the preceding Surface rows and are not repeated here. Each implementing class implements its interface exactly, so this doubles as the per-instance method surface.

**Data-only / callable surfaces (no `## Methods` subsection).** `ServerSinkInterface` adds `styled` and `columns` data members to `SinkInterface` (its `write` is the inherited contract in the following `SinkInterface` table). Every `*Options` / `*EventMap` / `LogRecord` / `Style` / `Theme` / `ThemeStatus` / `BorderChars` / `ColumnSpec` / `TreeNode` / `StepPosition` / `ProgressReport` / `WriterSet` / `CapturedMessage` / `CapturedChunk` / `CaptureResult` / `BrowserPalette` / `ConsoleOutput` / `StyleAccumulator` / `StreamTargetInterface` row is a data / options shape with no behavioral methods.

#### `RendererInterface`

| Method   | Returns  | Summary                                                                                                                                                             |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render` | `string` | Renders `text` wrapped in the target codes for `style`. The empty style (no colors, no attributes) and the empty string both return `text` unchanged — no wrapping. |

#### `StylerInterface`

`StylerInterface` is also callable: its call signature `(text) => string` renders the accumulated style, and its chainable `Color` / `Attribute` accessors are data getters that stay in the preceding Surface row. `render` is its one named method — the same styling reached by value instead of by accessor name.

| Method   | Returns  | Summary                                                                                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render` | `string` | Renders `text` in `style` merged over the accumulated style — the by-value counterpart of the accessor chain, and the door a `Theme` role is applied through. |

#### `SinkInterface`

| Method  | Returns | Summary                                                                                                                                                          |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write` | `void`  | Writes one already-formatted chunk of output — one line without its terminator, or a `\r`-leading redraw frame written verbatim, routed by the optional `level`. |

#### `LoggerInterface`

| Method    | Returns                | Summary                                                                            |
| --------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `debug`   | `void`                 | Logs at `debug` — dropped unless the logger's `level` is `debug`.                  |
| `info`    | `void`                 | Logs at `info`.                                                                    |
| `warn`    | `void`                 | Logs at `warn`.                                                                    |
| `error`   | `void`                 | Logs at `error`.                                                                   |
| `entries` | `readonly LogRecord[]` | Returns the bounded tail of recent `LogRecord`s, oldest first (capped at `limit`). |
| `clear`   | `void`                 | Drops every retained record (does not touch listeners).                            |
| `destroy` | `void`                 | Tears down — clears retention and destroys the emitter.                            |

#### `LoggerManagerInterface`

| Method     | Returns                        | Summary                                                                                                                |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `register` | `LoggerInterface`              | Mints and stores a logger named `name`, the manager's defaults flowing in — a re-register of the same name overwrites. |
| `logger`   | `LoggerInterface \| undefined` | Looks one registered logger up by name.                                                                                |
| `loggers`  | `readonly LoggerInterface[]`   | Lists the registered loggers in insertion order.                                                                       |
| `debug`    | `void`                         | Fans out a `debug` log to every registered logger.                                                                     |
| `info`     | `void`                         | Fans out an `info` log to every registered logger.                                                                     |
| `warn`     | `void`                         | Fans out a `warn` log to every registered logger.                                                                      |
| `error`    | `void`                         | Fans out an `error` log to every registered logger.                                                                    |
| `remove`   | `void` / `boolean`             | Removes every registered logger with `remove()`, one with `remove(name)`, or a batch with `remove(names)`.             |

#### `ReporterInterface`

| Method    | Returns | Summary                                                                                          |
| --------- | ------- | ------------------------------------------------------------------------------------------------ |
| `section` | `void`  | Writes a titled separator block — a section heading framed by a horizontal rule.                 |
| `step`    | `void`  | Writes a step line, optionally prefixed with its `[index/total]` `StepPosition`.                 |
| `timing`  | `void`  | Writes a timing line — `label … 1.23s` (sub-second shown as `…ms`).                              |
| `status`  | `void`  | Writes an icon + colored outcome line for `level` (`error` routes to the error stream).          |
| `table`   | `void`  | Renders a `TableOptions` grid through `renderTable` and writes it.                               |
| `tree`    | `void`  | Renders a `TreeOptions` tree through `renderTree` and writes it.                                 |
| `box`     | `void`  | Renders a `BoxOptions` frame through `renderBox` and writes it.                                  |
| `line`    | `void`  | Writes one raw line, colored through the styler if any styling is embedded — no prefix, no icon. |
| `blank`   | `void`  | Writes `count` blank lines (default `1`).                                                        |

#### `RetentionInterface`

| Method    | Returns        | Summary                                                                                                                                          |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `add`     | `void`         | Retains one record — appends it to the total buffer and to its level's bucket, evicting the oldest of each past `limit`.                         |
| `records` | `readonly T[]` | Returns a copy of the whole retained buffer, oldest first, or — given a level — a copy of that level's bucket, empty for a level with no bucket. |
| `clear`   | `void`         | Drops every retained record from the total buffer and every bucket.                                                                              |

#### `CaptureInterface`

| Method     | Returns                      | Summary                                                                                                                                          |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `start`    | `void`                       | Snapshots the configured `console.*` and installs the interceptors — a no-op when already `active`.                                              |
| `stop`     | `void`                       | Restores the snapshot-original `console.*` — a no-op when not `active`.                                                                          |
| `messages` | `readonly CapturedMessage[]` | Returns a copy of the whole captured buffer, oldest first (capped at `limit`), or — given a `CaptureLevel` — a copy of only that level's bucket. |
| `clear`    | `void`                       | Drops every buffered message (total + by level); does not stop interception.                                                                     |
| `destroy`  | `void`                       | Tears down — `stop()` (restoring `console`) then destroys the emitter.                                                                           |

#### `SpinnerInterface`

| Method    | Returns | Summary                                                                                           |
| --------- | ------- | ------------------------------------------------------------------------------------------------- |
| `start`   | `void`  | Arms the periodic timer and renders the first frame — a no-op when already `active`.              |
| `tick`    | `void`  | Advances one frame: builds the line, emits `frame`, and writes `\r` + line to the sink.           |
| `update`  | `void`  | Changes the message; re-renders immediately when `active` so the change shows at once.            |
| `succeed` | `void`  | Stops with a success line — clears the timer, writes + emits `✔ message` + newline.               |
| `fail`    | `void`  | Stops with an error line — clears the timer, writes + emits `✖ message` + newline (error stream). |
| `stop`    | `void`  | Clears the timer and leaves the current line (no final write) — a no-op when not `active`.        |
| `destroy` | `void`  | Tears down — `stop()` then destroys the emitter.                                                  |

#### `ProgressInterface`

| Method    | Returns | Summary                                                                                                                                  |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `update`  | `void`  | Reports progress: clamps `current`, re-renders the bar, emits `update`, writes `\r` + bar. Ignored after a terminal `succeed` or `fail`. |
| `succeed` | `void`  | Finishes successfully — renders a full bar + newline, emits a final `update` then `succeed`.                                             |
| `fail`    | `void`  | Finishes unsuccessfully — renders the bar at its current fill + newline to the error stream (no `succeed`).                              |
| `destroy` | `void`  | Tears down — destroys the emitter.                                                                                                       |

#### `ProcessCaptureInterface`

| Method     | Returns                    | Summary                                                                                                                                         |
| ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`    | `void`                     | Begins intercepting the configured process streams (idempotent; emits `start`).                                                                 |
| `stop`     | `void`                     | Restores the pristine `process.*.write` references (idempotent; emits `stop`).                                                                  |
| `messages` | `readonly CapturedChunk[]` | Returns a copy of the full captured buffer, oldest first (capped at `limit`), or — given a `StreamLevel` — a copy of only that stream's bucket. |
| `clear`    | `void`                     | Drops every buffered chunk (total + per-stream); interception is unaffected.                                                                    |
| `destroy`  | `void`                     | Stops interception (restoring the streams) and tears down the emitter.                                                                          |

## Contract

These invariants hold across `src/core` ↔ `src/browser` ↔ `src/server` ↔ `console.md`:

1. **Doc ↔ source bijection.** Every `function` / `const` / `class` / `interface` / `type` row in the `## Surface` tables is a real export of the console source trees (`src/core` plus the `src/browser` and `src/server` environment backends), and every export appears as a Surface row — exhaustive, both directions.
2. **Doc ↔ source method bijection.** Every behavioral interface's `## Methods` table lists exactly its public methods (call-signature members) — exhaustive, both directions — and each implementing class (`ANSIRenderer` / `Logger` / `LoggerManager` / `Reporter` / `Capture` / `Spinner` / `Progress` / `ProcessCapture`) implements every method of its interface and adds none beyond it. A renamed / added / removed method breaks the gate until the table is reconciled.
3. **One coherent `LogLevel`; styling orthogonal to level.** A `LogLevel` is one ascending-severity scale (`debug` < `info` < `warn` < `error`, ordered by `LEVEL_SEVERITY`); a logger gates by threshold through `meetsLevel`. A level's color (`LEVEL_COLORS`) is a styling choice, never a separate level — there are no `success` / `ready` pseudo-levels (those that look like outcomes are the reporter's `StatusLevel`, a narrative axis with no ordering or gating).
4. **Style is data with a swappable renderer.** A `Style` is a frozen `{ foreground?, background?, attributes }` record, never a baked escape string; a `RendererInterface` turns it into output for one target. The cross-environment default is the `ANSIRenderer` (SGR codes); a browser `%c` renderer implements the same contract over the same `Style`, so retargeting swaps the renderer and never the style model. The `Styler` is immutable copy-on-write (a later color of a channel wins; a repeated attribute is idempotent), so a base styler is freely reusable.
5. **A theme is the application's vocabulary; an option is this instance's presentation.** A `Theme` binds the semantic roles the whole application shares to `Style` values — a label style per `LogLevel` under `levels`, an icon + style per `StatusLevel` under `statuses`, one `accent` (spinner glyph, bar fill, step prefix) and one `chrome` (separators, box / table / tree connectors, a log line's timestamp / name / data surround). Hand one theme to the logger, the reporter, the spinner, and the progress bar and every surface speaks it; `createTheme` merges per role — and per entry within `levels` / `statuses` — over `DEFAULT_THEME`, snapshots every style leaf, and deep-freezes each snapshot, so an override restyles one role and later caller mutation cannot change it. A per-entity option carries what only that instance draws with: a spinner's `frames`, a progress bar's `fill` / `empty`, a box's / table's / tree's `border`. The test is which axis the value keys on: a domain axis (level, status, accent, chrome) is a theme role; a glyph one instance happens to use is an option, and it never enters the theme.
6. **The `Sink` seam + the no-capture-loop.** `SinkInterface` is the one place text leaves the system — redirect output by supplying a different sink, with no change to the logger / reporter / animation. The default `createConsoleSink` (and `createBrowserSink` / `createServerSink`) snapshots the underlying `console` / `process` write at creation and writes through that snapshot, so a `Capture` / `ProcessCapture` installed afterward can never feed the system's own output back into itself — create sinks (and loggers) before installing a capture.
7. **`format` owns the human line; the record + `entry` / `capture` event owns the machine record.** A `Logger` always emits an accepted record on `entry`, and a `Capture` / `ProcessCapture` emits every intercepted call on `capture`; a file / JSON / remote transport rides that emitter rather than a second code path, and it rides `entry` rather than `format` — the record is already structured there, so no transport parses a line back apart. `format` (a `LogFormatFunction`, defaulting to `formatRecord`) decides only what the human line looks like, and the order is fixed: gate, freeze the record, retain it, emit `entry`, then — unless `silent` — `format` and write. `silent` suppresses the write and never invokes `format`, so a silent logger still feeds every transport and pays nothing for a line nobody reads. A formatter throw is a programmer error: it propagates to the `logger.info` caller and prevents that logger's write after its record and event have left. A manager fans out sequentially, so the throw also stops every remaining logger for that call before retention or `entry`. Listener isolation is the emitter's: a listener throw routes to the emitter's own `error` handler, never onto the domain `EventMap`, so a buggy transport / capture listener can never perturb logging — nor (for the captures) escape into the host's `console.*` / `process.*.write` call.
8. **Bounded retention.** Every buffer is capped, never unbounded: a logger's `entries()` tail at `DEFAULT_LOG_LIMIT`, a `Capture` / `ProcessCapture`'s total buffer and each per-level / per-stream bucket at `DEFAULT_CAPTURE_LIMIT` / `DEFAULT_STREAM_LIMIT` — oldest dropped first. A long-running logger or capture can never grow without bound. The console capture and the process capture buffer through the one `Retention` engine (`RetentionInterface`, generic over the record type each carries), so their retention semantics cannot drift apart.
9. **The environment split — one engine, environment sinks.** The cross-environment core owns the contract (`Style` / `SinkInterface` / `LogLevel`) and all the universal logic; each environment supplies only the platform output backend at the `Sink` seam. ANSI lives in core (`ANSIRenderer` + `createConsoleSink`); the browser translates ANSI to `console.log('%c…', css)` at the sink (`createBrowserSink` over the pure, total, `%`-safe `ansiToConsole`); the server writes to the real `process` streams with styling selected per target at construction by the precedence in the color-detection contract. The browser / server modules import the core contracts (never redeclare them) and add only their backend.
10. **Color detection is the server sink's alone.** `createServerSink` decides each target's styling once, at construction: `options.styled` when supplied; otherwise `inferStyled(target, options.environment ?? process.env)` checks a present `FORCE_COLOR` first (only the exact value `'0'` disables), then a present, non-empty `NO_COLOR`, then the target's own `isTTY === true`. The sink stores that fact per target (`stdout` and `stderr` can differ), keys its ANSI stripping off it, and exposes the `stdout` fact as `styled`. Nothing else reads the environment: core's `createStyler` takes `enabled` from its caller and defaults to `true`, and the browser sink always styles. The server pairing is `createStyler({ enabled: sink.styled })` — one styling fact drives both ANSI generation and sink stripping.
11. **Animations: every sink gets the frame, the sink decides the redraw + timer leak-freedom.** A `Spinner` / `Progress` builds a frame line and writes a leading `\r` + that line to its sink, then emits it — every sink receives the same frame and the line overwrite is the sink's decision. A `ServerSink` writes the frame straight to the stream and appends no newline (a plain target loses the frame's ANSI, never its `\r`), so a terminal returns to column 0 and redraws in place. Core's `createConsoleSink` also writes it verbatim, and because `console.log` terminates each call the frame lands as a fresh line rather than an overwrite — the plain-environment degrade, with no `\r`-specific branch in core. `createBrowserSink` strips the leading `\r` (a DevTools console cannot overwrite a line, and the stray control character would be rendered) and writes a fresh line — the locked browser degrade. A `Spinner`'s internal timer is always cleared on `succeed` / `fail` / `stop` / `destroy`, so it never leaks; a `Progress` has no self-timer (the caller drives `update`). A `Spinner` and a `Progress` are both universal — `setInterval` + the one styler + the one sink, no `node:*`, no `process.stdout`.
12. **Capture never-throws, non-reentrant, pristine restore.** A `Capture` / `ProcessCapture` builds its record through a total stringify / decode (`formatArgs` / `decodeChunk`), so intercepting `console.*` / `process.*.write` can never throw and crash the host. Each is process-global and non-reentrant — it patches the one global, so at most one may be active at a time; `start()` is idempotent (never double-patches) and `stop()` restores the exact snapshot reference, leaving the global pristine. A `ProcessCapture` additionally returns the snapshot-original's backpressure boolean so a caller's `write` handling keeps working.
13. **`width()`-aware rendering.** Every layout (`renderSeparator` / `renderBox` / `renderTable` / `renderTree` / `renderBar`, through `align` / `repeatTo`) measures on the visible `width` (ANSI stripped, counted in code points), so an already-styled cell or title keeps its columns — its escape codes never break the layout. Caller text arrives line-broken either way: the `renderBox` function splits its `content` on a line feed OR a CRLF pair, so a body written on Windows frames byte-identically to the same body written on POSIX, and no carriage return from a CRLF break reaches a framed row. A lone carriage return is not a separator — it stays inside its line, because a bare `\r` is the animation frame's cursor control (the animation contract), and cutting a frame on it would break the redraw the sink decides.

What ships is the **cross-environment core** (the style engine, structured logging, narrative reporting, the `console` `Capture`, and the live animations) plus the environment backends (the browser `%c` sink, and the server TTY sink with the raw-stream `ProcessCapture`). Deliberately **not** part of this surface, by the same "build only what earns its keep" discipline:

- **A file / JSON / remote sink.** Those ride the shipped `entry` transport seam — a consumer writes the sink.
- **East-asian (wide-glyph) width handling.** `width` counts code points, so a wide glyph (CJK, most emoji) counts as one column while a terminal gives it two — a layout holding one renders wider than it measured, and its border stops lining up.
- **256-color and 24-bit color depth.** `Color` stays the closed 16-name union, and that is a decision rather than an omission. That union is what generates the fluent styler — one chainable accessor per name, `styler.brightCyan.bold('…')` — and an open numeric or hex axis has no accessor set to generate. A consumer who wants different ink behind those names already has it: `BrowserPalette` maps each name to exact CSS. A consumer who wants true color implements one `RendererInterface`, which receives the `Style` data and emits whatever its target understands — the 24-bit seam is already open, and it costs the style model every environment shares nothing.
- **A multi-capture coordinator.** Capture is process-global by design.

## Patterns

### A styled, leveled logger

Build a leveled `Logger`, gate a call below threshold, tap the `entry` transport event, and tear it down:

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

Swap `format` for the human line, and set `silent` to suppress only the write:

```ts
import { Logger } from '@orkestrel/console'

// `format` owns the human line and nothing else — the record is already structured on `entry`.
const logger = new Logger({ format: (record) => `${record.level}: ${record.message}` })
logger.info('ready') // info: ready

// `silent` suppresses the write only: the record is still emitted, and `format` is never invoked.
const quiet = new Logger({ silent: true, format: () => 'never built' })
quiet.emitter.on('entry', (record) => archive(record)) // still fires
quiet.info('archived') // nothing written, no formatter call
```

### A logger registry

Register named loggers in a `LoggerManager`, fan a log out to every one, and remove one or all:

```ts
import { LoggerManager } from '@orkestrel/console'

const manager = new LoggerManager({ level: 'info' })
manager.register('http') // mints + stores a logger named 'http', the manager's defaults flow in
manager.info('booted') // fan out an `info` log to every registered logger
manager.remove('http') // remove one by name (also: remove(['a', 'b']) for a batch)
manager.remove() // no argument — empty the registry
```

### A reporter narration

Narrate a deploy with every `Reporter` verb — a section, a step, a timing, a table, two trees, a box, a line, a blank, and a status:

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
reporter.blank() // a blank line; reporter.blank(3) writes a run of 3
reporter.status('success', 'all green') // ✔ all green
```

### One theme, every entity

Override one theme role, hand the same theme to a logger, a reporter, and a spinner, then set a per-entity option that never enters the theme:

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

// A per-entity option is this instance's presentation, never a shared role.
new Spinner({ message: 'deploying', frames: ['-', '\\', '|', '/'] }).tick() // - deploying
new Progress({ total: 10, width: 10, fill: '=', empty: '.' }).update(4) // ====...... 40% (4/10)
```

### Scoping third-party `console.*` with `createCaptureResult`

Scope a third-party library's `console.*` output to one call with `createCaptureResult`, sync and async:

```ts
import { createCaptureResult } from '@orkestrel/console'

// Create your loggers before this — they snapshot the real console, so they are never recaptured.
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

Start a `Capture`, read and clear its buffer, then stop and destroy it:

```ts
import { Capture } from '@orkestrel/console'

const capture = new Capture()
capture.start() // snapshot the configured console.* and install the interceptors
console.log('hello')
capture.messages() // the whole buffer — [{ level: 'log', text: 'hello', time: … }]
capture.clear() // drop every buffered message; interception is unaffected
capture.stop() // restore the snapshot-original console.*
capture.destroy() // stop() then destroy the emitter
```

### The bounded retention engine directly

Drive the bounded `Retention` engine directly — the whole buffer, one level's bucket, and the shared cap each evicts under:

```ts
import { Retention } from '@orkestrel/console'

// The console capture and the process capture buffer through this one engine, so their retention semantics cannot drift apart.
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

Run a `Spinner` through a success and a failure outcome, and a `Progress` bar through an update, a success, and a failure:

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

Swap only the `sink` to `createBrowserSink` and log through the same core `Logger`:

```ts
import { Logger } from '@orkestrel/console'
import { createBrowserSink } from '@orkestrel/console/browser'

// The same core logger; only the sink changes. ANSI is translated to `%c` at the sink,
// so a DevTools console renders the same 16 colors a terminal would.
const logger = new Logger({ name: 'app', sink: createBrowserSink() })
logger.error('boom') // → console.error('%c…', 'color:#cd0000;…') in DevTools
```

### The server — a TTY sink and a process capture

Builds a TTY-aware server sink and its paired styler, a forced-styled override, and a `ProcessCapture` that mirrors a library's raw `stderr` write while buffering it.

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

// Own every output path — a direct process.stdout.write, library output, child-process pipes:
const capture = new ProcessCapture({ levels: ['stderr'], mirror: true })
capture.start()
process.stderr.write('a library diagnostic\n') // captured and still shown (mirror: true)
capture.messages('stderr') // [{ level: 'stderr', text: 'a library diagnostic\n', time: … }]
capture.clear() // drop buffered chunks; interception is unaffected
capture.stop()
capture.destroy() // stop() then tear down the emitter
```

### One logger, different sink per environment (the cross-env one-liner)

Pick the sink by environment and keep the rest of the `Logger` code identical:

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

Call the pure renderer, layout, and formatting helpers directly, with no `Logger` or `Reporter` in front of them:

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

Call `inferColumns` directly against the live `process.stdout`:

```ts
import { inferColumns } from '@orkestrel/console/server'

inferColumns(process.stdout) // the live TTY width, or the DEFAULT_COLUMNS fallback off a TTY
```

### Server boundary guards directly

Call the server boundary guards directly against a real stream and a real encoding:

```ts
import { isBufferEncoding, isStreamTarget } from '@orkestrel/console/server'

isStreamTarget(process.stdout) // true — a record with a callable `write`
isStreamTarget({}) // false — no `write`
isBufferEncoding('utf8') // true — a value accepted by Buffer#toString
isBufferEncoding('nope') // false
```

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ source bijection across `src/core` and the `src/browser` + `src/server` backends (value + type exports), each interface ↔ implementing-class method bijection, and the equality gate: every `Summary` cell against its declaration's description paragraph, the titled `The server — a TTY sink and a process capture` fence against the `@example` block of that title (pinned so the titled pair cannot be retired silently), and the README pitch against this guide's tagline. It also runs the flagship fences and asserts the values their comments claim.
- [`tests/src/core/renderers/ANSIRenderer.test.ts`](../tests/src/core/renderers/ANSIRenderer.test.ts) — the ANSI renderer: foreground / background / attribute SGR codes, multi-attribute composition, `default` / unset / empty-style / empty-string pass-through.
- [`tests/src/core/Styler.test.ts`](../tests/src/core/Styler.test.ts) — the fluent styler: chainable `Color` / `Attribute` accessors, immutability + composition either way, last-color-wins / idempotent-attribute, the `enabled` verbatim switch, a swapped renderer, and `render` by value (the merge precedence, a themed role, the frozen merged style handed to the renderer).
- [`tests/src/core/loggers/Logger.test.ts`](../tests/src/core/loggers/Logger.test.ts) — the logger: the level gate (drop below threshold), the frozen `LogRecord`, bounded `entries()` retention + `clear`, the `entry` transport event (fires even when `silent`), the styled line, the themed level label, the `format` contract (the return written exactly, never invoked when `silent` or when the gate drops a record, a throw preventing only the write), the default snapshotted console sink, and the emitter's listener-isolation (`error` handler) emit-safety.
- [`tests/src/core/loggers/LoggerManager.test.ts`](../tests/src/core/loggers/LoggerManager.test.ts) — the registry: `register` (defaults flow in — `theme` / `format` included — and a register override wins, re-register overwrites) / `logger` / `loggers` / `count`, sequential `debug`…`error` fan-out including formatter-throw halt, and `remove` over every logger, one, or a batch.
- [`tests/src/core/Reporter.test.ts`](../tests/src/core/Reporter.test.ts) — the reporter verbs: `section` / `step` (with / without position) / `timing` / `status` (the theme's icon + style, `error` → error stream) / `table` / `tree` / `box` / `line` / `blank`, each verb's bytes unchanged under the explicit default theme.
- [`tests/src/core/Capture.test.ts`](../tests/src/core/Capture.test.ts) — the console interceptor: snapshot-at-`start` + restore, capture (total + by level) + bounded buffers, the `capture` event + `start` / `stop` lifecycle, `mirror` / `sink` forwarding, idempotency, and the no-capture-loop.
- [`tests/src/core/Spinner.test.ts`](../tests/src/core/Spinner.test.ts) — the spinner: deterministic `tick()` frame advance + the `\r` write, idempotent `start`, the leak-free timer (armed / always cleared, fake timers), `update`, `succeed` / `fail` outcome lines (the theme's status icon + style), the accent glyph, and the `frame` / `start` / `stop` events.
- [`tests/src/core/Progress.test.ts`](../tests/src/core/Progress.test.ts) — the progress bar: `update` clamp + render + `\r` write, the `update` event, terminal `succeed` (full bar + `succeed` event) / `fail` (error stream, no succeed), the custom `fill` / `empty` glyphs with the accent on the filled run only, and the post-terminal ignore.
- [`tests/src/core/Retention.test.ts`](../tests/src/core/Retention.test.ts) — the shared retention engine the console and process captures compose: oldest-first order in the whole buffer and per level, the independent cap on each, a record whose level has no bucket, the copy returned by every `records` call, `clear` leaving retention working, and the zero / one limits.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — the pure helpers: `strip` / `width` (ANSI-aware, code points), `freezeStyle` snapshot and deep freeze, `meetsLevel` / `selectWriter` (every `LogLevel` plus an omitted one, and a backend folding several levels onto one target) / `formatTime` / `formatRecord`, `align` / `paint` / `repeatTo` / `cellAt`, `renderSeparator` / `renderBox` / `renderTable` / `renderTree` (every connector derived from the selected border set, an omitted `border` byte-identical to an explicit `single`) / `renderBar`, `formatDuration`, and the total `stringifyValue` / `formatArgs` (Error / cycle / BigInt).
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
