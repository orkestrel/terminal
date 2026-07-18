import type {
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	PasswordOptions,
	PromptValue,
	SelectOptions,
} from '@src/core'
import { createMemoryTerminalStore, createTerminalManager } from '@src/core'
import { createManualTimer, createRecorder } from '../../setup.js'
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

// FIX 1 — settle events on teardown: `#removeOne` destroys the broker BEFORE unsubscribing the
// manager's listeners, so the broker's own expire-on-destroy loop re-emits `expire` through the
// still-attached listeners onto the manager emitter — a manager-level observer sees exactly one
// `expire` per parked prompt on `remove` / `clear` / `destroy`, correctly attributed.
describe('TerminalManager — settle events on teardown', () => {
	it('remove(name) emits exactly one manager-level expire per parked prompt, correctly attributed', () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const expireEvents = createRecorder<readonly [to: string, id: string]>()
		manager.emitter.on('expire', expireEvents.handler)

		const firstA = manager.ask('user', 'a', 'input', { message: 'x' })
		const secondA = manager.ask('user', 'a', 'input', { message: 'y' })
		const firstB = manager.ask('user', 'b', 'input', { message: 'z' })
		void firstA.catch(() => undefined)
		void secondA.catch(() => undefined)
		void firstB.catch(() => undefined)

		const pendingA = manager.pending('a')
		expect(pendingA).toHaveLength(2)

		expect(manager.remove('a')).toBe(true)

		expect(expireEvents.count).toBe(2)
		for (const [to, id] of expireEvents.calls) {
			expect(to).toBe('a')
			expect(pendingA.some((prompt) => prompt.id === id)).toBe(true)
		}
		expect(manager.terminals()).toEqual(['b'])

		manager.destroy()
	})

	it('clear() emits exactly one manager-level expire per parked prompt across every endpoint', () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const expireEvents = createRecorder<readonly [to: string, id: string]>()
		manager.emitter.on('expire', expireEvents.handler)

		const askA = manager.ask('user', 'a', 'input', { message: 'x' })
		const askB = manager.ask('user', 'b', 'input', { message: 'y' })
		void askA.catch(() => undefined)
		void askB.catch(() => undefined)

		manager.clear()

		expect(expireEvents.count).toBe(2)
		const attributedTo = expireEvents.calls.map(([to]) => to).sort()
		expect(attributedTo).toEqual(['a', 'b'])
		expect(manager.terminals()).toEqual([])

		manager.destroy()
	})

	it('destroy() emits exactly one manager-level expire per parked prompt (via clear -> removeOne)', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')
		const expireEvents = createRecorder<readonly [to: string, id: string]>()
		manager.emitter.on('expire', expireEvents.handler)

		const askA = manager.ask('user', 'a', 'input', { message: 'x' })
		const askB = manager.ask('user', 'b', 'input', { message: 'y' })

		manager.destroy()

		await Promise.all([
			expect(askA).rejects.toMatchObject({ code: 'EXPIRE' }),
			expect(askB).rejects.toMatchObject({ code: 'EXPIRE' }),
		])
		expect(expireEvents.count).toBe(2)
		const attributedTo = expireEvents.calls.map(([to]) => to).sort()
		expect(attributedTo).toEqual(['a', 'b'])
	})
})

