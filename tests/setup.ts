// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`.

import type {
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	KeyEvent,
	PasswordOptions,
	PromptFormInterface,
	PromptStep,
	PromptType,
	SelectOptions,
	TerminalStoreInterface,
	TimerCancel,
	TimerHandler,
} from '@src/core'
import type { EmitterInterface, EventMap } from '@orkestrel/emitter'
import type { RecorderInterface } from '@orkestrel/test'
import { parseKey } from '@src/core'
import { createRecorder } from '@orkestrel/test'

/**
 * Read one indexed collection element and fail loudly when it is absent.
 *
 * @typeParam T - The collection element type
 * @param values - The readonly collection to read
 * @param index - The zero-based index to require
 * @returns The element at `index`
 */
export function requireElement<T>(values: readonly T[], index: number): T {
	const value = values[index]
	if (value === undefined)
		throw new Error(`Missing required test element at index ${String(index)}`)
	return value
}

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: RecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

// ── Deterministic timer + SSE response (terminals broker / client) ───────────
//
// The injection seams the headless `Prompt` broker and the `PromptClient` SSE bridge
// expose for hermetic tests (AGENTS §16.1): a MANUAL timer driving expiry / reconnect
// without real time, and a builder that wraps scripted SSE events as a `fetch` Response
// the injected client `fetch` returns. No `node:*` / DOM — `ReadableStream` / `Response`
// / `TextEncoder` are global in both runners.

/** A manually-driven {@link TimerHandler} plus controls to inspect + fire its armed timers. */
export interface ManualTimerInterface {
	/** The {@link TimerHandler} to inject (records each armed timer; never fires on its own). */
	readonly handler: TimerHandler
	/** How many timers are currently armed (not yet fired / cancelled). */
	readonly pending: number
	/** Fire every currently-armed timer (in arm order), clearing them. */
	flush(): void
}

/**
 * Create a {@link ManualTimerInterface} — a `TimerHandler` that records each armed deadline
 * instead of scheduling it, so a test fires expiry / reconnect on demand with zero real time
 * (AGENTS §16). Injected as the `Prompt` broker's `timer` (its prompt expiry) or the
 * `PromptClient`'s `timer` (its reconnect backoff): arm a timer, assert `pending`, call
 * {@link ManualTimerInterface.flush} to fire it. A cancelled timer (the broker answering before
 * expiry) drops out of `pending` and never fires.
 *
 * @returns A manual timer whose `handler` is the injectable {@link TimerHandler}
 */
export function createManualTimer(): ManualTimerInterface {
	let armed: Array<{ readonly callback: () => void; cancelled: boolean }> = []
	return {
		handler(callback: () => void): TimerCancel {
			const timer = { callback, cancelled: false }
			armed.push(timer)
			return () => {
				timer.cancelled = true
			}
		},
		get pending() {
			return armed.filter((timer) => !timer.cancelled).length
		},
		flush() {
			const firing = armed
			armed = []
			for (const timer of firing) if (!timer.cancelled) timer.callback()
		},
	}
}

/**
 * Build a `fetch` Response whose body is an SSE stream of the given events — the controlled
 * stream an injected client `fetch` returns so a {@link import('@src/core').PromptClientInterface}
 * test drives the bridge with no real network (AGENTS §16). Each event is serialized as
 * `event: {name}\ndata: {json}\n\n`; the stream then ENDS (a bounded SSE response), so the
 * client's read loop completes and (per its options) reconnects.
 *
 * @param events - The SSE events to stream, each `{ event, data }` (data JSON-stringified)
 * @returns A `Response` with a `text/event-stream` body of the encoded events
 */
export function createSSEResponse(
	events: ReadonlyArray<{ readonly event: string; readonly data: unknown }>,
): Response {
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const { event, data } of events) {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
			}
			controller.close()
		},
	})
	return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

// ── Reducer feed driver ───────────────────────────────────────────────────
//
// The single general form of the ~8 local `feed` / `feedInput` drivers that were
// hand-duplicated per reducer across `helpers.test.ts` (AGENTS §16.1): thread a
// scripted sequence of raw key strings through a prompt reducer, decoding each via
// the real `parseKey`, and return the final step.

