# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (AGENTS §22).

## By concept

| Concept  | Spec                         | Source                                                   | Tests                                                                            |
| -------- | ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Terminal | [`terminal.md`](terminal.md) | [`src/core`](../src/core), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/server`](../tests/src/server) |

One concept covers both source trees: [`src/core`](../src/core) declares the
`TerminalInterface` contract, the broker, the bridge, the manager, and every
pure leaf, and [`src/server`](../src/server) implements that one contract
against a real TTY. The end-to-end proof that they compose lives in
[`tests/integration.test.ts`](../tests/integration.test.ts).

## By directory

| Directory    | Guide                        |
| ------------ | ---------------------------- |
| `src/core`   | [`terminal.md`](terminal.md) |
| `src/server` | [`terminal.md`](terminal.md) |

## Dependency reference

`@orkestrel/form` owns the form itself — the schema, the twelve controls, the
rules, the values, and the settle-once `answer` promise — and terminal
declares none of it a second time. Its guide is not mirrored here: form is
not published yet, so this repository pins it as a committed tarball
(`file:vendor/orkestrel-form-0.0.1.tgz`) and there is no released guide to
mirror. Read the installed package's own guide at
[github.com/orkestrel/form](https://github.com/orkestrel/form) for form's
laws, and read [`terminal.md`](terminal.md) for what terminal adds around
them. The pin, its two standing conditions, and the five-step re-pin recipe
are recorded in [`terminal.md`](terminal.md).

[`console.md`](console.md) is a byte-identical mirror of the guide for
`@orkestrel/console` — a runtime dependency, the `StylerInterface` every
rendered view is painted through (one style engine). It documents **that
package's** surface, not anything sourced in this repo; it is kept here so a
reader of this package can see the primitive it is built from without leaving
this guide set. It mirrors console's published release (`0.0.7`), which
carries the `StylerInterface.render` / `freezeStyle` surface this package
builds against.

[`contract.md`](contract.md) is a byte-identical mirror of the guide
for `@orkestrel/contract` — a runtime dependency, the `Guard<T>` vocabulary
the wire-boundary validators in this package are built from (no `as`
anywhere on the broker/bridge boundary). It documents **that package's**
surface, not anything sourced in this repo; it is kept here for the same
reason.

[`emitter.md`](emitter.md) is a byte-identical mirror of the guide
for `@orkestrel/emitter` — a runtime dependency, the typed push-observation
surface the `Prompt` broker and `PromptClient` bridge each expose as
`emitter`. It documents **that package's** surface, not anything sourced in
this repo; it is kept here so a reader of this package can see the primitive
it is built from without leaving this guide set.

[`database.md`](database.md) is a byte-identical mirror of the guide
for `@orkestrel/database` — a runtime dependency, the typed keyed-row
`TableInterface` the `DatabaseTerminalStore` twin persists each endpoint's
config snapshot through (one opaque JSON column, driver-pluggable). It
documents **that package's** surface, not anything sourced in this repo; it
is kept here so a reader of this package can see the primitive it is built
from without leaving this guide set.

[`sse.md`](sse.md) is a byte-identical mirror of the guide for
`@orkestrel/sse` — a runtime dependency, the `SSEParser` the `PromptClient`
decodes the broker's event stream with. It documents **that package's**
surface, not anything sourced in this repo; it is kept here for the same
reason.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not
anything sourced in this repo; it is kept here so a reader of the parity suite
can see the primitives it is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
