import { createMemoryTerminalStore, createTerminalManager } from '@src/core'
import { createManualTimer } from '../../setup.js'
import { describe, expect, it } from 'vitest'

// src/core/TerminalManager.ts — the multi-endpoint registry of `Prompt` brokers: idempotent
// `add`, attributed `ask` with a transitive DEADLOCK check across all in-flight edges, `pending`
// / `answer` routed by endpoint name, durable `open` / `save` over a `TerminalStoreInterface`,
// and batch `remove` / `clear` / `destroy`.

describe('TerminalManager', () => {
	it('add is idempotent — a re-add returns the SAME broker, a parked prompt survives', () => {
		const manager = createTerminalManager()
		const first = manager.add('agent')
		const ticket = first.park({ form: 'input', options: { message: 'name' } })
		const second = manager.add('agent')
		expect(second).toBe(first)
		expect(first.pending()).toHaveLength(1)
		void ticket.value.catch(() => undefined)
		manager.destroy()
	})

	it('typed ask resolves per form via manager.answer', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		const promise = manager.ask('user', 'agent', 'input', { message: 'name' })
		const [pending] = manager.pending('agent')
		expect(pending).toBeDefined()
		if (pending === undefined) throw new Error('unreachable')
		const result = manager.answer('agent', pending.id, 'Ada')
		expect(result).toEqual({ success: true, value: 'Ada' })
		expect(await promise).toBe('Ada')
		manager.destroy()
	})

	it('ask against an unknown target rejects TARGET, listing known names', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		manager.add('shell')
		await expect(manager.ask('user', 'ghost', 'input', { message: 'x' })).rejects.toMatchObject({
			code: 'TARGET',
			context: { known: ['agent', 'shell'] },
		})
		manager.destroy()
	})

	it('a direct cycle (B already asking A) rejects a new A -> B ask with DEADLOCK', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const pending = manager.ask('b', 'a', 'input', { message: 'x' })
		void pending.catch(() => undefined)
		await expect(manager.ask('a', 'b', 'input', { message: 'y' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})
		manager.destroy()
	})

	it('a transitive cycle (A -> B -> C parked, then C -> A) rejects DEADLOCK with the path', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		manager.add('c')
		const first = manager.ask('a', 'b', 'input', { message: 'x' })
		const second = manager.ask('b', 'c', 'input', { message: 'y' })
		void first.catch(() => undefined)
		void second.catch(() => undefined)
		await expect(manager.ask('c', 'a', 'input', { message: 'z' })).rejects.toMatchObject({
			code: 'DEADLOCK',
			context: { path: ['c', 'a', 'b', 'c'] },
		})
		manager.destroy()
	})

	it('edge clears after answer — a formerly-cyclic ask now succeeds', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const first = manager.ask('b', 'a', 'input', { message: 'x' })
		const [pendingOne] = manager.pending('a')
		if (pendingOne === undefined) throw new Error('unreachable')
		manager.answer('a', pendingOne.id, 'ok')
		await first
		const second = manager.ask('a', 'b', 'input', { message: 'y' })
		const [pendingTwo] = manager.pending('b')
		if (pendingTwo === undefined) throw new Error('unreachable')
		manager.answer('b', pendingTwo.id, 'ok2')
		await expect(second).resolves.toBe('ok2')
		manager.destroy()
	})

	it('edge clears after injected-timer expiry — a formerly-cyclic ask now succeeds', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler })
		manager.add('a')
		manager.add('b')
		const first = manager.ask('b', 'a', 'input', { message: 'x' })
		timer.flush()
		await expect(first).rejects.toMatchObject({ code: 'EXPIRE' })
		const second = manager.ask('a', 'b', 'input', { message: 'y' })
		const [pendingTwo] = manager.pending('b')
		if (pendingTwo === undefined) throw new Error('unreachable')
		manager.answer('b', pendingTwo.id, 'ok')
		await expect(second).resolves.toBe('ok')
		manager.destroy()
	})

	it('edge clears after remove(to) — a formerly-cyclic ask now succeeds', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const first = manager.ask('b', 'a', 'input', { message: 'x' })
		manager.remove('a')
		await expect(first).rejects.toMatchObject({ code: 'EXPIRE' })
		manager.add('a')
		const second = manager.ask('a', 'b', 'input', { message: 'y' })
		const [pendingTwo] = manager.pending('b')
		if (pendingTwo === undefined) throw new Error('unreachable')
		manager.answer('b', pendingTwo.id, 'ok')
		await expect(second).resolves.toBe('ok')
		manager.destroy()
	})

	it('edge clears after clear() — a formerly-cyclic ask now succeeds', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const first = manager.ask('b', 'a', 'input', { message: 'x' })
		manager.clear()
		await expect(first).rejects.toMatchObject({ code: 'EXPIRE' })
		manager.add('a')
		manager.add('b')
		const second = manager.ask('a', 'b', 'input', { message: 'y' })
		const [pendingTwo] = manager.pending('b')
		if (pendingTwo === undefined) throw new Error('unreachable')
		manager.answer('b', pendingTwo.id, 'ok')
		await expect(second).resolves.toBe('ok')
		manager.destroy()
	})

	it('edge clears after destroy() — a fresh manager permits the formerly-cyclic ask', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const first = manager.ask('b', 'a', 'input', { message: 'x' })
		manager.destroy()
		await expect(first).rejects.toMatchObject({ code: 'EXPIRE' })

		const fresh = createTerminalManager()
		fresh.add('a')
		fresh.add('b')
		const second = fresh.ask('a', 'b', 'input', { message: 'y' })
		const [pendingTwo] = fresh.pending('b')
		if (pendingTwo === undefined) throw new Error('unreachable')
		fresh.answer('b', pendingTwo.id, 'ok')
		await expect(second).resolves.toBe('ok')
		fresh.destroy()
	})

	it('pending() / pending(to) attribute from/to and scope by endpoint', () => {
		const manager = createTerminalManager()
		manager.add('agent')
		manager.add('shell')
		const first = manager.ask('user', 'agent', 'input', { message: 'x' })
		const second = manager.ask('user', 'shell', 'input', { message: 'y' })
		void first.catch(() => undefined)
		void second.catch(() => undefined)

		const all = manager.pending()
		expect(all).toHaveLength(2)
		const agentPending = manager.pending('agent')
		expect(agentPending).toHaveLength(1)
		expect(agentPending[0]?.from).toBe('user')
		expect(agentPending[0]?.to).toBe('agent')
		const shellPending = manager.pending('shell')
		expect(shellPending).toHaveLength(1)
		expect(shellPending[0]?.to).toBe('shell')
		expect(manager.pending('ghost')).toEqual([])
		manager.destroy()
	})

	it('answer: unknown terminal -> terminal, unknown id -> unknown, gate reject -> rejected, accept -> success', () => {
		const manager = createTerminalManager()
		manager.add('agent')
		expect(manager.answer('ghost', 'nope', 'x')).toEqual({ success: false, error: 'terminal' })
		expect(manager.answer('agent', 'nope', 'x')).toEqual({ success: false, error: 'unknown' })

		const ticket = manager.terminal('agent')
		if (ticket === undefined) throw new Error('unreachable')
		const promise = manager.ask('user', 'agent', 'input', {
			message: 'x',
			validate: { required: true },
		})
		void promise.catch(() => undefined)
		const [pending] = manager.pending('agent')
		if (pending === undefined) throw new Error('unreachable')
		expect(manager.answer('agent', pending.id, '')).toEqual({ success: false, error: 'rejected' })
		expect(manager.answer('agent', pending.id, 'ok')).toEqual({ success: true, value: 'ok' })
		manager.destroy()
	})

	it('open/save round-trips through createMemoryTerminalStore — save writes config, open restores an EMPTY broker with the saved timeout', async () => {
		const timer = createManualTimer()
		const store = createMemoryTerminalStore()
		const writer = createTerminalManager({ store, timer: timer.handler })
		writer.add('agent', { timeout: 5 })
		expect(await writer.save('agent')).toBe(true)
		expect(await writer.save('ghost')).toBe(false)

		const reader = createTerminalManager({ store, timer: timer.handler })
		const restored = await reader.open('agent')
		expect(restored).toBeDefined()
		if (restored === undefined) throw new Error('unreachable')
		expect(restored.count).toBe(0) // parked Promises never resurrect
		const again = await reader.open('agent')
		expect(again).toBe(restored) // already registered — no second store hit
		expect(await reader.open('nope')).toBeUndefined()

		// Assert the restored timeout via injected-timer expiry (rather than reading private state).
		const promise = restored.input({ message: 'x' })
		expect(timer.pending).toBe(1)
		timer.flush()
		await expect(promise).rejects.toMatchObject({ code: 'EXPIRE' })

		writer.destroy()
		reader.destroy()
	})

	it('open without a store or with no registered/stored name resolves undefined (lenient)', async () => {
		const manager = createTerminalManager()
		expect(await manager.open('nope')).toBeUndefined()
		manager.destroy()

		const store = createMemoryTerminalStore()
		const managerWithStore = createTerminalManager({ store })
		expect(await managerWithStore.open('nope')).toBeUndefined()
		managerWithStore.destroy()
	})

	it('remove(array) vs remove(single) overload behavior — array is true when ANY was removed', () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		expect(manager.remove(['a', 'ghost'])).toBe(true) // §9.2: true if ANY removed
		expect(manager.terminals()).toEqual(['b'])
		expect(manager.remove('b')).toBe(true)
		expect(manager.remove('b')).toBe(false)
		expect(manager.remove(['ghost1', 'ghost2'])).toBe(false)
		manager.destroy()
	})

	it('destroy settles every parked ask with EXPIRE and is idempotent', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const first = manager.ask('user', 'a', 'input', { message: 'x' })
		const second = manager.ask('user', 'b', 'input', { message: 'y' })
		manager.destroy()
		await Promise.all([
			expect(first).rejects.toMatchObject({ code: 'EXPIRE' }),
			expect(second).rejects.toMatchObject({ code: 'EXPIRE' }),
		])
		expect(manager.count).toBe(0)
		expect(() => manager.destroy()).not.toThrow()
		manager.destroy()
	})
})
