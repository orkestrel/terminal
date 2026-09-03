# @orkestrel/terminal

The terminal side of a form, for the `@orkestrel` line. `@orkestrel/form` owns
the document — the schema, the controls, the rules, the values, and the
settle-once `answer` promise. This package owns what form has no opinion about:
a key decoder, a theme, pure per-field reducers, and the surfaces one form
can be answered on. The server `Terminal` implements the one driving contract
against a real TTY (raw-mode stdin, live in-place re-render, a `node:readline`
fallback when piped). The headless `Prompt` broker PARKS a live form until
somebody elsewhere answers it. The `PromptClient` bridge carries a form parked
elsewhere to this machine's keyboard over SSE. Built beside
`@orkestrel/console` (the shared style engine), `@orkestrel/contract`,
`@orkestrel/emitter`, `@orkestrel/database`, and `@orkestrel/sse`.

## Install

```sh
npm install @orkestrel/terminal
```

## Requirements

- Node.js >= 22
- Core and `./server` both ship dual ESM+CJS builds

## Usage

Ask one whole form at this machine's keyboard:

```ts
import { createForm } from '@orkestrel/form'
import { createTerminal } from '@orkestrel/terminal/server'

const terminal = createTerminal()
const values = await terminal.ask(
	createForm({
		fields: [
			{ control: 'text', name: 'name', label: 'Your name', rule: { required: true } },
			{ control: 'confirm', name: 'terms', label: 'Accept the terms', rule: { required: true } },
		],
	}),
)
```

A bare return binds ABSENCE, not the empty string, so `required` refuses it and
the walk asks again.

Park a live form and answer it from anywhere else:

```ts
import { createForm } from '@orkestrel/form'
import { createPrompt } from '@orkestrel/terminal'

const prompt = createPrompt()
prompt.emitter.on('pending', (form) => send(form)) // the wire-safe record

const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
const id = prompt.park(form) // the id; you await the form's own `answer`
prompt.answer(id, { name: 'Ada' }) // fills and submits the AUTHORITATIVE form
const values = await form.answer // { name: 'Ada' }
```

Bridge a form parked elsewhere to a local terminal over SSE:

```ts
import { createPromptClient } from '@orkestrel/terminal'
import { createTerminal } from '@orkestrel/terminal/server'

const client = createPromptClient({
	url: 'http://localhost:3000/forms',
	terminal: createTerminal(),
})
await client.connect() // renders each parked form here, POSTs { id, values } back
```

## Guide

See [guides/terminal.md](./guides/terminal.md) for the documented surface — the
driving contract, the pure reducers, the broker, the wire seam, the SSE bridge,
the multi-endpoint manager, the stores, and the TTY driver.

## Package

The entry points, per the `exports` field in `package.json`, are `.` (the
host-independent core — the reducers, the broker, the bridge, the manager, and
the stores) and `./server` (the Node-only `Terminal` driver). Both entry points
ship dual ESM+CJS builds.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
