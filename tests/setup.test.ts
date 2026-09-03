// tests/setup.ts — the host-independent test infrastructure every project in this workspace loads.
// This proof covers the exported behavior the consuming suites depend on and nothing else: the
// injected timer's deferral and cancellation, the SSE and JSON response fixtures, the raw key
// fold, the recording terminal's boundary snapshot and its deferred hold, the schema fixtures'
// standing at the real form boundary, and the shared store matrix's shape. Every expectation is
// derived through a route the module cannot share — the real SSE parser, the real form parser and
// audit, the real console stripper, the real pending-form guard, and the host clock. Production
// behavior belongs to the suites that own it and is never re-proven here.

import type { TerminalStoreInterface } from '@src/core'
import { ACCEPT_EVENT_STREAM, CTRL_C, RETURN, isPendingForm } from '@src/core'
import { FIELD_CONTROLS, auditSchema, createForm, parseForm, serializeForm } from '@orkestrel/form'
import {
	TERMINAL_STORE_SCENARIOS,
	createFormSchema,
	createHostilePattern,
	createHostileSchema,
	createHostileText,
	createHostileWireSchema,
	createJSONResponse,
	createManualTimer,
	createPendingForm,
	createRecordingTerminal,
	createSSEResponse,
	createEveryControlSchema,
	feedReducer,
} from './setup.js'
import { createSSEParser } from '@orkestrel/sse'
import { CSI, strip } from '@orkestrel/console'
import { createRecorder, requireValue, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('createManualTimer', () => {
	it('holds every armed callback until flush while the host clock runs on', async () => {
		const timer = createManualTimer()
		const fired = createRecorder<readonly [label: string]>()
		timer.handler(() => fired.handler('first'), 1)
		timer.handler(() => fired.handler('second'), 1)

		expect(timer.pending).toBe(2)
		// The host clock is the route this timer replaces: a real deadline far past both arming
		// delays must still leave every callback parked.
		await waitForDelay(20)
		expect(fired.calls).toEqual([])

		timer.flush()
		expect(fired.calls).toEqual([['first'], ['second']])
		expect(timer.pending).toBe(0)

		timer.flush()
		expect(fired.calls).toEqual([['first'], ['second']])
	})

	it('drops a cancelled callback from pending and from the flush', () => {
		const timer = createManualTimer()
		const fired = createRecorder<readonly [label: string]>()
		const cancel = timer.handler(() => fired.handler('cancelled'), 1)
		timer.handler(() => fired.handler('armed'), 1)

		cancel()
		expect(timer.pending).toBe(1)
		cancel()
		expect(timer.pending).toBe(1)

		timer.flush()
		expect(fired.calls).toEqual([['armed']])
		expect(timer.pending).toBe(0)
	})
})

describe('createSSEResponse', () => {
	it('frames each event as the wire format the real SSE parser reads back', async () => {
		const events = [
			{ event: 'pending', data: { id: 'one', status: 'pending' } },
			{ event: 'expire', data: { id: 'one' } },
			{ event: 'destroy', data: '' },
		]
		const response = createSSEResponse(events)
		expect(response.headers.get('Content-Type')).toBe(ACCEPT_EVENT_STREAM)

		// A finite stream: reading it to the end resolves rather than hanging.
		const parser = createSSEParser()
		const parsed = parser.parse(await response.text())

		expect(parsed.map((one) => one.event)).toEqual(['pending', 'expire', 'destroy'])
		expect(parsed.map((one): unknown => JSON.parse(one.data))).toEqual(
			events.map((one) => one.data),
		)
		// Every event was terminated by its own blank line, so nothing is left in progress.
		expect(parser.flush()).toEqual([])
	})
})

describe('createJSONResponse', () => {
	it('carries the value as a JSON body under the default and an explicit status', async () => {
		const value = { id: 'one', values: { name: 'Ada' } }
		const accepted = createJSONResponse(value)
		expect(accepted.status).toBe(200)
		expect(accepted.ok).toBe(true)
		expect(accepted.headers.get('Content-Type')).toBe('application/json')
		const decoded: unknown = await accepted.json()
		expect(decoded).toEqual(value)

		const refused = createJSONResponse({ message: 'gone' }, 410)
		expect(refused.status).toBe(410)
		expect(refused.ok).toBe(false)
		const failure: unknown = await refused.json()
		expect(failure).toEqual({ message: 'gone' })
	})
})

describe('feedReducer', () => {
	it('returns an untouched active step when there are no keys', () => {
		const seed = ['seed']
		const step = feedReducer<string, readonly string[]>(
			() => {
				throw new Error('The reducer ran for an empty key list')
			},
			seed,
			[],
		)

		expect(step).toEqual({ state: seed, view: '', status: 'active' })
		expect(step.state).toBe(seed)
	})

	it('decodes each raw key and threads the state through the fold', () => {
		const step = feedReducer<string, ReadonlyArray<string | undefined>>(
			(state, key) => ({
				state: [...state, key.name],
				view: key.sequence,
				status: 'active',
			}),
			[],
			['A', `${CSI}A`, RETURN, CTRL_C],
		)

		// The reducer never sees a raw string: an arrow escape arrives decoded as `up`, and the
		// control bytes arrive under their names, which is what parseKey routing means here.
		expect(step.state).toEqual(['A', 'up', 'return', 'c'])
		// The last step is the one returned.
		expect(step.view).toBe(CTRL_C)
		expect(step.status).toBe('active')
	})
})

describe('createRecordingTerminal', () => {
	it('answers each form with the next scripted values and records the pre-answer snapshot', async () => {
		const terminal = createRecordingTerminal({ answers: [{ name: 'Ada' }, { name: 'Grace' }] })

		const first = createForm(createFormSchema())
		expect(await terminal.ask(first)).toEqual({ name: 'Ada' })
		expect(first.status).toBe('settled')
		expect(first.values).toEqual({ name: 'Ada' })

		const second = createForm(createFormSchema())
		expect(await terminal.ask(second)).toEqual({ name: 'Grace' })

		// The record is a snapshot taken at the interface boundary, not a live view of the form:
		// each entry still reports the unanswered form the terminal received.
		const [firstRecord] = requireValue(terminal.calls.calls[0], 'Missing first recorded form')
		expect(firstRecord.status).toBe('editing')
		expect(firstRecord.values).toEqual({})
		expect(firstRecord.schema).toEqual(createFormSchema())
		expect(firstRecord.errors.map((error) => error.field)).toEqual(['name'])
		expect(terminal.calls.count).toBe(2)
	})

	it('holds a deferred form live until release settles it', async () => {
		const terminal = createRecordingTerminal({ answers: [{ name: 'Ada' }], defer: true })
		const form = createForm(createFormSchema())

		const answer = terminal.ask(form)
		expect(terminal.active).toBe(form)
		expect(form.status).toBe('editing')
		// The host clock proves the promise is genuinely parked rather than merely unawaited.
		await waitForDelay(20)
		expect(form.status).toBe('editing')

		terminal.release()
		expect(await answer).toEqual({ name: 'Ada' })
		expect(form.status).toBe('settled')

		// A release against a settled form is inert.
		terminal.release({ name: 'Grace' })
		expect(form.values).toEqual({ name: 'Ada' })
	})

	it('throws when the form refuses the scripted answer', () => {
		const terminal = createRecordingTerminal()
		const form = createForm(createFormSchema())

		// The schema requires `name`, and an exhausted script answers with an empty record. The
		// refusal is raised where the scripted answer is written, before any promise is handed back.
		expect(() => terminal.ask(form)).toThrow('Scripted terminal answer was refused')
	})
})

describe('createEveryControlSchema', () => {
	it('covers every field control the form package declares, each under its own name', () => {
		const schema = createEveryControlSchema()
		const controls = schema.fields.map((field) => field.control)
		const names = schema.fields.map((field) => field.name)

		expect([...controls].sort()).toEqual([...FIELD_CONTROLS].sort())
		expect(new Set(names).size).toBe(names.length)
		expect(auditSchema(schema)).toEqual([])
	})
})

describe('createPendingForm', () => {
	it('builds an envelope the wire guard accepts, defaulting its id, status, time, and schema', () => {
		const envelope = createPendingForm()

		expect(isPendingForm(envelope)).toBe(true)
		expect(envelope.id).toBe('form-1')
		expect(envelope.status).toBe('pending')
		expect(envelope.time).toBe(1)
		expect('from' in envelope).toBe(false)
		expect('to' in envelope).toBe(false)
		// The payload is a real serialized schema, so the real parser recovers the default fixture.
		expect(parseForm(envelope.schema)).toEqual(createFormSchema())

		const routed = createPendingForm(createEveryControlSchema(), {
			id: 'routed',
			from: 'agent',
			to: 'shell',
		})
		expect(isPendingForm(routed)).toBe(true)
		expect(routed.id).toBe('routed')
		expect(routed.from).toBe('agent')
		expect(routed.to).toBe('shell')
		expect(parseForm(routed.schema)).toEqual(createEveryControlSchema())
	})
})

describe('createHostileText', () => {
	it('wraps the clean text in real ANSI, leaving its control bytes behind the stripper', () => {
		const hostile = createHostileText('Name')

		// The console stripper removes ANSI and nothing else, so what it leaves is exactly the
		// clean text plus the raw control bytes a display sanitizer still has to handle.
		expect(strip(hostile)).toBe('Name\u0000\t\n\r\u007f')
		expect(hostile).not.toBe(strip(hostile))
	})
})

describe('createHostilePattern', () => {
	it('surrounds regex source with a real OSC sequence and stays compilable', () => {
		const hostile = createHostilePattern('pattern')

		expect(new RegExp(hostile).source.includes('pattern')).toBe(true)
		expect(strip(hostile)).toBe('pattern\u0000\t\n\r\u007f')
		expect(hostile).not.toBe(strip(hostile))
	})
})

describe('createHostileSchema', () => {
	it('writes control bytes into every schema string a terminal can render', () => {
		const leaves: string[] = []
		JSON.parse(JSON.stringify(createHostileSchema()), (key: string, value: unknown) => {
			// `control` names a field's discriminant rather than a rendered string, so the form
			// package would refuse a hostile one and it is the single exempt position.
			if (typeof value === 'string' && key !== 'control') leaves.push(value)
			return value
		})

		expect(leaves.length).toBeGreaterThan(0)
		expect(
			leaves.filter(
				(leaf) =>
					![...leaf].some((character) => {
						const code = character.charCodeAt(0)
						return code < 32 || code === 127
					}),
			),
		).toEqual([])
	})
})

describe('createHostileWireSchema', () => {
	it('passes the form parse boundary the authored hostile schema is refused at', () => {
		// The authored fixture drives the direct sanitizers, so it deliberately keeps control bytes
		// inside format-constrained defaults the form package refuses.
		expect(auditSchema(createHostileSchema())).not.toEqual([])
		expect(parseForm(serializeForm(createHostileSchema()))).toBeUndefined()

		// The wire twin is what crosses a real transport, so it must survive the round trip whole.
		const wire = createHostileWireSchema()
		expect(auditSchema(wire)).toEqual([])
		expect(parseForm(serializeForm(wire))).toEqual(wire)
	})
})

describe('TERMINAL_STORE_SCENARIOS', () => {
	it('is a frozen table whose labels name each case exactly once', () => {
		// The consuming store suites spread this table through `it.each` under `$label`, so a
		// repeated or empty label collapses two cases into one test name.
		const labels = TERMINAL_STORE_SCENARIOS.map((scenario) => scenario.label)

		expect(Object.isFrozen(TERMINAL_STORE_SCENARIOS)).toBe(true)
		expect(new Set(labels).size).toBe(labels.length)
		expect(labels.filter((label) => label.length === 0)).toEqual([])
	})

	it('exercises every method of the store seam across its cases', async () => {
		// An inert stub that answers nothing and only records which methods the table reaches. The
		// values each case expects are the store contract, proven by the MemoryTerminalStore and
		// DatabaseTerminalStore suites that run this table against the real backends.
		const reached = new Set<string>()
		const store: TerminalStoreInterface = {
			async get() {
				reached.add('get')
				return undefined
			},
			async set() {
				reached.add('set')
			},
			async delete() {
				reached.add('delete')
			},
		}

		for (const scenario of TERMINAL_STORE_SCENARIOS) await scenario.act(store)

		expect([...reached].sort()).toEqual(['delete', 'get', 'set'])
	})
})
