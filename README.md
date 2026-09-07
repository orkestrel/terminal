# @orkestrel/terminal

> The terminal side of a form: a key decoder, a presentation theme, the pure per-field reducers,
> the headless broker that parks a live form until somebody elsewhere answers it, the SSE bridge
> that carries a parked form to a machine with a keyboard, and the manager that routes parked
> forms between named endpoints.

`@orkestrel/form` owns the document — the schema, the controls, the rules,
the values, and the settle-once `answer` promise — and this package declares
none of it a second time. Part of the `@orkestrel` line, built beside
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

A bare return binds absence, not the empty string, so `required` refuses it and
the walk asks again.

Park a live form and answer it from anywhere else:

```ts
import { createForm } from '@orkestrel/form'
import { createPrompt } from '@orkestrel/terminal'

const prompt = createPrompt()
prompt.emitter.on('pending', (form) => send(form)) // the wire-safe record

const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
const id = prompt.park(form) // the id; you await the form's own `answer`
prompt.answer(id, { name: 'Ada' }) // fills and submits the authoritative form
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
