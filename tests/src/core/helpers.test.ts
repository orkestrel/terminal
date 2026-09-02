import type { PromptThemeOptions } from '@src/core'
import type { CheckboxField, SelectField } from '@orkestrel/form'
import type { Attribute } from '@orkestrel/console'
import {
	BACKSPACE,
	CTRL_C,
	CTRL_D,
	CTRL_U,
	DELETE,
	ESCAPE,
	KEY_CSI,
	NEWLINE,
	RETURN,
	SPACE,
	checkboxReduce,
	confirmReduce,
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createPromptTheme,
	createSelectState,
	defaultTimer,
	editLine,
	editorReduce,
	inputReduce,
	isAbortError,
	isInsecureRemote,
	isPendingForm,
	isPendingFormStatus,
	isPrintable,
	isTerminalSnapshot,
	isWireEvent,
	parseKey,
	passwordReduce,
	renderCheckboxView,
	renderConfirmView,
	renderEditorView,
	renderErrorLine,
	renderHintedHeader,
	renderInputView,
	renderPasswordView,
	renderPromptHeader,
	renderSelectView,
	renderSubmitHeader,
	sanitizeDisplayText,
	sanitizeSchema,
	sanitizeThemeIcons,
	selectReduce,
	serializeDestroy,
	serializeExpire,
	serializePending,
	toggleIndex,
} from '@src/core'
import {
	createHostileSchema,
	createManualTimer,
	createPendingForm,
	feedReducer,
} from '../../setup.js'
import { strip } from '@orkestrel/console'
import { requireValue, waitForDelay } from '@orkestrel/test'
import { describe, expect, it } from 'vitest'

describe('parseKey', () => {
	it('decodes Enter bytes to one canonical key', () => {
		for (const sequence of [RETURN, NEWLINE]) {
			expect(parseKey(sequence)).toEqual({
				name: 'return',
				sequence,
				ctrl: false,
				meta: false,
				shift: false,
			})
		}
	})

	it('decodes a CRLF chunk delivered as one Enter keypress', () => {
		expect(parseKey(`${RETURN}${NEWLINE}`)).toEqual({
			name: 'return',
			sequence: `${RETURN}${NEWLINE}`,
			ctrl: false,
			meta: false,
			shift: false,
		})
	})

	it('decodes backspace, delete, space, and ctrl combinations', () => {
		expect(parseKey(BACKSPACE).name).toBe('backspace')
		expect(parseKey(DELETE).name).toBe('backspace')
		expect(parseKey(SPACE).name).toBe('space')
		expect(parseKey(CTRL_C)).toMatchObject({ name: 'c', ctrl: true })
		expect(parseKey(CTRL_D)).toMatchObject({ name: 'd', ctrl: true })
		expect(parseKey(CTRL_U)).toMatchObject({ name: 'u', ctrl: true })
	})

	it('decodes CSI and SS3 navigation sequences', () => {
		expect(parseKey(`${KEY_CSI}A`)).toMatchObject({ name: 'up', meta: true })
		expect(parseKey(`${ESCAPE}OB`)).toMatchObject({ name: 'down', meta: true })
		expect(parseKey(`${KEY_CSI}3~`)).toMatchObject({ name: 'delete', meta: true })
	})

	it('preserves printable and byte-array input', () => {
		expect(parseKey('A')).toMatchObject({ name: 'A', sequence: 'A', shift: true })
		expect(parseKey(new TextEncoder().encode('🙂'))).toMatchObject({
			name: '🙂',
			sequence: '🙂',
		})
	})

	it('is total for empty and unknown escape sequences, naming neither', () => {
		expect(parseKey('')).toEqual({ sequence: '', ctrl: false, meta: false, shift: false })
		expect(parseKey('')).not.toHaveProperty('name')
		const unknown = parseKey(`${ESCAPE}[999~`)
		expect(unknown.sequence).toBe(`${ESCAPE}[999~`)
		expect(unknown).not.toHaveProperty('name')
	})
})

describe('isPrintable', () => {
	it('accepts visible code points and rejects C0 plus DEL', () => {
		expect(isPrintable('a')).toBe(true)
		expect(isPrintable('🙂')).toBe(true)
		expect(isPrintable('')).toBe(false)
		expect(isPrintable('\u0000')).toBe(false)
		expect(isPrintable('\u007f')).toBe(false)
	})
})

