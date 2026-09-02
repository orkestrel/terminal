import type {
	CheckboxState,
	ConfirmState,
	EditorState,
	FetchInit,
	InputState,
	KeyEvent,
	PasswordState,
	PendingForm,
	PromptIcon,
	PromptRole,
	PromptStep,
	PromptTheme,
	PromptThemeOptions,
	SelectState,
	TimerCancelFunction,
	WireEvent,
} from './types.js'
import type { Style, StylerInterface } from '@orkestrel/console'
import type {
	CheckboxField,
	ConfirmField,
	EditorField,
	FormField,
	FormSchema,
	PasswordField,
	SelectField,
	TextField,
} from '@orkestrel/form'
import {
	CONTROL_NAMES,
	DEFAULT_MASK,
	DEFAULT_PROMPT_THEME,
	PROMPT_ROLES,
	SEQUENCE_NAMES,
} from './constants.js'
import { isString } from '@orkestrel/contract'
import { createStyler, freezeStyle, strip, stripControls } from '@orkestrel/console'

// The PURE prompt core implementation — all EXPORTED, all pure, all unit-tested:
// the key decoder, schema sanitization, per-field view renderers, and the six `create*State`
// factories + `*Reduce` reducers. No `node:*`, no I/O, no events. Form owns validation and
// settlement; these reducers only turn keys into candidate field values.

// === Key decoding

/**
 * Decodes one keypress's bytes into a {@link KeyEvent} — total, never throws. A `Uint8Array` is
 * read as UTF-8; the resulting string is matched against the known control bytes and the CRLF
 * pair ({@link CONTROL_NAMES}) and escape sequences ({@link SEQUENCE_NAMES}), falling back to a
 * single printable character. An unrecognized sequence carries NO `name`, with the raw `sequence`
 * preserved.
 *
 * @remarks
 * - **Single control byte.** A one-character control input (`return` / `backspace` / `tab` /
 *   `escape` / `space`, or a Ctrl combo `c` / `d` / `u` / `a` / `e`), or the two-byte `\r\n`
 *   CRLF pair, is looked up in {@link CONTROL_NAMES}, carrying its `ctrl` flag.
 * - **Escape sequence.** A multi-byte ESC sequence (`up` / `down` / `left` / `right` in BOTH the
 *   `ESC[A` and `ESCOA` forms, plus `home` / `end` / `delete`) is looked up in
 *   {@link SEQUENCE_NAMES} and flagged `meta`.
 * - **Printable character.** A single printable character becomes `name` = that character, with
 *   `shift` set when it is an uppercase letter. A multi-code-point printable (an emoji, a pasted
 *   run) keeps its first code point as the name and the whole input as `sequence`.
 * - **Unknown.** Anything else (an unrecognized escape, an empty input) yields an event with NO
 *   `name` — absence, never an empty string — total, so the driver never crashes on a stray byte.
 *
 * @param input - The raw keypress bytes, as a string or `Uint8Array`
 * @returns The decoded {@link KeyEvent}
 *
 * @example
 * ```ts
 * parseKey('\r')        // { name: 'return', sequence: '\r', ctrl: false, meta: false, shift: false }
 * parseKey('\r\n')      // { name: 'return', sequence: '\r\n', ctrl: false, meta: false, shift: false }
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

	// A known single control byte (return / backspace / tab / escape / space / a ctrl combo),
	// or the two-byte CRLF pair.
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

	// Anything else (an unrecognized escape, an empty input) — total, never a throw. The name is
	// OMITTED rather than emptied, so a caller reads absence instead of a sentinel.
	return { sequence, ctrl: false, meta: false, shift: false }
}

/** Checks whether a single character is a printable (non-control) character — used by {@link parseKey}'s char fallback. */
export function isPrintable(character: string): boolean {
	if (character.length === 0) return false
	const code = character.codePointAt(0)
	if (code === undefined) return false
	// Exclude the C0 controls (0–31) and DEL (127); everything at or above space is printable.
	return code >= 32 && code !== 127
}

// === Prompt theme

