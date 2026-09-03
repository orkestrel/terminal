import { isPendingForm, isPendingFormStatus, isTerminalSnapshot, isWireEvent } from '@src/core'
import { createPendingForm } from '../../setup.js'
import { describe, expect, it } from 'vitest'

describe('wire guards', () => {
	it('guards pending statuses and envelopes without parsing schema semantics', () => {
		for (const status of ['pending', 'answered', 'expired'])
			expect(isPendingFormStatus(status)).toBe(true)
		expect(isPendingFormStatus('gone')).toBe(false)
		expect(isPendingForm(createPendingForm())).toBe(true)
		expect(isPendingForm({ id: 'x', schema: {}, status: 'pending', time: 1 })).toBe(true)
		expect(isPendingForm({ id: '', schema: {}, status: 'pending', time: 1 })).toBe(false)
		expect(isPendingForm(Object.create(null))).toBe(false)
	})

	it('guards wire events and terminal snapshots', () => {
		expect(isWireEvent({ event: 'pending', data: '{}', id: 'x' })).toBe(true)
		expect(isWireEvent({ event: 1, data: '{}' })).toBe(false)
		expect(isTerminalSnapshot({ id: 'agent', timeout: 20 })).toBe(true)
		expect(isTerminalSnapshot({ id: '', timeout: 20 })).toBe(false)
		expect(isTerminalSnapshot({ id: 'agent', timeout: '20' })).toBe(false)
	})
})
