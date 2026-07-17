import type {
	CheckboxChoice,
	CheckboxOptions,
	CheckboxState,
	ConfirmOptions,
	ConfirmState,
	EditorOptions,
	EditorState,
	FetchInit,
	InputOptions,
	InputState,
	KeyEvent,
	PasswordOptions,
	PasswordState,
	PendingPrompt,
	PendingPromptStatus,
	PromptChoice,
	PromptFormInterface,
	PromptStep,
	PromptType,
	SelectOptions,
	SelectState,
	TerminalSnapshot,
	TimerCancel,
	ValidationRules,
	Validator,
	WireEvent,
} from './types.js'
import type { Guard } from '@orkestrel/contract'
import type { StylerInterface } from '@orkestrel/console'
import {
	ALPHANUMERIC_PATTERN,
	CONTROL_NAMES,
	DEFAULT_MASK,
	EMAIL_PATTERN,
	INTEGER_PATTERN,
	NUMERIC_PATTERN,
	PROMPT_ICONS,
	RULE_MESSAGES,
	SEQUENCE_NAMES,
	URL_PATTERN,
} from './constants.js'
import {
	isBoolean,
	isNonEmptyString,
	isNumber,
	isRecord,
	isString,
	literalOf,
	recordOf,
} from '@orkestrel/contract'
import { createStyler, STATUS_ICONS, stripControls } from '@orkestrel/console'

// The PURE prompt core implementation — all EXPORTED, all pure, all unit-tested (AGENTS §5):
// the key decoder, the validation rule engine, the choice normalizers, the per-prompt view
// renderers, and the six `create*State` factories + `*Reduce` reducers. No `node:*`, no I/O,
// no events. A reducer is a total `(state, key) → PromptStep`; the view is rendered through the
// state's console {@link StylerInterface} (the ONE style engine), so the impure server driver
// (T-c) only feeds bytes in and writes the rendered view out.

// === Key decoding

/**
 * Decode one keypress's bytes into a {@link KeyEvent} — total, never throws. A `Uint8Array` is
 * read as UTF-8; the resulting string is matched against the known control bytes
 * ({@link CONTROL_NAMES}) and escape sequences ({@link SEQUENCE_NAMES}), falling back to a
 * single printable character. An unrecognized sequence yields `name: ''` with the raw `sequence`
 * preserved.
 *
 * @remarks
 * - **Single control byte.** A one-character control input (`return` / `backspace` / `tab` /
 *   `escape` / `space`, or a Ctrl combo `c` / `d` / `u` / `a` / `e`) is looked up in
 *   {@link CONTROL_NAMES}, carrying its `ctrl` flag.
 * - **Escape sequence.** A multi-byte ESC sequence (`up` / `down` / `left` / `right` in BOTH the
 *   `ESC[A` and `ESCOA` forms, plus `home` / `end` / `delete`) is looked up in
 *   {@link SEQUENCE_NAMES} and flagged `meta`.
 * - **Printable character.** A single printable character becomes `name` = that character, with
 *   `shift` set when it is an uppercase letter. A multi-code-point printable (an emoji, a pasted
 *   run) keeps its first code point as the name and the whole input as `sequence`.
 * - **Unknown.** Anything else (an unrecognized escape, an empty input) yields `name: ''` —
 *   total, so the driver never crashes on a stray byte.
 *
 * @param input - The raw keypress bytes, as a string or `Uint8Array`
 * @returns The decoded {@link KeyEvent}
 *
 * @example
 * ```ts
 * parseKey('\r')        // { name: 'return', sequence: '\r', ctrl: false, meta: false, shift: false }
 * parseKey('\x1b[A')    // { name: 'up', sequence: '\x1b[A', ctrl: false, meta: true, shift: false }
 * parseKey('A')         // { name: 'A', sequence: 'A', ctrl: false, meta: false, shift: true }
 * parseKey('\x03')      // { name: 'c', sequence: '\x03', ctrl: true, meta: false, shift: false }
 * ```
 */
export function parseKey(input: string | Uint8Array): KeyEvent {
	const sequence = isString(input) ? input : new TextDecoder().decode(input)

	// A known multi-byte escape sequence (arrows / home / end / delete) — flagged `meta`.
	const sequenceName = SEQUENCE_NAMES[sequence]
	if (sequenceName !== undefined) {
		return { name: sequenceName, sequence, ctrl: false, meta: true, shift: false }
	}

	// A known single control byte (return / backspace / tab / escape / space / a ctrl combo).
	const control = CONTROL_NAMES[sequence]
	if (control !== undefined) {
		return { name: control.name, sequence, ctrl: control.ctrl, meta: false, shift: false }
	}

	// A printable character — one or more code points, the first naming the key.
	const points = [...sequence]
	const first = points[0]
	if (first !== undefined && isPrintable(first)) {
		return { name: first, sequence, ctrl: false, meta: false, shift: first !== first.toLowerCase() }
	}

	// Anything else (an unrecognized escape, an empty input) — total, never a throw.
	return { name: '', sequence, ctrl: false, meta: false, shift: false }
}

/** Whether a single character is a printable (non-control) character — used by {@link parseKey}'s char fallback. */
export function isPrintable(character: string): boolean {
	if (character.length === 0) return false
	const code = character.codePointAt(0)
	if (code === undefined) return false
	// Exclude the C0 controls (0–31) and DEL (127); everything at or above space is printable.
	return code >= 32 && code !== 127
}

// === Validation engine