// FIX 2 — destroyed-manager guards: `add` throws `DESTROYED` at entry; `open` throws `DESTROYED`
// both at entry and after the `store` await gap (never resurrecting a broker mid-teardown).
describe('TerminalManager — destroyed-manager guards', () => {
	it('add() after destroy throws DESTROYED', () => {
		const manager = createTerminalManager()
		manager.destroy()
		expect(() => manager.add('a')).toThrow(expect.objectContaining({ code: 'DESTROYED' }))
	})

	it('open() at entry after destroy throws DESTROYED', async () => {
		const store = createMemoryTerminalStore()
		const manager = createTerminalManager({ store })
		manager.destroy()
		await expect(manager.open('a')).rejects.toMatchObject({ code: 'DESTROYED' })
	})

	it('open() resolving across a destroy gap does not resurrect a zombie broker', async () => {
		let resolveGet: ((snapshot: { readonly id: string }) => void) | undefined
		const deferredStore = {
			get: (id: string) =>
				new Promise<{ readonly id: string } | undefined>((resolve) => {
					resolveGet = () => resolve({ id })
				}),
			set: async () => undefined,
			delete: async () => undefined,
		}
		const manager = createTerminalManager({ store: deferredStore })
		const openPromise = manager.open('a')
		manager.destroy()
		if (resolveGet === undefined) throw new Error('unreachable')
		resolveGet({ id: 'a' })
		await expect(openPromise).rejects.toMatchObject({ code: 'DESTROYED' })
		expect(manager.terminal('a')).toBeUndefined()
		expect(manager.terminals()).toEqual([])
	})

	it('ask on the empty post-destroy registry still fails via TARGET', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.destroy()
		await expect(manager.ask('user', 'a', 'input', { message: 'x' })).rejects.toMatchObject({
			code: 'TARGET',
		})
	})
})

// FIX 3 — parked-prompt cap: a broker's `cap` rejects the (cap+1)th park with LIMIT, without
// parking / minting / emitting / arming a timer; the manager-level `cap` flows into minted
// brokers exactly like `timeout`; an `ask` against a full target rejects LIMIT and records NO edge.
describe('TerminalManager — parked-prompt cap', () => {
	it('broker cap 3 — fourth park rejects LIMIT; answering one frees room for a new park', async () => {
		const manager = createTerminalManager()
		const broker = manager.add('a', { cap: 3 })
		const t1 = broker.park({ form: 'input', options: { message: '1' } })
		const t2 = broker.park({ form: 'input', options: { message: '2' } })
		const t3 = broker.park({ form: 'input', options: { message: '3' } })
		expect(broker.count).toBe(3)

		const t4 = broker.park({ form: 'input', options: { message: '4' } })
		await expect(t4.value).rejects.toMatchObject({ code: 'LIMIT', context: { cap: 3 } })
		expect(broker.count).toBe(3)
		expect(broker.pending()).toHaveLength(3)

		const result = broker.answer(t1.id, 'ok')
		expect(result.success).toBe(true)
		expect(broker.count).toBe(2)

		const t5 = broker.park({ form: 'input', options: { message: '5' } })
		expect(broker.count).toBe(3)
		expect(broker.pending().some((prompt) => prompt.id === t5.id)).toBe(true)

		void t2.value.catch(() => undefined)
		void t3.value.catch(() => undefined)
		void t5.value.catch(() => undefined)
		manager.destroy()
	})

	it('manager-level cap flows to minted brokers exactly like timeout', async () => {
		const manager = createTerminalManager({ cap: 1 })
		const broker = manager.add('a')
		const t1 = broker.park({ form: 'input', options: { message: '1' } })
		const t2 = broker.park({ form: 'input', options: { message: '2' } })
		await expect(t2.value).rejects.toMatchObject({ code: 'LIMIT', context: { cap: 1 } })
		expect(broker.count).toBe(1)
		void t1.value.catch(() => undefined)
		manager.destroy()
	})

	it('ask on a full target rejects LIMIT and records no edge (a SAME-TICK, non-awaited reciprocal ask sees no ghost cycle)', async () => {
		const manager = createTerminalManager()
		manager.add('a', { cap: 1 })
		manager.add('b')
		manager.add('user')
		manager.add('other')
		// Fill the cap with a genuinely open edge from a DIFFERENT asker than the overflow one, so
		// the overflow's LIMIT rejection is the only candidate source of a ghost edge below.
		const filler = manager.ask('other', 'a', 'input', { message: 'filler' })
		// Issue the overflow ask WITHOUT awaiting it, then synchronously (same tick) issue the
		// reciprocal ask. A pre-rejected ticket that still recorded an edge would leave a ghost
		// user->a edge alive until the microtask that settles `overflow` runs — a same-tick
		// reciprocal (a -> user) would see it and wrongly reject DEADLOCK.
		const overflow = manager.ask('user', 'a', 'input', { message: 'y' })
		const reciprocal = manager.ask('a', 'user', 'input', { message: 'reciprocal' })

		const [pending] = manager.pending('user')
		expect(pending).toBeDefined()
		if (pending === undefined) throw new Error('unreachable')
		manager.answer('user', pending.id, 'ok')
		await expect(reciprocal).resolves.toBe('ok')

		await expect(overflow).rejects.toMatchObject({ code: 'LIMIT' })

		const [fillerPending] = manager.pending('a')
		if (fillerPending === undefined) throw new Error('unreachable')
		manager.answer('a', fillerPending.id, 'filler-ok')
		await expect(filler).resolves.toBe('filler-ok')

		manager.destroy()
	})
})

