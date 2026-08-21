// Host-independent shared test infrastructure. Keep Node and browser globals in their own setup
// modules. Assertions and test registration belong in test files, never here.

import type {
	PendingForm,
	PromptStep,
	TerminalInterface,
	TerminalStoreInterface,
	TimerCancel,
	TimerHandler,
} from '@src/core'
import type { FieldError, FormInterface, FormSchema, FormStatus, FormValues } from '@orkestrel/form'
import { parseKey } from '@src/core'
import { serializeForm } from '@orkestrel/form'
import { createRecorder } from '@orkestrel/test'

/** A manually driven timer used at broker and reconnect boundaries. */
export interface ManualTimerInterface {
	readonly handler: TimerHandler
	readonly pending: number
	flush(): void
}

/** Create an injected timer that fires only when the test calls `flush`. */
export function createManualTimer(): ManualTimerInterface {
	let timers: Array<{ readonly callback: () => void; cancelled: boolean }> = []
	return {
		handler(callback: () => void): TimerCancel {
			const timer = { callback, cancelled: false }
			timers.push(timer)
			return () => {
				timer.cancelled = true
			}
		},
		get pending() {
			return timers.filter((timer) => !timer.cancelled).length
		},
		flush() {
			const firing = timers
			timers = []
			for (const timer of firing) if (!timer.cancelled) timer.callback()
		},
	}
}