/**
 * Evaluate ONE built-in validation rule against `input`, returning its error message when the
 * rule fails or `undefined` when it passes. The atomic check {@link buildRuleValidator} wraps
 * into a {@link Validator}. Pure.
 *
 * @remarks
 * A function `check` is the custom-override path: it is called and its `true` ⇒ pass, a string
 * ⇒ that message, anything else ⇒ the generic {@link RULE_MESSAGES.invalid}. A primitive `check`
 * runs the named built-in: `required` (non-empty trimmed), `minimum` / `maximum` (length
 * bounds, the message interpolated with the count), `pattern` (a regex source), and the
 * `email` / `url` / `numeric` / `integer` / `alphanumeric` pattern tests.
 *
 * @param rule - The rule name (`'required'`, `'minimum'`, …)
 * @param check - The configured value (a primitive toggle / bound / pattern, or a custom {@link Validator})
 * @param input - The input string to test
 * @returns The error message when the rule fails, else `undefined`
 */
export function evaluateRule(
	rule: string,
	check: boolean | number | string | Validator,
	input: string,
): string | undefined {
	// `typeof` (not the broad `isFunction` guard) so the union narrows to the precise `Validator`.
	if (typeof check === 'function') {
		const result = check(input)
		if (result === true) return undefined
		return isString(result) ? result : RULE_MESSAGES.invalid
	}

	switch (rule) {
		case 'required':
			if (check === true && input.trim().length === 0) return RULE_MESSAGES.required
			break
		case 'minimum':
			if (isNumber(check) && [...input].length < check)
				return RULE_MESSAGES.minimum.replace('{count}', String(check))
			break
		case 'maximum':
			if (isNumber(check) && [...input].length > check)
				return RULE_MESSAGES.maximum.replace('{count}', String(check))
			break
		case 'pattern':
			if (isString(check)) {
				let compiled: RegExp | undefined
				try {
					compiled = new RegExp(check)
				} catch {
					return RULE_MESSAGES.pattern.replace('{pattern}', check)
				}
				if (!compiled.test(input)) return RULE_MESSAGES.pattern.replace('{pattern}', check)
			}
			break
		case 'email':
			if (check === true && !EMAIL_PATTERN.test(input)) return RULE_MESSAGES.email
			break
		case 'url':
			if (check === true && !URL_PATTERN.test(input)) return RULE_MESSAGES.url
			break
		case 'numeric':
			if (check === true && !NUMERIC_PATTERN.test(input)) return RULE_MESSAGES.numeric
			break
		case 'integer':
			if (check === true && !INTEGER_PATTERN.test(input)) return RULE_MESSAGES.integer
			break
		case 'alphanumeric':
			if (check === true && !ALPHANUMERIC_PATTERN.test(input)) return RULE_MESSAGES.alphanumeric
			break
	}

	return undefined
}

/** Wrap a named rule + its primitive check into a {@link Validator} (returns `true` or the rule's message). */
export function buildRuleValidator(rule: string, check: boolean | number | string): Validator {
	return (input: string) => evaluateRule(rule, check, input) ?? true
}

/**
 * Append a rule-backed {@link Validator} to `validators` when the rule is enabled — a `false` /
 * `undefined` `check` is skipped, a function `check` is added verbatim (the custom override), and
 * a primitive `check` is wrapped via {@link buildRuleValidator}. Mutates `validators` in place.
 */
export function appendRule(
	validators: Validator[],
	rule: string,
	check: boolean | number | string | Validator | undefined,
): void {
	if (check === undefined || check === false) return
	if (typeof check === 'function') {
		validators.push(check)
		return
	}
	validators.push(buildRuleValidator(rule, check))
}

/**
 * Compose several {@link Validator}s into ONE short-circuiting validator — it runs them in order
 * and returns the FIRST error message, or `true` when all pass. The empty composition always
 * passes.
 */
export function composeValidators(...validators: Validator[]): Validator {
	return (input: string) => {
		for (const validator of validators) {
			const result = validator(input)
			if (result !== true) return result
		}
		return true
	}
}

/**
 * Compile a {@link Validator} or declarative {@link ValidationRules} (or nothing) into ONE
 * composed {@link Validator}. A bare validator passes through; rules are appended in the fixed
 * order (required → minimum → maximum → pattern → email → url → numeric → integer → alphanumeric
 * → custom) and composed; absent / empty input yields an always-passing validator. Pure.
 *
 * @remarks
 * Unlike a prior variant (which returned `Validator | undefined`), this ALWAYS returns a
 * `Validator` — an absent or empty rule set yields a validator that returns `true` for every
 * input. That keeps a prompt's state unconditional (it always holds a real validator to apply on
 * submit), with no `undefined` branch at the call site.
 *
 * @param validate - A custom {@link Validator}, a {@link ValidationRules} bag, or `undefined`
 * @returns The composed {@link Validator} (always-passing when nothing was supplied)
 *
 * @example
 * ```ts
 * const v = resolveValidation({ required: true, minimum: 3 })
 * v('')    // 'This field is required'
 * v('ab')  // 'Must be at least 3 characters'
 * v('abc') // true
 * ```
 */
