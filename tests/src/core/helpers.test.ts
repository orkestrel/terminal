import type {
	PasswordState,
	PendingPrompt,
	PromptStep,
	ValidationRules,
	Validator,
} from '@src/core'
import {
	appendRule,
	buildRuleValidator,
	checkboxReduce,
	checkboxView,
	composeValidators,
	confirmReduce,
	confirmView,
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createSelectState,
	dispatchPendingPrompt,
	editLine,
	editorReduce,
	evaluateRule,
	gateSelection,
	inputReduce,
	inputView,
	isAnswerPayload,
	isCheckboxChoice,
	isInsecureRemote,
	isPendingPrompt,
	isPendingPromptStatus,
	isPrintable,
	isPromptChoice,
	isPromptType,
	isTerminalSnapshot,
	normalizeCheckboxChoice,
	normalizeChoice,
	parseKey,
	passing,
	passwordReduce,
	reconstructValidationRules,
	resolveChoices,
	resolveOption,
	resolveValidation,
	selectReduce,
	selectView,
	serializeChoices,
	serializeExpire,
	serializePending,
	serializePromptOptions,
	serializeShutdown,
	serializeValidationRules,
	toggleIndex,
} from '@src/core'
import { createStyler, strip } from '@orkestrel/console'
import { isNumber, isString } from '@orkestrel/contract'
import { createRecordingTerminal, feedReducer } from '../../setup.js'
import { describe, expect, it } from 'vitest'

// The PURE prompt core — parseKey (a total key decoder), the validation engine
// (resolveValidation + every rule), the choice normalizers, and the six prompt reducers
// driven as deterministic state machines. Reducers are tested with a plain (disabled) styler
// so the rendered `view` reads as plain text; a couple of cases use an enabled styler + strip
// to prove the view IS styled. Every reducer assertion threads state through a scripted
// KeyEvent sequence (decoded via the real parseKey) and checks state / view / value / status.

// A plain styler — every call returns its text verbatim, so a view's CONTENT is asserted directly.
const plain = createStyler({ enabled: false })

// === parseKey

describe('parseKey', () => {
	// One row per (input bytes → expected name / modifiers). Covers control bytes, the CSI and SS3
	// arrow forms, home / end / delete, the ctrl combos, and a printable char.
	const cases: readonly {
		readonly label: string
		readonly input: string
		readonly name: string
		readonly ctrl?: boolean
		readonly meta?: boolean
		readonly shift?: boolean
	}[] = [
		{ label: 'carriage return → return', input: '\r', name: 'return' },
		{ label: 'line feed → return', input: '\n', name: 'return' },
		{ label: 'tab', input: '\t', name: 'tab' },
		{ label: 'escape', input: '\x1b', name: 'escape' },
		{ label: 'DEL → backspace', input: '\x7f', name: 'backspace' },
		{ label: 'BS → backspace', input: '\b', name: 'backspace' },
		{ label: 'space', input: ' ', name: 'space' },
		{ label: 'CSI up', input: '\x1b[A', name: 'up', meta: true },
		{ label: 'CSI down', input: '\x1b[B', name: 'down', meta: true },
		{ label: 'CSI right', input: '\x1b[C', name: 'right', meta: true },
		{ label: 'CSI left', input: '\x1b[D', name: 'left', meta: true },
		{ label: 'SS3 up', input: '\x1bOA', name: 'up', meta: true },
		{ label: 'SS3 down', input: '\x1bOB', name: 'down', meta: true },
		{ label: 'home (letter)', input: '\x1b[H', name: 'home', meta: true },
		{ label: 'end (letter)', input: '\x1b[F', name: 'end', meta: true },
		{ label: 'home (numeric)', input: '\x1b[1~', name: 'home', meta: true },
		{ label: 'end (numeric)', input: '\x1b[4~', name: 'end', meta: true },
		{ label: 'delete', input: '\x1b[3~', name: 'delete', meta: true },
		{ label: 'ctrl-c', input: '\x03', name: 'c', ctrl: true },
		{ label: 'ctrl-d', input: '\x04', name: 'd', ctrl: true },
		{ label: 'ctrl-u', input: '\x15', name: 'u', ctrl: true },
		{ label: 'ctrl-a', input: '\x01', name: 'a', ctrl: true },
		{ label: 'ctrl-e', input: '\x05', name: 'e', ctrl: true },
		{ label: 'lowercase char', input: 'a', name: 'a' },
		{ label: 'digit char', input: '7', name: '7' },
		{ label: 'punctuation char', input: '?', name: '?' },
		{ label: 'uppercase char → shift', input: 'A', name: 'A', shift: true },
	]

	for (const row of cases) {
		it(`decodes ${row.label}`, () => {
			const key = parseKey(row.input)
			expect(key.name).toBe(row.name)
			expect(key.sequence).toBe(row.input)
			expect(key.ctrl).toBe(row.ctrl ?? false)
			expect(key.meta).toBe(row.meta ?? false)
			expect(key.shift).toBe(row.shift ?? false)
		})
	}

	it('decodes a Uint8Array (UTF-8) the same as the string', () => {
		const bytes = new TextEncoder().encode('\x1b[A')
		expect(parseKey(bytes)).toEqual(parseKey('\x1b[A'))
	})

	it('decodes a multi-byte UTF-8 printable from a Uint8Array', () => {
		const key = parseKey(new TextEncoder().encode('é'))
		expect(key.name).toBe('é')
		expect(key.sequence).toBe('é')
	})

	it('is total — an unknown escape yields name = empty with the raw sequence', () => {
		const key = parseKey('\x1b[99Z')
		expect(key.name).toBe('')
		expect(key.sequence).toBe('\x1b[99Z')
	})

	it('is total — empty input never throws', () => {
		expect(parseKey('')).toEqual({ name: '', sequence: '', ctrl: false, meta: false, shift: false })
	})
})

describe('isPrintable', () => {
	it('accepts visible characters and rejects control bytes', () => {
		expect(isPrintable('a')).toBe(true)
		expect(isPrintable(' ')).toBe(true)
		expect(isPrintable('é')).toBe(true)
		expect(isPrintable('\x03')).toBe(false)
		expect(isPrintable('\x7f')).toBe(false)
		expect(isPrintable('')).toBe(false)
	})
})

// === Validation engine

describe('resolveValidation', () => {
	it('returns an always-passing validator when nothing is supplied', () => {
		const validator = resolveValidation()
		expect(validator('')).toBe(true)
		expect(validator('anything')).toBe(true)
	})

	it('passes a bare validator function through unchanged', () => {
		const custom: Validator = (input) => (input === 'ok' ? true : 'nope')
		expect(resolveValidation(custom)).toBe(custom)
	})

	it('required — rejects empty / whitespace, accepts content', () => {
		const validator = resolveValidation({ required: true })
		expect(validator('')).toBe('This field is required')
		expect(validator('   ')).toBe('This field is required')
		expect(validator('x')).toBe(true)
	})

	it('minimum / maximum — gate the length with the count interpolated', () => {
		const validator = resolveValidation({ minimum: 3, maximum: 5 })
		expect(validator('ab')).toBe('Must be at least 3 characters')
		expect(validator('abcdef')).toBe('Must be at most 5 characters')
		expect(validator('abcd')).toBe(true)
	})

	it('pattern — tests the regex source and reports it', () => {
		const validator = resolveValidation({ pattern: '^[a-z]+$' })
		expect(validator('ABC')).toBe('Must match pattern: ^[a-z]+$')
		expect(validator('abc')).toBe(true)
	})

	it('email / url — apply the built-in patterns', () => {
		expect(resolveValidation({ email: true })('nope')).toBe('Must be a valid email address')
		expect(resolveValidation({ email: true })('a@b.co')).toBe(true)
		expect(resolveValidation({ url: true })('ftp://x')).toBe('Must be a valid URL')
		expect(resolveValidation({ url: true })('https://x.dev')).toBe(true)
	})

	it('numeric / integer / alphanumeric — apply the built-in patterns', () => {
		expect(resolveValidation({ numeric: true })('1.5')).toBe(true)
		expect(resolveValidation({ numeric: true })('1.5.0')).toBe('Must be a numeric value')
		expect(resolveValidation({ integer: true })('1.5')).toBe('Must be an integer')
		expect(resolveValidation({ integer: true })('-42')).toBe(true)
		expect(resolveValidation({ alphanumeric: true })('a1')).toBe(true)
		expect(resolveValidation({ alphanumeric: true })('a-1')).toBe(
			'Must contain only letters and digits',
		)
	})

	it('custom — runs the escape-hatch validator', () => {
		const rules: ValidationRules = { custom: (input) => (input.includes('@') ? true : 'need @') }
		const validator = resolveValidation(rules)
		expect(validator('a')).toBe('need @')
		expect(validator('a@b')).toBe(true)
	})

	it('a function rule overrides the built-in check', () => {
		const validator = resolveValidation({
			required: (input) => (input === 'x' ? true : 'must be x'),
		})
		expect(validator('y')).toBe('must be x')
		expect(validator('x')).toBe(true)
	})

	it('composes rules in order — the first failure short-circuits', () => {
		const validator = resolveValidation({ required: true, minimum: 3 })
		// Empty fails `required` first (not `minimum`).
		expect(validator('')).toBe('This field is required')
		expect(validator('ab')).toBe('Must be at least 3 characters')
		expect(validator('abc')).toBe(true)
	})
})