/**
 * Builds a complete {@link PromptTheme} by merging a partial one over
 * {@link DEFAULT_PROMPT_THEME}, leaf by leaf — each supplied icon replaces that glyph, each
 * supplied role replaces that {@link Style}, and everything else keeps its default. Each supplied
 * style is snapshotted through the console module's own
 * {@link import('@orkestrel/console').freezeStyle}, so the result is deeply frozen and a caller
 * mutating its own attribute list afterwards cannot reach into a built theme.
 *
 * @param options - The partial theme to merge, or `undefined` for the defaults
 * @returns The resolved, deeply frozen theme every prompt state carries
 *
 * @example
 * ```ts
 * createPromptTheme() // the defaults
 * createPromptTheme({
 * 	icons: { pointer: '=>' },
 * 	roles: { message: { foreground: 'magenta', attributes: ['bold'] } },
 * })
 * ```
 */
export function createPromptTheme(options?: PromptThemeOptions): PromptTheme {
	const icons: Record<PromptIcon, string> = { ...DEFAULT_PROMPT_THEME.icons, ...options?.icons }
	const roles: Record<PromptRole, Style> = { ...DEFAULT_PROMPT_THEME.roles }
	for (const role of PROMPT_ROLES) {
		const style = options?.roles?.[role]
		if (style !== undefined) roles[role] = freezeStyle(style)
	}
	return Object.freeze({ icons: Object.freeze(icons), roles: Object.freeze(roles) })
}

/**
 * Sanitizes text for one single-line display slot. Composes console's ANSI {@link strip} and C0
 * {@link stripControls} passes with removal of tab, line feed, and carriage return.
 *
 * @param text - The text to sanitize for a glyph or hint slot
 * @returns The text with ANSI sequences, every C0 control character, and DEL removed
 *
 * @example
 * ```ts
 * sanitizeDisplayText('Q\rOVERWRITE\nNEXT\tX') // 'QOVERWRITENEXTX'
 * ```
 */
export function sanitizeDisplayText(text: string): string {
	return stripControls(strip(text)).replaceAll('\t', '').replaceAll('\n', '').replaceAll('\r', '')
}

/**
 * Sanitizes every terminal-readable string in a parsed form schema.
 *
 * @remarks
 * Display strings pass through {@link sanitizeDisplayText}: labels, help, placeholders, masks,
 * choice labels and help, file accept entries, and pattern sources. Identity and answer strings
 * stay verbatim: schema, group, and field names, group references, choice values, and defaults.
 * Rewriting those would sever the rendering copy from the authoritative form. Field metadata is
 * removed because terminal neither renders nor interprets it. Pattern sources are sanitized as
 * text only and are never compiled or executed here.
 *
 * @param schema - A schema already accepted by the Form package's `parseForm`
 * @returns A new schema with terminal-readable strings sanitized and field metadata omitted
 *
 * @example
 * ```ts
 * sanitizeSchema({ fields: [{ control: 'text', name: 'na\u001bme', label: 'N\u0000ame' }] })
 * // { fields: [{ control: 'text', name: 'na\u001bme', label: 'Name' }] }
 * ```
 */
export function sanitizeSchema(schema: FormSchema): FormSchema {
	const groups = schema.groups?.map((group) => ({
		name: group.name,
		label: sanitizeDisplayText(group.label),
		...(group.help !== undefined ? { help: sanitizeDisplayText(group.help) } : {}),
	}))
	const fields: FormField[] = []
	for (const source of schema.fields) {
		const { meta: _meta, ...field } = source
		const rule =
			field.rule === undefined
				? undefined
				: {
						...field.rule,
						...(field.rule.pattern !== undefined
							? { pattern: sanitizeDisplayText(field.rule.pattern) }
							: {}),
					}
		const shared = {
			name: field.name,
			...(field.label !== undefined ? { label: sanitizeDisplayText(field.label) } : {}),
			...(field.help !== undefined ? { help: sanitizeDisplayText(field.help) } : {}),
			...(field.group !== undefined ? { group: field.group } : {}),
			...(rule !== undefined ? { rule } : {}),
		}

		switch (field.control) {
			case 'text':
			case 'editor':
			case 'number': {
				fields.push({
					...field,
					...shared,
					...(field.placeholder !== undefined
						? { placeholder: sanitizeDisplayText(field.placeholder) }
						: {}),
				})
				break
			}
			case 'password': {
				fields.push({
					...field,
					...shared,
					...(field.mask !== undefined ? { mask: sanitizeDisplayText(field.mask) } : {}),
				})
				break
			}
			case 'date':
			case 'time':
			case 'datetime':
			case 'color':
			case 'confirm': {
				fields.push({
					...field,
					...shared,
				})
				break
			}
			case 'select':
			case 'checkbox': {
				fields.push({
					...field,
					...shared,
					choices: field.choices.map((choice) => ({
						...choice,
						value: choice.value,
						label: sanitizeDisplayText(choice.label),
						...(choice.help !== undefined ? { help: sanitizeDisplayText(choice.help) } : {}),
					})),
				})
				break
			}
			case 'file': {
				fields.push({
					...field,
					...shared,
					...(field.accept !== undefined ? { accept: field.accept.map(sanitizeDisplayText) } : {}),
				})
				break
			}
		}
	}

	return {
		...(schema.name !== undefined ? { name: schema.name } : {}),
		...(schema.label !== undefined ? { label: sanitizeDisplayText(schema.label) } : {}),
		...(schema.help !== undefined ? { help: sanitizeDisplayText(schema.help) } : {}),
		...(groups !== undefined ? { groups } : {}),
		fields,
	}
}