// ============================================================================
// PRESSURE — adversarial volume/topology/reentrancy suites over the REAL
// TerminalManager (deterministic, injected-timer, zero sleeps, zero sockets).
// ============================================================================

describe('TerminalManager — pressure: fan-out', () => {
	it('50 terminals, 200 round-robin asks across all six forms, fully drain the edge multiset', async () => {
		const manager = createTerminalManager()
		const names = Array.from({ length: 50 }, (_, i) => `t${i}`)
		for (const name of names) manager.add(name)

		type FormSpec =
			| { readonly form: 'input'; readonly options: InputOptions; readonly value: string }
			| { readonly form: 'password'; readonly options: PasswordOptions; readonly value: string }
			| { readonly form: 'editor'; readonly options: EditorOptions; readonly value: string }
			| { readonly form: 'confirm'; readonly options: ConfirmOptions; readonly value: boolean }
			| { readonly form: 'select'; readonly options: SelectOptions; readonly value: string }
			| {
					readonly form: 'checkbox'
					readonly options: CheckboxOptions
					readonly value: readonly string[]
			  }

		const forms: readonly FormSpec[] = [
			{ form: 'input', options: { message: 'm' }, value: 'in' },
			{ form: 'password', options: { message: 'm' }, value: 'pw' },
			{ form: 'confirm', options: { message: 'm' }, value: true },
			{ form: 'select', options: { message: 'm', choices: ['x', 'y'] }, value: 'x' },
			{ form: 'checkbox', options: { message: 'm', choices: ['x', 'y'] }, value: ['x'] },
			{ form: 'editor', options: { message: 'm' }, value: 'ed' },
		]

		// An open chain t0 -> t1 -> ... -> t48 (skips the closing t49 -> t0 wrap, which would
		// legitimately DEADLOCK — a directed ring cannot fully park without answering in between,
		// per TerminalManager#findCycle). 200 round-robin asks over this open chain accumulate
		// MULTIPLE edges per (from, to) pair — the multiset — with no cycle ever formed.
		const tickets: { readonly to: string; readonly id: string; readonly value: PromptValue }[] = []
		const promises: Promise<PromptValue>[] = []
		for (let k = 0; k < 200; k++) {
			const i = k % 49
			const from = names[i]
			const to = names[i + 1]
			if (from === undefined || to === undefined) throw new Error('unreachable')
			const spec = forms[k % 6]
			if (spec === undefined) throw new Error('unreachable')
			let promise: Promise<PromptValue>
			switch (spec.form) {
				case 'input':
					promise = manager.ask(from, to, 'input', spec.options)
					break
				case 'password':
					promise = manager.ask(from, to, 'password', spec.options)
					break
				case 'editor':
					promise = manager.ask(from, to, 'editor', spec.options)
					break
				case 'confirm':
					promise = manager.ask(from, to, 'confirm', spec.options)
					break
				case 'select':
					promise = manager.ask(from, to, 'select', spec.options)
					break
				case 'checkbox':
					promise = manager.ask(from, to, 'checkbox', spec.options)
					break
			}
			promises.push(promise)
			const list = manager.pending(to)
			const last = list[list.length - 1]
			if (last === undefined) throw new Error('unreachable')
			tickets.push({ to, id: last.id, value: spec.value })
		}

		expect(manager.pending()).toHaveLength(200)

		const results = tickets.map((ticket) => manager.answer(ticket.to, ticket.id, ticket.value))
		for (const result of results) expect(result.success).toBe(true)

		const values = await Promise.all(promises)
		values.forEach((value, index) => {
			const ticket = tickets[index]
			if (ticket === undefined) throw new Error('unreachable')
			expect(value).toEqual(ticket.value)
		})

		expect(manager.pending()).toHaveLength(0)
		expect(manager.count).toBe(50)
		expect(manager.terminals()).toHaveLength(50)

		// A reciprocal pair after full settle parks cleanly on both sides — proof the multiset
		// (and every edge it produced) is fully drained, not just decremented.
		const forward = manager.ask('t0', 't1', 'input', { message: 'forward' })
		const [forwardPending] = manager.pending('t1')
		if (forwardPending === undefined) throw new Error('unreachable')
		manager.answer('t1', forwardPending.id, 'fwd-ok')
		await expect(forward).resolves.toBe('fwd-ok')

		const backward = manager.ask('t1', 't0', 'input', { message: 'backward' })
		const [backwardPending] = manager.pending('t0')
		if (backwardPending === undefined) throw new Error('unreachable')
		manager.answer('t0', backwardPending.id, 'bwd-ok')
		await expect(backward).resolves.toBe('bwd-ok')

		manager.destroy()
	})
})

