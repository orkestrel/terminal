import type {
	FieldChoice,
	FieldError,
	FieldValue,
	FormField,
	FormInterface,
	FormValues,
} from '@orkestrel/form'
import type {
	CheckboxField,
	ConfirmField,
	EditorField,
	FileField,
	PasswordField,
	SelectField,
} from '@orkestrel/form'
import type { KeyEvent, PromptStep, PromptTheme, TerminalInterface } from '@src/core'
import type { StylerInterface } from '@orkestrel/console'
import type { Interface } from 'node:readline'
import type { InputStreamInterface, OutputStreamInterface, TerminalOptions } from './types.js'
import {
	checkboxReduce,
	confirmReduce,
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createPromptTheme,
	createSelectState,
	editorReduce,
	inputReduce,
	parseKey,
	passwordReduce,
	renderErrorLine,
	renderHintedHeader,
	renderPromptHeader,
	sanitizeDisplayText,
	selectReduce,
	TerminalError,
} from '@src/core'
import { matchesAnswer, parseValue } from '@orkestrel/form'
import { createStyler } from '@orkestrel/console'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import {
	CURSOR_HIDE,
	CURSOR_SHOW,
	FALLBACK_CHECKBOX_HINT,
	FALLBACK_CONFIRM_HINT,
	FALLBACK_EDITOR_HINT,
	FALLBACK_SELECT_HINT,
	FILE_HINT,
	LINE_FEED,
	REFUSAL_MESSAGE,
} from './constants.js'
import {
	fieldToText,
	filterDisabled,
	filterEnabled,
	isInputStream,
	isOutputStream,
	isReadable,
	lineCount,
	redrawPrefix,
	renderGroupHeader,
	renderLockedLine,
	renderNumberedList,
	renderSuggestionLine,
	renderUnavailableLine,
	supportsRawMode,
	valueToText,
} from './helpers.js'

/**
 * The interactive terminal form DRIVER — the {@link TerminalInterface} implementation for a human at
 * this machine's keyboard, and the only impure part of the terminal stack. {@link ask} walks one
 * form's fields in schema order, feeds raw-mode stdin bytes through `parseKey` into the matching
 * pure reducer, renders each returned view in place, and binds every answer through the form's own
 * `fill`. It owns no form logic: the schema, the rules, the values, and the settlement all belong to
 * the form it is given, and this class owns only raw mode, the cursor, and the re-render.
 *
 * @remarks
 * See {@link TerminalInterface} for the driving contract. The walk itself:
 *
 * - **Twelve controls, seven reducers.** `text`, `number`, `date`, `time`, `datetime`, `color`, and
 *   each `file` entry are read as one line of text through {@link fieldToText}, which appends that
 *   control's format cue to the label. `password`, `confirm`, `editor`, `select`, and `checkbox`
 *   each drive their own reducer. An open `select` is a suggestion list plus a typed line, because
 *   `open` means the answer need not come from the list.
 * - **The binding projects through `matchesAnswer`.** Every answer is filled as
 *   `fill(name, matchesAnswer(value) ? value : undefined)` after `parseValue` has coerced it to the
 *   control's own shape, so a bare return on a field with no default binds as ABSENCE and the
 *   form's `required` rule refuses it. A typed answer the control cannot hold binds as absence and
 *   invalidates the field, so the walk asks again with the reason on screen.
 * - **Visibility is honored.** A `hidden` field and a field currently in `form.disabled` are
 *   skipped; a `locked` field renders read-only; entering a new group writes its label as a section
 *   header.
 * - **Refusal re-asks.** After the walk the form is submitted. A refusal re-walks only the erroring
 *   fields the walk can edit and submits again. When every erroring field is one the walk cannot
 *   edit — hidden, locked, or disabled — the form is abandoned instead, because asking again could
 *   not change the answer.
 * - **Raw-mode leak-free.** Raw mode is entered once per field and always cleaned up: on submit, on
 *   cancel, on a throw, and when the form is abandoned under an active read.
 * - **Non-TTY fallback.** When `input` is not a TTY, the same walk runs over `node:readline` line
 *   input: `select` and `checkbox` print a numbered list, and `editor` reads to end of input.
 */
