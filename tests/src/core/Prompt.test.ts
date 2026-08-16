import { createManualTimer, recordEmitterEvents } from '../../setup.js'
import { createPrompt, isTerminalError } from '@src/core'
import { createForm, isFormError } from '@orkestrel/form'
import { captureError, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('Prompt', () => {
	it('parks a live form and emits its serialized schema with attribution', () => {
		const prompt = createPrompt()
		const recorded = recordEmitterEvents(prompt.emitter, ['pending'])
		const form = createForm({
			name: 'profile',
			fields: [
				{
					control: 'text',
					name: 'name',
					rule: { custom: (value) => (value === 'Ada' ? true : 'Use Ada') },
				},
			],
		})

		const id = prompt.park(form, { from: 'user', to: 'agent' })
		const pending = prompt.pending(id)

		expect(pending).toEqual({
			id,
			schema: { name: 'profile', fields: [{ control: 'text', name: 'name' }] },
			status: 'pending',
			time: expect.any(Number),
			from: 'user',
			to: 'agent',
		})
		expect(recorded.pending.calls).toEqual([[pending]])
		expect(prompt.count).toBe(1)
		void form.answer.catch(() => undefined)
		prompt.destroy()
	})

	it('fills, submits, emits, and resolves the authoritative form on acceptance', async () => {
		const prompt = createPrompt()
		const events = recordEmitterEvents(prompt.emitter, ['answer'])
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const id = prompt.park(form)

		expect(prompt.answer(id, { name: 'Ada' })).toEqual({
			success: true,
			value: { name: 'Ada' },
		})
		expect(await form.answer).toEqual({ name: 'Ada' })
		expect(events.answer.calls).toEqual([[id, { name: 'Ada' }]])
		expect(prompt.pending(id)).toBeUndefined()
		expect(prompt.count).toBe(0)
	})

	it('returns the authoritative custom FieldError exactly and leaves the form pending', () => {
		const prompt = createPrompt()
		const form = createForm({
			fields: [
				{
					control: 'text',
					name: 'word',
					rule: { custom: (value) => (value === 'yes' ? true : 'Say yes') },
				},
			],
		})
		const id = prompt.park(form)

		expect(prompt.answer(id, { word: 'no' })).toEqual({
			success: false,
			error: { reason: 'rejected', errors: [{ field: 'word', message: 'Say yes' }] },
		})
		expect(prompt.pending(id)?.status).toBe('pending')
		expect(form.status).toBe('editing')
		void form.answer.catch(() => undefined)
		prompt.destroy()
	})

	it('returns named-rule FieldErrors exactly', () => {
		const prompt = createPrompt()
		const form = createForm({
			fields: [{ control: 'text', name: 'name', rule: { required: true } }],
		})
		const id = prompt.park(form)

		expect(prompt.answer(id, {})).toEqual({
			success: false,
			error: {
				reason: 'rejected',
				errors: [{ field: 'name', message: 'This field is required', rule: 'required' }],
			},
		})
		void form.answer.catch(() => undefined)
		prompt.destroy()
	})

	it('converts a control refusal into an exact rejected FieldError', () => {
		const prompt = createPrompt()
		const form = createForm({ fields: [{ control: 'number', name: 'age' }] })
		const id = prompt.park(form)

		expect(prompt.answer(id, { age: 'old' })).toEqual({
			success: false,
			error: {
				reason: 'rejected',
				errors: [{ field: 'age', message: 'The number field "age" cannot hold that value' }],
			},
		})
		void form.answer.catch(() => undefined)
		prompt.destroy()
	})

	it('returns unknown for an absent id and for a settled ticket', () => {
		const prompt = createPrompt()
		const form = createForm({ fields: [{ control: 'confirm', name: 'ready' }] })
		const id = prompt.park(form)

		expect(prompt.answer('missing', {})).toEqual({
			success: false,
			error: { reason: 'unknown' },
		})
		expect(prompt.answer(id, { ready: true }).success).toBe(true)
		expect(prompt.answer(id, { ready: false })).toEqual({
			success: false,
			error: { reason: 'unknown' },
		})
	})

	it('expires through the injected timer and rejects the caller with Form ABANDONED', async () => {
		const timer = createManualTimer()
		const prompt = createPrompt({ timer: timer.handler, timeout: 20 })
		const events = recordEmitterEvents(prompt.emitter, ['expire'])
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const answer = form.answer.catch((error: unknown) => error)
		const id = prompt.park(form)

		expect(timer.pending).toBe(1)
		timer.flush()
		const error = await answer
		expect(isFormError(error) && error.code).toBe('ABANDONED')
		expect(form.status).toBe('abandoned')
		expect(events.expire.calls).toEqual([[id]])
		expect(prompt.pending(id)).toBeUndefined()
	})

	it('cancels the expiry deadline after acceptance', () => {
		const timer = createManualTimer()
		const prompt = createPrompt({ timer: timer.handler })
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const id = prompt.park(form)
		prompt.answer(id, { name: 'Ada' })

		expect(timer.pending).toBe(0)
		timer.flush()
		expect(form.status).toBe('settled')
	})

	it('refuses a park at cap without a ticket and abandons the refused form', async () => {
		const timer = createManualTimer()
		const prompt = createPrompt({ cap: 1, timer: timer.handler })
		const held = createForm({ fields: [{ control: 'text', name: 'held' }] })
		const refused = createForm({ fields: [{ control: 'text', name: 'refused' }] })
		void held.answer.catch(() => undefined)
		const refusal = refused.answer.catch((error: unknown) => error)
		prompt.park(held)

		const thrown = captureError(() => prompt.park(refused))

		expect(isTerminalError(thrown) && thrown.code).toBe('LIMIT')
		expect(isFormError(await refusal) && refused.status).toBe('abandoned')
		expect(prompt.count).toBe(1)
		expect(timer.pending).toBe(1)
		prompt.destroy()
	})

	it('destroy abandons every parked form, cancels timers, and is idempotent', async () => {
		const timer = createManualTimer()
		const prompt = createPrompt({ timer: timer.handler })
		const forms = ['a', 'b'].map((name) => createForm({ fields: [{ control: 'text', name }] }))
		const answers = forms.map((form) => form.answer.catch((error: unknown) => error))
		for (const form of forms) prompt.park(form)

		prompt.destroy()
		prompt.destroy()

		expect(timer.pending).toBe(0)
		expect(prompt.count).toBe(0)
		for (const error of await Promise.all(answers)) {
			expect(isFormError(error) && error.code).toBe('ABANDONED')
		}
	})

	it('destroys and refuses a form parked after broker teardown', async () => {
		const prompt = createPrompt()
		prompt.destroy()
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const answer = form.answer.catch((error: unknown) => error)

		expect(() => prompt.park(form)).toThrow(/destroyed/)
		expect(isFormError(await answer) && form.status).toBe('abandoned')
	})

	it('preserves insertion order in pending accessors', () => {
		const prompt = createPrompt()
		const forms = ['first', 'second'].map((name) =>
			createForm({ fields: [{ control: 'text', name }] }),
		)
		for (const form of forms) {
			void form.answer.catch(() => undefined)
			prompt.park(form)
		}

		expect(requireValue(prompt.pending()[0], 'Missing first pending form').schema).toEqual({
			fields: [{ control: 'text', name: 'first' }],
		})
		expect(requireValue(prompt.pending()[1], 'Missing second pending form').schema).toEqual({
			fields: [{ control: 'text', name: 'second' }],
		})
		prompt.destroy()
	})
})
