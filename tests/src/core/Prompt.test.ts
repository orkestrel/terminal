import type { PendingPrompt, PromptInterface } from '@src/core'
import { createPrompt, isTerminalError } from '@src/core'
import { createManualTimer, createRecorder, recordEmitterEvents } from '../../setup.js'
import { describe, expect, it } from 'vitest'

// The headless prompt BROKER, driven deterministically: every prompt is PARKED as a Promise that
// `answer()` resolves (after validation + a per-form type check) or an INJECTED timer expires
// (rejecting with a TerminalError). The manual timer makes expiry hermetic — no real time — and a
// recorder bundle asserts the §13 events (pending / answer / expire). No network, no terminal.

// A broker whose expiry is driven by a manual timer — return the broker plus the timer so a test
// fires expiry on demand.
function broker(timeout = 1000): {
	readonly prompt: PromptInterface
	readonly timer: ReturnType<typeof createManualTimer>
} {
	const timer = createManualTimer()
	const prompt = createPrompt({ timeout, timer: timer.handler })
	return { prompt, timer }
}

describe('Prompt — park as a Promise', () => {
	it('parks each call and resolves it on a validated answer', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'Name?' })

		// The call parked exactly one pending prompt, addressable by id.
		expect(prompt.count).toBe(1)
		const [parked] = prompt.pending()
		expect(parked.form).toBe('input')
		expect(parked.message).toBe('Name?')
		expect(parked.status).toBe('pending')
		expect(prompt.pending(parked.id)?.id).toBe(parked.id)

		// Answering resolves the awaited Promise with the value, and the prompt is gone.
		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		expect(await answer).toBe('Ada')
		expect(prompt.count).toBe(0)
		expect(prompt.pending(parked.id)).toBeUndefined()
	})

	it('resolves confirm to a boolean and checkbox to a string array', async () => {
		const { prompt } = broker()
		const confirmed = prompt.confirm({ message: 'OK?' })
		const checked = prompt.checkbox({ message: 'Pick', choices: ['a', 'b', 'c'] })
		const [confirm, checkbox] = prompt.pending()

		expect(prompt.answer(confirm.id, true)).toEqual({ success: true, value: true })
		expect(prompt.answer(checkbox.id, ['a', 'c'])).toEqual({ success: true, value: ['a', 'c'] })
		expect(await confirmed).toBe(true)
		expect(await checked).toEqual(['a', 'c'])
	})

	it('mints a distinct id per parked prompt', () => {
		const { prompt } = broker()
		void prompt.input({ message: 'one' })
		void prompt.input({ message: 'two' })
		const ids = prompt.pending().map((parked) => parked.id)
		expect(new Set(ids).size).toBe(2)
	})
})

describe('Prompt — answer validation + type check', () => {
	it('rejects an answer that fails the resolved validator (stays pending)', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'Name?', validate: { required: true, minimum: 2 } })
		const [parked] = prompt.pending()

		// An empty answer fails `required`; a too-short answer fails `minimum` — both rejected.
		expect(prompt.answer(parked.id, '')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(parked.id, 'a')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.count).toBe(1)
		expect(prompt.pending(parked.id)?.status).toBe('pending')

		// A valid answer is accepted and resolves the Promise.
		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		expect(await answer).toBe('Ada')
	})

	it('rejects an answer of the wrong type for the form', () => {
		const { prompt } = broker()
		void prompt.confirm({ message: 'OK?' })
		void prompt.checkbox({ message: 'Pick', choices: ['a'] })
		const [confirm, checkbox] = prompt.pending()

		// confirm wants a boolean; checkbox wants a string[] — a mismatched type is refused.
		expect(prompt.answer(confirm.id, 'yes')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(checkbox.id, 'a')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(checkbox.id, [1, 2])).toEqual({ success: false, error: 'rejected' })
		expect(prompt.count).toBe(2)
	})

	it('returns unknown for an unknown id', () => {
		const { prompt } = broker()
		expect(prompt.answer('missing', 'x')).toEqual({ success: false, error: 'unknown' })
	})

	it('accepts a legitimate false confirm answer (false is a value, not a rejection)', async () => {
		const { prompt } = broker()
		const confirmed = prompt.confirm({ message: 'OK?' })
		const [parked] = prompt.pending()

		// `false` is the answered VALUE, distinct from the gate's `undefined` rejection — so the answer
		// is ACCEPTED and the awaited Promise resolves to `false`, not rejected/left pending.
		expect(prompt.answer(parked.id, false)).toEqual({ success: true, value: false })
		expect(await confirmed).toBe(false)
		expect(prompt.count).toBe(0)
	})
})