/**
 * Sanitizes every glyph a wire-supplied {@link PromptThemeOptions} carries for a single-line display
 * slot. Only the icons need it: a role is guard-narrowed to a console {@link Style}, whose colors
 * and attributes are fixed name sets, so no role can carry a byte a terminal would act on.
 *
 * @param theme - The narrowed theme options a remote prompt supplied
 * @returns The same theme with every supplied glyph sanitized for a single-line display slot
 */
export function sanitizeThemeIcons(theme: PromptThemeOptions): PromptThemeOptions {
	const icons = theme.icons
	if (icons === undefined) return theme
	const sanitized: Record<string, string> = {}
	for (const [icon, glyph] of Object.entries(icons)) sanitized[icon] = sanitizeDisplayText(glyph)
	return { ...theme, icons: sanitized }
}

// === Shared view helpers

/** Renders the styled question header (`? message`) — the leading line every active prompt view shares, themed by the `question` + `message` roles. */
export function renderPromptHeader(
	styler: StylerInterface,
	theme: PromptTheme,
	message: string,
): string {
	return `${styler.render(theme.roles.question, theme.icons.question)} ${styler.render(theme.roles.message, message)}`
}

/**
 * Renders a question header followed by a key hint painted with the `hint` role, or the header
 * alone when no hint is supplied.
 *
 * @param styler - The console styler that renders each role
 * @param theme - The resolved prompt theme
 * @param message - The prompt's question text
 * @param hint - The optional key hint to append
 * @returns The rendered header with the optional hint
 */
export function renderHintedHeader(
	styler: StylerInterface,
	theme: PromptTheme,
	message: string,
	hint?: string,
): string {
	const head = renderPromptHeader(styler, theme, message)
	return hint === undefined ? head : `${head} ${styler.render(theme.roles.hint, hint)}`
}

/** Renders the styled submit line (`✔ message`) — the committed header an interactive prompt shows once resolved, themed by the `success` + `message` roles. */
export function renderSubmitHeader(
	styler: StylerInterface,
	theme: PromptTheme,
	message: string,
): string {
	return `${styler.render(theme.roles.success, theme.icons.success)} ${styler.render(theme.roles.message, message)}`
}

/** Renders the styled failure line (`✖ message`) a form driver appends for a refused field. */
export function renderErrorLine(
	styler: StylerInterface,
	theme: PromptTheme,
	message: string,
): string {
	return `${styler.render(theme.roles.error, theme.icons.error)} ${styler.render(theme.roles.error, message)}`
}

// === Input prompt

/**
 * Builds the initial text-field key state.
 *
 * @param field - The text field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createInputState(
	field: TextField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): InputState {
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		default: field.default ?? '',
		styler,
		theme: createPromptTheme(theme),
		value: '',
	}
}

/** Renders a text-field key state as a styled view. */
export function renderInputView(state: InputState): string {
	const content = state.value.length > 0 ? state.value : state.default
	const role = state.value.length > 0 ? state.theme.roles.content : state.theme.roles.hint
	const shown = state.styler.render(role, sanitizeDisplayText(content))
	return `${renderPromptHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.pointer, state.theme.icons.pointer)} ${shown}`
}

