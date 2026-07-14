# @orkestrel/terminal

An interactive terminal-prompt toolkit for the `@orkestrel` line — six
prompt forms (`input`, `password`, `confirm`, `select`, `checkbox`,
`editor`) modelled as pure, event-free state machines, driven across three
symmetric surfaces: a headless `Prompt` broker that parks each call and
resolves it when answered, an SSE `PromptClient` bridge that dispatches a
remote prompt to a local terminal, and a raw-mode `Terminal` driver
(`node:readline` fallback when piped) that answers each prompt at this
machine's keyboard. Built to sit beside `@orkestrel/console` (the shared
style engine), `@orkestrel/contract`, `@orkestrel/emitter`, and
`@orkestrel/sse`, reusing all four as it takes shape.

## Install

```sh
npm install @orkestrel/terminal
```

## Requirements

- Node.js >= 24
- Core is ESM; the `./server` subpath ships dual ESM+CJS builds

## Usage

Park a prompt headlessly and answer it from elsewhere (an SSE transport, a
remote terminal):

```ts
import { createPrompt } from '@orkestrel/terminal'

const prompt = createPrompt()
prompt.emitter.on('pending', (pending) => send(pending)) // forward to a remote client
const name = await prompt.input({ message: 'Your name', validate: { required: true } })
```

Drive the same six prompt forms locally at this machine's keyboard:

```ts
import { createTerminal } from '@orkestrel/terminal/server'

const terminal = createTerminal()
const name = await terminal.input({ message: 'Your name' })
const proceed = await terminal.confirm({ message: 'Continue?', default: true })
```

Bridge a remote broker's prompts to a local terminal over SSE:

```ts
import { createPromptClient } from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const client = createPromptClient({
	url: 'http://localhost:3000/prompts',
	terminal: createTerminal(),
})
await client.connect()
```

## Guide

See [guides/src/terminal.md](./guides/src/terminal.md) for the full
documented surface — the six prompt forms, the headless broker, the SSE
bridge, and the raw-mode terminal driver.

## Package

Published as two entry points per the `exports` field in `package.json`:
`.` (the environment-agnostic core — the pure prompt reducers, the
`Prompt` broker, and the `PromptClient` bridge) and `./server` (the
Node-only `Terminal` driver). Core is ESM-only; `./server` ships dual
ESM+CJS builds.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