describe('input reducer', () => {
	it('edits copy-on-write and submits the declared default on bare return', () => {
		const initial = createInputState({
			control: 'text',
			name: 'name',
			label: 'Name',
			default: 'Ada',
		})
		const typed = inputReduce(initial, parseKey('G'))
		expect(typed.state).not.toBe(initial)
		expect(initial.value).toBe('')
		expect(typed.state.value).toBe('G')
		expect(inputReduce(initial, parseKey(RETURN))).toMatchObject({ status: 'submit', value: 'Ada' })
	})

	it('supports backspace, ctrl-u, and ctrl-c', () => {
		const initial = createInputState({ control: 'text', name: 'name' })
		expect(feedReducer(inputReduce, initial, ['a', 'b', BACKSPACE]).state.value).toBe('a')
		expect(feedReducer(inputReduce, initial, ['a', CTRL_U]).state.value).toBe('')
		expect(inputReduce(initial, parseKey(CTRL_C)).status).toBe('cancel')
	})

	it('renders labels, content, and a committed value', () => {
		const initial = createInputState({ control: 'text', name: 'name', label: 'Name' })
		expect(strip(renderInputView(initial))).toContain('? Name ›')
		expect(strip(feedReducer(inputReduce, initial, ['A', RETURN]).view)).toBe('✔ Name A')
	})

	it('sanitizes preserved names and defaults only when they are echoed', () => {
		const name = 'na\u0000me\u007f'
		const seed = 'se\u0000ed\u007f'
		const initial = createInputState({ control: 'text', name, default: seed })

		expect(strip(renderInputView(initial))).toBe('? name › seed')
		const submitted = inputReduce(initial, parseKey(RETURN))
		expect(submitted.value).toBe(seed)
		expect(strip(submitted.view)).toBe('✔ name seed')
		expect(seed).not.toBe(sanitizeDisplayText(seed))
	})
})

describe('password reducer', () => {
	it('masks every live and committed byte while resolving the real value', () => {
		const initial = createPasswordState({
			control: 'password',
			name: 'secret',
			label: 'Secret',
			mask: '•',
		})
		const typed = feedReducer(passwordReduce, initial, ['s', '3'])
		expect(strip(renderPasswordView(typed.state))).toContain('••')
		expect(renderPasswordView(typed.state)).not.toContain('s3')
		const submitted = passwordReduce(typed.state, parseKey(RETURN))
		expect(submitted.value).toBe('s3')
		expect(submitted.view).not.toContain('s3')
	})

	it('cancels on ctrl-c', () => {
		const initial = createPasswordState({ control: 'password', name: 'secret' })
		expect(passwordReduce(initial, parseKey(CTRL_C)).status).toBe('cancel')
	})
})

describe('confirm reducer', () => {
	it('submits y, n, and the default', () => {
		const yes = createConfirmState({ control: 'confirm', name: 'ready', default: true })
		expect(confirmReduce(yes, parseKey('y')).value).toBe(true)
		expect(confirmReduce(yes, parseKey('N')).value).toBe(false)
		expect(confirmReduce(yes, parseKey(RETURN)).value).toBe(true)
	})

	it('ignores unrelated keys and cancels on ctrl-c', () => {
		const state = createConfirmState({ control: 'confirm', name: 'ready' })
		expect(confirmReduce(state, parseKey('x')).status).toBe('active')
		expect(confirmReduce(state, parseKey(CTRL_C)).status).toBe('cancel')
		expect(strip(renderConfirmView(state))).toContain('(y/N)')
	})
})

describe('select reducer', () => {
	const field: SelectField = {
		control: 'select',
		name: 'role',
		label: 'Role',
		choices: [
			{ value: 'admin', label: 'Admin' },
			{ value: 'viewer', label: 'Viewer', help: 'Read only' },
		],
		default: 'viewer',
	}

	it('focuses the default, wraps, and submits the choice value', () => {
		const initial = createSelectState(field)
		expect(initial.focused).toBe(1)
		expect(selectReduce(initial, parseKey(`${KEY_CSI}B`)).state.focused).toBe(0)
		expect(selectReduce(initial, parseKey(RETURN)).value).toBe('viewer')
	})

	it('renders every label and help string', () => {
		const view = strip(renderSelectView(createSelectState(field)))
		expect(view).toContain('Admin')
		expect(view).toContain('Viewer  Read only')
	})
})

describe('checkbox reducer', () => {
	const field: CheckboxField = {
		control: 'checkbox',
		name: 'scope',
		label: 'Scope',
		choices: [
			{ value: 'read', label: 'Read' },
			{ value: 'write', label: 'Write' },
		],
		default: ['write'],
	}

	it('seeds, toggles copy-on-write, and submits in choice order', () => {
		const initial = createCheckboxState(field)
		expect(initial.checked).toEqual([1])
		const toggled = checkboxReduce(initial, parseKey(SPACE))
		expect(toggled.state).not.toBe(initial)
		expect(toggled.state.checked).toEqual([1, 0])
		expect(checkboxReduce(toggled.state, parseKey(RETURN)).value).toEqual(['read', 'write'])
	})

	it('renders boxes and the selection count', () => {
		const view = strip(renderCheckboxView(createCheckboxState(field)))
		expect(view).toContain('Read')
		expect(view).toContain('Write')
		expect(view).toContain('1 selected')
	})

	it('toggleIndex adds and removes without mutating the input', () => {
		const source = [1]
		expect(toggleIndex(source, 0)).toEqual([1, 0])
		expect(toggleIndex(source, 1)).toEqual([])
		expect(source).toEqual([1])
	})
})