describe('TerminalManager — pressure: deadlock chain', () => {
	it('a 20-link chain closes into DEADLOCK on t20 -> t1, survives a broken middle link (parks), then clears fully', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler })
		const names = Array.from({ length: 20 }, (_, i) => `t${i + 1}`)
		for (const name of names) manager.add(name)

		// t1 -> t2 -> ... -> t19 -> t20 (19 parked asks forming an open chain).
		const links: Promise<string>[] = []
		for (let i = 1; i < 20; i++) {
			links.push(manager.ask(`t${i}`, `t${i + 1}`, 'input', { message: `link${i}` }))
		}
		for (const link of links) void link.catch(() => undefined)

		// Closing the ring: t20 -> t1 would complete the cycle t1 -> t2 -> ... -> t20 -> t1.
		const expectedPath = ['t20', ...names]
		await expect(manager.ask('t20', 't1', 'input', { message: 'close' })).rejects.toMatchObject({
			code: 'DEADLOCK',
			context: { path: expectedPath },
		})

		// Answer the middle link (t10 -> t11, links[9]) — this SEVERS the chain: t1..t9 no longer
		// reach t11..t20, so no completing path remains for the cycle.
		const [middle] = manager.pending('t11')
		if (middle === undefined) throw new Error('unreachable')
		manager.answer('t11', middle.id, 'ok')
		await links[9]

		// Derived expectation: the chain is a single path with no alternate route, so severing its
		// one edge fully breaks the would-be cycle — t20 -> t1 now PARKS instead of DEADLOCK.
		const reopened = manager.ask('t20', 't1', 'input', { message: 'reopen' })
		const [pendingOnT1] = manager.pending('t1')
		if (pendingOnT1 === undefined) throw new Error('unreachable')
		manager.answer('t1', pendingOnT1.id, 'ok')
		await expect(reopened).resolves.toBe('ok')

		// Settle every remaining original link (all but the already-answered middle one).
		for (let i = 1; i < 20; i++) {
			if (i === 10) continue
			const target = `t${i + 1}`
			const [pending] = manager.pending(target)
			if (pending === undefined) continue
			manager.answer(target, pending.id, 'ok')
		}
		await Promise.all(links.map((link) => link.catch(() => undefined)))
		expect(manager.pending()).toHaveLength(0)

		const finalAsk = manager.ask('t20', 't1', 'input', { message: 'final' })
		const [finalPending] = manager.pending('t1')
		if (finalPending === undefined) throw new Error('unreachable')
		manager.answer('t1', finalPending.id, 'done')
		await expect(finalAsk).resolves.toBe('done')
		manager.destroy()
	})
})