/**
 * Advances an input prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Printable characters extend the value; backspace shrinks it; ctrl-u clears it; ctrl-c
 * cancels; return produces the candidate value, with an empty line falling back to the default.
 */
export function inputReduce(state: InputState, key: KeyEvent): PromptStep<string, InputState> {
	if (key.ctrl && key.name === 'c') return { state, view: renderInputView(state), status: 'cancel' }

	if (key.name === 'return') {
		const answer = state.value.length > 0 ? state.value : state.default
		const next = { ...state, value: answer }
		return {
			state: next,
			view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, sanitizeDisplayText(answer))}`,
			status: 'submit',
			value: answer,
		}
	}

	const value = editLine(state.value, key)
	if (value === undefined) return { state, view: renderInputView(state), status: 'active' }
	const next = { ...state, value }
	return { state: next, view: renderInputView(next), status: 'active' }
}

// === Password prompt

/**
 * Builds the initial password-field key state.
 *
 * @param field - The password field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createPasswordState(
	field: PasswordField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): PasswordState {
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		mask: sanitizeDisplayText(field.mask ?? DEFAULT_MASK),
		styler,
		theme: createPromptTheme(theme),
		value: '',
	}
}

/** Renders a password-field key state as a styled view. */
export function renderPasswordView(state: PasswordState): string {
	const masked = state.styler.render(
		state.theme.roles.content,
		state.mask.repeat(state.value.length),
	)
	return `${renderPromptHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.pointer, state.theme.icons.pointer)} ${masked}`
}

/**
 * Advances a password prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Identical line-editing to {@link inputReduce} (printable extends, backspace shrinks,
 * ctrl-u clears, ctrl-c cancels) but the view masks the value. Return produces the candidate value.
 */
export function passwordReduce(
	state: PasswordState,
	key: KeyEvent,
): PromptStep<string, PasswordState> {
	if (key.ctrl && key.name === 'c')
		return { state, view: renderPasswordView(state), status: 'cancel' }

	if (key.name === 'return') {
		return {
			state,
			view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, state.mask.repeat(state.value.length))}`,
			status: 'submit',
			value: state.value,
		}
	}

	const value = editLine(state.value, key)
	if (value === undefined) return { state, view: renderPasswordView(state), status: 'active' }
	const next = { ...state, value }
	return { state: next, view: renderPasswordView(next), status: 'active' }
}

// === Confirm prompt

/**
 * Builds the initial confirm-field key state.
 *
 * @param field - The confirm field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createConfirmState(
	field: ConfirmField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): ConfirmState {
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		default: field.default ?? false,
		styler,
		theme: createPromptTheme(theme),
	}
}

/**
 * Renders a confirm-field key state as a styled view. The selected role paints the default letter.
 */
export function renderConfirmView(state: ConfirmState): string {
	const head = renderPromptHeader(state.styler, state.theme, state.message)
	const answer = state.default
		? `${state.styler.render(state.theme.roles.selected, 'Y')}${state.styler.render(state.theme.roles.hint, '/n')}`
		: `${state.styler.render(state.theme.roles.hint, 'y/')}${state.styler.render(state.theme.roles.selected, 'N')}`
	return `${head} ${state.styler.render(state.theme.roles.hint, '(')}${answer}${state.styler.render(state.theme.roles.hint, ')')}`
}

/**
 * Advances a confirm prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<boolean>`
 * reducer. `y` / `Y` submits `true`, `n` / `N` submits `false`, return on an empty line submits
 * the `default`, ctrl-c cancels; any other key is ignored (stays active).
 */