/**
 * Thread a scripted sequence of raw key strings through a prompt `reduce` function,
 * decoding each key via the real {@link parseKey} and folding it through `reduce` in
 * order — the one general form of the per-reducer `feed` / `feedInput` drivers
 * duplicated across `helpers.test.ts` (AGENTS §16.1).
 *
 * @typeParam TValue - The prompt's resolved value type (matches the reducer's {@link PromptStep} `T`)
 * @typeParam TState - The prompt's concrete state shape (matches the reducer's {@link PromptStep} `S`)
 * @param reduce - The pure prompt reducer under test (e.g. `inputReduce`, `selectReduce`)
 * @param state - The initial prompt state (typically from a `create*State` factory)
 * @param keys - The raw key strings to feed in order, each decoded via `parseKey`
 * @returns The final {@link PromptStep} after folding every key through `reduce`
 */
export function feedReducer<TValue, TState>(
	reduce: (state: TState, key: KeyEvent) => PromptStep<TValue, TState>,
	state: TState,
	keys: readonly string[],
): PromptStep<TValue, TState> {
	let step: PromptStep<TValue, TState> = { state, view: '', status: 'active' }
	for (const key of keys) step = reduce(step.state, parseKey(key))
	return step
}

// ── Recording terminal — a real PromptFormInterface, not a mock ────────────
//
// A real implementation of the six-method `PromptFormInterface` contract that records
// each form call's options and resolves with a configured per-form answer (AGENTS
// §16.1 recorder-not-mock). Supports a deferred/blocking mode — held pending calls a
// test releases explicitly — for exercising in-flight duplicate suppression.

/** The configured resolved answer per {@link PromptFormInterface} form, used by {@link createRecordingTerminal}. */
export interface RecordingTerminalAnswers {
	readonly input?: string
	readonly password?: string
	readonly confirm?: boolean
	readonly select?: string
	readonly checkbox?: readonly string[]
	readonly editor?: string
}

/**
 * Options for {@link createRecordingTerminal}.
 *
 * @remarks
 * - `answers` — the value each form resolves with once called (unset forms default:
 *   `''` for text forms, `false` for `confirm`, `[]` for `checkbox`).
 * - `defer` — the forms whose calls are held PENDING (unresolved) until released
 *   through {@link RecordingTerminalController.release}, for testing in-flight behavior.
 */
export interface RecordingTerminalOptions {
	readonly answers?: RecordingTerminalAnswers
	readonly defer?: readonly PromptType[]
}

/** A {@link createRecorder} per {@link PromptFormInterface} form, keyed by form name. */
export interface RecordingTerminalCalls {
	readonly input: RecorderInterface<readonly [InputOptions]>
	readonly password: RecorderInterface<readonly [PasswordOptions]>
	readonly confirm: RecorderInterface<readonly [ConfirmOptions]>
	readonly select: RecorderInterface<readonly [SelectOptions]>
	readonly checkbox: RecorderInterface<readonly [CheckboxOptions]>
	readonly editor: RecorderInterface<readonly [EditorOptions]>
}

/** One deferred, still-unresolved {@link createRecordingTerminal} form call. */
export interface RecordingTerminalPendingCall {
	readonly form: PromptType
}

/** Controls over the deferred calls a {@link createRecordingTerminal} is holding pending. */
export interface RecordingTerminalController {
	/** The currently deferred, unresolved calls (in call order). */
	readonly pending: readonly RecordingTerminalPendingCall[]
	/** Resolve deferred calls with their configured answer — every pending call, or only `form`'s. */
	release(form?: PromptType): void
}

/** The result of {@link createRecordingTerminal} — a real terminal, its call recorders, and deferred-call control. */
export interface RecordingTerminalResult {
	readonly terminal: PromptFormInterface
	readonly calls: RecordingTerminalCalls
	readonly controller: RecordingTerminalController
}

/**
 * Create a {@link RecordingTerminalResult} — a REAL {@link PromptFormInterface}
 * implementation (not a mock) whose six form methods record their `options` into
 * per-form recorders and resolve a configured per-form answer (AGENTS §16.1). A form
 * listed in `options.defer` instead holds its call PENDING until released through
 * {@link RecordingTerminalController.release} — for exercising in-flight duplicate
 * suppression and similar pending-call behavior without a real terminal.
 *
 * @param options - The {@link RecordingTerminalOptions} (answers + deferred forms)
 * @returns The recording terminal, its call recorders, and the deferred-call controller
 */
