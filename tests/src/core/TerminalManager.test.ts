import type { TerminalManagerEventMap } from '@src/core'
import { createManualTimer } from '../../setup.js'
import { createMemoryTerminalStore, createTerminalManager, isTerminalError } from '@src/core'
import { createForm, isFormError } from '@orkestrel/form'
import { createRecorders, requireValue } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

function createTextForm(name = 'answer') {
	return createForm({ fields: [{ control: 'text', name }] })
}

describe('TerminalManager', () => {
	it('adds brokers idempotently and preserves insertion-order accessors', () => {
		const manager = createTerminalManager()
		const first = manager.add('a')
		expect(manager.add('a', { cap: 1 })).toBe(first)
		manager.add('b')
		expect(manager.count).toBe(2)
		expect(manager.terminals()).toEqual(['a', 'b'])
		expect(manager.terminal('missing')).toBeUndefined()
		manager.destroy()
	})

	it('asks with one whole form, attributes the PendingForm, and routes accepted values', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		const events = createRecorders<TerminalManagerEventMap, 'pending' | 'answer'>(manager.emitter, [
			'pending',
			'answer',
		])
		const form = createTextForm('name')
		const answer = manager.ask('user', 'agent', form)
		const pending = requireValue(manager.pending('agent')[0], 'Missing pending form for agent')

		expect(pending.from).toBe('user')
		expect(pending.to).toBe('agent')
		expect(events.pending.calls).toEqual([[pending]])
		expect(manager.answer('agent', pending.id, { name: 'Ada' })).toEqual({
			success: true,
			value: { name: 'Ada' },
		})
		expect(await answer).toEqual({ name: 'Ada' })
		expect(events.answer.calls).toEqual([['agent', pending.id, { name: 'Ada' }]])
		expect(manager.pending()).toEqual([])
		manager.destroy()
	})

	it('preserves TARGET with the known endpoint list', async () => {
		const manager = createTerminalManager()
		manager.add('known')
		const form = createTextForm()
		void form.answer.catch(() => undefined)

		const error = await manager.ask('user', 'missing', form).catch((reason: unknown) => reason)
		expect(isTerminalError(error) && error.code).toBe('TARGET')
		expect(isTerminalError(error) && error.context).toEqual({ to: 'missing', known: ['known'] })
		expect(form.status).toBe('editing')
		form.destroy()
		manager.destroy()
	})

	it('preserves direct and transitive DEADLOCK paths', async () => {
		const manager = createTerminalManager()
		for (const name of ['a', 'b', 'c']) manager.add(name)
		const ab = createTextForm('ab')
		const bc = createTextForm('bc')
		void ab.answer.catch(() => undefined)
		void bc.answer.catch(() => undefined)
		void manager.ask('a', 'b', ab)
		void manager.ask('b', 'c', bc)
		const closing = createTextForm('ca')
		void closing.answer.catch(() => undefined)

		const error = await manager.ask('c', 'a', closing).catch((reason: unknown) => reason)
		expect(isTerminalError(error) && error.code).toBe('DEADLOCK')
		expect(isTerminalError(error) && error.context?.path).toEqual(['c', 'a', 'b', 'c'])
		expect(closing.status).toBe('editing')
		closing.destroy()
		manager.destroy()
	})

	it('keeps an attribution edge on rejection and clears it on acceptance', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const held = createForm({
			fields: [
				{
					control: 'text',
					name: 'word',
					rule: { custom: (value) => (value === 'yes' ? true : 'Say yes') },
				},
			],
		})
		const settled = manager.ask('a', 'b', held)
		const id = requireValue(manager.pending('b')[0], 'Missing pending form for b').id

		expect(manager.answer('b', id, { word: 'no' }).success).toBe(false)
		const blocked = createTextForm('blocked')
		void blocked.answer.catch(() => undefined)
		const deadlock = await manager.ask('b', 'a', blocked).catch((reason: unknown) => reason)
		expect(isTerminalError(deadlock) && deadlock.code).toBe('DEADLOCK')
		blocked.destroy()

		expect(manager.answer('b', id, { word: 'yes' }).success).toBe(true)
		expect(await settled).toEqual({ word: 'yes' })
		const reverse = createTextForm('reverse')
		const reversed = manager.ask('b', 'a', reverse)
		const reverseId = requireValue(manager.pending('a')[0], 'Missing pending form for a').id
		manager.answer('a', reverseId, { reverse: 'ok' })
		expect(await reversed).toEqual({ reverse: 'ok' })
		manager.destroy()
	})

	it('clears the edge before expiry re-emission', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler })
		manager.add('a')
		manager.add('b')
		const held = createTextForm('held')
		const abandoned = manager.ask('a', 'b', held).catch((error: unknown) => error)
		const events = createRecorders<TerminalManagerEventMap, 'expire'>(manager.emitter, ['expire'])
		const id = requireValue(manager.pending('b')[0], 'Missing pending form for b').id

		timer.flush()
		expect(isFormError(await abandoned) && held.status).toBe('abandoned')
		expect(events.expire.calls).toEqual([['b', id]])
		const reverse = createTextForm('reverse')
		const answer = manager.ask('b', 'a', reverse)
		manager.answer('a', requireValue(manager.pending('a')[0], 'Missing pending form for a').id, {
			reverse: 'ok',
		})
		expect(await answer).toEqual({ reverse: 'ok' })
		manager.destroy()
	})

	it('clears edges and abandons asks when a target is removed', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const held = createTextForm('held')
		const abandoned = manager.ask('a', 'b', held).catch((error: unknown) => error)

		expect(manager.remove('b')).toBe(true)
		expect(isFormError(await abandoned) && held.status).toBe('abandoned')
		const reverse = createTextForm('reverse')
		const answer = manager.ask('b', 'a', reverse)
		manager.answer('a', requireValue(manager.pending('a')[0], 'Missing pending form for a').id, {
			reverse: 'ok',
		})
		expect(await answer).toEqual({ reverse: 'ok' })
		manager.destroy()
	})

	it('returns terminal, unknown, and rejected answer reasons without throwing', () => {
		const manager = createTerminalManager()
		manager.add('agent')
		expect(manager.answer('missing', 'id', {})).toEqual({
			success: false,
			error: { reason: 'terminal' },
		})
		expect(manager.answer('agent', 'missing', {})).toEqual({
			success: false,
			error: { reason: 'unknown' },
		})
		const form = createForm({
			fields: [{ control: 'text', name: 'name', rule: { required: true } }],
		})
		void form.answer.catch(() => undefined)
		void manager.ask('user', 'agent', form)
		const id = requireValue(manager.pending()[0], 'Missing pending form').id
		expect(manager.answer('agent', id, {})).toEqual({
			success: false,
			error: {
				reason: 'rejected',
				errors: [{ field: 'name', message: 'This field is required', rule: 'required' }],
			},
		})
		manager.destroy()
	})

	it('saves explicit endpoint config and opens an empty broker from the store', async () => {
		const store = createMemoryTerminalStore()
		const writer = createTerminalManager({ store, timeout: 99 })
		writer.add('agent', { timeout: 20 })
		expect(await writer.save('agent')).toBe(true)
		writer.destroy()

		const reader = createTerminalManager({ store })
		const opened = await reader.open('agent')
		expect(opened).toBe(reader.terminal('agent'))
		expect(opened?.pending()).toEqual([])
		expect(await reader.open('missing')).toBeUndefined()
		reader.destroy()
	})

	it('reports false when save has no store or no endpoint', async () => {
		const manager = createTerminalManager()
		expect(await manager.save('missing')).toBe(false)
		manager.add('agent')
		expect(await manager.save('agent')).toBe(false)
		manager.destroy()
	})

	it('supports batch and all removal without destroying the reusable manager', () => {
		const manager = createTerminalManager()
		for (const name of ['a', 'b', 'c', 'd']) manager.add(name)
		expect(manager.remove(['a', 'b'])).toBe(true)
		// A batch reports true only when every listed name was mounted, and it still removes the
		// ones that were: `c` is gone even though `missing` was never there to remove.
		expect(manager.remove(['c', 'missing'])).toBe(false)
		expect(manager.terminals()).toEqual(['d'])
		manager.remove()
		expect(manager.terminals()).toEqual([])
		expect(manager.add('fresh')).toBeDefined()
		manager.destroy()
	})

	it('destroy abandons every ask and permanently refuses new registry work', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		const forms = [createTextForm('a'), createTextForm('b')]
		const answers = forms.map((form) =>
			manager.ask('user', 'agent', form).catch((error: unknown) => error),
		)

		manager.destroy()
		manager.destroy()
		for (const error of await Promise.all(answers)) {
			expect(isFormError(error) && error.code).toBe('ABANDONED')
		}
		expect(() => manager.add('later')).toThrow(/destroyed/)
		await expect(manager.open('later')).rejects.toMatchObject({ code: 'DESTROYED' })
	})

	it('does not retain a ghost edge when a pending listener answers synchronously', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		manager.emitter.on('pending', (pending) => {
			manager.answer('b', pending.id, { value: 'done' })
		})
		const form = createTextForm('value')
		expect(await manager.ask('a', 'b', form)).toEqual({ value: 'done' })
		const reverse = createTextForm('reverse')
		const answer = manager.ask('b', 'a', reverse)
		manager.answer('a', requireValue(manager.pending('a')[0], 'Missing pending form for a').id, {
			reverse: 'ok',
		})
		expect(await answer).toEqual({ reverse: 'ok' })
		manager.destroy()
	})
})