export function confirmReduce(
	state: ConfirmState,
	key: KeyEvent,
): PromptStep<boolean, ConfirmState> {
	if (key.ctrl && key.name === 'c')
		return { state, view: renderConfirmView(state), status: 'cancel' }

	let answer: boolean | undefined
	const choice = key.name?.toLowerCase()
	if (key.name === 'return') answer = state.default
	else if (choice === 'y') answer = true
	else if (choice === 'n') answer = false

	if (answer === undefined) return { state, view: renderConfirmView(state), status: 'active' }
	return {
		state,
		view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, answer ? 'yes' : 'no')}`,
		status: 'submit',
		value: answer,
	}
}

// === Select prompt

/**
 * Builds the initial select-field key state.
 *
 * @param field - The select field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createSelectState(
	field: SelectField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): SelectState {
	const choices = [...field.choices]
	const index = choices.findIndex((choice) => choice.value === field.default)
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		choices,
		styler,
		theme: createPromptTheme(theme),
		focused: index >= 0 ? index : 0,
	}
}

/** Renders a select-field key state as a multi-line styled view. */
export function renderSelectView(state: SelectState): string {
	const lines = state.choices.map((choice, index) => {
		const active = index === state.focused
		const pointer = active
			? state.styler.render(state.theme.roles.pointer, state.theme.icons.pointer)
			: ' '
		const marker = active
			? state.styler.render(state.theme.roles.selected, state.theme.icons.selected)
			: state.styler.render(state.theme.roles.muted, state.theme.icons.dot)
		const label = active
			? state.styler.render(state.theme.roles.focus, choice.label)
			: state.styler.render(state.theme.roles.content, choice.label)
		const description =
			choice.help === undefined
				? ''
				: `  ${state.styler.render(state.theme.roles.description, choice.help)}`
		return `${pointer} ${marker} ${label}${description}`
	})
	return [renderPromptHeader(state.styler, state.theme, state.message), ...lines].join('\n')
}

/**
 * Advances a select prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. `up` / `down` (and `k` / `j`) move the focus, WRAPPING at the ends; return submits the
 * focused choice's `value`; ctrl-c cancels. An empty choice list can never submit (a higher layer
 * guards against it); any other key is ignored.
 */
export function selectReduce(state: SelectState, key: KeyEvent): PromptStep<string, SelectState> {
	if (key.ctrl && key.name === 'c')
		return { state, view: renderSelectView(state), status: 'cancel' }

	const count = state.choices.length
	if (count === 0) return { state, view: renderSelectView(state), status: 'active' }

	if (key.name === 'up' || key.name === 'k') {
		const next = { ...state, focused: (state.focused - 1 + count) % count }
		return { state: next, view: renderSelectView(next), status: 'active' }
	}
	if (key.name === 'down' || key.name === 'j') {
		const next = { ...state, focused: (state.focused + 1) % count }
		return { state: next, view: renderSelectView(next), status: 'active' }
	}
	if (key.name === 'return') {
		const choice = state.choices[state.focused]
		const value = choice?.value ?? ''
		return {
			state,
			view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, choice?.label ?? '')}`,
			status: 'submit',
			value,
		}
	}
	return { state, view: renderSelectView(state), status: 'active' }
}

// === Checkbox prompt

/**
 * Builds the initial checkbox-field key state.
 *
 * @param field - The checkbox field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createCheckboxState(
	field: CheckboxField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): CheckboxState {
	const choices = [...field.choices]
	const checked: readonly number[] = choices.reduce<number[]>((indices, choice, index) => {
		if (field.default?.includes(choice.value) === true) indices.push(index)
		return indices
	}, [])
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		choices,
		styler,
		theme: createPromptTheme(theme),
		focused: 0,
		checked,
	}
}

/** Renders a checkbox-field key state as a multi-line styled view. */
export function renderCheckboxView(state: CheckboxState): string {
	const lines = state.choices.map((choice, index) => {
		const active = index === state.focused
		const ticked = state.checked.includes(index)
		const pointer = active
			? state.styler.render(state.theme.roles.pointer, state.theme.icons.pointer)
			: ' '
		const box = ticked
			? state.styler.render(state.theme.roles.selected, state.theme.icons.checked)
			: state.styler.render(state.theme.roles.muted, state.theme.icons.unchecked)
		const label = active
			? state.styler.render(state.theme.roles.focus, choice.label)
			: state.styler.render(state.theme.roles.content, choice.label)
		const description =
			choice.help === undefined
				? ''
				: `  ${state.styler.render(state.theme.roles.description, choice.help)}`
		return `${pointer} ${box} ${label}${description}`
	})
	const summary = state.styler.render(state.theme.roles.hint, `${state.checked.length} selected`)
	const body = [
		renderPromptHeader(state.styler, state.theme, state.message),
		...lines,
		summary,
	].join('\n')
	return body
}