export function resolveValidation(validate?: Validator | ValidationRules): Validator {
	if (validate === undefined) return passing
	// `typeof` (not the broad `isFunction` guard) so the union narrows to the precise `Validator`.
	if (typeof validate === 'function') return validate

	const validators: Validator[] = []
	appendRule(validators, 'required', validate.required)
	appendRule(validators, 'minimum', validate.minimum)
	appendRule(validators, 'maximum', validate.maximum)
	appendRule(validators, 'pattern', validate.pattern)
	appendRule(validators, 'email', validate.email)
	appendRule(validators, 'url', validate.url)
	appendRule(validators, 'numeric', validate.numeric)
	appendRule(validators, 'integer', validate.integer)
	appendRule(validators, 'alphanumeric', validate.alphanumeric)
	if (typeof validate.custom === 'function') validators.push(validate.custom)

	if (validators.length === 0) return passing
	return composeValidators(...validators)
}

/** The always-passing {@link Validator} — the resolved validator when no rules were supplied. */
export function passing(_input: string): true {
	return true
}

// === Choice normalization

/** Normalize a select choice input into a full {@link PromptChoice} (a bare string becomes both name and value). */
export function normalizeChoice(choice: string | PromptChoice): PromptChoice {
	return isString(choice) ? { name: choice, value: choice } : choice
}

/** Normalize a checkbox choice input into a full {@link CheckboxChoice} (a bare string becomes both name and value). */
export function normalizeCheckboxChoice(choice: string | CheckboxChoice): CheckboxChoice {
	return isString(choice) ? { name: choice, value: choice } : choice
}

// === Shared view helpers

/** The styled prompt-message header (`? message`) — the leading line every active prompt view shares. */
export function promptHeader(styler: StylerInterface, message: string): string {
	return `${styler.cyan(PROMPT_ICONS.question)} ${styler.bold(message)}`
}

/** The styled submit line (`✔ message`) — the committed header an interactive prompt shows once resolved. */
export function submitHeader(styler: StylerInterface, message: string): string {
	return `${styler.green(STATUS_ICONS.success)} ${styler.bold(message)}`
}

/** The styled error line (`✖ message`) — appended beneath a prompt view when the last submit failed validation. */
export function errorLine(styler: StylerInterface, message: string): string {
	return `${styler.red(STATUS_ICONS.error)} ${styler.red(message)}`
}

// === Input prompt

/** Build the initial {@link InputState} from {@link InputOptions} — resolving the validator + styler, seeding an empty value. */
export function createInputState(options: InputOptions): InputState {
	return {
		message: options.message,
		default: options.default ?? '',
		validator: resolveValidation(options.validate),
		styler: options.styler ?? createStyler(),
		value: '',
	}
}

/** Render an {@link InputState} as a styled view — the header, the typed value (or dimmed default hint), and any error. */
export function inputView(state: InputState): string {
	const shown = state.value.length > 0 ? state.value : state.styler.dim(state.default)
	const head = `${promptHeader(state.styler, state.message)} ${state.styler.cyan(PROMPT_ICONS.pointer)} ${shown}`
	return state.error === undefined ? head : `${head}\n${errorLine(state.styler, state.error)}`
}

/**
 * Advance an input prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Printable characters extend the value; backspace shrinks it; ctrl-u clears it; ctrl-c
 * cancels; return submits (the empty line falls back to the default) through the validator — an
 * invalid submit stays active with the error in the view.
 */
export function inputReduce(state: InputState, key: KeyEvent): PromptStep<string, InputState> {
	if (key.ctrl && key.name === 'c') return { state, view: inputView(state), status: 'cancel' }

	if (key.name === 'return') {
		const answer = state.value.length > 0 ? state.value : state.default
		const result = state.validator(answer)
		if (result !== true) {
			const next: InputState = { ...state, error: result }
			return { state: next, view: inputView(next), status: 'active' }
		}
		const next: InputState = { ...state, value: answer, error: undefined }
		return {
			state: next,
			view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(answer)}`,
			status: 'submit',
			value: answer,
		}
	}

	const value = editLine(state.value, key)
	if (value === undefined) return { state, view: inputView(state), status: 'active' }
	const next: InputState = { ...state, value, error: undefined }
	return { state: next, view: inputView(next), status: 'active' }
}

// === Password prompt

/** Build the initial {@link PasswordState} from {@link PasswordOptions} — resolving the validator + styler + mask. */
export function createPasswordState(options: PasswordOptions): PasswordState {
	return {
		message: options.message,
		mask: options.mask ?? DEFAULT_MASK,
		validator: resolveValidation(options.validate),
		styler: options.styler ?? createStyler(),
		value: '',
	}
}

/** Render a {@link PasswordState} as a styled view — the header, the value masked to `mask` repeated, and any error. */
export function passwordView(state: PasswordState): string {
	const masked = state.mask.repeat(state.value.length)
	const head = `${promptHeader(state.styler, state.message)} ${state.styler.cyan(PROMPT_ICONS.pointer)} ${masked}`
	return state.error === undefined ? head : `${head}\n${errorLine(state.styler, state.error)}`
}

/**
 * Advance a password prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Identical line-editing to {@link inputReduce} (printable extends, backspace shrinks,
 * ctrl-u clears, ctrl-c cancels) but the view masks the value; return submits through the
 * validator (no default fallback — a password has no echoed default).
 */
export function passwordReduce(
	state: PasswordState,
	key: KeyEvent,
): PromptStep<string, PasswordState> {
	if (key.ctrl && key.name === 'c') return { state, view: passwordView(state), status: 'cancel' }

	if (key.name === 'return') {
		const result = state.validator(state.value)
		if (result !== true) {
			const next: PasswordState = { ...state, error: result }
			return { state: next, view: passwordView(next), status: 'active' }
		}
		return {
			state: { ...state, error: undefined },
			view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(state.mask.repeat(state.value.length))}`,
			status: 'submit',
			value: state.value,
		}
	}

	const value = editLine(state.value, key)
	if (value === undefined) return { state, view: passwordView(state), status: 'active' }
	const next: PasswordState = { ...state, value, error: undefined }
	return { state: next, view: passwordView(next), status: 'active' }
}