describe('editor reducer', () => {
	it('commits lines and finishes with ctrl-d', () => {
		const initial = createEditorState({ control: 'editor', name: 'notes', label: 'Notes' })
		const final = feedReducer(editorReduce, initial, ['a', RETURN, 'b', CTRL_D])
		expect(final).toMatchObject({ status: 'submit', value: 'a\nb' })
		expect(strip(final.view)).toBe('✔ Notes 2 lines')
	})

	it('uses the default for an empty editor and cancels on ctrl-c', () => {
		const state = createEditorState({ control: 'editor', name: 'notes', default: 'seed' })
		expect(editorReduce(state, parseKey(CTRL_D)).value).toBe('seed')
		expect(editorReduce(state, parseKey(CTRL_C)).status).toBe('cancel')
		expect(strip(renderEditorView(state))).toContain('(Ctrl+D to finish)')
	})
})

describe('editLine', () => {
	it('applies line-editing keys and refuses navigation', () => {
		expect(editLine('ab', parseKey('c'))).toBe('abc')
		expect(editLine('ab', parseKey(SPACE))).toBe('ab ')
		expect(editLine('ab', parseKey(BACKSPACE))).toBe('a')
		expect(editLine('ab', parseKey(CTRL_U))).toBe('')
		expect(editLine('ab', parseKey(`${KEY_CSI}A`))).toBeUndefined()
	})
})

describe('presentation', () => {
	it('merges and freezes a partial theme without moving defaults', () => {
		const attributes: Attribute[] = ['underline']
		const theme = createPromptTheme({
			icons: { pointer: '=>' },
			roles: { content: { foreground: 'blue', attributes } },
		})
		attributes.push('bold')
		expect(theme.icons.pointer).toBe('=>')
		expect(theme.icons.question).toBe('?')
		expect(theme.roles.content.attributes).toEqual(['underline'])
		expect(Object.isFrozen(theme)).toBe(true)
	})

	it('renders the four shared line shapes', () => {
		const state = createInputState({ control: 'text', name: 'name', label: 'Name' })
		expect(strip(renderPromptHeader(state.styler, state.theme, 'Name'))).toBe('? Name')
		expect(strip(renderHintedHeader(state.styler, state.theme, 'Name', 'hint'))).toBe('? Name hint')
		expect(strip(renderSubmitHeader(state.styler, state.theme, 'Name'))).toBe('✔ Name')
		expect(strip(renderErrorLine(state.styler, state.theme, 'No'))).toBe('✖ No')
	})

	it('sanitizes supplied theme glyphs only', () => {
		expect(sanitizeThemeIcons({ icons: { pointer: '\u001b[31m>\u001b[0m\n' } })).toEqual({
			icons: { pointer: '>' },
		})
		const roles: PromptThemeOptions = { roles: { message: { attributes: ['bold'] } } }
		expect(sanitizeThemeIcons(roles)).toBe(roles)
	})
})