export class Terminal implements TerminalInterface {
	readonly #input: InputStreamInterface
	readonly #output: OutputStreamInterface
	readonly #styler: StylerInterface
	readonly #theme: PromptTheme
	readonly #handlers = new Map<object, (chunk: string | Uint8Array) => void>()
	readonly #queue: string[] = []
	#interface: Interface | undefined
	#taker: ((line: string | undefined) => void) | undefined
	#ended = false

	constructor(options?: TerminalOptions) {
		// Resolve each stream through its guard: a present, well-shaped injected stream is used as is;
		// otherwise the real process stream — no assertion, and an absent option falls through.
		this.#input = isInputStream(options?.input) ? options.input : stdin
		this.#output = isOutputStream(options?.output) ? options.output : stdout
		this.#styler = createStyler()
		this.#theme = createPromptTheme(options?.theme)
	}

	// === The contract

	async ask(form: FormInterface): Promise<FormValues> {
		try {
			this.#report(form, form.errors)
			await this.#walk(form, form.schema.fields)
			for (;;) {
				if (form.status !== 'editing') return await form.answer
				const result = form.submit()
				if (result.success) return await form.answer
				this.#report(form, result.error)
				const again = this.#collectEditable(form, result.error)
				// Nothing the walk can edit, or an input stream that has already ended: asking again would
				// render the same fields and read the same answers forever, so abandon the form instead.
				// The failures are on screen either way, so the reader sees what could not be answered.
				if (again.length === 0 || this.#ended) {
					form.destroy()
					return await form.answer
				}
				await this.#walk(form, again)
			}
		} finally {
			this.#close()
		}
	}

	// === The walk

