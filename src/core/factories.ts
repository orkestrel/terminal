import type {
	PromptClientInterface,
	PromptClientOptions,
	PromptInterface,
	PromptOptions,
	TerminalManagerInterface,
	TerminalManagerOptions,
	TerminalSnapshotRow,
	TerminalStoreInterface,
} from './types.js'
import type { DriverInterface, TableInterface } from '@orkestrel/database'
import { Prompt } from './Prompt.js'
import { PromptClient } from './PromptClient.js'
import { TerminalManager } from './TerminalManager.js'
import { MemoryTerminalStore } from './MemoryTerminalStore.js'
import { DatabaseTerminalStore } from './DatabaseTerminalStore.js'
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { rawShape, stringShape } from '@orkestrel/contract'

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

/**
 * Create the multi-endpoint {@link TerminalManagerInterface} — a named registry of
 * {@link PromptInterface} brokers so several parties can `ask` prompts of each other by name,
 * with a transitive DEADLOCK check across every in-flight ask.
 *
 * @param options - See {@link TerminalManagerOptions}
 * @returns A {@link TerminalManagerInterface}
 *
 * @example
 * ```ts
 * import { createTerminalManager } from '@src/core'
 *
 * const manager = createTerminalManager()
 * manager.add('agent')
 * ```
 */
export function createTerminalManager(options?: TerminalManagerOptions): TerminalManagerInterface {
	return new TerminalManager(options)
}

/**
 * Create the in-memory {@link TerminalStoreInterface} — a process-lifetime `Map` of endpoint
 * config snapshots, the default store backing a {@link TerminalManagerInterface}'s `open` / `save`.
 *
 * @returns A {@link TerminalStoreInterface}
 *
 * @example
 * ```ts
 * import { createMemoryTerminalStore } from '@src/core'
 *
 * const store = createMemoryTerminalStore()
 * ```
 */
export function createMemoryTerminalStore(): TerminalStoreInterface {
	return new MemoryTerminalStore()
}

/**
 * Create a {@link TerminalStoreInterface} backed by one table of the `databases` layer — the
 * driver-pluggable twin of {@link createMemoryTerminalStore}, storing each endpoint's config
 * snapshot as one opaque JSON column.
 *
 * @param driver - The {@link DriverInterface} backing the table (default an in-memory driver)
 * @returns A {@link TerminalStoreInterface}
 *
 * @example
 * ```ts
 * import { createDatabaseTerminalStore } from '@src/core'
 *
 * const store = createDatabaseTerminalStore() // in-memory by default
 * ```
 */
export function createDatabaseTerminalStore(
	driver: DriverInterface = createMemoryDriver(),
): TerminalStoreInterface {
	// The snapshot is stored as ONE OPAQUE JSON column (`rawShape`), so the row infers FLAT —
	// `{ id: string; snapshot: unknown }` = TerminalSnapshotRow.
	const columns = { id: stringShape(), snapshot: rawShape({}) }
	const database = createDatabase({ driver, tables: { terminals: columns } })
	const table: TableInterface<TerminalSnapshotRow> = database.table('terminals')
	return new DatabaseTerminalStore(table)
}