describe('evaluateRule / buildRuleValidator / composeValidators', () => {
	it('evaluateRule returns undefined on pass and the message on fail', () => {
		expect(evaluateRule('required', true, 'x')).toBeUndefined()
		expect(evaluateRule('required', true, '')).toBe('This field is required')
	})

	it('a function check returning a non-string falsy resolves to the generic message', () => {
		const validator: Validator = () => 'bad'
		expect(evaluateRule('custom', validator, 'x')).toBe('bad')
	})

	it('buildRuleValidator wraps a primitive rule into a Validator', () => {
		const validator = buildRuleValidator('minimum', 2)
		expect(validator('a')).toBe('Must be at least 2 characters')
		expect(validator('ab')).toBe(true)
	})

	it('composeValidators returns the first error, else true', () => {
		const a: Validator = (input) => (input.length > 0 ? true : 'empty')
		const b: Validator = (input) => (input.startsWith('x') ? true : 'need x')
		const composed = composeValidators(a, b)
		expect(composed('')).toBe('empty')
		expect(composed('y')).toBe('need x')
		expect(composed('xy')).toBe(true)
		// The empty composition always passes.
		expect(composeValidators()('anything')).toBe(true)
	})
})

// === Choice normalization

describe('normalizeChoice / normalizeCheckboxChoice', () => {
	it('a bare string becomes both name and value', () => {
		expect(normalizeChoice('one')).toEqual({ name: 'one', value: 'one' })
		expect(normalizeCheckboxChoice('two')).toEqual({ name: 'two', value: 'two' })
	})

	it('a full object passes through unchanged', () => {
		const choice = { name: 'One', value: '1', description: 'first' }
		expect(normalizeChoice(choice)).toBe(choice)
		const checkbox = { name: 'Two', value: '2', checked: true }
		expect(normalizeCheckboxChoice(checkbox)).toBe(checkbox)
	})
})

// === Reducer drivers (deterministic)
//
// The shared `feedReducer` helper (tests/setup.ts, AGENTS §16.1) threads a scripted key
// sequence through a reducer via the real `parseKey` — the one general form of the
// per-reducer `feed` / `feedInput` drivers that used to be hand-duplicated below.

describe('inputReduce', () => {
	it('accumulates printable characters into the value', () => {
		const step = feedReducer(inputReduce, createInputState({ message: 'Name', styler: plain }), [
			'h',
			'i',
		])
		expect(step.status).toBe('active')
		expect(step.state.value).toBe('hi')
		expect(step.view).toContain('hi')
	})

	it('backspace shrinks, space inserts, ctrl-u clears', () => {
		const base = createInputState({ message: 'Name', styler: plain })
		expect(feedReducer(inputReduce, base, ['a', 'b', '\x7f']).state.value).toBe('a')
		expect(feedReducer(inputReduce, base, ['a', ' ', 'b']).state.value).toBe('a b')
		expect(feedReducer(inputReduce, base, ['a', 'b', '\x15']).state.value).toBe('')
	})

	it('submits the typed value through the validator', () => {
		const step = feedReducer(inputReduce, createInputState({ message: 'Name', styler: plain }), [
			'j',
			'o',
			'\r',
		])
		expect(step.status).toBe('submit')
		expect(step.value).toBe('jo')
	})

	it('an empty submit falls back to the default', () => {
		const step = feedReducer(
			inputReduce,
			createInputState({ message: 'Name', default: 'anon', styler: plain }),
			['\r'],
		)
		expect(step.status).toBe('submit')
		expect(step.value).toBe('anon')
	})

	it('a failing validator keeps the prompt active with the error in the view', () => {
		const step = feedReducer(
			inputReduce,
			createInputState({ message: 'Name', validate: { minimum: 3 }, styler: plain }),
			['a', '\r'],
		)
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Must be at least 3 characters')
		expect(step.view).toContain('Must be at least 3 characters')
	})

	it('ctrl-c cancels', () => {
		const step = feedReducer(inputReduce, createInputState({ message: 'Name', styler: plain }), [
			'a',
			'\x03',
		])
		expect(step.status).toBe('cancel')
		expect(step.value).toBeUndefined()
	})

	it('renders a styled view with an enabled styler', () => {
		const styled = createStyler({ enabled: true })
		const step = inputReduce(createInputState({ message: 'Name', styler: styled }), parseKey('x'))
		// The raw view carries ANSI; stripped, it shows the message + the typed char.
		expect(step.view).not.toBe(strip(step.view))
		expect(strip(step.view)).toContain('Name')
		expect(strip(step.view)).toContain('x')
	})
})

describe('passwordReduce', () => {
	it('keeps the real value but masks it in the view', () => {
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', styler: plain }),
			['1', '2', '3'],
		)
		expect(step.state.value).toBe('123')
		expect(step.view).toContain('***')
		expect(step.view).not.toContain('123')
	})

	it('honors a custom mask', () => {
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', mask: '•', styler: plain }),
			['a', 'b'],
		)
		expect(step.view).toContain('••')
	})

	it('submits the unmasked value through the validator', () => {
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', validate: { minimum: 4 }, styler: plain }),
			['1', '2', '\r'],
		)
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Must be at least 4 characters')
		const ok = feedReducer(passwordReduce, createPasswordState({ message: 'PIN', styler: plain }), [
			's',
			'e',
			'c',
			'\r',
		])
		expect(ok.status).toBe('submit')
		expect(ok.value).toBe('sec')
	})

	it('ctrl-c cancels', () => {
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', styler: plain }),
			['1', '\x03'],
		)
		expect(step.status).toBe('cancel')
	})
})

describe('confirmReduce', () => {
	it('y submits true, n submits false', () => {
		const base = createConfirmState({ message: 'OK?', styler: plain })
		const yes = confirmReduce(base, parseKey('y'))
		expect(yes.status).toBe('submit')
		expect(yes.value).toBe(true)
		const no = confirmReduce(base, parseKey('n'))
		expect(no.status).toBe('submit')
		expect(no.value).toBe(false)
	})

	it('Y submits true, N submits false (case-insensitive)', () => {
		const base = createConfirmState({ message: 'OK?', styler: plain })
		const yes = confirmReduce(base, parseKey('Y'))
		expect(yes.status).toBe('submit')
		expect(yes.value).toBe(true)
		const no = confirmReduce(base, parseKey('N'))
		expect(no.status).toBe('submit')
		expect(no.value).toBe(false)
	})

	it('return on an empty line submits the default', () => {
		const off = confirmReduce(createConfirmState({ message: 'OK?', styler: plain }), parseKey('\r'))
		expect(off.value).toBe(false)
		const on = confirmReduce(
			createConfirmState({ message: 'OK?', default: true, styler: plain }),
			parseKey('\r'),
		)
		expect(on.value).toBe(true)
	})

	it('renders the (Y/n) hint with the default emphasized', () => {
		const view = confirmReduce(
			createConfirmState({ message: 'OK?', default: true, styler: plain }),
			parseKey('z'),
		).view
		expect(view).toContain('(Y/n)')
	})

	it('an unrelated key keeps the prompt active', () => {
		const step = confirmReduce(createConfirmState({ message: 'OK?', styler: plain }), parseKey('z'))
		expect(step.status).toBe('active')
	})

	it('ctrl-c cancels', () => {
		const step = confirmReduce(
			createConfirmState({ message: 'OK?', styler: plain }),
			parseKey('\x03'),
		)
		expect(step.status).toBe('cancel')
	})
})

describe('selectReduce', () => {
	const options = { message: 'Pick', choices: ['a', 'b', 'c'], styler: plain }

	it('renders one row per choice with the focused row marked', () => {
		const view = selectView(createSelectState(options))
		const lines = view.split('\n')
		expect(lines).toHaveLength(4) // header + 3 rows
		expect(view).toContain('a')
		expect(view).toContain('c')
	})

	it('down/up move the focus and wrap', () => {
		expect(feedReducer(selectReduce, createSelectState(options), ['\x1b[B']).state.focused).toBe(1)
		// Up from the first wraps to the last.
		expect(feedReducer(selectReduce, createSelectState(options), ['\x1b[A']).state.focused).toBe(2)
		// j/k aliases.
		expect(feedReducer(selectReduce, createSelectState(options), ['j', 'j']).state.focused).toBe(2)
		expect(feedReducer(selectReduce, createSelectState(options), ['k']).state.focused).toBe(2)
	})

	it('pre-focuses the default choice', () => {
		const state = createSelectState({ ...options, default: 'c' })
		expect(state.focused).toBe(2)
	})

	it('return submits the focused choice value', () => {
		const step = feedReducer(selectReduce, createSelectState(options), ['\x1b[B', '\r'])
		expect(step.status).toBe('submit')
		expect(step.value).toBe('b')
	})

	it('ctrl-c cancels', () => {
		expect(feedReducer(selectReduce, createSelectState(options), ['\x03']).status).toBe('cancel')
	})
})