describe('schema sanitization', () => {
	it('removes ANSI, C0, line controls, and DEL from one display slot', () => {
		expect(sanitizeDisplayText('\u001b[31mQ\u001b[0m\u0000\t\n\r\u007f')).toBe('Q')
	})

	it('preserves identity and value strings while cleaning display strings and metadata', () => {
		const hostile = createHostileSchema()
		const sanitized = sanitizeSchema(hostile)

		expect(sanitized.name).toBe(hostile.name)
		expect(sanitized.groups?.map((group) => group.name)).toEqual(
			hostile.groups?.map((group) => group.name),
		)
		expect(sanitized.fields.map((field) => field.name)).toEqual(
			hostile.fields.map((field) => field.name),
		)
		expect(sanitized.fields.map((field) => field.group)).toEqual(
			hostile.fields.map((field) => field.group),
		)
		expect(
			sanitized.fields.map((field) => ('default' in field ? field.default : undefined)),
		).toEqual(hostile.fields.map((field) => ('default' in field ? field.default : undefined)))
		expect(
			sanitized.fields.flatMap((field) =>
				field.control === 'select' || field.control === 'checkbox'
					? field.choices.map((choice) => choice.value)
					: [],
			),
		).toEqual(
			hostile.fields.flatMap((field) =>
				field.control === 'select' || field.control === 'checkbox'
					? field.choices.map((choice) => choice.value)
					: [],
			),
		)

		expect(sanitized.label).toBe('Form')
		expect(sanitized.help).toBe('Form help')
		expect(requireValue(sanitized.groups?.[0], 'Missing sanitized group')).toMatchObject({
			label: 'Group',
			help: 'Group help',
		})
		expect(requireValue(sanitized.fields[0], 'Missing sanitized text field')).toMatchObject({
			label: 'Text',
			help: 'Text help',
			placeholder: 'placeholder',
			rule: { pattern: 'pattern' },
		})
		expect(requireValue(sanitized.fields[1], 'Missing sanitized editor field')).toMatchObject({
			label: 'Editor',
			placeholder: 'editor placeholder',
		})
		expect(requireValue(sanitized.fields[2], 'Missing sanitized password field')).toMatchObject({
			mask: '*',
		})
		expect(requireValue(sanitized.fields[3], 'Missing sanitized number field')).toMatchObject({
			placeholder: 'number placeholder',
		})
		expect(requireValue(sanitized.fields[9], 'Missing sanitized select field')).toMatchObject({
			choices: [{ label: 'One', help: 'One help' }],
		})
		expect(requireValue(sanitized.fields[10], 'Missing sanitized checkbox field')).toMatchObject({
			choices: [{ label: 'Two', help: 'Two help' }],
		})
		expect(requireValue(sanitized.fields[11], 'Missing sanitized file field')).toMatchObject({
			accept: ['text/plain'],
		})
		expect(requireValue(sanitized.fields[4], 'Missing sanitized date field').rule).toEqual(
			requireValue(hostile.fields[4], 'Missing hostile date field').rule,
		)
		expect('meta' in requireValue(sanitized.fields[0], 'Missing sanitized text field')).toBe(false)
	})

	it('has a hostile negative control that distinguishes raw display text from its projection', () => {
		const hostile = createHostileSchema()
		const sanitized = sanitizeSchema(hostile)
		const label = requireValue(hostile.fields[0], 'Missing hostile text field').label ?? ''
		expect(label).not.toBe(sanitizeDisplayText(label))
		expect(requireValue(sanitized.fields[0], 'Missing sanitized text field').label).toBe(
			sanitizeDisplayText(label),
		)
	})
})

describe('wire guards and serializers', () => {
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

	it('serializes pending, expire, and destroy frames exactly', () => {
		const pending = createPendingForm(undefined, { id: 'one' })
		expect(serializePending(pending)).toEqual({
			event: 'pending',
			data: JSON.stringify(pending),
			id: 'one',
		})
		expect(serializeExpire('one')).toEqual({ event: 'expire', data: '{"id":"one"}' })
		expect(serializeDestroy()).toEqual({ event: 'destroy', data: '' })
	})
})

describe('host seams', () => {
	it('recognizes abort errors only by the host error contract', () => {
		expect(isAbortError(new DOMException('stopped', 'AbortError'))).toBe(true)
		const error = new Error('stopped')
		error.name = 'AbortError'
		expect(isAbortError(error)).toBe(true)
		expect(isAbortError(new Error('other'))).toBe(false)
		expect(isAbortError({ name: 'AbortError' })).toBe(false)
	})

	it('flags only non-loopback plain HTTP endpoints', () => {
		expect(isInsecureRemote('http://example.com')).toBe(true)
		expect(isInsecureRemote('http://user@example.com/path')).toBe(true)
		expect(isInsecureRemote('http://localhost:3000')).toBe(false)
		expect(isInsecureRemote('http://127.0.0.1')).toBe(false)
		expect(isInsecureRemote('http://[::1]:3000')).toBe(false)
		expect(isInsecureRemote('https://example.com')).toBe(false)
		expect(isInsecureRemote('not a url')).toBe(false)
	})

	it('defaultTimer fires on real short time and its cancel is idempotent', async () => {
		let count = 0
		defaultTimer(() => {
			count += 1
		}, 10)
		const cancel = defaultTimer(() => {
			count += 10
		}, 10)
		cancel()
		cancel()
		await waitForDelay(20)
		expect(count).toBe(1)
	})

	it('manual timers retain arm order and ignore cancelled deadlines', () => {
		const timer = createManualTimer()
		const order: number[] = []
		timer.handler(() => order.push(1), 20)
		const cancel = timer.handler(() => order.push(2), 20)
		timer.handler(() => order.push(3), 20)
		cancel()
		timer.flush()
		expect(order).toEqual([1, 3])
		expect(timer.pending).toBe(0)
	})
})