describe('Prompt — timeout → expire → reject', () => {
	it('expires an unanswered prompt: emits expire and rejects with a TerminalError', async () => {
		const { prompt, timer } = broker()
		const events = recordEmitterEvents(prompt.emitter, ['pending', 'answer', 'expire'])
		const answer = prompt.input({ message: 'Name?' })
		const [parked] = prompt.pending()
		expect(timer.pending).toBe(1) // a deadline is armed

		// Fire the injected timer — the prompt expires and its Promise rejects.
		timer.flush()
		await expect(answer).rejects.toSatisfy(
			(error: unknown) => isTerminalError(error) && error.code === 'EXPIRE',
		)
		expect(prompt.count).toBe(0)
		expect(events.expire.calls).toEqual([[parked.id]])
		expect(events.answer.count).toBe(0)
	})

	it('cancels the deadline once answered (no later expire)', async () => {
		const { prompt, timer } = broker()
		const events = recordEmitterEvents(prompt.emitter, ['pending', 'answer', 'expire'])
		const answer = prompt.input({ message: 'Name?' })
		const [parked] = prompt.pending()

		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		expect(await answer).toBe('Ada')
		// The answered prompt's timer was cancelled — flushing fires nothing.
		expect(timer.pending).toBe(0)
		timer.flush()
		expect(events.expire.count).toBe(0)
		expect(events.answer.calls).toEqual([[parked.id, 'Ada']])
	})
})

describe('Prompt — events', () => {
	it('emits pending with the wire-safe record on park', () => {
		const { prompt } = broker()
		const pending = createRecorder<readonly [PendingPrompt]>()
		prompt.emitter.on('pending', pending.handler)
		void prompt.input({ message: 'Name?', default: 'Ada' })

		expect(pending.count).toBe(1)
		const [record] = pending.calls[0]
		expect(record.form).toBe('input')
		// The options are serialized — declarative data kept (message + default), styler / functions dropped.
		expect(record.options).toEqual({ message: 'Name?', default: 'Ada' })
	})
})

describe('Prompt — destroy', () => {
	it('expires every still-pending prompt and destroys the emitter', async () => {
		const { prompt } = broker()
		const events = recordEmitterEvents(prompt.emitter, ['pending', 'answer', 'expire'])
		const first = prompt.input({ message: 'one' })
		const second = prompt.input({ message: 'two' })
		const ids = prompt.pending().map((parked) => parked.id)

		prompt.destroy()
		await expect(first).rejects.toSatisfy(isTerminalError)
		await expect(second).rejects.toSatisfy(isTerminalError)
		expect(prompt.count).toBe(0)
		expect(events.expire.calls.map(([id]) => id).sort()).toEqual([...ids].sort())
		expect(prompt.emitter.destroyed).toBe(true)
	})

	it('rejects a new call after destroy', async () => {
		const { prompt } = broker()
		prompt.destroy()
		await expect(prompt.input({ message: 'x' })).rejects.toSatisfy(isTerminalError)
	})
})

// ============================================================================
// HARDENING — broker edge coverage: answer-state machine totality, accessor
// totality, timer cleanup, wire-safe serialization, validate-on-answer per form.
// ============================================================================