describe('checkboxReduce', () => {
	const options = { message: 'Pick', choices: ['a', 'b', 'c'], styler: plain }

	it('space toggles the focused box', () => {
		// toggle index 0, move down, toggle index 1.
		const step = feedReducer(checkboxReduce, createCheckboxState(options), [' ', '\x1b[B', ' '])
		expect([...step.state.checked].sort((x, y) => x - y)).toEqual([0, 1])
	})

	it('seeds the checked set from initial checked choices', () => {
		const state = createCheckboxState({
			message: 'Pick',
			choices: [{ name: 'a', value: 'a', checked: true }, 'b'],
			styler: plain,
		})
		expect(state.checked).toEqual([0])
	})

	it('submits the checked values in choice order', () => {
		// Check c (index 2) first, then a (index 0); the result is ordered [a, c].
		const step = feedReducer(checkboxReduce, createCheckboxState(options), [
			'\x1b[B',
			'\x1b[B',
			' ',
			'\x1b[A',
			'\x1b[A',
			' ',
			'\r',
		])
		expect(step.status).toBe('submit')
		expect(step.value).toEqual(['a', 'c'])
	})

	it('the count summary appears in the view', () => {
		const step = feedReducer(checkboxReduce, createCheckboxState(options), [' '])
		expect(step.view).toContain('1 selected')
	})

	it('min gating rejects an under-full submit with the reason', () => {
		const step = feedReducer(checkboxReduce, createCheckboxState({ ...options, min: 2 }), [
			' ',
			'\r',
		])
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Select at least 2 options')
		expect(step.view).toContain('Select at least 2 options')
	})

	it('max gating rejects an over-full submit', () => {
		const step = feedReducer(checkboxReduce, createCheckboxState({ ...options, max: 1 }), [
			' ',
			'\x1b[B',
			' ',
			'\r',
		])
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Select no more than 1 option')
	})

	it('an empty submit is allowed when no min is set', () => {
		const step = feedReducer(checkboxReduce, createCheckboxState(options), ['\r'])
		expect(step.status).toBe('submit')
		expect(step.value).toEqual([])
	})

	it('ctrl-c cancels', () => {
		expect(feedReducer(checkboxReduce, createCheckboxState(options), ['\x03']).status).toBe(
			'cancel',
		)
	})
})

describe('toggleIndex / gateSelection', () => {
	it('toggleIndex adds and removes an index (copy-on-write)', () => {
		expect(toggleIndex([], 1)).toEqual([1])
		expect(toggleIndex([1, 2], 1)).toEqual([2])
	})

	it('gateSelection reports under/over range and pluralizes', () => {
		expect(gateSelection(0, 1)).toBe('Select at least 1 option')
		expect(gateSelection(0, 2)).toBe('Select at least 2 options')
		expect(gateSelection(3, undefined, 1)).toBe('Select no more than 1 option')
		expect(gateSelection(1, 1, 3)).toBeUndefined()
	})
})

describe('editorReduce', () => {
	it('accumulates multi-line text, return committing a line', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'h',
			'i',
			'\r',
			'y',
			'o',
		])
		expect(step.state.lines).toEqual(['hi'])
		expect(step.state.current).toBe('yo')
	})

	it('ctrl-d finishes, joining the lines with newlines', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'a',
			'\r',
			'b',
			'\x04',
		])
		expect(step.status).toBe('submit')
		expect(step.value).toBe('a\nb')
	})

	it('an empty finish falls back to the default', () => {
		const step = feedReducer(
			editorReduce,
			createEditorState({ message: 'Body', default: 'none', styler: plain }),
			['\x04'],
		)
		expect(step.status).toBe('submit')
		expect(step.value).toBe('none')
	})

	it('validates the whole text on finish — invalid stays active', () => {
		const step = feedReducer(
			editorReduce,
			createEditorState({ message: 'Body', validate: { minimum: 5 }, styler: plain }),
			['h', 'i', '\x04'],
		)
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Must be at least 5 characters')
	})

	it('backspace edits the current line', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'a',
			'b',
			'\x7f',
		])
		expect(step.state.current).toBe('a')
	})

	it('ctrl-c cancels', () => {
		expect(
			feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
				'a',
				'\x03',
			]).status,
		).toBe('cancel')
	})
})

describe('editLine', () => {
	it('appends a printable, drops on backspace, clears on ctrl-u, inserts space', () => {
		expect(editLine('ab', parseKey('c'))).toBe('abc')
		expect(editLine('ab', parseKey('\x7f'))).toBe('a')
		expect(editLine('ab', parseKey('\x15'))).toBe('')
		expect(editLine('ab', parseKey(' '))).toBe('ab ')
	})

	it('returns undefined for a non-editing key', () => {
		expect(editLine('ab', parseKey('\x1b[A'))).toBeUndefined()
		expect(editLine('ab', parseKey('\x1b'))).toBeUndefined()
	})
})

// === Wire serialization + dispatch (T-b)

describe('serializePromptOptions', () => {
	it('drops the styler and a bare-function validate, keeps declarative data', () => {
		const wire = serializePromptOptions({
			message: 'Name?',
			default: 'Ada',
			mask: '*',
			styler: createStyler(),
			validate: () => true,
		})
		expect(wire).toEqual({ message: 'Name?', default: 'Ada', mask: '*' })
	})

	it('flattens a function rule inside validate to true (keeps the built-in rules)', () => {
		const wire = serializePromptOptions({
			message: 'x',
			validate: { required: true, minimum: 3, custom: () => true },
		})
		expect(wire.validate).toEqual({ required: true, minimum: 3, custom: true })
	})

	it('drops a function validate entirely without throwing (wire-safety)', () => {
		const validate: Validator = (_input) => true
		let wire: Readonly<Record<string, unknown>> | undefined
		// A FUNCTION validate has no declarative form to keep — it is dropped, and serialization never
		// throws on the unserializable function (it cannot survive the SSE wire).
		expect(() => {
			wire = serializePromptOptions({ message: 'Name?', validate })
		}).not.toThrow()
		expect(wire).toEqual({ message: 'Name?' })
		expect(wire && 'validate' in wire).toBe(false)
	})

	it('strips functions from each choice, keeping plain fields', () => {
		const wire = serializePromptOptions({
			message: 'Pick',
			choices: ['a', { name: 'Bee', value: 'b', onPick: () => undefined }],
		})
		expect(wire.choices).toEqual(['a', { name: 'Bee', value: 'b' }])
	})
})

describe('reconstructValidationRules', () => {
	it('keeps only primitive rule values, dropping the rest', () => {
		expect(reconstructValidationRules({ required: true, minimum: 3, junk: { a: 1 } })).toEqual({
			required: true,
			minimum: 3,
		})
	})

	it('returns undefined for an empty / non-record payload', () => {
		expect(reconstructValidationRules({})).toBeUndefined()
		expect(reconstructValidationRules('nope')).toBeUndefined()
	})

	it('round-trips a serialized rules bag back into an applicable validator', () => {
		const wire = serializePromptOptions({ message: 'x', validate: { required: true, minimum: 2 } })
		const rules = reconstructValidationRules(wire.validate)
		const validator = resolveValidation(rules)
		expect(validator('')).toBe('This field is required')
		expect(validator('a')).toBe('Must be at least 2 characters')
		expect(validator('ab')).toBe(true)
	})
})

describe('isPendingPrompt', () => {
	it('accepts a well-formed wire record and rejects malformed ones', () => {
		const valid = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: {},
			status: 'pending',
			time: 1,
		}
		expect(isPendingPrompt(valid)).toBe(true)
		expect(isPendingPrompt({ ...valid, form: 'bogus' })).toBe(false) // not a PromptType
		expect(isPendingPrompt({ ...valid, id: '' })).toBe(false) // empty id
		expect(isPendingPrompt({ id: 'p1' })).toBe(false) // missing fields
	})

	it('accepts with from/to and without, rejects invalid from/to', () => {
		const valid = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: {},
			status: 'pending',
			time: 1,
		}
		expect(isPendingPrompt(valid)).toBe(true) // no from/to — both optional
		expect(isPendingPrompt({ ...valid, from: 'agent-1', to: 'human-1' })).toBe(true)
		expect(isPendingPrompt({ ...valid, from: 'agent-1' })).toBe(true) // only from
		expect(isPendingPrompt({ ...valid, to: 'human-1' })).toBe(true) // only to
		expect(isPendingPrompt({ ...valid, from: 1 })).toBe(false) // non-string from
		expect(isPendingPrompt({ ...valid, to: null })).toBe(false) // non-string to
	})
})

describe('dispatchPendingPrompt', () => {
	it('reconstructs typed options and drives the matching terminal method', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: { input: 'answered' } })
		const pending: PendingPrompt = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: { default: 'Ada', validate: { required: true } },
			status: 'pending',
			time: 1,
		}
		const value = await dispatchPendingPrompt(terminal, pending)
		expect(value).toBe('answered')
		const seen = calls.input.calls[0]?.[0]
		expect(seen?.message).toBe('Name?')
		expect(seen?.default).toBe('Ada')
		expect(seen && resolveValidation(seen.validate)('')).toBe('This field is required') // the validate rules were rebuilt
	})
})