// === Confirm prompt

/** Build the initial {@link ConfirmState} from {@link ConfirmOptions} — defaulting the answer to `false`. */
export function createConfirmState(options: ConfirmOptions): ConfirmState {
	return {
		message: options.message,
		default: options.default ?? false,
		styler: options.styler ?? createStyler(),
	}
}

/** Render a {@link ConfirmState} as a styled view — the header plus a `(Y/n)` hint with the default letter emphasized. */
export function confirmView(state: ConfirmState): string {
	const hint = state.default
		? `${state.styler.green('Y')}${state.styler.dim('/n')}`
		: `${state.styler.dim('y/')}${state.styler.green('N')}`
	return `${promptHeader(state.styler, state.message)} ${state.styler.dim('(')}${hint}${state.styler.dim(')')}`
}

/**
 * Advance a confirm prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<boolean>`
 * reducer. `y` / `Y` submits `true`, `n` / `N` submits `false`, return on an empty line submits
 * the `default`, ctrl-c cancels; any other key is ignored (stays active).
 */
export function confirmReduce(
	state: ConfirmState,
	key: KeyEvent,
): PromptStep<boolean, ConfirmState> {
	if (key.ctrl && key.name === 'c') return { state, view: confirmView(state), status: 'cancel' }

	let answer: boolean | undefined
	const choice = key.name.toLowerCase()
	if (key.name === 'return') answer = state.default
	else if (choice === 'y') answer = true
	else if (choice === 'n') answer = false

	if (answer === undefined) return { state, view: confirmView(state), status: 'active' }
	return {
		state,
		view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(answer ? 'yes' : 'no')}`,
		status: 'submit',
		value: answer,
	}
}

// === Select prompt

/** Build the initial {@link SelectState} from {@link SelectOptions} — normalizing choices and pre-focusing the default. */
export function createSelectState(options: SelectOptions): SelectState {
	const choices = options.choices.map(normalizeChoice)
	const index = choices.findIndex((choice) => choice.value === options.default)
	return {
		message: options.message,
		choices,
		styler: options.styler ?? createStyler(),
		focused: index >= 0 ? index : 0,
	}
}

/** Render a {@link SelectState} as a MULTI-LINE styled view — the header followed by one row per choice, the focused row marked. */
export function selectView(state: SelectState): string {
	const lines = state.choices.map((choice, index) => {
		const active = index === state.focused
		const pointer = active ? state.styler.cyan(PROMPT_ICONS.pointer) : ' '
		const marker = active
			? state.styler.green(PROMPT_ICONS.selected)
			: state.styler.dim(PROMPT_ICONS.dot)
		const label = active ? state.styler.bold(choice.name) : choice.name
		const description =
			choice.description === undefined ? '' : `  ${state.styler.dim(choice.description)}`
		return `${pointer} ${marker} ${label}${description}`
	})
	return [promptHeader(state.styler, state.message), ...lines].join('\n')
}

/**
 * Advance a select prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. `up` / `down` (and `k` / `j`) move the focus, WRAPPING at the ends; return submits the
 * focused choice's `value`; ctrl-c cancels. An empty choice list can never submit (a higher layer
 * guards against it); any other key is ignored.
 */
export function selectReduce(state: SelectState, key: KeyEvent): PromptStep<string, SelectState> {
	if (key.ctrl && key.name === 'c') return { state, view: selectView(state), status: 'cancel' }

	const count = state.choices.length
	if (count === 0) return { state, view: selectView(state), status: 'active' }

	if (key.name === 'up' || key.name === 'k') {
		const next: SelectState = { ...state, focused: (state.focused - 1 + count) % count }
		return { state: next, view: selectView(next), status: 'active' }
	}
	if (key.name === 'down' || key.name === 'j') {
		const next: SelectState = { ...state, focused: (state.focused + 1) % count }
		return { state: next, view: selectView(next), status: 'active' }
	}
	if (key.name === 'return') {
		const choice = state.choices[state.focused]
		const value = choice?.value ?? ''
		return {
			state,
			view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(choice?.name ?? '')}`,
			status: 'submit',
			value,
		}
	}
	return { state, view: selectView(state), status: 'active' }
}

// === Checkbox prompt

/** Build the initial {@link CheckboxState} from {@link CheckboxOptions} — normalizing choices, seeding the checked set, carrying min/max. */
export function createCheckboxState(options: CheckboxOptions): CheckboxState {
	const choices = options.choices.map(normalizeCheckboxChoice)
	const checked = choices.reduce<number[]>((indices, choice, index) => {
		if (choice.checked === true) indices.push(index)
		return indices
	}, [])
	return {
		message: options.message,
		choices,
		styler: options.styler ?? createStyler(),
		focused: 0,
		checked,
		min: options.min,
		max: options.max,
	}
}