describe('Prompt — answer state machine (totality)', () => {
	it('answering an ALREADY-answered id returns unknown (the prompt is gone)', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'Name?' })
		const [parked] = prompt.pending()

		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		expect(await answer).toBe('Ada')
		// A second answer for the same id finds nothing — unknown, and no double-resolve.
		expect(prompt.answer(parked.id, 'Grace')).toEqual({ success: false, error: 'unknown' })
		expect(prompt.count).toBe(0)
	})

	it('answering an EXPIRED id returns unknown (expiry removed it)', async () => {
		const { prompt, timer } = broker()
		const answer = prompt.input({ message: 'Name?' })
		const [parked] = prompt.pending()

		timer.flush() // expire it
		await expect(answer).rejects.toSatisfy(isTerminalError)
		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: false, error: 'unknown' }) // already expired + removed
	})

	it('a rejected answer leaves the prompt addressable and re-answerable', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'Name?', validate: { minimum: 3 } })
		const [parked] = prompt.pending()

		expect(prompt.answer(parked.id, 'ab')).toEqual({ success: false, error: 'rejected' }) // too short
		expect(prompt.pending(parked.id)?.status).toBe('pending') // still pending, not corrupted
		expect(prompt.answer(parked.id, 'abc')).toEqual({ success: true, value: 'abc' })
		expect(await answer).toBe('abc')
	})

	it('validate-on-answer runs the resolved validator for password AND editor forms', async () => {
		const { prompt } = broker()
		const pw = prompt.password({ message: 'PIN', validate: { minimum: 4 } })
		const ed = prompt.editor({ message: 'Body', validate: { required: true } })
		const [password, editor] = prompt.pending()

		expect(prompt.answer(password.id, 'ab')).toEqual({ success: false, error: 'rejected' }) // fails minimum
		expect(prompt.answer(editor.id, '   ')).toEqual({ success: false, error: 'rejected' }) // fails required (whitespace)
		expect(prompt.answer(password.id, 'hunter')).toEqual({ success: true, value: 'hunter' })
		expect(prompt.answer(editor.id, 'real text')).toEqual({ success: true, value: 'real text' })
		expect(await pw).toBe('hunter')
		expect(await ed).toBe('real text')
	})

	it('select rejects a value outside its choices; checkbox requires a string[] (a non-string element rejects)', async () => {
		const { prompt } = broker()
		const selected = prompt.select({ message: 'Pick', choices: ['a', 'b'] })
		const checked = prompt.checkbox({ message: 'Pick', choices: ['a', 'b'] })
		const [select, checkbox] = prompt.pending()

		// select gates on choice membership — an offered value is accepted, an unoffered one is not.
		expect(prompt.answer(select.id, 'anything')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(select.id, 'a')).toEqual({ success: true, value: 'a' })
		// checkbox rejects a non-array and an array with a non-string element.
		expect(prompt.answer(checkbox.id, 'a')).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(checkbox.id, ['a', 2])).toEqual({ success: false, error: 'rejected' })
		expect(prompt.answer(checkbox.id, [])).toEqual({ success: true, value: [] }) // empty string[] is valid
		expect(await selected).toBe('a')
		expect(await checked).toEqual([])
	})
})

describe('Prompt — choice gates (select membership, checkbox min/max/membership) — T4', () => {
	it('select rejects a value not in the offered choices, and accepts a valid member', async () => {
		const { prompt } = broker()
		const selected = prompt.select({ message: 'Pick', choices: ['a', 'b', 'c'] })
		const [select] = prompt.pending()

		expect(prompt.answer(select.id, 'z')).toEqual({ success: false, error: 'rejected' }) // not offered
		expect(prompt.pending(select.id)?.status).toBe('pending')
		expect(prompt.answer(select.id, 'b')).toEqual({ success: true, value: 'b' }) // valid member
		expect(await selected).toBe('b')
	})

	it('checkbox rejects a count below min, above max, or containing a non-offered value', async () => {
		const { prompt } = broker()
		const checked = prompt.checkbox({
			message: 'Pick',
			choices: ['a', 'b', 'c', 'd'],
			min: 2,
			max: 3,
		})
		const [checkbox] = prompt.pending()

		expect(prompt.answer(checkbox.id, ['a'])).toEqual({ success: false, error: 'rejected' }) // below min
		expect(prompt.answer(checkbox.id, ['a', 'b', 'c', 'd'])).toEqual({
			success: false,
			error: 'rejected',
		}) // above max
		expect(prompt.answer(checkbox.id, ['a', 'z'])).toEqual({ success: false, error: 'rejected' }) // non-offered value
		expect(prompt.pending(checkbox.id)?.status).toBe('pending') // still parked, none accepted

		// A valid in-range member-only checkbox is accepted.
		expect(prompt.answer(checkbox.id, ['a', 'b'])).toEqual({ success: true, value: ['a', 'b'] })
		expect(await checked).toEqual(['a', 'b'])
	})
})