// ============================================================================
// HARDENING — comprehensive edge coverage (totality, copy-on-write, boundaries,
// ReDoS, mask no-leak, every guard). Appended to the baseline suite above.
// ============================================================================

// === parseKey — totality & exotic input (AGENTS §16: every branch never throws)

describe('parseKey — totality & exotic input', () => {
	// A LONE escape decodes to the named `escape` key (the single ESC byte is in CONTROL_NAMES).
	it('a lone ESC is the named escape key, not a fallback', () => {
		const key = parseKey('\x1b')
		expect(key.name).toBe('escape')
		expect(key.ctrl).toBe(false)
		expect(key.meta).toBe(false)
	})

	// Every input that is NOT a recognized control / escape / printable falls to `name: ''`,
	// preserving the raw sequence — and NEVER throws. One row per hostile / partial / garbage shape.
	const fallbacks: readonly { readonly label: string; readonly input: string }[] = [
		{ label: 'a partial CSI (no final byte)', input: '\x1b[' },
		{ label: 'a partial SS3 (no final byte)', input: '\x1bO' },
		{ label: 'a truncated tilde sequence', input: '\x1b[3' },
		{ label: 'an unknown CSI final byte', input: '\x1b[99Z' },
		{ label: 'an unknown SS3 final byte', input: '\x1bOZ' },
		{ label: 'a bare DEL inside an escape', input: '\x1b\x7f' },
		{ label: 'a lone C0 control with no mapping (VT)', input: '\x0b' },
		{ label: 'a lone C0 control with no mapping (FF)', input: '\x0c' },
	]
	for (const row of fallbacks) {
		it(`is total for ${row.label} (name = empty, raw sequence kept)`, () => {
			let key: ReturnType<typeof parseKey> | undefined
			expect(() => {
				key = parseKey(row.input)
			}).not.toThrow()
			expect(key?.name).toBe('')
			expect(key?.sequence).toBe(row.input)
			expect(key?.ctrl).toBe(false)
			expect(key?.meta).toBe(false)
			expect(key?.shift).toBe(false)
		})
	}

	it('decodes a surrogate-pair emoji — first code point names the key, whole input is the sequence', () => {
		const key = parseKey('😀')
		expect(key.name).toBe('😀') // one code point (not the two UTF-16 halves)
		expect(key.sequence).toBe('😀')
		expect(key.shift).toBe(false) // an emoji has no case
	})

	it('decodes a multi-code-point pasted run — first code point names, whole run is the sequence', () => {
		const key = parseKey('hello')
		expect(key.name).toBe('h')
		expect(key.sequence).toBe('hello')
	})

	it('decodes a high-Unicode printable (CJK) as itself', () => {
		const key = parseKey('好')
		expect(key.name).toBe('好')
		expect(key.sequence).toBe('好')
	})

	it('decodes a multi-byte Uint8Array (an emoji) identically to its string', () => {
		const bytes = new TextEncoder().encode('😀')
		expect(parseKey(bytes)).toEqual(parseKey('😀'))
	})

	it('decodes the SS3 left / right arrows (alternate forms)', () => {
		expect(parseKey('\x1bOC').name).toBe('right')
		expect(parseKey('\x1bOD').name).toBe('left')
		expect(parseKey('\x1bOC').meta).toBe(true)
	})

	it('decodes home / end numeric-tilde 7~ / 8~ variants', () => {
		expect(parseKey('\x1b[7~').name).toBe('home')
		expect(parseKey('\x1b[8~').name).toBe('end')
	})

	it('an uppercase non-ASCII letter still sets shift', () => {
		// 'É' lowercases to 'é' (it differs), so the shift heuristic flags it.
		const key = parseKey('É')
		expect(key.name).toBe('É')
		expect(key.shift).toBe(true)
	})

	it('a fuzz sweep over every byte 0..255 never throws and always preserves the sequence', () => {
		for (let code = 0; code <= 255; code += 1) {
			const input = String.fromCharCode(code)
			let key: ReturnType<typeof parseKey> | undefined
			expect(() => {
				key = parseKey(input)
			}).not.toThrow()
			expect(key?.sequence).toBe(input)
			// `name` is always a string (a real name or the empty fallback) — never undefined.
			expect(typeof key?.name).toBe('string')
		}
	})
})

// === Validation engine — boundary-exact, combinations, Validator-function, ReDoS

describe('resolveValidation — rule boundaries (exact)', () => {
	it('minimum / maximum gate at the EXACT boundary length', () => {
		const min = resolveValidation({ minimum: 3 })
		expect(min('ab')).toBe('Must be at least 3 characters') // 2 < 3
		expect(min('abc')).toBe(true) // 3 == 3 passes (>=)
		const max = resolveValidation({ maximum: 3 })
		expect(max('abc')).toBe(true) // 3 == 3 passes (<=)
		expect(max('abcd')).toBe('Must be at most 3 characters') // 4 > 3
	})

	it('minimum 0 / maximum 0 — the degenerate bounds', () => {
		expect(resolveValidation({ minimum: 0 })('')).toBe(true) // 0 >= 0
		expect(resolveValidation({ maximum: 0 })('')).toBe(true) // 0 <= 0
		expect(resolveValidation({ maximum: 0 })('x')).toBe('Must be at most 0 characters')
	})

	it('email — boundary cases around the local@domain.tld shape', () => {
		const email = resolveValidation({ email: true })
		expect(email('a@b.co')).toBe(true)
		expect(email('a@b')).toBe('Must be a valid email address') // no dot-tld
		expect(email('@b.co')).toBe('Must be a valid email address') // empty local
		expect(email('a b@c.co')).toBe('Must be a valid email address') // whitespace
		expect(email('a@@b.co')).toBe('Must be a valid email address') // double @
	})

	it('url — only http(s):// with a non-empty rest passes', () => {
		const url = resolveValidation({ url: true })
		expect(url('http://x')).toBe(true)
		expect(url('https://x.dev/path')).toBe(true)
		expect(url('https://')).toBe('Must be a valid URL') // empty rest
		expect(url('ws://x')).toBe('Must be a valid URL')
		expect(url('ftp://x')).toBe('Must be a valid URL')
	})

	it('numeric — accepts signed integers / decimals, rejects malformed', () => {
		const numeric = resolveValidation({ numeric: true })
		expect(numeric('0')).toBe(true)
		expect(numeric('-0.5')).toBe(true)
		expect(numeric('42')).toBe(true)
		expect(numeric('1.')).toBe('Must be a numeric value') // trailing dot
		expect(numeric('.5')).toBe('Must be a numeric value') // leading dot
		expect(numeric('1e3')).toBe('Must be a numeric value') // no exponent form
		expect(numeric('')).toBe('Must be a numeric value')
	})

	it('integer — rejects a decimal, accepts a signed integer at the boundary', () => {
		const integer = resolveValidation({ integer: true })
		expect(integer('-42')).toBe(true)
		expect(integer('0')).toBe(true)
		expect(integer('42.0')).toBe('Must be an integer')
		expect(integer('1.5')).toBe('Must be an integer')
	})

	it('alphanumeric — letters and digits only, empty rejected', () => {
		const alnum = resolveValidation({ alphanumeric: true })
		expect(alnum('abc123')).toBe(true)
		expect(alnum('')).toBe('Must contain only letters and digits') // + needs >=1
		expect(alnum('a b')).toBe('Must contain only letters and digits')
		expect(alnum('a_b')).toBe('Must contain only letters and digits')
	})

	it('pattern — an empty source matches everything (always passes)', () => {
		// `new RegExp('')` matches any string, so an empty pattern never fails.
		expect(resolveValidation({ pattern: '' })('anything')).toBe(true)
	})

	it('required gates whitespace-only as empty (trim), distinct from minimum (raw length)', () => {
		expect(resolveValidation({ required: true })('   ')).toBe('This field is required')
		// minimum counts RAW length, so 3 spaces satisfy minimum: 3 (no trim).
		expect(resolveValidation({ minimum: 3 })('   ')).toBe(true)
	})
})

describe('resolveValidation — combinations & first-error order', () => {
	it('runs rules in the fixed order — required precedes minimum precedes pattern', () => {
		const validator = resolveValidation({ required: true, minimum: 3, pattern: '^[a-z]+$' })
		expect(validator('')).toBe('This field is required') // required fires first
		expect(validator('ab')).toBe('Must be at least 3 characters') // then minimum
		expect(validator('ABC')).toBe('Must match pattern: ^[a-z]+$') // then pattern
		expect(validator('abc')).toBe(true) // all pass
	})

	it('custom runs LAST, after every built-in rule', () => {
		const validator = resolveValidation({
			minimum: 2,
			custom: (input) => (input.startsWith('x') ? true : 'need x'),
		})
		// minimum fails before custom is consulted.
		expect(validator('a')).toBe('Must be at least 2 characters')
		// minimum passes, custom then rejects.
		expect(validator('ab')).toBe('need x')
		expect(validator('xy')).toBe(true)
	})

	it('a Validator FUNCTION supplied for a built-in rule is honored verbatim (overrides the built-in)', () => {
		// `minimum` given a function: the built-in length check is REPLACED by the function.
		const validator = resolveValidation({
			minimum: (input) => (input === 'exact' ? true : 'must be exact'),
		})
		expect(validator('x')).toBe('must be exact') // not the "at least N characters" message
		expect(validator('exact')).toBe(true)
	})

	it('an all-false / all-undefined rules bag yields an always-passing validator', () => {
		const allOff: ValidationRules = { required: false, email: false, numeric: undefined }
		const validator = resolveValidation(allOff)
		expect(validator('')).toBe(true)
		expect(validator('@@@')).toBe(true)
	})

	it('an empty rules object is always-passing', () => {
		expect(resolveValidation({})('anything')).toBe(true)
	})
})