/** Render a {@link CheckboxState} as a MULTI-LINE styled view — the header, one box per choice (focused + checked marked), a count, and any error. */
export function checkboxView(state: CheckboxState): string {
	const lines = state.choices.map((choice, index) => {
		const active = index === state.focused
		const ticked = state.checked.includes(index)
		const pointer = active ? state.styler.cyan(PROMPT_ICONS.pointer) : ' '
		const box = ticked
			? state.styler.green(PROMPT_ICONS.checked)
			: state.styler.dim(PROMPT_ICONS.unchecked)
		const label = active ? state.styler.bold(choice.name) : choice.name
		const description =
			choice.description === undefined ? '' : `  ${state.styler.dim(choice.description)}`
		return `${pointer} ${box} ${label}${description}`
	})
	const summary = state.styler.dim(`${state.checked.length} selected`)
	const body = [promptHeader(state.styler, state.message), ...lines, summary].join('\n')
	return state.error === undefined ? body : `${body}\n${errorLine(state.styler, state.error)}`
}

/**
 * Advance a checkbox prompt by one {@link KeyEvent} — the pure
 * `(state, key) → PromptStep<readonly string[]>` reducer. `up` / `down` (and `k` / `j`) move the
 * focus (wrapping); `space` toggles the focused index in the checked set; return submits the
 * checked values in CHOICE order — gated by `min` / `max` (an out-of-range count stays active with
 * the reason in the view); ctrl-c cancels.
 */