describe('Prompt — accessors (§9.1) totality', () => {
	it('pending() lists all parked; pending(unknown) is undefined; count tracks the map', () => {
		const { prompt } = broker()
		expect(prompt.count).toBe(0)
		expect(prompt.pending()).toEqual([])
		expect(prompt.pending('nope')).toBeUndefined()

		void prompt.input({ message: 'one' })
		void prompt.input({ message: 'two' })
		expect(prompt.count).toBe(2)
		expect(prompt.pending()).toHaveLength(2)
		expect(prompt.pending('still-unknown')).toBeUndefined()
	})

	it('pending() returns wire-safe records — the styler / functions are stripped from options', () => {
		const { prompt } = broker()
		void prompt.input({
			message: 'Name?',
			default: 'Ada',
			validate: { required: true, custom: () => true },
		})
		const [parked] = prompt.pending()
		// Only declarative data survives; the custom function rule flattened to `true`.
		expect(parked.options).toEqual({
			message: 'Name?',
			default: 'Ada',
			validate: { required: true, custom: true },
		})
		expect('styler' in parked.options).toBe(false)
	})

	it('a bare-function validate is dropped from the parked record (no wire form)', () => {
		const { prompt } = broker()
		void prompt.input({ message: 'Name?', validate: (input) => (input ? true : 'x') })
		const [parked] = prompt.pending()
		expect(parked.options).toEqual({ message: 'Name?' })
		expect('validate' in parked.options).toBe(false)
	})
})

describe('Prompt — timer cleanup & idempotent destroy', () => {
	it('destroy() cancels every armed deadline (no leaked timers)', async () => {
		const { prompt, timer } = broker()
		// destroy() rejects each parked Promise — capture them so the rejections are observed
		// (an un-awaited reject would surface as an unhandled rejection).
		const first = prompt.input({ message: 'one' })
		const second = prompt.input({ message: 'two' })
		expect(timer.pending).toBe(2)

		prompt.destroy()
		expect(timer.pending).toBe(0) // both deadlines cancelled
		// Flushing after destroy fires nothing (no double-expire).
		timer.flush()
		expect(prompt.count).toBe(0)
		await expect(first).rejects.toSatisfy(isTerminalError)
		await expect(second).rejects.toSatisfy(isTerminalError)
	})

	it('destroy() is idempotent — a second call is a no-op', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'x' })
		expect(() => {
			prompt.destroy()
			prompt.destroy() // must not throw / re-emit
		}).not.toThrow()
		await expect(answer).rejects.toSatisfy(isTerminalError)
		expect(prompt.emitter.destroyed).toBe(true)
	})

	it('an answered prompt drops out of pending() while others remain', async () => {
		const { prompt } = broker()
		const first = prompt.input({ message: 'one' })
		void prompt.input({ message: 'two' })
		const [a, b] = prompt.pending()

		expect(prompt.answer(a.id, 'A')).toEqual({ success: true, value: 'A' })
		expect(await first).toBe('A')
		const remaining = prompt.pending()
		expect(remaining).toHaveLength(1)
		expect(remaining[0].id).toBe(b.id)
	})
})

// ============================================================================
// T2 — park() as the general entry point, and AnswerResult totality.
// ============================================================================

