import { CTRL_C, CTRL_D, RETURN, createPromptClient, isTerminalError } from '@src/core'
import { createTerminal } from '@src/server'
import {
	createEveryControlSchema,
	createJSONResponse,
	createPendingForm,
	createSSEResponse,
} from '../../setup.js'
import { createFakeTTY, createLineInput, createStreamTarget, rawOutput } from '../../setupServer.js'
import { createForm, isFormError } from '@orkestrel/form'
import { CSI, strip } from '@orkestrel/console'
import { requireValue, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('Terminal', () => {
	it('walks every control through real reducers and settles one whole form', async () => {
		const tty = createFakeTTY({
			scripts: [
				['Ada', RETURN],
				['s3cret', RETURN],
				['42', RETURN],
				['2026-08-15', RETURN],
				['12:30', RETURN],
				['2026-08-15T12:30', RETURN],
				['#112233', RETURN],
				['y'],
				[`${CSI}B`, RETURN],
				[' ', `${CSI}B`, ' ', RETURN],
				['a.txt', RETURN],
				['b.txt', RETURN],
				[RETURN],
				['first', RETURN, 'second', CTRL_D],
			],
		})
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm(createEveryControlSchema())

		expect(await terminal.ask(form)).toEqual({
			name: 'Ada',
			secret: 's3cret',
			age: 42,
			date: '2026-08-15',
			time: '12:30',
			meeting: '2026-08-15T12:30',
			color: '#112233',
			ready: true,
			role: 'viewer',
			scope: ['read', 'write'],
			files: ['a.txt', 'b.txt'],
			notes: 'first\nsecond',
		})
		expect(form.status).toBe('settled')
		expect(tty.enters).toBe(14)
		expect(tty.exits).toBe(14)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
		expect(rawOutput(tty)).not.toContain('s3cret')
	})

	it('binds a blank line as absence so required refuses and re-asks', async () => {
		const tty = createFakeTTY({ scripts: [[RETURN], ['Ada', RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [{ control: 'text', name: 'name', label: 'Name', rule: { required: true } }],
		})

		expect(await terminal.ask(form)).toEqual({ name: 'Ada' })
		expect(tty.text()).toContain('Name: This field is required')
		expect(tty.enters).toBe(2)
		expect(tty.exits).toBe(2)
	})

	it('refuses a value the control cannot hold and accepts a later parseable value', async () => {
		const tty = createFakeTTY({
			scripts: [
				['old', RETURN],
				['42', RETURN],
			],
		})
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'number', name: 'age', label: 'Age' }] })

		expect(await terminal.ask(form)).toEqual({ age: 42 })
		expect(tty.text()).toContain('Age: Enter a value this field accepts')
	})

	it('accepts an open select value outside its suggestion list', async () => {
		const tty = createFakeTTY({ scripts: [['operator', RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [
				{
					control: 'select',
					name: 'role',
					label: 'Role',
					open: true,
					choices: [{ value: 'admin', label: 'Admin' }],
				},
			],
		})

		expect(await terminal.ask(form)).toEqual({ role: 'operator' })
		expect(tty.text()).toContain('Suggestions: admin')
	})

	it('sanitizes preserved values only when locked and suggestion lines echo them', async () => {
		const locked = 'fi\u0000xed\u007f'
		const offered = 'ad\u0000min\u007f'
		const tty = createFakeTTY({ scripts: [['operator', RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [
				{ control: 'text', name: 'locked', label: 'Code', default: locked, locked: true },
				{
					control: 'select',
					name: 'role',
					label: 'Role',
					open: true,
					choices: [{ value: offered, label: 'Admin' }],
				},
			],
		})

		expect(await terminal.ask(form)).toEqual({ locked, role: 'operator' })
		expect(tty.text()).toContain('○ Code (locked) fixed')
		expect(tty.text()).toContain('Suggestions: admin')
		expect(tty.text()).not.toContain('\u0000')
		expect(tty.text()).not.toContain('\u007f')
		expect(`${locked}${offered}`).toContain('\u0000')
	})

	it('sanitizes field identity and failure text at the report boundary', async () => {
		const name = 'na\u0000me\u007f'
		const message = 'No\u0000pe\u007f'
		const tty = createFakeTTY({ scripts: [] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [{ control: 'text', name, hidden: true, rule: { required: true } }],
		})
		form.invalidate(name, message)

		const error = await terminal.ask(form).catch((reason: unknown) => reason)
		expect(isFormError(error) && error.code).toBe('ABANDONED')
		expect(tty.text()).toContain('name: Nope')
		expect(tty.text()).not.toContain('\u0000')
		expect(tty.text()).not.toContain('\u007f')

		const raw = createFakeTTY()
		raw.output.write(`${name}: ${message}`)
		expect(raw.text()).toContain('\u0000')
		expect(raw.text()).toContain('\u007f')
	})

	it('renders an authoritative refusal before posting the corrected retry', async () => {
		const tty = createFakeTTY({
			scripts: [
				['bad', RETURN],
				['good', RETURN],
			],
		})
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const pending = createPendingForm(
			{ fields: [{ control: 'text', name: 'word', label: 'Word' }] },
			{ id: 'retry' },
		)
		const message = 'Use\u0000 good\u007f'
		const bodies: string[] = []
		const outputAtPost: string[] = []
		const client = createPromptClient({
			url: 'http://localhost/prompts',
			terminal,
			reconnect: false,
			fetch: async (_input, init) => {
				if (init?.method !== 'POST') {
					return createSSEResponse([{ event: 'pending', data: pending }])
				}
				bodies.push(init.body ?? '')
				outputAtPost.push(tty.text())
				return bodies.length === 1
					? createJSONResponse({
							success: false,
							error: {
								reason: 'rejected',
								errors: [{ field: 'word', message }],
							},
						})
					: createJSONResponse({ success: true, value: { word: 'good' } })
			},
		})

		await client.connect()
		await waitForDelay(10)

		expect(bodies).toEqual([
			JSON.stringify({ id: 'retry', values: { word: 'bad' } }),
			JSON.stringify({ id: 'retry', values: { word: 'good' } }),
		])
		expect(requireValue(outputAtPost[0], 'Missing first answer output')).not.toContain(
			'Word: Use good',
		)
		expect(requireValue(outputAtPost[1], 'Missing second answer output')).toContain(
			'Word: Use good',
		)
		expect(requireValue(outputAtPost[1], 'Missing second answer output')).not.toContain('\u0000')
		expect(requireValue(outputAtPost[1], 'Missing second answer output')).not.toContain('\u007f')
		client.destroy()
	})

	it('collects multiple file paths until a blank line', async () => {
		const tty = createFakeTTY({ scripts: [['one.txt', RETURN], ['two.txt', RETURN], [RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'file', name: 'files', multiple: true }] })

		expect(await terminal.ask(form)).toEqual({ files: ['one.txt', 'two.txt'] })
		expect(tty.text()).toContain('One path per line, blank to finish')
	})

	it('skips hidden and disabled fields, renders locked fields and groups, and submits held values', async () => {
		const tty = createFakeTTY({ scripts: [['Ada', RETURN]] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			groups: [{ name: 'identity', label: 'Identity' }],
			fields: [
				{ control: 'text', name: 'hidden', default: 'secret', hidden: true },
				{ control: 'text', name: 'locked', label: 'Code', default: 'fixed', locked: true },
				{ control: 'text', name: 'disabled', default: 'drop', disabled: true },
				{ control: 'text', name: 'name', label: 'Name', group: 'identity' },
			],
		})

		expect(await terminal.ask(form)).toEqual({ hidden: 'secret', locked: 'fixed', name: 'Ada' })
		expect(tty.text()).toContain('○ Code (locked) fixed')
		expect(tty.text()).toContain('Identity')
		expect(tty.text()).not.toContain('drop')
	})

	it('abandons an unanswerable hidden or locked required field after reporting it', async () => {
		const tty = createFakeTTY({ scripts: [] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [
				{
					control: 'text',
					name: 'hidden',
					label: 'Hidden',
					hidden: true,
					rule: { required: true },
				},
				{
					control: 'text',
					name: 'locked',
					label: 'Locked',
					locked: true,
					rule: { required: true },
				},
				{ control: 'text', name: 'disabled', disabled: true, rule: { required: true } },
			],
		})

		const error = await terminal.ask(form).catch((reason: unknown) => reason)
		expect(isFormError(error) && error.code).toBe('ABANDONED')
		expect(form.status).toBe('abandoned')
		expect(tty.text()).toContain('Hidden: This field is required')
		expect(tty.text()).toContain('Locked: This field is required')
		expect(tty.text()).not.toContain('disabled: This field is required')
	})

	it('submits a form containing only a runtime-disabled required field', async () => {
		const tty = createFakeTTY({ scripts: [] })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({
			fields: [{ control: 'text', name: 'disabled', disabled: true, rule: { required: true } }],
		})
		expect(await terminal.ask(form)).toEqual({})
	})

	it('ctrl-c rejects CANCEL, cleans raw mode, and leaves the caller-owned form editing', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		void form.answer.catch(() => undefined)
		const answer = terminal.ask(form).catch((reason: unknown) => reason)
		tty.push(CTRL_C)

		const error = await answer
		expect(isTerminalError(error) && error.code).toBe('CANCEL')
		expect(form.status).toBe('editing')
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
		form.destroy()
	})

	it('external abandon interrupts an active render with Form ABANDONED and cleans raw mode', async () => {
		const tty = createFakeTTY()
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		const answer = terminal.ask(form).catch((reason: unknown) => reason)
		form.destroy()

		const error = await answer
		expect(isFormError(error) && error.code).toBe('ABANDONED')
		expect(tty.enters).toBe(1)
		expect(tty.exits).toBe(1)
		expect(tty.raw).toBe(false)
		expect(tty.listeners()).toBe(0)
	})

	it('drives the non-TTY fallback over one shared real readline stream', async () => {
		const input = createLineInput(['Ada', '2', '1,2', 'one.txt', ''])
		const output = createStreamTarget()
		const terminal = createTerminal({ input, output: output.target })
		const form = createForm({
			fields: [
				{ control: 'text', name: 'name', label: 'Name' },
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
				{ control: 'file', name: 'files', multiple: true },
			],
		})

		expect(await terminal.ask(form)).toEqual({
			name: 'Ada',
			role: 'viewer',
			scope: ['read', 'write'],
			files: ['one.txt'],
		})
		const rendered = strip(output.writes.calls.map(([text]) => text).join(''))
		expect(rendered).toContain('  1) Admin')
		expect(rendered).toContain('Enter numbers separated by commas')
		expect(input.listenerCount('data')).toBe(0)
	})

	it('fails the fallback loudly when the injected input is not a Node readable', async () => {
		const tty = createFakeTTY({ isTTY: false })
		const terminal = createTerminal({ input: tty.input, output: tty.output })
		const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
		void form.answer.catch(() => undefined)

		const error = await terminal.ask(form).catch((reason: unknown) => reason)
		expect(isTerminalError(error) && error.code).toBe('DRIVER')
		form.destroy()
	})
})
