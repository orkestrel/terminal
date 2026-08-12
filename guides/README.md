# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (AGENTS §22).

## By concept

| Concept  | Spec                         | Source                                                   | Tests                                                                            |
| -------- | ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Terminal | [`terminal.md`](terminal.md) | [`src/core`](../src/core), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory    | Guide                        |
| ------------ | ---------------------------- |
| `src/core`   | [`terminal.md`](terminal.md) |
| `src/server` | [`terminal.md`](terminal.md) |

## Dependency reference

[`console.md`](console.md) is a byte-identical mirror of the guide for
`@orkestrel/console` — a runtime dependency, the `StylerInterface` the pure
prompt core renders its `view` through (one style engine). It documents
**that package's** surface, not anything sourced in this repo; it is kept
here so a reader of this package can see the primitive it is built from
without leaving this guide set.

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