describe('Prompt — park() general entry point', () => {
	it('returns a Ticket whose id is listed in pending() and whose value resolves on answer', async () => {
		const { prompt } = broker()
		const ticket = prompt.park({ form: 'input', options: { message: 'Name?' } })

		expect(prompt.count).toBe(1)
		const parked = prompt.pending(ticket.id)
		expect(parked?.id).toBe(ticket.id)
		expect(parked?.form).toBe('input')
		expect(parked?.from).toBeUndefined()
		expect(parked?.to).toBeUndefined()

		expect(prompt.answer(ticket.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		expect(await ticket.value).toBe('Ada')
	})

	it('stamps from/to on the pending record when the request carries them', () => {
		const { prompt } = broker()
		const ticket = prompt.park({
			form: 'confirm',
			options: { message: 'OK?' },
			from: 'agent',
			to: 'human',
		})
		const parked = prompt.pending(ticket.id)
		expect(parked?.from).toBe('agent')
		expect(parked?.to).toBe('human')
	})

	it('leaves from/to absent when the request omits them', () => {
		const { prompt } = broker()
		const ticket = prompt.park({ form: 'select', options: { message: 'Pick', choices: ['a'] } })
		const parked = prompt.pending(ticket.id)
		expect(parked && 'from' in parked).toBe(false)
		expect(parked && 'to' in parked).toBe(false)
	})

	it('parks each form correctly and its value resolves to the form-appropriate type', async () => {
		const { prompt } = broker()
		const checkboxTicket = prompt.park({
			form: 'checkbox',
			options: { message: 'Pick', choices: ['a', 'b'] },
		})
		expect(prompt.answer(checkboxTicket.id, ['a'])).toEqual({ success: true, value: ['a'] })
		expect(await checkboxTicket.value).toEqual(['a'])
	})

	it('rejects the value with an EXPIRE TerminalError on injected-timer expiry', async () => {
		const { prompt, timer } = broker()
		const ticket = prompt.park({ form: 'input', options: { message: 'Name?' } })
		timer.flush()
		await expect(ticket.value).rejects.toSatisfy(
			(error: unknown) => isTerminalError(error) && error.code === 'EXPIRE',
		)
		expect(prompt.count).toBe(0)
	})

	it('post-destroy park behaves like the form methods: a fresh id, pre-rejected EXPIRE value', async () => {
		const { prompt } = broker()
		prompt.destroy()
		const ticket = prompt.park({ form: 'input', options: { message: 'x' } })
		expect(typeof ticket.id).toBe('string')
		expect(ticket.id.length).toBeGreaterThan(0)
		await expect(ticket.value).rejects.toSatisfy(isTerminalError)
		expect(prompt.count).toBe(0)
	})
})

describe('Prompt — answer() AnswerResult totality', () => {
	it('unknown id returns { success: false, error: "unknown" }', () => {
		const { prompt } = broker()
		expect(prompt.answer('nope', 'x')).toEqual({ success: false, error: 'unknown' })
	})

	it('an already-answered id returns { success: false, error: "unknown" }', async () => {
		const { prompt } = broker()
		const answer = prompt.input({ message: 'Name?' })
		const [parked] = prompt.pending()
		expect(prompt.answer(parked.id, 'Ada')).toEqual({ success: true, value: 'Ada' })
		await answer
		expect(prompt.answer(parked.id, 'Grace')).toEqual({ success: false, error: 'unknown' })
	})

	it('a type-mismatched or failed-validation answer returns { success: false, error: "rejected" } and stays pending', () => {
		const { prompt } = broker()
		const confirm = prompt.confirm({ message: 'OK?' })
		void confirm
		const [parked] = prompt.pending()
		expect(prompt.answer(parked.id, 'not-a-boolean')).toEqual({
			success: false,
			error: 'rejected',
		})
		expect(prompt.pending(parked.id)?.status).toBe('pending')
	})

	it('an accepted answer returns { success: true, value } with the gate-coerced value', () => {
		const { prompt } = broker()
		const checked = prompt.checkbox({ message: 'Pick', choices: ['a', 'b'] })
		void checked
		const [parked] = prompt.pending()
		expect(prompt.answer(parked.id, ['a'])).toEqual({ success: true, value: ['a'] })
	})
})