export function checkboxReduce(
	state: CheckboxState,
	key: KeyEvent,
): PromptStep<readonly string[], CheckboxState> {
	if (key.ctrl && key.name === 'c') return { state, view: checkboxView(state), status: 'cancel' }

	const count = state.choices.length

	if ((key.name === 'up' || key.name === 'k') && count > 0) {
		const next: CheckboxState = {
			...state,
			focused: (state.focused - 1 + count) % count,
			error: undefined,
		}
		return { state: next, view: checkboxView(next), status: 'active' }
	}
	if ((key.name === 'down' || key.name === 'j') && count > 0) {
		const next: CheckboxState = { ...state, focused: (state.focused + 1) % count, error: undefined }
		return { state: next, view: checkboxView(next), status: 'active' }
	}
	if (key.name === 'space' && count > 0) {
		const checked = toggleIndex(state.checked, state.focused)
		const next: CheckboxState = { ...state, checked, error: undefined }
		return { state: next, view: checkboxView(next), status: 'active' }
	}
	if (key.name === 'return') {
		const error = gateSelection(state.checked.length, state.min, state.max)
		if (error !== undefined) {
			const next: CheckboxState = { ...state, error }
			return { state: next, view: checkboxView(next), status: 'active' }
		}
		const ordered = [...state.checked].sort((a, b) => a - b)
		const values = ordered
			.map((index) => state.choices[index]?.value)
			.filter((value): value is string => value !== undefined)
		const summary = ordered
			.map((index) => state.choices[index]?.name)
			.filter((name): name is string => name !== undefined)
			.join(', ')
		return {
			state: { ...state, error: undefined },
			view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(summary)}`,
			status: 'submit',
			value: values,
		}
	}
	return { state, view: checkboxView(state), status: 'active' }
}

/** Toggle `index` in a readonly index list — copy-on-write, returning the new sorted-by-insertion list. */
export function toggleIndex(indices: readonly number[], index: number): readonly number[] {
	return indices.includes(index) ? indices.filter((i) => i !== index) : [...indices, index]
}

/** The min/max gate for a checkbox submit — the rejection message when `count` is out of range, else `undefined`. */
export function gateSelection(count: number, min?: number, max?: number): string | undefined {
	if (min !== undefined && count < min)
		return `Select at least ${String(min)} option${min === 1 ? '' : 's'}`
	if (max !== undefined && count > max)
		return `Select no more than ${String(max)} option${max === 1 ? '' : 's'}`
	return undefined
}

// === Editor prompt

/** Build the initial {@link EditorState} from {@link EditorOptions} — resolving the validator + styler, seeding empty lines. */
export function createEditorState(options: EditorOptions): EditorState {
	return {
		message: options.message,
		default: options.default ?? '',
		validator: resolveValidation(options.validate),
		styler: options.styler ?? createStyler(),
		lines: [],
		current: '',
	}
}

/** Render an {@link EditorState} as a MULTI-LINE styled view — the header (with a Ctrl+D hint), the committed lines, the in-progress line, and any error. */
export function editorView(state: EditorState): string {
	const head = `${promptHeader(state.styler, state.message)} ${state.styler.dim('(Ctrl+D to finish)')}`
	const body = [...state.lines, `${state.styler.cyan(PROMPT_ICONS.pointer)} ${state.current}`]
	const view = [head, ...body].join('\n')
	return state.error === undefined ? view : `${view}\n${errorLine(state.styler, state.error)}`
}

/**
 * Advance an editor prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Printable characters extend the current line; backspace shrinks it; return commits the
 * current line and starts a fresh one; ctrl-d FINISHES (joining all lines, falling back to the
 * default when empty) through the validator; ctrl-c cancels. An invalid finish stays active with
 * the error.
 */
export function editorReduce(state: EditorState, key: KeyEvent): PromptStep<string, EditorState> {
	if (key.ctrl && key.name === 'c') return { state, view: editorView(state), status: 'cancel' }

	if (key.ctrl && key.name === 'd') {
		const lines = state.current.length > 0 ? [...state.lines, state.current] : state.lines
		const joined = lines.join('\n')
		const answer = joined.length > 0 ? joined : state.default
		const result = state.validator(answer)
		if (result !== true) {
			const next: EditorState = { ...state, error: result }
			return { state: next, view: editorView(next), status: 'active' }
		}
		return {
			state: { ...state, error: undefined },
			view: `${submitHeader(state.styler, state.message)} ${state.styler.dim(`${String(lines.length)} line${lines.length === 1 ? '' : 's'}`)}`,
			status: 'submit',
			value: answer,
		}
	}

	if (key.name === 'return') {
		const next: EditorState = {
			...state,
			lines: [...state.lines, state.current],
			current: '',
			error: undefined,
		}
		return { state: next, view: editorView(next), status: 'active' }
	}

	const current = editLine(state.current, key)
	if (current === undefined) return { state, view: editorView(state), status: 'active' }
	const next: EditorState = { ...state, current, error: undefined }
	return { state: next, view: editorView(next), status: 'active' }
}

// === Shared reducer helpers

/**
 * Apply a single line-editing {@link KeyEvent} to a text buffer — the editing shared by input /
 * password / editor. A printable key appends its character; `backspace` drops the last character;
 * `space` appends a space; ctrl-u clears the line. Returns the new buffer, or `undefined` when the
 * key does not edit the line (so the caller can leave the state untouched).
 */
export function editLine(value: string, key: KeyEvent): string | undefined {
	if (key.ctrl && key.name === 'u') return ''
	if (key.name === 'backspace') return value.slice(0, -1)
	if (key.name === 'space') return `${value} `
	// A printable key that is not a control / navigation key — `name` is the literal character. Count
	// CODE POINTS (not UTF-16 units) so an astral printable (an emoji, a surrogate pair — `name.length`
	// 2 but ONE code point) appends instead of being dropped, while a multi-char control name (`up`,
	// `return`) is still rejected.
	if (!key.ctrl && !key.meta && [...key.name].length === 1 && isPrintable(key.name)) {
		return `${value}${key.sequence}`
	}
	return undefined
}

// === Wire serialization (T-b)

/**
 * Produce the WIRE-SAFE form of a prompt's options — the {@link PendingPrompt.options} a broker
 * serializes over SSE. Drops everything that cannot cross the wire (a `styler`, and any
 * function-valued `validate` rule), while KEEPING the declarative data a remote client needs to
 * reconstruct the prompt: the {@link ValidationRules} as data, plus `message` / `choices` /
 * `default` / `mask` / `min` / `max`. This is WHY T-a's validation is rules-as-data: a `Validator`
 * FUNCTION can't be serialized, but its declarative rules can — the client rebuilds the validator
 * from them via {@link resolveValidation}.
 *
 * @remarks
 * - **Functions are dropped.** A top-level function value (e.g. a bare-`Validator` `validate`) is
 *   omitted entirely; the `styler` (a fluent function-bearing object) is dropped by key.
 * - **`validate` rules are flattened.** A {@link ValidationRules} bag is copied with each
 *   function rule replaced by `true` (the rule's INTENT survives as the built-in check; its
 *   custom function does not). A bare-function `validate` is dropped (no declarative form to keep).
 * - **`choices` are function-stripped.** Each choice keeps its plain fields (`name` / `value` /
 *   `description` / `checked`); a bare string passes through.
 *
 * @param options - The raw prompt options bag (may hold functions / a styler)
 * @returns A JSON-safe options record — only serializable, declarative data
 */
export function serializePromptOptions(options: object): Readonly<Record<string, unknown>> {
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(options)) {
		// Drop the non-serializable styler (a fluent function-bearing object) and any bare function.
		if (key === 'styler' || typeof value === 'function') continue
		if (key === 'validate') {
			const rules = serializeValidationRules(value)
			if (rules !== undefined) result[key] = rules
			continue
		}
		if (key === 'choices') {
			result[key] = serializeChoices(value)
			continue
		}
		result[key] = value
	}
	return result
}

/**
 * Flatten a `validate` option to its wire-safe {@link ValidationRules} DATA — a function rule
 * becomes `true` (its built-in check survives; its body cannot cross the wire). A bare-function
 * `validate` (no rules object) has no declarative form, so it yields `undefined` (dropped).
 */
export function serializeValidationRules(
	validate: unknown,
): Readonly<Record<string, unknown>> | undefined {
	if (!isRecord(validate)) return undefined
	const rules: Record<string, unknown> = {}
	for (const [rule, value] of Object.entries(validate)) {
		rules[rule] = typeof value === 'function' ? true : value
	}
	return rules
}

/** Strip functions from a `choices` option — each choice keeps its plain fields; a bare string passes through. */
export function serializeChoices(choices: unknown): readonly unknown[] {
	if (!Array.isArray(choices)) return []
	return choices.map((choice: unknown) => {
		if (isString(choice)) return choice
		if (!isRecord(choice)) return choice
		const normalized: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(choice)) {
			if (typeof value !== 'function') normalized[key] = value
		}
		return normalized
	})
}

// === Wire guards (§14 — narrow every wire-decoded value)

/** Narrow an unknown value to a {@link PromptType} — one of the six prompt forms. */
export const isPromptType: Guard<PromptType> = literalOf(
	'input',
	'password',
	'confirm',
	'select',
	'checkbox',
	'editor',
)

/** Narrow an unknown value to a {@link PendingPromptStatus}. */
export const isPendingPromptStatus: Guard<PendingPromptStatus> = literalOf(
	'pending',
	'answered',
	'expired',
)

/**
 * Narrow an unknown wire value to a {@link PendingPrompt} — the §14 guard a {@link PromptClient}
 * applies to each decoded SSE `pending` payload before dispatching it (never an `as`).
 */
export const isPendingPrompt: Guard<PendingPrompt> = recordOf(
	{
		id: isNonEmptyString,
		form: isPromptType,
		message: isString,
		options: isRecord,
		status: isPendingPromptStatus,
		time: isNumber,
		from: isString,
		to: isString,
	},
	['from', 'to'] as const,
)

// === Remote prompt dispatch (T-b)

/**
 * Rebuild a wire-decoded `validate` payload into a {@link ValidationRules} bag — the inverse of
 * {@link serializeValidationRules}. Keeps only the primitive rule values (`boolean` / `number` /
 * `string`) a serialized prompt could carry; an empty / non-record / all-dropped payload yields
 * `undefined` (no rules to apply). The client feeds the result back through {@link resolveValidation}.
 */
export function reconstructValidationRules(value: unknown): ValidationRules | undefined {
	if (!isRecord(value)) return undefined
	const rules: Record<string, boolean | number | string> = {}
	let count = 0
	for (const [rule, item] of Object.entries(value)) {
		// `pattern` is dropped here: it is the only string-valued rule, and copying an untrusted
		// wire-supplied regex source into a client-side `RegExp` risks ReDoS. The broker still
		// re-validates authoritatively via its own answer() gate, so dropping it here is safe.
		if (rule === 'pattern') continue
		if (isBoolean(item) || isNumber(item) || isString(item)) {
			rules[rule] = item
			count += 1
		}
	}
	if (count === 0) return undefined
	return rules
}

/** Read one option by key, narrowed by `guard` — `undefined` when absent or off-shape (§14, never an `as`). */
export function resolveOption<T>(
	options: Readonly<Record<string, unknown>>,
	key: string,
	guard: Guard<T>,
): T | undefined {
	const value = options[key]
	return guard(value) ? value : undefined
}

/** Narrow an unknown value to a {@link PromptChoice} — the `recordOf` shape inlined so no non-exported member lingers (§5). */
export function isPromptChoice(value: unknown): value is PromptChoice {
	return recordOf({ name: isString, value: isString, description: isString }, ['description'])(
		value,
	)
}

/** Narrow an unknown value to a {@link CheckboxChoice} — the `recordOf` shape inlined so no non-exported member lingers (§5). */
export function isCheckboxChoice(value: unknown): value is CheckboxChoice {
	return recordOf({ name: isString, value: isString, description: isString, checked: isBoolean }, [
		'description',
		'checked',
	])(value)
}

/** Read a `choices` option as a list of bare strings / full choices — each element narrowed by `guard`, off-shape elements stringified. */
export function resolveChoices<TChoice extends PromptChoice | CheckboxChoice>(
	options: Readonly<Record<string, unknown>>,
	guard: Guard<TChoice>,
): readonly (string | TChoice)[] {
	const choices = options.choices
	if (!Array.isArray(choices)) return []
	return choices.map((choice: unknown) => {
		if (isString(choice)) return choice
		if (guard(choice)) return choice
		return String(choice)
	})
}

/**
 * Sanitize a list of resolved choices' human-readable labels (`name` + `description`) with
 * {@link stripControls} — shared by the `select` and `checkbox` branches of
 * {@link dispatchPendingPrompt} so a remote-supplied choice can never inject raw control bytes
 * into the local terminal's rendered view.
 *
 * @param choices - The resolved choices (bare strings or full {@link PromptChoice} /
 *   {@link CheckboxChoice} objects) as returned by {@link resolveChoices}
 * @returns The same choices with every `name` / `description` control-stripped
 */
export function sanitizeChoiceLabels<TChoice extends PromptChoice | CheckboxChoice>(
	choices: readonly (string | TChoice)[],
): readonly (string | TChoice)[] {
	return choices.map((choice) => {
		if (isString(choice)) return stripControls(choice)
		const description =
			choice.description === undefined ? undefined : stripControls(choice.description)
		return { ...choice, name: stripControls(choice.name), description }
	})
}

/**
 * Dispatch a {@link PendingPrompt} to the matching {@link PromptFormInterface} method — the bridge
 * step a {@link PromptClient} runs to drive a LOCAL terminal with a prompt issued elsewhere.
 * Reconstructs typed options from the wire-safe {@link PendingPrompt.options} (every field
 * §14-narrowed, never an `as`; the validator rebuilt from rules via {@link reconstructValidationRules}),
 * then calls the matching prompt form and returns its resolved value.
 *
 * @param terminal - The local {@link PromptFormInterface} to drive
 * @param pending - The decoded pending prompt to dispatch
 * @returns The prompt's resolved value (a `string` / `boolean` / `readonly string[]` per form)
 */
export function dispatchPendingPrompt(
	terminal: PromptFormInterface,
	pending: PendingPrompt,
): Promise<string | boolean | readonly string[]> {
	const options = pending.options
	const validate = reconstructValidationRules(options.validate)
	const message = stripControls(pending.message)
	switch (pending.form) {
		case 'input': {
			const value = resolveOption(options, 'default', isString)
			return terminal.input({
				message,
				default: value === undefined ? undefined : stripControls(value),
				validate,
			})
		}
		case 'password': {
			const value = resolveOption(options, 'mask', isString)
			return terminal.password({
				message,
				mask: value === undefined ? undefined : stripControls(value),
				validate,
			})
		}
		case 'confirm':
			return terminal.confirm({
				message,
				default: resolveOption(options, 'default', isBoolean),
			})
		case 'select': {
			const value = resolveOption(options, 'default', isString)
			return terminal.select({
				message,
				choices: sanitizeChoiceLabels(resolveChoices(options, isPromptChoice)),
				default: value === undefined ? undefined : stripControls(value),
			})
		}
		case 'checkbox':
			return terminal.checkbox({
				message,
				choices: sanitizeChoiceLabels(resolveChoices(options, isCheckboxChoice)),
				min: resolveOption(options, 'min', isNumber),
				max: resolveOption(options, 'max', isNumber),
			})
		case 'editor': {
			const value = resolveOption(options, 'default', isString)
			return terminal.editor({
				message,
				default: value === undefined ? undefined : stripControls(value),
				validate,
			})
		}
	}
}

// === Broker + bridge wiring helpers (T-b)

/**
 * The default {@link import('./types.js').TimerHandler} — a thin host `setTimeout` / `clearTimeout`
 * wrapper that arms `callback` after `ms` and returns a {@link TimerCancel}. The deadline seam
 * behind both the {@link import('./Prompt.js').Prompt} broker (its expiry) and the
 * {@link import('./PromptClient.js').PromptClient} (its reconnect backoff); a test injects a
 * deterministic timer instead, so neither entity touches real time.
 */
export function defaultTimer(callback: () => void, ms: number): TimerCancel {
	const handle = setTimeout(callback, ms)
	return () => clearTimeout(handle)
}

/** The default {@link import('./types.js').FetchHandler} — the global `fetch`, adapted to the minimal injected shape the {@link import('./PromptClient.js').PromptClient} uses. */
export function globalFetch(input: string, init?: FetchInit): Promise<Response> {
	return fetch(input, init)
}

/**
 * Whether a caught value is an `AbortError` — the {@link import('./PromptClient.js').PromptClient}
 * distinguishes a deliberate `disconnect` / teardown (an aborted `fetch`) from a real fault, so it
 * exits its connect loop quietly instead of emitting `error` / reconnecting.
 */
export function isAbortError(error: unknown): boolean {
	return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
}

/**
 * Parse a JSON wire string TOTAL — a malformed / empty payload yields `undefined` (the caller's
 * guard then rejects it), never a throw. The {@link import('./PromptClient.js').PromptClient}
 * decodes every SSE `data` field through this before §14-narrowing it.
 */
export function parseWireJSON(text: string): unknown {
	if (text.length === 0) return undefined
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

/**
 * Whether `url` is an INSECURE remote endpoint — a plain `http://` URL whose host is NOT a
 * loopback address. Pure string parsing (no `URL` global), so it stays total on malformed input.
 *
 * @remarks
 * A loopback host (`localhost`, `127.0.0.1`, `[::1]`) over `http://` is exempt (local
 * development has no network hop to eavesdrop on); every other `http://` host is insecure.
 * An `https://` URL (or any non-`http://` scheme) is never flagged.
 *
 * @param url - The candidate endpoint URL
 * @returns `true` when `url` is a non-loopback `http://` endpoint
 *
 * @example
 * ```ts
 * isInsecureRemote('http://example.com')     // true
 * isInsecureRemote('http://localhost:3000')  // false
 * isInsecureRemote('https://example.com')    // false
 * ```
 */
export function isInsecureRemote(url: string): boolean {
	const prefix = 'http://'
	if (!url.startsWith(prefix)) return false
	const rest = url.slice(prefix.length)
	const hostEnd = rest.search(/[/?#]/)
	const authority = hostEnd === -1 ? rest : rest.slice(0, hostEnd)
	const host = authority.includes('@') ? authority.slice(authority.indexOf('@') + 1) : authority
	const hostname = host.startsWith('[')
		? host.slice(0, host.indexOf(']') + 1)
		: (host.split(':')[0] ?? '')
	return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]'
}

// === Terminal manager wire seams (transport-neutral, no http dependency)

/** Serialize a parked {@link PendingPrompt} into a {@link WireEvent} — event `'pending'`, `data` the JSON-stringified prompt, `id` the prompt's own id (an SSE bridge sets its frame `id:` from this). */
export function serializePending(prompt: PendingPrompt): WireEvent {
	return { event: 'pending', data: JSON.stringify(prompt), id: prompt.id }
}

/** Serialize a parked prompt's expiry into a {@link WireEvent} — event `'expire'`, `data` the JSON-stringified `{ id }` payload. */
export function serializeExpire(id: string): WireEvent {
	return { event: 'expire', data: JSON.stringify({ id }) }
}

/** The {@link WireEvent} a broker/manager sends when it is going away — event `'shutdown'`, no payload. */
export function serializeShutdown(): WireEvent {
	return { event: 'shutdown', data: '' }
}

/** Narrow an unknown wire payload to an answer POST body — a non-empty `id` string plus a `value` key (of any shape) present. */
export function isAnswerPayload(
	value: unknown,
): value is { readonly id: string; readonly value: unknown } {
	return isRecord(value) && isNonEmptyString(value.id) && 'value' in value
}

/** Narrow an unknown value to a {@link TerminalSnapshot} — a non-empty `id` plus an optional numeric `timeout`. */
export const isTerminalSnapshot: Guard<TerminalSnapshot> = recordOf(
	{ id: isNonEmptyString, timeout: isNumber },
	['timeout'] as const,
)
