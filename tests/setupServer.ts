// Node-only shared test infrastructure for the server project. Assertions stay in test files.

import type { InputStreamInterface } from '@src/server'
import type { RecorderInterface } from '@orkestrel/test'
import type { StreamTargetInterface } from '@orkestrel/console/server'
import { strip } from '@orkestrel/console'
import { createRecorder } from '@orkestrel/test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/** A recording output stream. */
export interface StreamTargetResult {
	readonly target: StreamTargetInterface
	readonly writes: RecorderInterface<readonly [text: string]>
}

/** Create an injected output stream that records every written byte. */
export function createStreamTarget(options?: { readonly isTTY?: boolean }): StreamTargetResult {
	const writes = createRecorder<readonly [text: string]>()
	const target: StreamTargetInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? false,
	}
	return { target, writes }
}

/** A recording TTY backed by a real EventEmitter. */
export interface FakeTTYInterface {
	readonly input: InputStreamInterface
	readonly output: StreamTargetInterface
	readonly writes: RecorderInterface<readonly [text: string]>
	readonly raw: boolean
	readonly enters: number
	readonly exits: number
	push(chunk: string | Uint8Array): void
	text(): string
	listeners(): number
}

/** Configures a recording TTY. */
export interface FakeTTYOptions {
	readonly isTTY?: boolean
	readonly scripts?: ReadonlyArray<ReadonlyArray<string | Uint8Array>>
}

/**
 * Creates a recording TTY. It is manually pushed by default; supplying `scripts` makes each listener
 * registration draw the next script and replay it off the host queue.
 */
export function createFakeTTY(options?: FakeTTYOptions): FakeTTYInterface {
	const emitter = new EventEmitter()
	const writes = createRecorder<readonly [text: string]>()
	const scripts = options?.scripts
	let raw = false
	let enters = 0
	let exits = 0
	let index = 0
	const input: InputStreamInterface = {
		on(event, listener) {
			emitter.on(event, listener)
			if (scripts === undefined) return
			const script = scripts[index] ?? []
			index += 1
			queueMicrotask(() => {
				for (const chunk of script) emitter.emit('data', chunk)
			})
		},
		off(event, listener) {
			emitter.off(event, listener)
		},
		setRawMode(mode: boolean) {
			if (mode && !raw) enters += 1
			if (!mode && raw) exits += 1
			raw = mode
		},
		resume() {},
		pause() {},
		isTTY: options?.isTTY ?? true,
	}
	const output: StreamTargetInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? true,
	}
	return {
		input,
		output,
		writes,
		push: (chunk) => emitter.emit('data', chunk),
		text: () => strip(writes.calls.map(([text]) => text).join('')),
		get raw() {
			return raw
		},
		get enters() {
			return enters
		},
		get exits() {
			return exits
		},
		listeners: () => emitter.listenerCount('data'),
	}
}

/** Create an ended readable stream containing scripted lines. */
export function createLineInput(lines: readonly string[], finalNewline = true): PassThrough {
	const input = new PassThrough()
	const text = lines.join('\n')
	input.end(finalNewline && text.length > 0 ? `${text}\n` : text)
	return input
}

/** Concatenate all raw output bytes. */
export function rawOutput(tty: FakeTTYInterface): string {
	return tty.writes.calls.map(([text]) => text).join('')
}