	/**
	 * Ask `fields` in the order given, skipping what the walk must not touch and rendering what it
	 * must not edit. Returns early the moment the form stops being editable, so an abandoned form
	 * ends the walk between fields as well as under an active read.
	 */
	async #walk(form: FormInterface, fields: readonly FormField[]): Promise<void> {
		let group: string | undefined
		for (const field of fields) {
			if (form.status !== 'editing') return
			if (field.hidden === true) continue
			if (form.disabled.has(field.name)) continue
			if (field.group !== group) {
				group = field.group
				if (group !== undefined) this.#writeGroup(form, group)
			}
			if (field.locked === true) {
				this.#writeLocked(form, field)
				continue
			}
			const raw = await this.#read(form, field)
			if (form.status !== 'editing') return
			this.#bind(form, field, raw)
		}
	}

	/** Write a group's label as a section header, resolving the schema's declared label and falling back to the group's own name. */
	#writeGroup(form: FormInterface, name: string): void {
		const label = form.schema.groups?.find((group) => group.name === name)?.label ?? name
		this.#output.write(
			`${LINE_FEED}${renderGroupHeader(this.#styler, this.#theme, sanitizeDisplayText(label))}${LINE_FEED}`,
		)
	}

	/** Render a locked field read-only — its label, its mark, and the answer the form already holds. */
	#writeLocked(form: FormInterface, field: FormField): void {
		const line = renderLockedLine(
			this.#styler,
			this.#theme,
			sanitizeDisplayText(field.label ?? field.name),
			sanitizeDisplayText(valueToText(form.values[field.name])),
		)
		this.#output.write(`${line}${LINE_FEED}`)
	}

	/** Read one field through the reducer its control names, resolving the raw answer the binding projects. */
	#read(form: FormInterface, field: FormField): Promise<FieldValue | undefined> {
		if (field.control === 'password') return this.#askPassword(form, field)
		if (field.control === 'confirm') return this.#confirm(form, field)
		if (field.control === 'editor') return this.#askEditor(form, field)
		if (field.control === 'select') return this.#select(form, field)
		if (field.control === 'checkbox') return this.#checkbox(form, field)
		if (field.control === 'file') return this.#file(form, field)
		return this.#askText(form, field)
	}

	/**
	 * Bind one raw answer to the form — the single binding, and the only place this driver writes a
	 * value. `parseValue` coerces the raw answer to the control's own shape and `matchesAnswer`
	 * projects a blank one to absence, which is what keeps `required` refusing a bare return. A raw
	 * answer the control cannot hold binds as absence and invalidates the field, so the field comes
	 * back on the next pass carrying the reason rather than vanishing silently.
	 */
	#bind(form: FormInterface, field: FormField, raw: FieldValue | undefined): void {
		form.touch(field.name)
		const value = raw === undefined ? undefined : parseValue(field, raw)
		form.fill(field.name, matchesAnswer(value) ? value : undefined)
		if (value === undefined && matchesAnswer(raw)) form.invalidate(field.name, REFUSAL_MESSAGE)
	}

	/** The erroring fields the walk can ask again — every field the walk skips or renders read-only is excluded, because a second pass could not change its answer. */
	#collectEditable(form: FormInterface, errors: readonly FieldError[]): readonly FormField[] {
		const fields: FormField[] = []
		for (const error of errors) {
			const field = form.field(error.field)
			if (field === undefined) continue
			if (field.hidden === true || field.locked === true) continue
			if (form.disabled.has(field.name)) continue
			if (fields.some((held) => held.name === field.name)) continue
			fields.push(field)
		}
		return fields
	}

	/** Write every supplied failure against its field's label. */
	#report(form: FormInterface, errors: readonly FieldError[]): void {
		for (const error of errors) {
			const label = sanitizeDisplayText(form.field(error.field)?.label ?? error.field)
			const message = sanitizeDisplayText(error.message)
			const line = renderErrorLine(this.#styler, this.#theme, `${label}: ${message}`)
			this.#output.write(`${line}${LINE_FEED}`)
		}
	}

	// === The controls

	/** Read a field as one line of text — `text` itself and the six controls a terminal has no widget for. */
	#askText(form: FormInterface, field: FormField): Promise<string> {
		const state = createInputState(fieldToText(field), this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, inputReduce)
		return this.#line(form, state.message, state.default)
	}

	/** Read a secret — masked live in raw mode, and read without echo through readline on a stream that cannot enter it. */
	#askPassword(form: FormInterface, field: PasswordField): Promise<string> {
		const state = createPasswordState(field, this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, passwordReduce)
		return this.#prompt(form, renderPromptHeader(this.#styler, this.#theme, state.message))
	}

	/**
	 * Read a yes or no. The fallback accepts `y` / `yes` / `n` / `no` in any case and takes the
	 * field's default for a bare line; anything else is returned as typed, so the binding refuses it
	 * and the walk asks again rather than silently reading it as no.
	 */
	async #confirm(form: FormInterface, field: ConfirmField): Promise<FieldValue> {
		const state = createConfirmState(field, this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, confirmReduce)
		const header = renderHintedHeader(
			this.#styler,
			this.#theme,
			state.message,
			FALLBACK_CONFIRM_HINT,
		)
		const line = await this.#prompt(form, header)
		const answer = line.trim().toLowerCase()
		if (answer.length === 0) return state.default
		if (answer === 'y' || answer === 'yes') return true
		if (answer === 'n' || answer === 'no') return false
		return line.trim()
	}

	/** Read text over many lines — ctrl-d finishes in raw mode, and end of input finishes on a piped stream. */
	#askEditor(form: FormInterface, field: EditorField): Promise<string> {
		const state = createEditorState(field, this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, editorReduce)
		return this.#block(form, state.message, state.default)
	}

	/**
	 * Read one choice. A disabled choice is named above the list and never offered, because the form
	 * refuses its value at every door. An open select is a suggestion list plus a typed line, since
	 * `open` admits an answer the list does not offer; a closed select with nothing left to offer
	 * resolves absence and lets the form's own rules report it.
	 */
	async #select(form: FormInterface, field: SelectField): Promise<FieldValue | undefined> {
		const choices = filterEnabled(field.choices)
		this.#writeUnavailable(field.choices)
		if (field.open === true) {
			if (choices.length > 0) {
				const display = choices.map((choice) => ({
					...choice,
					value: sanitizeDisplayText(choice.value),
				}))
				this.#output.write(
					`${renderSuggestionLine(this.#styler, this.#theme, display)}${LINE_FEED}`,
				)
			}
			return this.#askText(form, field)
		}
		if (choices.length === 0) return undefined
		const state = createSelectState({ ...field, choices }, this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, selectReduce)
		this.#writeList(state.message, choices)
		const line = await this.#prompt(form, this.#formatHint(`${FALLBACK_SELECT_HINT}:`))
		return choices[Number.parseInt(line.trim(), 10) - 1]?.value
	}

	/**
	 * Read any number of choices. Disabled choices are named above the list and never offered, so a
	 * box the form would refuse can never be ticked. An empty answer is an answered "none of them",
	 * which is what `matchesAnswer` says an empty list means.
	 */
	async #checkbox(form: FormInterface, field: CheckboxField): Promise<FieldValue> {
		const choices = filterEnabled(field.choices)
		this.#writeUnavailable(field.choices)
		const state = createCheckboxState({ ...field, choices }, this.#styler, this.#theme)
		if (supportsRawMode(this.#input)) return this.#drive(form, state, checkboxReduce)
		this.#writeList(state.message, choices)
		const line = await this.#prompt(form, this.#formatHint(`${FALLBACK_CHECKBOX_HINT}:`))
		return line
			.split(',')
			.map((part) => choices[Number.parseInt(part.trim(), 10) - 1]?.value)
			.filter((value): value is string => value !== undefined)
	}

	/**
	 * Read file paths — names only, because bytes never enter a form. A `multiple` field collects one
	 * path per line until a blank one, and a single field takes one. No path at all is absence rather
	 * than an empty list, because the reader answered a blank line.
	 */
	async #file(form: FormInterface, field: FileField): Promise<FieldValue | undefined> {
		if (field.multiple === true) this.#output.write(`${this.#formatHint(FILE_HINT)}${LINE_FEED}`)
		const paths: string[] = []
		for (;;) {
			const entry = await this.#askText(form, field)
			if (entry.length === 0) break
			paths.push(entry)
			if (field.multiple !== true || this.#ended) break
		}
		return paths.length > 0 ? paths : undefined
	}

	/** Name the choices a field shows but refuses, above the list the walk drives. */
	#writeUnavailable(choices: readonly FieldChoice[]): void {
		const refused = filterDisabled(choices)
		if (refused.length === 0) return
		this.#output.write(`${renderUnavailableLine(this.#styler, this.#theme, refused)}${LINE_FEED}`)
	}

	/** Write a field's header above its numbered choice list — the non-TTY presentation of a choice field. */
	#writeList(message: string, choices: readonly FieldChoice[]): void {
		const header = renderPromptHeader(this.#styler, this.#theme, message)
		const list = renderNumberedList(this.#styler, this.#theme, choices)
		this.#output.write(`${header}${LINE_FEED}${list}${LINE_FEED}`)
	}

	/** Paint one line of supplementary instruction through the `hint` role. */
	#formatHint(text: string): string {
		return this.#styler.render(this.#theme.roles.hint, text)
	}

	// === The raw-mode kernel

	/**
	 * The irreducible Node raw-mode primitive — the ONLY place raw mode is touched. Switches the input
	 * into raw mode (each keypress delivered immediately, no echo), resumes its flow, and subscribes
	 * `handler` to `'data'`. The paired {@link #leaveRaw} operation unsubscribes the exact handler,
	 * leaves raw mode, and pauses the stream on submit, cancel, abandon, or throw.
	 */
	#enterRaw(token: object, handler: (chunk: string | Uint8Array) => void): void {
		this.#handlers.set(token, handler)
		this.#input.setRawMode?.(true)
		this.#input.resume?.()
		this.#input.on('data', handler)
	}

	#leaveRaw(token: object): void {
		const handler = this.#handlers.get(token)
		if (handler === undefined) return
		this.#handlers.delete(token)
		this.#input.off('data', handler)
		this.#input.setRawMode?.(false)
		this.#input.pause?.()
	}

	/**
	 * Drive ONE field over raw-mode stdin — the generic engine every interactive control shares.
	 * Renders the reducer's initial view, enters raw mode once, and on each keypress runs `parseKey` →
	 * `reduce` → an in-place re-render; on `submit` it cleans up and resolves the reducer's value, on
	 * `cancel` (ctrl-c) it cleans up and rejects a {@link TerminalError} coded `CANCEL`. Abandoning
	 * the form ends the read too, through the rejection of its own `answer`. Raw mode is entered
	 * exactly once and cleaned up on every exit path, so no raw mode and no `'data'` listener ever
	 * leaks. The cursor is hidden for the duration and restored on exit.
	 */
	#drive<T, S>(
		form: FormInterface,
		initial: S,
		reduce: (state: S, key: KeyEvent) => PromptStep<T, S>,
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			// Render the first view, tracking how many lines it spans so the next redraw climbs over them.
			this.#output.write(CURSOR_HIDE)
			let firstView: string
			try {
				firstView = reduce(initial, parseKey('')).view
				this.#output.write(firstView)
			} catch (error) {
				// Raw mode was never entered yet, but the cursor was hidden — restore it before rejecting.
				this.#output.write(`${CURSOR_SHOW}${LINE_FEED}`)
				reject(error)
				return
			}
			const token = {}
			const handler = this.#createHandler(
				token,
				initial,
				lineCount(firstView),
				reduce,
				resolve,
				reject,
			)
			this.#enterRaw(token, handler)
			// An abandoned form ends the read: its own `answer` rejects, so release the terminal and fail
			// this field with the form's error. A read that already finished holds no token and is a no-op.
			void form.answer.catch((error: unknown) => this.#interrupt(token, reject, error))
		})
	}

	#createHandler<T, S>(
		token: object,
		initial: S,
		initialLines: number,
		reduce: (state: S, key: KeyEvent) => PromptStep<T, S>,
		resolve: (value: T | PromiseLike<T>) => void,
		reject: (reason?: unknown) => void,
	): (chunk: string | Uint8Array) => void {
		let state = initial
		let lines = initialLines
		return (chunk) => {
			try {
				const step = reduce(state, parseKey(chunk))
				state = step.state
				if (step.status === 'active') {
					this.#render(step.view, lines)
					lines = lineCount(step.view)
					return
				}
				// Terminal step (submit / cancel): paint the final committed view, then tear down.
				this.#render(step.view, lines)
				this.#leaveRaw(token)
				this.#output.write(`${CURSOR_SHOW}${LINE_FEED}`)
				if (step.status === 'cancel') reject(new TerminalError('CANCEL', 'Prompt cancelled'))
				else if (step.status === 'submit' && step.value !== undefined) resolve(step.value)
				else reject(new TerminalError('DRIVER', 'submit produced no value'))
			} catch (error) {
				// A throw inside the reducer/styler: tear down raw mode + the listener, restore the cursor
				// exactly as the normal exit path does, then reject.
				this.#leaveRaw(token)
				this.#output.write(`${CURSOR_SHOW}${LINE_FEED}`)
				reject(error)
			}
		}
	}

	/** End an active read that the form outlived — release raw mode exactly as a submit does, then fail the read with the form's own error. */
	#interrupt(token: object, reject: (reason?: unknown) => void, error: unknown): void {
		if (!this.#handlers.has(token)) return
		this.#leaveRaw(token)
		this.#output.write(`${CURSOR_SHOW}${LINE_FEED}`)
		reject(error)
	}

	/** Redraw a field view in place — climb over the previous view's `previousLines`, clear, and write the new view (the pure cursor-math is {@link redrawPrefix}). */
	#render(view: string, previousLines: number): void {
		this.#output.write(`${redrawPrefix(previousLines)}${view}`)
	}

	// === Non-TTY fallbacks (node:readline line input)

	/** Read one line for a text-shaped field, taking the field's default when the line is bare. */
	async #line(form: FormInterface, message: string, seed: string): Promise<string> {
		const answer = await this.#prompt(form, renderPromptHeader(this.#styler, this.#theme, message))
		return answer.length > 0 ? answer : seed
	}

	/**
	 * Read a whole block for an `editor` field — a piped stream has no ctrl-d keypress, so end of
	 * input is the terminator. It drains every remaining line, which is why nothing after an `editor`
	 * field can be asked on the same stream.
	 */
	async #block(form: FormInterface, message: string, seed: string): Promise<string> {
		const header = renderHintedHeader(this.#styler, this.#theme, message, FALLBACK_EDITOR_HINT)
		this.#output.write(`${header}${LINE_FEED}`)
		const collected: string[] = []
		for (;;) {
			const line = await this.#next(form)
			if (line === undefined) break
			collected.push(line)
		}
		const text = collected.join('\n')
		return text.length > 0 ? text : seed
	}

	/** Write one field's header and read back the line the reader answers it with, or `''` once the stream has ended. */
	async #prompt(form: FormInterface, header: string): Promise<string> {
		this.#output.write(`${header} `)
		const line = await this.#next(form)
		return line ?? ''
	}

	/**
	 * Take the next line the input carries — from the buffer when the reader has already read ahead,
	 * and otherwise by waiting for one. It resolves ABSENCE once the stream has ended, so a walk over
	 * an exhausted stream settles instead of waiting forever, and it rejects when the form is
	 * abandoned, so an unanswerable read ends with the form rather than outliving it.
	 */
	#next(form: FormInterface): Promise<string | undefined> {
		const buffered = this.#queue.shift()
		if (buffered !== undefined) return Promise.resolve(buffered)
		if (this.#ended) return Promise.resolve(undefined)
		this.#startReader()
		return new Promise<string | undefined>((resolve, reject) => {
			this.#taker = resolve
			void form.answer.catch((error: unknown) => {
				if (this.#taker !== resolve) return
				this.#taker = undefined
				reject(error)
			})
		})
	}

	/**
	 * Open the walk's ONE readline interface, or keep the open one. A whole form is many questions
	 * over one stream, and an interface reads ahead: a fresh interface per question would swallow
	 * every line it read past the one it was asked for, so the walk holds a single reader and buffers
	 * what arrives early. It is closed when the walk ends, so the process is free to exit.
	 */
	#startReader(): void {
		if (this.#interface !== undefined) return
		const rl = createInterface(this.#openReadline())
		rl.on('line', (line) => this.#accept(line))
		rl.on('close', () => this.#finish())
		this.#interface = rl
	}

	/** Hand a line to whoever is waiting for it, or buffer it for the next question. */
	#accept(line: string): void {
		const taker = this.#taker
		if (taker === undefined) {
			this.#queue.push(line)
			return
		}
		this.#taker = undefined
		taker(line)
	}

	/** Record that no further line can arrive and release whoever was waiting for one. */
	#finish(): void {
		this.#ended = true
		const taker = this.#taker
		if (taker === undefined) return
		this.#taker = undefined
		taker(undefined)
	}

	/** Close the walk's reader and release a waiting question — the walk is over, so the stream must stop holding the process open. */
	#close(): void {
		const taker = this.#taker
		this.#taker = undefined
		if (taker !== undefined) taker(undefined)
		const rl = this.#interface
		if (rl === undefined) return
		this.#interface = undefined
		// Drop the close listener first: this close is the walk ending, not the stream ending, and
		// recording it as end of input would refuse the next walk its input.
		rl.removeAllListeners('close')
		rl.close()
	}

	/**
	 * Narrow the resolved input to the `node:readline` `createInterface` boundary, never an assertion.
	 * The fallback only runs on a real piped `process.stdin` (or a `PassThrough` a test injects), both
	 * genuine readables; a minimal non-readable fake reaching here means the walk was driven with a
	 * stream it cannot use, which fails loudly rather than silently. `terminal: false` leaves readline
	 * as a line decoder and nothing else: the walk writes every prompt itself, through the same output
	 * every other line goes to, so nothing is written twice and a secret is never echoed.
	 */
	#openReadline(): { input: NodeJS.ReadableStream; terminal: boolean } {
		// Bind to a local first — a guard narrows a local, not a `#private` field access.
		const input = this.#input
		if (!isReadable(input))
			throw new TerminalError('DRIVER', 'Terminal fallback requires a readable input stream')
		return { input, terminal: false }
	}
}