/**
 * Advances a checkbox prompt by one {@link KeyEvent} — the pure
 * `(state, key) → PromptStep<readonly string[]>` reducer. `up` / `down` (and `k` / `j`) move the
 * focus (wrapping); `space` toggles the focused index in the checked set; return submits the
 * checked values in choice order; ctrl-c cancels. The form applies selection-count rules.
 */
export function checkboxReduce(
	state: CheckboxState,
	key: KeyEvent,
): PromptStep<readonly string[], CheckboxState> {
	if (key.ctrl && key.name === 'c')
		return { state, view: renderCheckboxView(state), status: 'cancel' }

	const count = state.choices.length

	if ((key.name === 'up' || key.name === 'k') && count > 0) {
		const next = {
			...state,
			focused: (state.focused - 1 + count) % count,
		}
		return { state: next, view: renderCheckboxView(next), status: 'active' }
	}
	if ((key.name === 'down' || key.name === 'j') && count > 0) {
		const next = { ...state, focused: (state.focused + 1) % count }
		return { state: next, view: renderCheckboxView(next), status: 'active' }
	}
	if (key.name === 'space' && count > 0) {
		const checked = toggleIndex(state.checked, state.focused)
		const next = { ...state, checked }
		return { state: next, view: renderCheckboxView(next), status: 'active' }
	}
	if (key.name === 'return') {
		const ordered = [...state.checked].sort((a, b) => a - b)
		const values = ordered
			.map((index) => state.choices[index]?.value)
			.filter((value): value is string => value !== undefined)
		const summary = ordered
			.map((index) => state.choices[index]?.label)
			.filter((name): name is string => name !== undefined)
			.join(', ')
		return {
			state,
			view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, summary)}`,
			status: 'submit',
			value: values,
		}
	}
	return { state, view: renderCheckboxView(state), status: 'active' }
}

/** Toggles `index` in a readonly index list — copy-on-write, returning the new sorted-by-insertion list. */
export function toggleIndex(indices: readonly number[], index: number): readonly number[] {
	return indices.includes(index) ? indices.filter((i) => i !== index) : [...indices, index]
}

// === Editor prompt

/**
 * Builds the initial editor-field key state.
 *
 * @param field - The editor field to render
 * @param styler - The styler used to render the view
 * @param theme - The optional terminal theme
 * @returns The initial immutable key state
 */
export function createEditorState(
	field: EditorField,
	styler: StylerInterface = createStyler(),
	theme?: PromptThemeOptions,
): EditorState {
	const lines: readonly string[] = []
	return {
		message: sanitizeDisplayText(field.label ?? field.name),
		default: field.default ?? '',
		styler,
		theme: createPromptTheme(theme),
		lines,
		current: '',
	}
}

/**
 * Renders an editor-field key state as a multi-line styled view with its finish hint.
 */
export function renderEditorView(state: EditorState): string {
	const head = renderHintedHeader(state.styler, state.theme, state.message, '(Ctrl+D to finish)')
	const pointer = state.styler.render(state.theme.roles.pointer, state.theme.icons.pointer)
	const committed = state.lines.map((line) => state.styler.render(state.theme.roles.content, line))
	const body = [
		...committed,
		`${pointer} ${state.styler.render(state.theme.roles.content, state.current)}`,
	]
	return [head, ...body].join('\n')
}

/**
 * Advances an editor prompt by one {@link KeyEvent} — the pure `(state, key) → PromptStep<string>`
 * reducer. Printable characters extend the current line; backspace shrinks it; return commits the
 * current line and starts a fresh one; ctrl-d FINISHES (joining all lines, falling back to the
 * default when empty); ctrl-c cancels. The form validates the candidate after the driver fills it.
 */
export function editorReduce(state: EditorState, key: KeyEvent): PromptStep<string, EditorState> {
	if (key.ctrl && key.name === 'c')
		return { state, view: renderEditorView(state), status: 'cancel' }

	if (key.ctrl && key.name === 'd') {
		const lines = state.current.length > 0 ? [...state.lines, state.current] : state.lines
		const joined = lines.join('\n')
		const answer = joined.length > 0 ? joined : state.default
		return {
			state,
			view: `${renderSubmitHeader(state.styler, state.theme, state.message)} ${state.styler.render(state.theme.roles.hint, `${String(lines.length)} line${lines.length === 1 ? '' : 's'}`)}`,
			status: 'submit',
			value: answer,
		}
	}

	if (key.name === 'return') {
		const next = {
			...state,
			lines: [...state.lines, state.current],
			current: '',
		}
		return { state: next, view: renderEditorView(next), status: 'active' }
	}

	const current = editLine(state.current, key)
	if (current === undefined) return { state, view: renderEditorView(state), status: 'active' }
	const next = { ...state, current }
	return { state: next, view: renderEditorView(next), status: 'active' }
}

// === Shared reducer helpers

/**
 * Applies a single line-editing {@link KeyEvent} to a text buffer — the editing shared by input /
 * password / editor. A printable key appends its character; `backspace` drops the last character;
 * `space` appends a space; ctrl-u clears the line. Returns the new buffer, or `undefined` when the
 * key does not edit the line (so the caller can leave the state untouched).
 */
export function editLine(value: string, key: KeyEvent): string | undefined {
	if (key.ctrl && key.name === 'u') return ''
	if (key.name === 'backspace') return value.slice(0, -1)
	if (key.name === 'space') return `${value} `
	// A printable key that is not a control / navigation key — `name` is the literal character, and an
	// undecoded key carries none at all. Count CODE POINTS (not UTF-16 units) so an astral printable
	// (an emoji, a surrogate pair — `name.length` 2 but ONE code point) appends instead of being
	// dropped, while a multi-char control name (`up`, `return`) is still rejected.
	if (
		!key.ctrl &&
		!key.meta &&
		key.name !== undefined &&
		[...key.name].length === 1 &&
		isPrintable(key.name)
	) {
		return `${value}${key.sequence}`
	}
	return undefined
}

// === Broker + bridge wiring helpers

/**
 * Implements the default {@link import('./types.js').TimerHandler} — a thin host `setTimeout` / `clearTimeout`
 * wrapper that arms `callback` after `ms` and returns a {@link TimerCancelFunction}. The deadline seam
 * behind both the {@link import('./Prompt.js').Prompt} broker (its expiry) and the
 * {@link import('./PromptClient.js').PromptClient} (its reconnect backoff); a test injects a
 * deterministic timer instead, so neither entity touches real time.
 */
export function defaultTimer(callback: () => void, ms: number): TimerCancelFunction {
	const handle = setTimeout(callback, ms)
	return () => clearTimeout(handle)
}

/** Implements the default {@link import('./types.js').FetchHandler} — the global `fetch`, adapted to the minimal injected shape the {@link import('./PromptClient.js').PromptClient} uses. */
export function globalFetch(input: string, init?: FetchInit): Promise<Response> {
	return fetch(input, init)
}

/**
 * Checks whether a caught value is an `AbortError` — the {@link import('./PromptClient.js').PromptClient}
 * distinguishes a deliberate `disconnect` / teardown (an aborted `fetch`) from a real fault, so it
 * exits its connect loop quietly instead of emitting `error` / reconnecting.
 */
export function isAbortError(error: unknown): boolean {
	return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
}

/**
 * Checks whether `url` is an INSECURE remote endpoint — a plain `http://` URL whose host is NOT a
 * loopback address. Pure string parsing (no `URL` global), so it stays total on malformed input.
 *
 * @remarks
 * A loopback host (`localhost`, `127.0.0.1`, `[::1]`) over `http://` is exempt (local
 * development has no network hop to eavesdrop on); every other `http://` host is insecure.
 * An `https://` URL (or any non-`http://` scheme) is never flagged.
 *
 * @param url - The candidate endpoint URL
 * @returns True if `url` is a non-loopback `http://` endpoint; false otherwise
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

/** Serializes a parked {@link PendingForm} into a {@link WireEvent}. */
export function serializePending(form: PendingForm): WireEvent {
	return { event: 'pending', data: JSON.stringify(form), id: form.id }
}

/** Serializes a parked prompt's expiry or release into a {@link WireEvent} — event `'expire'`, `data` the JSON-stringified `{ id }` payload. */
export function serializeExpire(id: string): WireEvent {
	return { event: 'expire', data: JSON.stringify({ id }) }
}

/** Serializes the {@link WireEvent} a broker or manager sends when it is going away — event `'destroy'`, no payload. */
export function serializeDestroy(): WireEvent {
	return { event: 'destroy', data: '' }
}