describe('resolveValidation — ReDoS / pathological-input promptness', () => {
	// A long, adversarial input against each pattern rule must return PROMPTLY (the patterns are
	// linear — no catastrophic backtracking). Budget generously to stay non-flaky on a busy CI box.
	// The threat model is hostile INPUT against the BUILT-IN patterns (the rule author owns the
	// `pattern` source). Each built-in is linear — no nested quantifier — so a 50k adversarial input
	// that forces the no-match (backtracking) path must still return in well under a wall-clock budget.
	const long = 'a'.repeat(50_000)
	const probes: readonly { readonly label: string; readonly rules: ValidationRules }[] = [
		{ label: 'email', rules: { email: true } },
		{ label: 'url', rules: { url: true } },
		{ label: 'numeric', rules: { numeric: true } },
		{ label: 'integer', rules: { integer: true } },
		{ label: 'alphanumeric', rules: { alphanumeric: true } },
		// A linear `pattern` source against a long input — proving the rule evaluates promptly, not
		// that the regex engine survives a catastrophic SOURCE (which the author, not input, controls).
		{ label: 'pattern (linear source)', rules: { pattern: '^[a-z]+$' } },
	]
	for (const { label, rules } of probes) {
		it(`${label} returns promptly on a 50k pathological input`, () => {
			const validator = resolveValidation(rules)
			const start = Date.now()
			const result = validator(`${long}!`) // a trailing '!' forces the no-match path
			expect(typeof result === 'string' || result === true).toBe(true)
			// A linear regex evaluates a 50k input in microseconds; 50ms is generous headroom for a
			// slow CI box while still catching a super-linear regression, unlike a 1000ms budget.
			expect(Date.now() - start).toBeLessThan(50)
		})
	}
})

describe('appendRule / passing', () => {
	it('appendRule skips false / undefined, pushes a wrapped primitive, pushes a function verbatim', () => {
		const validators: Validator[] = []
		appendRule(validators, 'required', false)
		appendRule(validators, 'required', undefined)
		expect(validators).toHaveLength(0)
		appendRule(validators, 'minimum', 2)
		expect(validators).toHaveLength(1)
		const custom: Validator = () => true
		appendRule(validators, 'custom', custom)
		expect(validators[1]).toBe(custom) // the function is added as-is, not wrapped
	})

	it('passing always returns true', () => {
		expect(passing('')).toBe(true)
		expect(passing('anything')).toBe(true)
	})
})

// === Copy-on-write — reducing the SAME prior state twice yields identical results and
// never mutates the prior state (AGENTS §11 immutability). One block per reducer.

describe('reducers — copy-on-write (prior state never mutated)', () => {
	it('inputReduce — same prior state, two reduces are identical and the prior is untouched', () => {
		const prior = createInputState({ message: 'Name', styler: plain })
		const snapshot = { ...prior }
		const a = inputReduce(prior, parseKey('x'))
		const b = inputReduce(prior, parseKey('x'))
		expect(a.state).toEqual(b.state)
		expect(a.view).toBe(b.view)
		expect(a.state).not.toBe(prior) // a NEW state object
		expect(prior).toEqual(snapshot) // the prior was not mutated
		expect(prior.value).toBe('') // still empty
	})

	it('passwordReduce — copy-on-write', () => {
		const prior = createPasswordState({ message: 'PIN', styler: plain })
		const a = passwordReduce(prior, parseKey('1'))
		const b = passwordReduce(prior, parseKey('1'))
		expect(a.state).toEqual(b.state)
		expect(prior.value).toBe('')
	})

	it('selectReduce — moving focus does not mutate the prior choices / focus', () => {
		const prior = createSelectState({ message: 'Pick', choices: ['a', 'b', 'c'], styler: plain })
		const a = selectReduce(prior, parseKey('\x1b[B'))
		const b = selectReduce(prior, parseKey('\x1b[B'))
		expect(a.state.focused).toBe(1)
		expect(b.state.focused).toBe(1)
		expect(prior.focused).toBe(0) // untouched
		expect(a.state.choices).toEqual(prior.choices)
	})

	it('checkboxReduce — toggling does not mutate the prior checked array', () => {
		const prior = createCheckboxState({ message: 'Pick', choices: ['a', 'b'], styler: plain })
		const a = checkboxReduce(prior, parseKey(' '))
		const b = checkboxReduce(prior, parseKey(' '))
		expect(a.state.checked).toEqual([0])
		expect(b.state.checked).toEqual([0])
		expect(prior.checked).toEqual([]) // the prior array is untouched
		expect(a.state.checked).not.toBe(prior.checked) // a NEW array
	})

	it('editorReduce — committing a line does not mutate the prior lines array', () => {
		const prior = createEditorState({ message: 'Body', styler: plain })
		const seeded = editorReduce(prior, parseKey('h')).state
		const a = editorReduce(seeded, parseKey('\r'))
		const b = editorReduce(seeded, parseKey('\r'))
		expect(a.state.lines).toEqual(['h'])
		expect(b.state.lines).toEqual(['h'])
		expect(seeded.lines).toEqual([]) // the prior (pre-return) lines untouched
		expect(a.state.lines).not.toBe(seeded.lines)
	})

	it('confirmReduce — submit carries the same immutable state object through', () => {
		const prior = createConfirmState({ message: 'OK?', styler: plain })
		const a = confirmReduce(prior, parseKey('y'))
		const b = confirmReduce(prior, parseKey('y'))
		expect(a.value).toBe(true)
		expect(b.value).toBe(true)
		expect(a.state).toBe(prior) // confirm has no per-key state delta — same object, unmutated
		expect(prior.default).toBe(false)
	})
})

// === Select — single choice + wrap-around at both ends

describe('selectReduce — single choice & wrap edges', () => {
	const single = { message: 'Only', choices: ['solo'], styler: plain }

	it('with ONE choice, up and down both stay on index 0 (wrap is a no-op)', () => {
		const state = createSelectState(single)
		expect(selectReduce(state, parseKey('\x1b[A')).state.focused).toBe(0)
		expect(selectReduce(state, parseKey('\x1b[B')).state.focused).toBe(0)
	})

	it('with ONE choice, return submits the solo value', () => {
		const step = selectReduce(createSelectState(single), parseKey('\r'))
		expect(step.status).toBe('submit')
		expect(step.value).toBe('solo')
	})

	it('down from the LAST wraps to the first', () => {
		const state = createSelectState({ message: 'Pick', choices: ['a', 'b', 'c'], styler: plain })
		const atLast = selectReduce(selectReduce(state, parseKey('\x1b[A')).state, parseKey('z')).state
		expect(atLast.focused).toBe(2) // up-from-first landed on the last
		expect(selectReduce(atLast, parseKey('\x1b[B')).state.focused).toBe(0) // down wraps to first
	})

	it('an empty choice list can never submit (stays active, value undefined)', () => {
		const empty = createSelectState({ message: 'None', choices: [], styler: plain })
		const step = selectReduce(empty, parseKey('\r'))
		expect(step.status).toBe('active')
		expect(step.value).toBeUndefined()
	})

	it('renders a choice description when present', () => {
		const view = selectView(
			createSelectState({
				message: 'Pick',
				choices: [{ name: 'A', value: 'a', description: 'the first' }],
				styler: plain,
			}),
		)
		expect(view).toContain('the first')
	})
})

// === Checkbox — toggle idempotence, min/max boundaries, focus-clears-error

