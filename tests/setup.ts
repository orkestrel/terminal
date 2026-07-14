// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`.

import type { TimerCancel, TimerHandler } from '@src/core'
import type { EmitterInterface, EventMap } from '@orkestrel/emitter'

/**
 * Resolve after `ms` milliseconds — the single shared delay helper (AGENTS §16.1),
 * for letting a real short timer (the `PromptClient` reconnect backoff) elapse instead
 * of inlining a `setTimeout` promise per test.
 *
 * @param ms - Milliseconds to wait; defaults to `0` (a macrotask turn)
 * @returns A promise that resolves once the delay elapses
 */
export function waitForDelay(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Recorder — a real callback with recorded calls, not a mock ─────────────────
// Use instead of a test-framework spy when the test only needs to count calls or
// inspect arguments (AGENTS §16.1).

/** A real call-recording callback over an argument tuple (AGENTS §16.1). */
export interface TestRecorderInterface<TArgs extends readonly unknown[]> {
	readonly calls: readonly TArgs[]
	readonly count: number
	readonly handler: (...args: TArgs) => void
	clear(): void
}

/**
 * Create a {@link TestRecorderInterface} — a real callback that records each
 * invocation's arguments, for asserting what fired and with what (AGENTS §16.1).
 *
 * @typeParam TArgs - The argument tuple the recorded handler receives
 * @returns A recorder whose `handler` records into `calls`
 */
export function createRecorder<TArgs extends readonly unknown[]>(): TestRecorderInterface<TArgs> {
	const calls: TArgs[] = []
	return {
		get calls() {
			return calls
		},
		get count() {
			return calls.length
		},
		handler(...args: TArgs) {
			calls.push(args)
		},
		clear() {
			calls.length = 0
		},
	}
}

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: TestRecorderInterface<TMap[K]>
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
	let armed: { readonly callback: () => void; cancelled: boolean }[] = []
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
	events: readonly { readonly event: string; readonly data: unknown }[],
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