describe('TerminalManager — pressure: diamond', () => {
	it('two independent paths both close the same cycle; each must be cleared before D -> A parks', async () => {
		const manager = createTerminalManager()
		for (const name of ['a', 'b', 'c', 'd']) manager.add(name)

		const ab = manager.ask('a', 'b', 'input', { message: 'ab' })
		const ac = manager.ask('a', 'c', 'input', { message: 'ac' })
		void ab.catch(() => undefined)
		void ac.catch(() => undefined)
		const bd = manager.ask('b', 'd', 'input', { message: 'bd' })
		const cd = manager.ask('c', 'd', 'input', { message: 'cd' })
		void bd.catch(() => undefined)
		void cd.catch(() => undefined)

		await expect(manager.ask('d', 'a', 'input', { message: 'da1' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})

		// Clear the B path (a -> b, b -> d).
		const [pb] = manager.pending('b')
		if (pb === undefined) throw new Error('unreachable')
		manager.answer('b', pb.id, 'okb')
		await ab
		const [pd1] = manager.pending('d')
		if (pd1 === undefined) throw new Error('unreachable')
		manager.answer('d', pd1.id, 'okd1')
		await bd

		// The C path (a -> c, c -> d) alone still closes the cycle.
		await expect(manager.ask('d', 'a', 'input', { message: 'da2' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})

		// Clear the C path.
		const [pc] = manager.pending('c')
		if (pc === undefined) throw new Error('unreachable')
		manager.answer('c', pc.id, 'okc')
		await ac
		const [pd2] = manager.pending('d')
		if (pd2 === undefined) throw new Error('unreachable')
		manager.answer('d', pd2.id, 'okd2')
		await cd

		const finalAsk = manager.ask('d', 'a', 'input', { message: 'da3' })
		const [pa] = manager.pending('a')
		if (pa === undefined) throw new Error('unreachable')
		manager.answer('a', pa.id, 'done')
		await expect(finalAsk).resolves.toBe('done')
		manager.destroy()
	})
})

describe('TerminalManager — pressure: multiset edges', () => {
	it('two concurrent A -> B asks each hold their own edge — B -> A deadlocks until BOTH are answered', async () => {
		const manager = createTerminalManager()
		manager.add('a')
		manager.add('b')

		const first = manager.ask('a', 'b', 'input', { message: 'first' })
		const second = manager.ask('a', 'b', 'input', { message: 'second' })
		void first.catch(() => undefined)
		void second.catch(() => undefined)
		expect(manager.pending('b')).toHaveLength(2)

		await expect(manager.ask('b', 'a', 'input', { message: 'x1' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})

		const [p1] = manager.pending('b')
		if (p1 === undefined) throw new Error('unreachable')
		manager.answer('b', p1.id, 'ok1')
		await first

		await expect(manager.ask('b', 'a', 'input', { message: 'x2' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})

		const [p2] = manager.pending('b')
		if (p2 === undefined) throw new Error('unreachable')
		manager.answer('b', p2.id, 'ok2')
		await second

		const parked = manager.ask('b', 'a', 'input', { message: 'x3' })
		const [pa] = manager.pending('a')
		if (pa === undefined) throw new Error('unreachable')
		manager.answer('a', pa.id, 'ok3')
		await expect(parked).resolves.toBe('ok3')
		manager.destroy()
	})
})

describe('TerminalManager — pressure: reentrancy storm', () => {
	it('a pending listener that synchronously answers every prompt resolves 100 sequential asks with none stranded', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		let counter = 0
		manager.emitter.on('pending', (prompt) => {
			const to = prompt.to
			if (to === undefined) return
			manager.answer(to, prompt.id, `answer-${counter}`)
		})

		for (let i = 0; i < 100; i++) {
			counter = i
			const value = await manager.ask('user', 'agent', 'input', { message: `q${i}` })
			expect(value).toBe(`answer-${i}`)
		}
		expect(manager.pending()).toHaveLength(0)
		manager.destroy()
	})

	it('an answer listener that issues a fresh nested ask to a different pair resolves normally', async () => {
		const manager = createTerminalManager()
		manager.add('agent')
		manager.add('helper')
		let nested: Promise<string> | undefined
		manager.emitter.on('answer', (to) => {
			if (to === 'agent' && nested === undefined) {
				nested = manager.ask('agent', 'helper', 'input', { message: 'nested' })
			}
		})

		const outer = manager.ask('user', 'agent', 'input', { message: 'outer' })
		const [pending] = manager.pending('agent')
		if (pending === undefined) throw new Error('unreachable')
		manager.answer('agent', pending.id, 'outer-value')
		await expect(outer).resolves.toBe('outer-value')

		expect(nested).toBeDefined()
		if (nested === undefined) throw new Error('unreachable')
		const [nestedPending] = manager.pending('helper')
		if (nestedPending === undefined) throw new Error('unreachable')
		manager.answer('helper', nestedPending.id, 'nested-value')
		await expect(nested).resolves.toBe('nested-value')
		manager.destroy()
	})

	it('destroy() with 50 parked prompts rejects every one with EXPIRE, is idempotent, and a post-destroy ask rejects TARGET (terminals cleared)', async () => {
		const manager = createTerminalManager()
		const names = Array.from({ length: 50 }, (_, i) => `n${i}`)
		for (const name of names) manager.add(name)
		const asks = names.map((name) => manager.ask('user', name, 'input', { message: name }))

		manager.destroy()
		await Promise.all(asks.map((ask) => expect(ask).rejects.toMatchObject({ code: 'EXPIRE' })))
		expect(() => manager.destroy()).not.toThrow()
		expect(manager.count).toBe(0)

		// destroy() -> clear() drops every terminal from the registry, so a post-destroy ask targets
		// an unmounted name and rejects TARGET (the actual observed behavior — pinned, not assumed).
		await expect(manager.ask('user', 'n0', 'input', { message: 'x' })).rejects.toMatchObject({
			code: 'TARGET',
		})
	})
})

describe('TerminalManager — pressure: mass expiry', () => {
	it('100 parked prompts across 10 terminals all expire together, draining the edge multiset', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler, timeout: 1000 })
		const targets = Array.from({ length: 10 }, (_, i) => `t${i}`)
		for (const target of targets) manager.add(target)
		manager.add('root')

		const expireEvents = createRecorder<readonly [string, string]>()
		manager.emitter.on('expire', expireEvents.handler)

		const asks: Promise<string>[] = []
		for (let i = 0; i < 100; i++) {
			const target = targets[i % 10]
			if (target === undefined) throw new Error('unreachable')
			asks.push(manager.ask(`asker${i}`, target, 'input', { message: `q${i}` }))
		}
		for (const ask of asks) void ask.catch(() => undefined)

		// One cyclic pair before firing: root -> t0 pending; t0 -> root would DEADLOCK.
		const rootAsk = manager.ask('root', 't0', 'input', { message: 'root->t0' })
		void rootAsk.catch(() => undefined)
		await expect(manager.ask('t0', 'root', 'input', { message: 'x' })).rejects.toMatchObject({
			code: 'DEADLOCK',
		})

		expect(manager.pending()).toHaveLength(101)
		expect(timer.pending).toBe(101)
		timer.flush()

		await Promise.all(asks.map((ask) => expect(ask).rejects.toMatchObject({ code: 'EXPIRE' })))
		await expect(rootAsk).rejects.toMatchObject({ code: 'EXPIRE' })

		expect(manager.pending()).toHaveLength(0)
		expect(expireEvents.count).toBe(101)
		const seen = expireEvents.calls.map(([to, id]) => `${to}:${id}`)
		expect(new Set(seen).size).toBe(101)

		// The edges are drained by expiry — t0 -> root now parks cleanly instead of DEADLOCK.
		const reopened = manager.ask('t0', 'root', 'input', { message: 'reopen' })
		const [pending] = manager.pending('root')
		if (pending === undefined) throw new Error('unreachable')
		manager.answer('root', pending.id, 'ok')
		await expect(reopened).resolves.toBe('ok')
		manager.destroy()
	})
})

