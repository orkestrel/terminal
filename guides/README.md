# Guides

A dual-axis index into this repository's guides — by concept, and by
directory (AGENTS §22).

## By concept

| Concept  | Spec                                 | Source                                                   | Tests                                                                            |
| -------- | ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Terminal | [`src/terminal.md`](src/terminal.md) | [`src/core`](../src/core), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory    | Guide                                |
| ------------ | ------------------------------------ |
| `src/core`   | [`src/terminal.md`](src/terminal.md) |
| `src/server` | [`src/terminal.md`](src/terminal.md) |

## Dependency reference

[`src/console.md`](src/console.md) is a byte-identical mirror of the guide for
`@orkestrel/console` — a runtime dependency, the `StylerInterface` the pure
prompt core renders its `view` through (one style engine). It documents
**that package's** surface, not anything sourced in this repo; it is kept
here so a reader of this package can see the primitive it is built from
without leaving this guide set.

[`src/contract.md`](src/contract.md) is a byte-identical mirror of the guide
for `@orkestrel/contract` — a runtime dependency, the `Guard<T>` vocabulary
the wire-boundary validators in this package are built from (no `as`
anywhere on the broker/bridge boundary). It documents **that package's**
surface, not anything sourced in this repo; it is kept here for the same
reason.

[`src/emitter.md`](src/emitter.md) is a byte-identical mirror of the guide
for `@orkestrel/emitter` — a runtime dependency, the typed push-observation
surface the `Prompt` broker and `PromptClient` bridge each expose as
`emitter`. It documents **that package's** surface, not anything sourced in
this repo; it is kept here so a reader of this package can see the primitive
it is built from without leaving this guide set.

[`src/sse.md`](src/sse.md) is a byte-identical mirror of the guide for
`@orkestrel/sse` — a runtime dependency, the `SSEParser` the `PromptClient`
decodes the broker's event stream with. It documents **that package's**
surface, not anything sourced in this repo; it is kept here for the same
reason.

[`src/guide.md`](src/guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity test
suite (`tests/guides/src/parity.test.ts`). It documents **that package's**
surface (`Guide` / `Source`, the manifest and comparison helpers), not
anything sourced in this repo; it is kept here so a reader of the parity suite
can see the primitives it is built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