describe('checkboxReduce — toggle idempotence & gating boundaries', () => {
	const options = { message: 'Pick', choices: ['a', 'b', 'c'], styler: plain }

	it('toggling the SAME index twice returns to unchecked (idempotent round-trip)', () => {
		const once = checkboxReduce(createCheckboxState(options), parseKey(' '))
		expect(once.state.checked).toEqual([0])
		const twice = checkboxReduce(once.state, parseKey(' '))
		expect(twice.state.checked).toEqual([]) // back to empty
	})

	it('submit EXACTLY at min passes; one below is rejected', () => {
		// min 1: zero checked rejects, one checked submits.
		const below = checkboxReduce(createCheckboxState({ ...options, min: 1 }), parseKey('\r'))
		expect(below.status).toBe('active')
		expect(below.state.error).toBe('Select at least 1 option')
		const at = checkboxReduce(
			checkboxReduce(createCheckboxState({ ...options, min: 1 }), parseKey(' ')).state,
			parseKey('\r'),
		)
		expect(at.status).toBe('submit')
		expect(at.value).toEqual(['a'])
	})

	it('submit EXACTLY at max passes; one above is rejected', () => {
		// max 2: check a + b submits; checking c too rejects.
		const twoChecked = checkboxReduce(
			checkboxReduce(createCheckboxState({ ...options, max: 2 }), parseKey(' ')).state,
			parseKey('\x1b[B'),
		).state
		const at = checkboxReduce(checkboxReduce(twoChecked, parseKey(' ')).state, parseKey('\r'))
		expect(at.status).toBe('submit')
		expect(at.value).toEqual(['a', 'b'])

		// Now three checked, max 2 → rejected.
		const allThree = createCheckboxState({ ...options, max: 2 })
		let step = checkboxReduce(allThree, parseKey(' ')) // a
		step = checkboxReduce(step.state, parseKey('\x1b[B'))
		step = checkboxReduce(step.state, parseKey(' ')) // b
		step = checkboxReduce(step.state, parseKey('\x1b[B'))
		step = checkboxReduce(step.state, parseKey(' ')) // c
		step = checkboxReduce(step.state, parseKey('\r'))
		expect(step.status).toBe('active')
		expect(step.state.error).toBe('Select no more than 2 options')
	})

	it('a rejected submit error is CLEARED on the next focus move', () => {
		const rejected = checkboxReduce(createCheckboxState({ ...options, min: 1 }), parseKey('\r'))
		expect(rejected.state.error).toBe('Select at least 1 option')
		const moved = checkboxReduce(rejected.state, parseKey('\x1b[B'))
		expect(moved.state.error).toBeUndefined()
	})

	it('a rejected submit error is CLEARED on the next toggle', () => {
		const rejected = checkboxReduce(createCheckboxState({ ...options, min: 2 }), parseKey('\r'))
		expect(rejected.state.error).toBe('Select at least 2 options')
		const toggled = checkboxReduce(rejected.state, parseKey(' '))
		expect(toggled.state.error).toBeUndefined()
	})

	it('renders each checked / unchecked box and the running count in the view', () => {
		const view = checkboxView(checkboxReduce(createCheckboxState(options), parseKey(' ')).state)
		expect(view).toContain('1 selected')
	})
})

// === Password — mask length == value length, the value NEVER appears (strip ANSI)

describe('passwordReduce — mask fidelity & no-leak (ANSI-stripped)', () => {
	it('the mask length equals the value length at every step', () => {
		const styled = createStyler({ enabled: true })
		const secret = ['s', 'e', 'c', 'r', 'e', 't']
		let step: PromptStep<string, PasswordState> = {
			state: createPasswordState({ message: 'PIN', styler: styled }),
			view: '',
			status: 'active',
		}
		for (let index = 0; index < secret.length; index += 1) {
			step = passwordReduce(step.state, parseKey(secret[index]))
			const masked = strip(step.view)
			// The plain-text view contains exactly (index+1) mask glyphs.
			expect((masked.match(/\*/g) ?? []).length).toBe(index + 1)
		}
		expect(step.state.value).toBe('secret')
	})

	it('the real secret NEVER appears in the rendered view, even stripped of ANSI', () => {
		const styled = createStyler({ enabled: true })
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', styler: styled }),
			['h', 'u', 'n', 't', 'e', 'r', '2'],
		)
		expect(strip(step.view)).not.toContain('hunter2')
	})

	it('the secret does not leak in the SUBMIT view either', () => {
		const styled = createStyler({ enabled: true })
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', styler: styled }),
			['p', 'a', 's', 's', '\r'],
		)
		expect(step.status).toBe('submit')
		expect(step.value).toBe('pass') // the value is returned to the caller…
		expect(strip(step.view)).not.toContain('pass') // …but never rendered
	})

	it('an empty password submits the empty string (no default fallback)', () => {
		const step = passwordReduce(
			createPasswordState({ message: 'PIN', styler: plain }),
			parseKey('\r'),
		)
		expect(step.status).toBe('submit')
		expect(step.value).toBe('')
	})

	it('ctrl-u clears a typed password mid-entry', () => {
		const step = feedReducer(
			passwordReduce,
			createPasswordState({ message: 'PIN', styler: plain }),
			['1', '2', '3', '\x15'],
		)
		expect(step.state.value).toBe('')
		expect(strip(step.view)).not.toContain('*')
	})
})

// === Editor — empty & multi-line edges

describe('editorReduce — empty & multi-line edges', () => {
	it('an immediate ctrl-d with no default submits the empty string (0 lines)', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'\x04',
		])
		expect(step.status).toBe('submit')
		expect(step.value).toBe('')
		expect(step.view).toContain('0 lines')
	})

	it('blank return lines produce empty committed lines in the joined output', () => {
		// return, return, then a char, then finish → ['', '', 'x'] joined as '\n\nx'.
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'\r',
			'\r',
			'x',
			'\x04',
		])
		expect(step.status).toBe('submit')
		expect(step.value).toBe('\n\nx')
	})

	it('a single finished line reports "1 line" (singular)', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'h',
			'i',
			'\x04',
		])
		expect(step.value).toBe('hi')
		expect(step.view).toContain('1 line')
		expect(step.view).not.toContain('1 lines')
	})

	it('multi-line text joins committed lines and the in-progress line with newlines', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'a',
			'\r',
			'b',
			'\r',
			'c',
			'\x04',
		])
		expect(step.value).toBe('a\nb\nc')
	})

	it('the in-progress current line is preserved (not committed) until return / finish', () => {
		const step = feedReducer(editorReduce, createEditorState({ message: 'Body', styler: plain }), [
			'a',
			'b',
		])
		expect(step.state.lines).toEqual([])
		expect(step.state.current).toBe('ab')
	})
})

// === editLine — every ctrl combo path & the non-editing keys

describe('editLine — full editing matrix', () => {
	it('ctrl-u clears regardless of the prior buffer', () => {
		expect(editLine('anything here', parseKey('\x15'))).toBe('')
	})

	it('backspace on an empty buffer stays empty (slice is safe)', () => {
		expect(editLine('', parseKey('\x7f'))).toBe('')
	})

	it('a multi-code-point printable appends its whole raw sequence', () => {
		// 'ab' decodes to name 'a' (length 1, printable) + sequence 'ab' → both chars appended.
		expect(editLine('x', parseKey('ab'))).toBe('xab')
		// an emoji is a single printable that appends verbatim.
		expect(editLine('x', parseKey('😀'))).toBe('x😀')
	})

	it('returns undefined (no edit) for control / navigation / meta keys', () => {
		expect(editLine('ab', parseKey('\r'))).toBeUndefined() // return
		expect(editLine('ab', parseKey('\t'))).toBeUndefined() // tab
		expect(editLine('ab', parseKey('\x1b[A'))).toBeUndefined() // arrow (meta)
		expect(editLine('ab', parseKey('\x03'))).toBeUndefined() // ctrl-c
		expect(editLine('ab', parseKey('\x04'))).toBeUndefined() // ctrl-d
		expect(editLine('ab', parseKey('\x1b'))).toBeUndefined() // escape
		expect(editLine('ab', parseKey('\x1b[99Z'))).toBeUndefined() // garbage (name '')
	})
})

// === confirmReduce — the remaining transitions

describe('confirmReduce — exhaustive transitions', () => {
	it('a lowercase y / n and uppercase Y / N all resolve, every other letter is ignored', () => {
		const base = createConfirmState({ message: 'OK?', styler: plain })
		for (const yes of ['y', 'Y']) expect(confirmReduce(base, parseKey(yes)).value).toBe(true)
		for (const no of ['n', 'N']) expect(confirmReduce(base, parseKey(no)).value).toBe(false)
		for (const other of ['a', 'z', '1', '?']) {
			expect(confirmReduce(base, parseKey(other)).status).toBe('active')
		}
	})

	it('the (y/N) hint shows N emphasized when the default is false', () => {
		expect(confirmView(createConfirmState({ message: 'OK?', styler: plain }))).toContain('(y/N)')
	})

	it('the submit view reads "yes" / "no", not the raw boolean', () => {
		const base = createConfirmState({ message: 'OK?', styler: plain })
		expect(confirmReduce(base, parseKey('y')).view).toContain('yes')
		expect(confirmReduce(base, parseKey('n')).view).toContain('no')
	})
})

// === inputReduce — remaining edges (error cleared on keystroke, styled views)

