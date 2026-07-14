import type {
	PromptClientInterface,
	PromptClientOptions,
	PromptInterface,
	PromptOptions,
} from './types.js'
import { Prompt } from './Prompt.js'
import { PromptClient } from './PromptClient.js'

/**
 * Create the headless prompt {@link PromptInterface} BROKER — it parks each prompt call as a
 * pending prompt and resolves it when {@link PromptInterface.answer} arrives (or rejects on
 * timeout). The tri-surface's headless arm: subscribe `emitter.on('pending', …)` to forward each
 * prompt to whoever can answer (an SSE transport, a remote terminal), then route the answer back
 * through `answer(id, value)`.
 *
 * @param options - See {@link PromptOptions}
 * @returns A {@link PromptInterface}
 *
 * @remarks
 * - **Park-as-Promise.** `await prompt.input({ message })` blocks until `answer(id, value)` accepts
 *   a matching value; the value is validated (text forms) and type-checked to the form first.
 * - **Timeout → expire → reject (deterministic).** An unanswered prompt expires after
 *   `options.timeout` (default {@link import('./constants.js').DEFAULT_PROMPT_TIMEOUT_MS}) and its
 *   Promise rejects with a {@link import('./errors.js').TerminalError}; inject `options.timer` to
 *   drive expiry without real time.
 *
 * @example
 * ```ts
 * import { createPrompt } from '@src/core'
 *
 * const prompt = createPrompt()
 * prompt.emitter.on('pending', (pending) => send(pending)) // forward to a remote client
 * const name = await prompt.input({ message: 'Your name', validate: { required: true } })
 * ```
 */
export function createPrompt(options?: PromptOptions): PromptInterface {
	return new Prompt(options)
}

/**
 * Create the SSE prompt {@link PromptClientInterface} BRIDGE — it connects to a remote broker's SSE
 * endpoint, dispatches each received prompt to a LOCAL {@link import('./types.js').PromptFormInterface}
 * terminal (so a human at this machine answers a prompt parked elsewhere), and POSTs the answer
 * back. Universal — `fetch` / SSE are web-standard.
 *
 * @param options - See {@link PromptClientOptions} (`url` + `terminal` required)
 * @returns A {@link PromptClientInterface}
 *
 * @remarks
 * - **Connect + reconnect.** `await client.connect()` streams remote prompts until the stream
 *   ends; it reconnects with the `delay` backoff unless `reconnect` is `false` / the client was
 *   `destroy`ed. Inject `options.fetch` (a scripted `fetch`) and `options.timer` to drive it
 *   deterministically in tests — no real network.
 * - **§14 wire narrowing.** Every decoded prompt is guard-narrowed before dispatch (never an `as`).
 *
 * @example
 * ```ts
 * import { createPromptClient } from '@src/core'
 *
 * const client = createPromptClient({ url: 'http://host/prompts', terminal })
 * await client.connect()
 * ```
 */
export function createPromptClient(options: PromptClientOptions): PromptClientInterface {
	return new PromptClient(options)
}
