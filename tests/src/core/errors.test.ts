import { describe, expect, it } from 'vitest'
import { isTerminalError, TerminalError } from '@src/core'
import { createCallableTerminalContext, TerminalContextFixture } from '../../setup.js'

describe('terminal error context types', () => {
	it('accepts a class-instance context', () => {
		const error = new TerminalError('DRIVER', 'failure')
		Object.defineProperty(error, 'context', { value: new TerminalContextFixture() })
		expect(isTerminalError(error)).toBe(true)
	})

	it('accepts a callable context', () => {
		const error = new TerminalError('DRIVER', 'failure')
		Object.defineProperty(error, 'context', { value: createCallableTerminalContext() })
		expect(isTerminalError(error)).toBe(true)
	})
})