describe('TerminalManager — pressure: expiry vs answer race', () => {
	it('answering first cancels the deadline — a later flush fires nothing, no double-settle', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler })
		manager.add('agent')
		const expireEvents = createRecorder<readonly [string, string]>()
		manager.emitter.on('expire', expireEvents.handler)

		const ask = manager.ask('user', 'agent', 'input', { message: 'x' })
		const [pending] = manager.pending('agent')
		if (pending === undefined) throw new Error('unreachable')
		expect(manager.answer('agent', pending.id, 'ok')).toEqual({ success: true, value: 'ok' })
		await expect(ask).resolves.toBe('ok')

		timer.flush()
		expect(expireEvents.count).toBe(0)
		expect(manager.answer('agent', pending.id, 'again')).toEqual({
			success: false,
			error: 'unknown',
		})
		manager.destroy()
	})

	it('expiring first then answering returns unknown (the prompt is already gone)', async () => {
		const timer = createManualTimer()
		const manager = createTerminalManager({ timer: timer.handler })
		manager.add('agent')

		const ask = manager.ask('user', 'agent', 'input', { message: 'x' })
		const [pending] = manager.pending('agent')
		if (pending === undefined) throw new Error('unreachable')
		timer.flush()
		await expect(ask).rejects.toMatchObject({ code: 'EXPIRE' })

		expect(manager.answer('agent', pending.id, 'late')).toEqual({
			success: false,
			error: 'unknown',
		})
		manager.destroy()
	})
})