describe('inputReduce — error clearing & view edges', () => {
	it('a validation error is cleared by the next keystroke', () => {
		const rejected = feedReducer(
			inputReduce,
			createInputState({ message: 'Name', validate: { minimum: 3 }, styler: plain }),
			['a', '\r'],
		)
		expect(rejected.state.error).toBe('Must be at least 3 characters')
		const typed = inputReduce(rejected.state, parseKey('b'))
		expect(typed.state.error).toBeUndefined()
		expect(typed.state.value).toBe('ab')
	})

	it('the dimmed default hint shows when the value is empty, then the typed value replaces it', () => {
		const empty = inputView(createInputState({ message: 'Name', default: 'anon', styler: plain }))
		expect(empty).toContain('anon')
		const typed = feedReducer(
			inputReduce,
			createInputState({ message: 'Name', default: 'anon', styler: plain }),
			['x'],
		)
		expect(typed.view).toContain('x')
	})

	it('a non-editing key (a bare arrow) leaves the value and keeps it active', () => {
		const step = feedReducer(inputReduce, createInputState({ message: 'Name', styler: plain }), [
			'a',
			'\x1b[A',
		])
		expect(step.status).toBe('active')
		expect(step.state.value).toBe('a') // the arrow did not edit
	})
})

// === Wire guards — every §14 narrowing path (totality on hostile input)

describe('wire guards — isPromptType / isPendingPromptStatus / isPromptChoice / isCheckboxChoice', () => {
	it('isPromptType accepts the six forms and rejects everything else', () => {
		for (const form of ['input', 'password', 'confirm', 'select', 'checkbox', 'editor']) {
			expect(isPromptType(form)).toBe(true)
		}
		for (const bad of ['INPUT', 'prompt', '', 42, null, undefined, {}]) {
			expect(isPromptType(bad)).toBe(false)
		}
	})

	it('isPendingPromptStatus accepts the three states and rejects others', () => {
		for (const status of ['pending', 'answered', 'expired']) {
			expect(isPendingPromptStatus(status)).toBe(true)
		}
		expect(isPendingPromptStatus('done')).toBe(false)
		expect(isPendingPromptStatus(null)).toBe(false)
	})

	it('isPromptChoice requires name + value strings, description optional', () => {
		expect(isPromptChoice({ name: 'A', value: 'a' })).toBe(true)
		expect(isPromptChoice({ name: 'A', value: 'a', description: 'd' })).toBe(true)
		expect(isPromptChoice({ name: 'A' })).toBe(false) // missing value
		expect(isPromptChoice({ name: 1, value: 'a' })).toBe(false) // name not a string
		expect(isPromptChoice('a')).toBe(false) // a bare string is NOT a choice object
		expect(isPromptChoice(null)).toBe(false)
	})

	it('isCheckboxChoice allows an optional checked boolean', () => {
		expect(isCheckboxChoice({ name: 'A', value: 'a', checked: true })).toBe(true)
		expect(isCheckboxChoice({ name: 'A', value: 'a' })).toBe(true)
		expect(isCheckboxChoice({ name: 'A', value: 'a', checked: 'yes' })).toBe(false) // wrong type
	})

	it('isPendingPrompt is total on adversarial input (never throws, returns false)', () => {
		for (const bad of [null, undefined, 42, 'x', [], { id: 'x' }, { id: 1, form: 'input' }]) {
			let ok
			expect(() => {
				ok = isPendingPrompt(bad)
			}).not.toThrow()
			expect(ok).toBe(false)
		}
	})
})

describe('resolveOption / resolveChoices', () => {
	it('resolveOption returns the value when the guard matches, else undefined', () => {
		const options = { default: 'Ada', count: 3, junk: { a: 1 } }
		expect(resolveOption(options, 'default', isString)).toBe('Ada')
		expect(resolveOption(options, 'count', isNumber)).toBe(3)
		expect(resolveOption(options, 'default', isNumber)).toBeUndefined() // type mismatch
		expect(resolveOption(options, 'missing', isString)).toBeUndefined() // absent
	})

	it('resolveChoices keeps bare strings + matching choices, stringifies off-shape elements', () => {
		const options = { choices: ['a', { name: 'B', value: 'b' }, { bogus: true }, 42] }
		const result = resolveChoices(options, isPromptChoice)
		expect(result[0]).toBe('a')
		expect(result[1]).toEqual({ name: 'B', value: 'b' })
		// off-shape elements are coerced to strings (never dropped, never thrown on).
		expect(result[2]).toBe('[object Object]')
		expect(result[3]).toBe('42')
	})

	it('resolveChoices returns an empty list for a non-array choices option', () => {
		expect(resolveChoices({ choices: 'nope' }, isPromptChoice)).toEqual([])
		expect(resolveChoices({}, isPromptChoice)).toEqual([])
	})
})

// === Wire serialization — the remaining serialize / reconstruct edges

describe('serializeValidationRules / serializeChoices (units)', () => {
	it('serializeValidationRules flattens functions to true, keeps primitives, undefined for non-record', () => {
		expect(serializeValidationRules({ required: true, custom: () => true, minimum: 3 })).toEqual({
			required: true,
			custom: true,
			minimum: 3,
		})
		expect(serializeValidationRules('nope')).toBeUndefined()
		expect(serializeValidationRules(42)).toBeUndefined()
	})

	it('serializeChoices passes bare strings, strips functions from objects, returns [] for non-array', () => {
		expect(serializeChoices(['a', { name: 'B', value: 'b', onPick: () => undefined }])).toEqual([
			'a',
			{ name: 'B', value: 'b' },
		])
		expect(serializeChoices('nope')).toEqual([])
		// a non-string, non-record element passes through unchanged.
		expect(serializeChoices([42])).toEqual([42])
	})
})

describe('serializePromptOptions — additional drops & round-trips', () => {
	it('keeps min / max / choices and drops a nested choice function across a checkbox bag', () => {
		const wire = serializePromptOptions({
			message: 'Pick',
			min: 1,
			max: 3,
			choices: [{ name: 'A', value: 'a', checked: true, onPick: () => undefined }],
			styler: createStyler(),
		})
		expect(wire).toEqual({
			message: 'Pick',
			min: 1,
			max: 3,
			choices: [{ name: 'A', value: 'a', checked: true }],
		})
	})

	it('an options bag with NO validate / choices passes its plain fields through untouched', () => {
		expect(serializePromptOptions({ message: 'x', default: true })).toEqual({
			message: 'x',
			default: true,
		})
	})

	it('a full serialize → reconstruct → resolveValidation round-trip preserves the built-in rules', () => {
		const wire = serializePromptOptions({
			message: 'x',
			validate: { required: true, minimum: 2, email: true, custom: () => true },
		})
		const rules = reconstructValidationRules(wire.validate)
		const validator = resolveValidation(rules)
		// required + minimum + email survived as data; custom (a function) became `true` (a no-op rule).
		expect(validator('')).toBe('This field is required')
		expect(validator('a')).toBe('Must be at least 2 characters')
		expect(validator('ab')).toBe('Must be a valid email address')
		expect(validator('a@b.co')).toBe(true)
	})
})

describe('reconstructValidationRules — additional edges', () => {
	it('keeps boolean / number rule values, drops objects / arrays / functions, and drops pattern (ReDoS defense)', () => {
		expect(
			reconstructValidationRules({
				required: true,
				minimum: 3,
				pattern: '^x$',
				junk: { a: 1 },
				list: [1],
			}),
		).toEqual({ required: true, minimum: 3 })
	})

	it('returns undefined when every value is non-primitive (nothing applicable survives)', () => {
		expect(reconstructValidationRules({ a: { x: 1 }, b: [1, 2] })).toBeUndefined()
	})
})

// === dispatchPendingPrompt — every form reconstructs its typed options

describe('dispatchPendingPrompt — per-form option reconstruction', () => {
	// The shared createRecordingTerminal (tests/setup.ts, AGENTS §16.1) — a real
	// PromptFormInterface whose six form methods record their options and resolve a
	// configured per-form answer.
	const ANSWERS = {
		input: 'i',
		password: 'p',
		confirm: true,
		select: 's',
		checkbox: ['c'],
		editor: 'e',
	} as const

	function pendingOf(form: PendingPrompt['form'], options: Record<string, unknown>): PendingPrompt {
		return { id: 'p', form, message: `${form}?`, options, status: 'pending', time: 1 }
	}

	it('password — reconstructs mask + validate rules', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		const value = await dispatchPendingPrompt(
			terminal,
			pendingOf('password', { mask: '#', validate: { minimum: 4 } }),
		)
		expect(value).toBe('p')
		expect(calls.password.calls[0]?.[0]).toEqual({
			message: 'password?',
			mask: '#',
			validate: { minimum: 4 },
		})
	})

	it('confirm — reconstructs the boolean default, ignores a non-boolean default', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		await dispatchPendingPrompt(terminal, pendingOf('confirm', { default: true }))
		expect(calls.confirm.calls[0]?.[0]).toEqual({ message: 'confirm?', default: true })
		const second = createRecordingTerminal({ answers: ANSWERS })
		await dispatchPendingPrompt(second.terminal, pendingOf('confirm', { default: 'yes' }))
		expect(second.calls.confirm.calls[0]?.[0]).toEqual({ message: 'confirm?', default: undefined })
	})

	it('checkbox — reconstructs choices + numeric min / max', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		const value = await dispatchPendingPrompt(
			terminal,
			pendingOf('checkbox', { choices: ['a', { name: 'B', value: 'b' }], min: 1, max: 2 }),
		)
		expect(value).toEqual(['c'])
		expect(calls.checkbox.calls[0]?.[0]).toEqual({
			message: 'checkbox?',
			choices: ['a', { name: 'B', value: 'b' }],
			min: 1,
			max: 2,
		})
	})

	it('select — reconstructs choices + default', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		await dispatchPendingPrompt(
			terminal,
			pendingOf('select', { choices: ['a', 'b'], default: 'b' }),
		)
		expect(calls.select.calls[0]?.[0]).toEqual({
			message: 'select?',
			choices: ['a', 'b'],
			default: 'b',
		})
	})

	it('editor — reconstructs default + validate rules', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		await dispatchPendingPrompt(
			terminal,
			pendingOf('editor', { default: 'seed', validate: { required: true } }),
		)
		expect(calls.editor.calls[0]?.[0]).toEqual({
			message: 'editor?',
			default: 'seed',
			validate: { required: true },
		})
	})

	it('a missing options bag still dispatches (every option resolves to undefined)', async () => {
		const { terminal, calls } = createRecordingTerminal({ answers: ANSWERS })
		const value = await dispatchPendingPrompt(terminal, pendingOf('input', {}))
		expect(value).toBe('i')
		expect(calls.input.calls[0]?.[0]).toEqual({
			message: 'input?',
			default: undefined,
			validate: undefined,
		})
	})
})

