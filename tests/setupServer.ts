// Node-only shared test infrastructure for the server project. Assertions stay in test files.

import type { InputStreamInterface, OutputStreamInterface } from '@src/server'
import type { RecorderInterface } from '@orkestrel/test'
import { strip } from '@orkestrel/console'
import { createRecorder } from '@orkestrel/test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/** A recording output stream. */
export interface StreamTargetResult {
	readonly target: OutputStreamInterface
	readonly writes: RecorderInterface<readonly [text: string]>
}

/** Create an injected output stream that records every written byte. */
export function createStreamTarget(options?: { readonly isTTY?: boolean }): StreamTargetResult {
	const writes = createRecorder<readonly [text: string]>()
	const target: OutputStreamInterface = {
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
	readonly output: OutputStreamInterface
	readonly writes: RecorderInterface<readonly [text: string]>
	readonly raw: boolean
	readonly enters: number
	readonly exits: number
	push(chunk: string | Uint8Array): void
	text(): string
	listeners(): number
}

/** Create a manually pushed recording TTY. */
export function createFakeTTY(options?: { readonly isTTY?: boolean }): FakeTTYInterface {
	const emitter = new EventEmitter()
	const writes = createRecorder<readonly [text: string]>()
	let raw = false
	let enters = 0
	let exits = 0
	const input: InputStreamInterface = {
		on(event, listener) {
			emitter.on(event, listener)
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
	const output: OutputStreamInterface = {
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

/** Create a TTY that emits one scripted key sequence each time a field starts listening. */
export function createScriptedTTY(
	scripts: ReadonlyArray<ReadonlyArray<string | Uint8Array>>,
): FakeTTYInterface {
	const emitter = new EventEmitter()
	const writes = createRecorder<readonly [text: string]>()
	let raw = false
	let enters = 0
	let exits = 0
	let index = 0
	const input: InputStreamInterface = {
		on(event, listener) {
			emitter.on(event, listener)
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
		isTTY: true,
	}
	const output: OutputStreamInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: true,
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