describe('TerminalManager — pressure: churn', () => {
	it('100 rounds of add/remove (with a parked prompt each round) expire cleanly; broker listener accounting stays stable; a fresh round-trip works after', async () => {
		const manager = createTerminalManager()
		for (let round = 0; round < 100; round++) {
			manager.add('churner')
			const broker = manager.terminal('churner')
			if (broker === undefined) throw new Error('unreachable')
			// @orkestrel/emitter's Emitter#count(event) is the listener-count observable: the manager
			// subscribes exactly ONE handler per event on each freshly-minted broker, every round.
			expect(broker.emitter.count('pending')).toBe(1)
			expect(broker.emitter.count('answer')).toBe(1)
			expect(broker.emitter.count('expire')).toBe(1)

			const ask = manager.ask('asker', 'churner', 'input', { message: `round${round}` })
			manager.remove('churner')
			await expect(ask).rejects.toMatchObject({ code: 'EXPIRE' })
		}

		expect(manager.pending()).toHaveLength(0)
		manager.add('churner')
		const finalAsk = manager.ask('asker', 'churner', 'input', { message: 'final' })
		const [pending] = manager.pending('churner')
		if (pending === undefined) throw new Error('unreachable')
		manager.answer('churner', pending.id, 'done')
		await expect(finalAsk).resolves.toBe('done')
		manager.destroy()
	})
})