export function createRecordingTerminal(
	options: RecordingTerminalOptions = {},
): RecordingTerminalResult {
	const answers = options.answers ?? {}
	const deferred = new Set(options.defer ?? [])
	const calls: RecordingTerminalCalls = {
		input: createRecorder<readonly [InputOptions]>(),
		password: createRecorder<readonly [PasswordOptions]>(),
		confirm: createRecorder<readonly [ConfirmOptions]>(),
		select: createRecorder<readonly [SelectOptions]>(),
		checkbox: createRecorder<readonly [CheckboxOptions]>(),
		editor: createRecorder<readonly [EditorOptions]>(),
	}
	const waiting: Array<{ readonly form: PromptType; readonly resolve: () => void }> = []

	function call<TOptions, TValue>(
		form: PromptType,
		recorder: RecorderInterface<readonly [TOptions]>,
		formOptions: TOptions,
		value: TValue,
	): Promise<TValue> {
		recorder.handler(formOptions)
		if (!deferred.has(form)) return Promise.resolve(value)
		return new Promise<TValue>((resolve) => {
			waiting.push({ form, resolve: () => resolve(value) })
		})
	}

	const terminal: PromptFormInterface = {
		input: (formOptions) => call('input', calls.input, formOptions, answers.input ?? ''),
		password: (formOptions) =>
			call('password', calls.password, formOptions, answers.password ?? ''),
		confirm: (formOptions) => call('confirm', calls.confirm, formOptions, answers.confirm ?? false),
		select: (formOptions) => call('select', calls.select, formOptions, answers.select ?? ''),
		checkbox: (formOptions) =>
			call('checkbox', calls.checkbox, formOptions, answers.checkbox ?? []),
		editor: (formOptions) => call('editor', calls.editor, formOptions, answers.editor ?? ''),
	}

	const controller: RecordingTerminalController = {
		get pending() {
			return waiting.map((entry) => ({ form: entry.form }))
		},
		release(form) {
			const releasing =
				form === undefined ? waiting.slice() : waiting.filter((entry) => entry.form === form)
			for (const entry of releasing) {
				const index = waiting.indexOf(entry)
				if (index >= 0) waiting.splice(index, 1)
				entry.resolve()
			}
		},
	}

	return { terminal, calls, controller }
}

/** Whether a repository-relative Vue SFC path belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}

// ── Terminal store contract matrix — the shared case table both twins run ──────
//
// `MemoryTerminalStore` and `DatabaseTerminalStore` are twin backends behind the one
// `TerminalStoreInterface` persistence seam, so their shared behavioral cases sit here as
// a data table (AGENTS §16.1 — a case matrix lives in a setup file; test registration does
// not). Each twin's own mirrored test file registers this table against the store it builds.

/** One {@link TerminalStoreInterface} behavioral case — a label, the acts to run, and the value the last act must equal. */
export interface TerminalStoreScenario {
	readonly label: string
	readonly act: (store: TerminalStoreInterface) => Promise<unknown>
	readonly expected: unknown
}

/**
 * The shared {@link TerminalStoreInterface} contract cases every twin backend satisfies — a
 * miss, a round-trip with and without the optional `timeout`, a same-id upsert, a delete, a
 * delete of an absent id, and independent coexistence of two ids.
 */
export const TERMINAL_STORE_SCENARIOS: readonly TerminalStoreScenario[] = Object.freeze([
	{
		label: 'resolves undefined for a never-stored id (miss)',
		act: (store) => store.get('nope'),
		expected: undefined,
	},
	{
		label: 'set then get round-trips a snapshot with a timeout',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 5000 })
			return store.get('shell')
		},
		expected: { id: 'shell', timeout: 5000 },
	},
	{
		label: 'set then get round-trips a snapshot WITHOUT a timeout (optional field absent)',
		act: async (store) => {
			await store.set({ id: 'plain' })
			return store.get('plain')
		},
		expected: { id: 'plain' },
	},
	{
		label: 'a second set under the SAME id upserts (replaces) rather than duplicating',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 1000 })
			await store.set({ id: 'shell', timeout: 9000 })
			return store.get('shell')
		},
		expected: { id: 'shell', timeout: 9000 },
	},
	{
		label: 'delete drops a stored snapshot; a subsequent get misses',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 5000 })
			await store.delete('shell')
			return store.get('shell')
		},
		expected: undefined,
	},
	{
		label: 'delete of an absent id is a no-op (no throw)',
		act: (store) => store.delete('never-existed'),
		expected: undefined,
	},
	{
		label: 'two distinct ids coexist independently',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 1000 })
			await store.set({ id: 'bash', timeout: 2000 })
			return [await store.get('shell'), await store.get('bash')]
		},
		expected: [
			{ id: 'shell', timeout: 1000 },
			{ id: 'bash', timeout: 2000 },
		],
	},
])