// === Validation engine — an uncompilable pattern source (totality)

describe('resolveValidation — uncompilable pattern source', () => {
	it('an uncompilable pattern source resolves to the pattern failure message and never throws', () => {
		let result: string | true | undefined
		expect(() => {
			result = resolveValidation({ pattern: '(' })('anything')
		}).not.toThrow()
		expect(result).toBe('Must match pattern: (')
	})
})

// === Wire dispatch — the pattern rule is dropped (defusing a ReDoS-shaped wire payload)

describe('dispatchPendingPrompt — a wire pattern rule is dropped (ReDoS defused)', () => {
	it('a pending validate.pattern never reaches the reconstructed rules; the resulting validator is instant on an adversarial input', async () => {
		const { terminal, calls } = createRecordingTerminal()
		const pending: PendingPrompt = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: { validate: { pattern: '(a+)+$' } },
			status: 'pending',
			time: 1,
		}
		await dispatchPendingPrompt(terminal, pending)
		const seenValidate = calls.input.calls[0]?.[0].validate
		// `pattern` was the ONLY rule in the payload — reconstructValidationRules drops it, leaving
		// nothing applicable, so the reconstructed rules bag is undefined (no pattern rule at all).
		expect(seenValidate).toBeUndefined()
		const validator = resolveValidation(seenValidate)
		const start = Date.now()
		const result = validator(`${'a'.repeat(30)}!`) // would catastrophically backtrack if the pattern survived
		expect(result).toBe(true)
		expect(Date.now() - start).toBeLessThan(1000)
	})
})

// === Wire dispatch — control-byte stripping (dispatch sanitizes; a direct view render does not)

describe('dispatchPendingPrompt — control-byte stripping (ESC / OSC-52)', () => {
	it('strips ESC / OSC-52 sequences from the message and choice labels before reaching the terminal', async () => {
		const { terminal, calls } = createRecordingTerminal()
		const escMessage = 'Name\x1b]52;c;AA==\x07?'
		const pending: PendingPrompt = {
			id: 'p1',
			form: 'select',
			message: escMessage,
			options: {
				choices: [{ name: 'A\x1b]52;c;AA==\x07', value: 'a', description: 'desc\x1b[31m' }],
			},
			status: 'pending',
			time: 1,
		}
		await dispatchPendingPrompt(terminal, pending)
		const seen = calls.select.calls[0]?.[0]
		expect(seen?.message).not.toContain('\x1b')
		const choice = seen?.choices[0]
		if (choice === undefined || isString(choice)) {
			throw new Error('expected a sanitized choice object, got a string or undefined')
		}
		expect(choice.name).not.toContain('\x1b')
		expect(choice.description).not.toContain('\x1b')
	})

	it('a LOCAL view render does NOT strip control bytes — sanitization is a dispatch-only concern', () => {
		const raw = 'Pick\x1b]52;c;AA==\x07'
		const state = createSelectState({ message: raw, choices: ['a'], styler: plain })
		const view = selectView(state)
		// The renderer reproduces the message verbatim; only dispatchPendingPrompt (a remote-input
		// boundary) sanitizes with stripControls — a local caller controls its own message content.
		expect(view).toContain('\x1b')
	})
})

// === Validation engine — code-point length boundary (astral characters)

describe('resolveValidation — minimum/maximum use code-point length (astral boundary)', () => {
	it('a 2-astral-character string has length 2 by code points, not 4 by UTF-16 units', () => {
		const twoAstral = '😀😀' // each emoji is a surrogate pair: 4 UTF-16 units, 2 code points
		expect(twoAstral.length).toBe(4)
		expect([...twoAstral].length).toBe(2)

		const min = resolveValidation({ minimum: 2 })
		expect(min(twoAstral)).toBe(true) // 2 code points >= 2

		const minTooHigh = resolveValidation({ minimum: 3 })
		expect(minTooHigh(twoAstral)).toBe('Must be at least 3 characters') // 2 code points < 3

		const max = resolveValidation({ maximum: 2 })
		expect(max(twoAstral)).toBe(true) // 2 code points <= 2

		const maxTooLow = resolveValidation({ maximum: 1 })
		expect(maxTooLow(twoAstral)).toBe('Must be at most 1 characters') // 2 code points > 1
	})
})

// === isInsecureRemote

describe('isInsecureRemote', () => {
	it('an http loopback endpoint is NOT insecure', () => {
		expect(isInsecureRemote('http://localhost:3000')).toBe(false)
		expect(isInsecureRemote('http://127.0.0.1:8080')).toBe(false)
		expect(isInsecureRemote('http://[::1]:9000')).toBe(false)
		expect(isInsecureRemote('http://localhost')).toBe(false)
	})

	it('an http remote (non-loopback) host IS insecure', () => {
		expect(isInsecureRemote('http://example.com')).toBe(true)
		expect(isInsecureRemote('http://192.168.1.5:3000/path')).toBe(true)
		expect(isInsecureRemote('http://user@example.com')).toBe(true)
	})

	it('https is never flagged insecure, regardless of host', () => {
		expect(isInsecureRemote('https://example.com')).toBe(false)
		expect(isInsecureRemote('https://localhost')).toBe(false)
		expect(isInsecureRemote('ws://example.com')).toBe(false) // not http:// at all
	})
})

// === Terminal manager wire seams

describe('serializePending / serializeExpire / serializeShutdown', () => {
	it('serializePending wraps a PendingPrompt as a pending WireEvent, id set from the prompt', () => {
		const prompt: PendingPrompt = {
			id: 'p1',
			form: 'input',
			message: 'Name?',
			options: {},
			status: 'pending',
			time: 1,
			from: 'agent-1',
			to: 'human-1',
		}
		const event = serializePending(prompt)
		expect(event.event).toBe('pending')
		expect(event.id).toBe('p1')
		expect(JSON.parse(event.data)).toEqual(prompt)
	})

	it('serializeExpire wraps an id as an expire WireEvent with no frame id', () => {
		const event = serializeExpire('p1')
		expect(event.event).toBe('expire')
		expect(event.id).toBeUndefined()
		expect(JSON.parse(event.data)).toEqual({ id: 'p1' })
	})

	it('serializeShutdown carries no payload', () => {
		const event = serializeShutdown()
		expect(event.event).toBe('shutdown')
		expect(event.data).toBe('')
		expect(event.id).toBeUndefined()
	})
})

describe('isAnswerPayload', () => {
	it('accepts a non-empty id plus a present value key, rejects malformed payloads', () => {
		expect(isAnswerPayload({ id: 'p1', value: 'answer' })).toBe(true)
		expect(isAnswerPayload({ id: 'p1', value: undefined })).toBe(true) // key present, value itself may be undefined
		expect(isAnswerPayload({ id: 'p1', value: false })).toBe(true)
		expect(isAnswerPayload({ id: '', value: 'x' })).toBe(false) // empty id
		expect(isAnswerPayload({ value: 'x' })).toBe(false) // missing id
		expect(isAnswerPayload({ id: 'p1' })).toBe(false) // missing value key
		expect(isAnswerPayload(null)).toBe(false)
		expect(isAnswerPayload('p1')).toBe(false)
	})
})

describe('isTerminalSnapshot', () => {
	it('accepts a non-empty id with/without a numeric timeout, rejects malformed snapshots', () => {
		expect(isTerminalSnapshot({ id: 'endpoint-1' })).toBe(true)
		expect(isTerminalSnapshot({ id: 'endpoint-1', timeout: 5000 })).toBe(true)
		expect(isTerminalSnapshot({ id: '' })).toBe(false) // empty id
		expect(isTerminalSnapshot({ id: 'endpoint-1', timeout: 'soon' })).toBe(false) // non-numeric timeout
		expect(isTerminalSnapshot({ timeout: 5000 })).toBe(false) // missing id
		expect(isTerminalSnapshot(null)).toBe(false)
		expect(isTerminalSnapshot([])).toBe(false)
	})
})