/** Build a finite protocol-faithful SSE response from inert event data. */
export function createSSEResponse(
	events: ReadonlyArray<{ readonly event: string; readonly data: unknown }>,
): Response {
	const encoder = new TextEncoder()
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const event of events) {
					controller.enqueue(
						encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`),
					)
				}
				controller.close()
			},
		}),
		{ headers: { 'Content-Type': 'text/event-stream' } },
	)
}

/** Build one JSON response from inert test data. */
export function createJSONResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

/** Fold raw key strings through a real reducer. */
export function feedReducer<TValue, TState>(
	reduce: (state: TState, key: ReturnType<typeof parseKey>) => PromptStep<TValue, TState>,
	state: TState,
	keys: readonly string[],
): PromptStep<TValue, TState> {
	let step: PromptStep<TValue, TState> = { state, view: '', status: 'active' }
	for (const key of keys) step = reduce(step.state, parseKey(key))
	return step
}

/** The immutable observation captured when a recording terminal receives a live form. */
export interface RecordedForm {
	readonly schema: FormSchema
	readonly values: FormValues
	readonly errors: readonly FieldError[]
	readonly status: FormStatus
}

/** Settings for a recording terminal. */
export interface RecordingTerminalOptions {
	readonly answers?: readonly FormValues[]
	readonly defer?: boolean
}

/**
 * A real TerminalInterface implementation for tests. It accepts scripted answers as inert data,
 * drives each supplied live form through its real fill and submit methods, and records the form at
 * the interface boundary. Deferred mode leaves the form live until `release` or external destroy.
 */
export class RecordingTerminal implements TerminalInterface {
	readonly calls = createRecorder<readonly [form: RecordedForm]>()
	readonly #answers: readonly FormValues[]
	readonly #defer: boolean
	#index = 0
	#active: FormInterface | undefined

	constructor(options: RecordingTerminalOptions = {}) {
		this.#answers = options.answers ?? []
		this.#defer = options.defer ?? false
	}

	get active(): FormInterface | undefined {
		return this.#active
	}

	ask(form: FormInterface): Promise<FormValues> {
		this.#active = form
		this.calls.handler({
			schema: form.schema,
			values: form.values,
			errors: form.errors,
			status: form.status,
		})
		if (!this.#defer) this.#answer(form, this.#answers[this.#index] ?? {})
		this.#index += 1
		return form.answer
	}

	release(values?: FormValues): void {
		const form = this.#active
		if (form === undefined || form.status !== 'editing') return
		this.#answer(form, values ?? this.#answers[this.#index - 1] ?? {})
	}

	#answer(form: FormInterface, values: FormValues): void {
		form.fill(values)
		const result = form.submit()
		if (!result.success)
			throw new Error(
				`Scripted terminal answer was refused: ${result.error[0]?.message ?? 'unknown'}`,
			)
	}
}

/** Build a recording TerminalInterface and expose its observations and release control. */
export function createRecordingTerminal(options: RecordingTerminalOptions = {}): RecordingTerminal {
	return new RecordingTerminal(options)
}

/** A compact valid schema used by broker and client fixtures. */
export function createFormSchema(): FormSchema {
	return {
		name: 'profile',
		label: 'Profile',
		fields: [{ control: 'text', name: 'name', label: 'Name', rule: { required: true } }],
	}
}

/** Build one form covering every supported field control. */
export function createTwelveControlSchema(): FormSchema {
	return {
		label: 'Registration',
		fields: [
			{ control: 'text', name: 'name', label: 'Name', rule: { required: true } },
			{ control: 'password', name: 'secret', label: 'Secret' },
			{ control: 'number', name: 'age', label: 'Age' },
			{ control: 'date', name: 'date', label: 'Date' },
			{ control: 'time', name: 'time', label: 'Time' },
			{ control: 'datetime', name: 'meeting', label: 'Meeting' },
			{ control: 'color', name: 'color', label: 'Color' },
			{ control: 'confirm', name: 'ready', label: 'Ready' },
			{
				control: 'select',
				name: 'role',
				label: 'Role',
				choices: [
					{ value: 'admin', label: 'Admin' },
					{ value: 'viewer', label: 'Viewer' },
				],
			},
			{
				control: 'checkbox',
				name: 'scope',
				label: 'Scope',
				choices: [
					{ value: 'read', label: 'Read' },
					{ value: 'write', label: 'Write' },
				],
			},
			{ control: 'file', name: 'files', label: 'Files', multiple: true },
			{ control: 'editor', name: 'notes', label: 'Notes' },
		],
	}
}

/** Build one valid pending-form envelope around a supplied schema. */
export function createPendingForm(
	schema: FormSchema = createFormSchema(),
	options?: { readonly id?: string; readonly from?: string; readonly to?: string },
): PendingForm {
	return {
		id: options?.id ?? 'form-1',
		schema: serializeForm(schema),
		status: 'pending',
		time: 1,
		...(options?.from !== undefined ? { from: options.from } : {}),
		...(options?.to !== undefined ? { to: options.to } : {}),
	}
}

/** Add ANSI, C0, whitespace controls, and DEL around one clean string. */
export function createHostileText(text: string): string {
	return `\u001b[31m${text}\u001b[0m\u0000\t\n\r\u007f`
}

/** Add a valid OSC ANSI sequence and C0 bytes around regex source without making it uncompilable. */
export function createHostilePattern(text: string): string {
	return `\u001b]0;title\u0007${text}\u0000\t\n\r\u007f`
}

/**
 * A valid schema with hostile bytes in every schema string position terminal can render or use to
 * relate rendered records. It covers all twelve controls and every control-specific string slot.
 */
export function createHostileSchema(): FormSchema {
	const hostile = createHostileText
	return {
		name: hostile('form'),
		label: hostile('Form'),
		help: hostile('Form help'),
		groups: [{ name: hostile('group'), label: hostile('Group'), help: hostile('Group help') }],
		fields: [
			{
				control: 'text',
				name: hostile('text'),
				label: hostile('Text'),
				help: hostile('Text help'),
				group: hostile('group'),
				default: hostile('seed'),
				placeholder: hostile('placeholder'),
				rule: { pattern: createHostilePattern('pattern') },
				meta: { hostile: hostile('metadata') },
			},
			{
				control: 'editor',
				name: hostile('editor'),
				label: hostile('Editor'),
				default: hostile('editor seed'),
				placeholder: hostile('editor placeholder'),
			},
			{
				control: 'password',
				name: hostile('password'),
				label: hostile('Password'),
				mask: hostile('*'),
			},
			{
				control: 'number',
				name: hostile('number'),
				label: hostile('Number'),
				placeholder: hostile('number placeholder'),
			},
			{
				control: 'date',
				name: hostile('date'),
				label: hostile('Date'),
				default: hostile('2026-08-15'),
				rule: { minimum: hostile('2026-01-01'), maximum: hostile('2026-12-31') },
			},
			{ control: 'time', name: hostile('time'), label: hostile('Time'), default: hostile('12:30') },
			{
				control: 'datetime',
				name: hostile('datetime'),
				label: hostile('Datetime'),
				default: hostile('2026-08-15T12:30'),
			},
			{
				control: 'color',
				name: hostile('color'),
				label: hostile('Color'),
				default: hostile('#112233'),
			},
			{ control: 'confirm', name: hostile('confirm'), label: hostile('Confirm') },
			{
				control: 'select',
				name: hostile('select'),
				label: hostile('Select'),
				choices: [{ value: hostile('one'), label: hostile('One'), help: hostile('One help') }],
				default: hostile('one'),
			},
			{
				control: 'checkbox',
				name: hostile('checkbox'),
				label: hostile('Checkbox'),
				choices: [{ value: hostile('two'), label: hostile('Two'), help: hostile('Two help') }],
				default: [hostile('two')],
			},
			{
				control: 'file',
				name: hostile('file'),
				label: hostile('File'),
				accept: [hostile('text/plain')],
			},
		],
	}
}

/**
 * The wire-valid hostile schema used end to end. Form intentionally refuses control bytes inside
 * format-constrained date, time, datetime, and color defaults, so those invalid authored values
 * remain in the direct sanitizer fixture above and are omitted at the parse boundary here.
 */
export function createHostileWireSchema(): FormSchema {
	const schema = createHostileSchema()
	return {
		...schema,
		fields: schema.fields.map((field) => {
			if (field.control === 'text') {
				return { ...field, default: createHostilePattern('pattern') }
			}
			if (field.control === 'date') {
				const { default: _default, rule: _rule, ...rest } = field
				return rest
			}
			if (field.control === 'time' || field.control === 'datetime' || field.control === 'color') {
				const { default: _default, ...rest } = field
				return rest
			}
			return field
		}),
	}
}

/** One shared store-contract case used by both store implementations. */
export interface TerminalStoreScenario {
	readonly label: string
	readonly act: (store: TerminalStoreInterface) => Promise<unknown>
	readonly expected: unknown
}

/** Shared point-store cases. */
export const TERMINAL_STORE_SCENARIOS: readonly TerminalStoreScenario[] = Object.freeze([
	{
		label: 'misses an absent id',
		act: (store) => store.get('missing'),
		expected: undefined,
	},
	{
		label: 'round-trips a snapshot',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 5000 })
			return store.get('shell')
		},
		expected: { id: 'shell', timeout: 5000 },
	},
	{
		label: 'round-trips a snapshot without a timeout',
		act: async (store) => {
			await store.set({ id: 'shell' })
			return store.get('shell')
		},
		expected: { id: 'shell' },
	},
	{
		label: 'upserts by the snapshot id',
		act: async (store) => {
			await store.set({ id: 'shell', timeout: 1000 })
			await store.set({ id: 'shell', timeout: 9000 })
			return store.get('shell')
		},
		expected: { id: 'shell', timeout: 9000 },
	},
	{
		label: 'deletes a stored snapshot',
		act: async (store) => {
			await store.set({ id: 'shell' })
			await store.delete('shell')
			return store.get('shell')
		},
		expected: undefined,
	},
	{
		label: 'ignores deletion of an absent id',
		act: async (store) => {
			await store.delete('missing')
			return store.get('missing')
		},
		expected: undefined,
	},
	{
		label: 'keeps distinct ids independent',
		act: async (store) => {
			await store.set({ id: 'a', timeout: 1 })
			await store.set({ id: 'b', timeout: 2 })
			return [await store.get('a'), await store.get('b')]
		},
		expected: [
			{ id: 'a', timeout: 1 },
			{ id: 'b', timeout: 2 },
		],
	},
])
