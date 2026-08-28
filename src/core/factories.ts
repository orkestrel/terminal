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
import { MemoryTerminalStore } from './stores/MemoryTerminalStore.js'
import { DatabaseTerminalStore } from './stores/DatabaseTerminalStore.js'
import { createDatabase, createMemoryDriver } from '@orkestrel/database'
import { rawShape, stringShape } from '@orkestrel/contract'

/**
 * Create the headless {@link PromptInterface} broker. It parks live forms and applies remote
 * answers to the authoritative instances.
 *
 * @param options - See {@link PromptOptions}
 * @returns A {@link PromptInterface}
 *
 * @remarks
 * The caller awaits the parked form's own `answer`. Timeout, `stop`, or teardown destroys the form,
 * so that promise rejects with the Form package's `ABANDONED` error. Inject `options.timer` to
 * drive expiry without real time.
 *
 * @example
 * ```ts
 * import { createPrompt } from '@src/core'
 * import { createForm } from '@orkestrel/form'
 *
 * const prompt = createPrompt()
 * const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
 * const id = prompt.park(form)
 * prompt.answer(id, { name: 'Ada' })
 * ```
 */
export function createPrompt(options?: PromptOptions): PromptInterface {
	return new Prompt(options)
}

/**
 * Create the SSE prompt {@link PromptClientInterface} BRIDGE — it connects to a remote broker's SSE
 * endpoint, dispatches each received form to a local {@link import('./types.js').TerminalInterface},
 * and POSTs the answer back. Universal — `fetch` / SSE are web-standard.
 *
 * @param options - See {@link PromptClientOptions} (`url` + `terminal` required)
 * @returns A {@link PromptClientInterface}
 *
 * @remarks
 * - **Connect + reconnect.** `await client.connect()` streams remote prompts until the stream
 *   ends; it reconnects with the `delay` backoff unless `reconnect` is `false` / the client was
 *   `destroy`ed. Inject `options.fetch` (a scripted `fetch`) and `options.timer` to drive it
 *   deterministically in tests — no real network.
 * - **Wire narrowing.** Every decoded prompt is guard-narrowed before dispatch (never an `as`).
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
 * Create the multi-endpoint {@link TerminalManager} — a named registry of
 * {@link PromptInterface} brokers so several parties can `ask` prompts of each other by name,
 * with a transitive DEADLOCK check across every in-flight ask.
 *
 * @param options - See {@link TerminalManagerOptions}
 * @returns A {@link TerminalManager}
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
