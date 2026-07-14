import type {
	CheckboxOptions,
	ConfirmOptions,
	EditorOptions,
	InputOptions,
	KeyEvent,
	PasswordOptions,
	PromptStep,
	SelectOptions,
	StylerInterface,
} from '@src/core'
import type {
	InputStreamInterface,
	OutputStreamInterface,
	TerminalInterface,
	TerminalOptions,
} from './types.js'
import {
	createCheckboxState,
	createConfirmState,
	createEditorState,
	createInputState,
	createPasswordState,
	createSelectState,
	createStyler,
	checkboxReduce,
	confirmReduce,
	editorReduce,
	inputReduce,
	parseKey,
	passwordReduce,
	resolveValidation,
	selectReduce,
	TerminalError,
} from '@src/core'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import {
	CURSOR_HIDE,
	CURSOR_SHOW,
	FALLBACK_CHECKBOX_HINT,
	FALLBACK_SELECT_HINT,
	LINE_FEED,
} from './constants.js'
import {
	isInputStream,
	isOutputStream,
	isRawCapable,
	isReadable,
	isWritable,
	lineCount,
	redrawPrefix,
} from './helpers.js'

/**
 * The interactive terminal prompt driver (T-c) — the third {@link TerminalInterface} surface (beside
 * the core headless `Prompt` broker and the SSE `PromptClient` bridge), and the ONLY impure part of
 * the prompt stack. It reads the TTY and DRIVES the pure core `*Reduce` reducers: it feeds raw-mode
 * stdin bytes through `parseKey` into the matching reducer, renders the returned `view` in place, and
 * resolves on a `submit` step / rejects with a {@link TerminalError} (`CANCEL`) on ctrl-c. It owns no
 * prompt logic of its own — state, view, validation, and the cancel signal all come from the pure
 * core; this class owns ONLY the cursor + raw-mode + in-place re-render mechanics.
 *
 * @remarks
 * See {@link TerminalInterface} for the behavioral contract (raw-mode leak-freedom, the in-place
 * re-render, the non-TTY readline fallback, event-free).
 */
export class Terminal implements TerminalInterface {
	readonly #input: InputStreamInterface
	readonly #output: OutputStreamInterface

	constructor(options?: TerminalOptions) {
		// Resolve each stream through its guard (§14): a present, well-shaped injected stream is used as
		// is; otherwise the real process stream — no `as`, and an `undefined` option falls through.
		this.#input = isInputStream(options?.input) ? options.input : stdin
		this.#output = isOutputStream(options?.output) ? options.output : stdout
	}

	// === Prompt forms (PromptFormInterface)

	input(options: InputOptions): Promise<string> {
		const state = createInputState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, inputReduce)
		return this.#lineFallback(
			options.message,
			options.styler,
			(answer) => {
				const value = answer.length > 0 ? answer : (options.default ?? '')
				return resolveValidation(options.validate)(value) === true ? { value } : undefined
			},
			// EOF: settle the entered line or the default — a piped stream can't be re-prompted.
			(answer) => (answer.length > 0 ? answer : (options.default ?? '')),
		)
	}

	password(options: PasswordOptions): Promise<string> {
		const state = createPasswordState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, passwordReduce)
		return this.#lineFallback(
			options.message,
			options.styler,
			(answer) =>
				resolveValidation(options.validate)(answer) === true ? { value: answer } : undefined,
			// EOF: settle the entered secret (or '') — a piped stream can't be re-prompted.
			(answer) => answer,
		)
	}

	confirm(options: ConfirmOptions): Promise<boolean> {
		const state = createConfirmState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, confirmReduce)
		return this.#lineFallback(
			options.message,
			options.styler,
			(answer) => {
				const normalized = answer.trim().toLowerCase()
				if (normalized.length === 0) return { value: options.default ?? false }
				if (normalized === 'y' || normalized === 'yes') return { value: true }
				if (normalized === 'n' || normalized === 'no') return { value: false }
				return undefined
			},
			// EOF: settle the default — a piped stream can't be re-prompted for a y/n.
			() => options.default ?? false,
		)
	}

	select(options: SelectOptions): Promise<string> {
		const state = createSelectState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, selectReduce)
		return this.#listFallback(
			options.message,
			options.styler,
			state.choices,
			FALLBACK_SELECT_HINT,
			(line) => {
				const index = Number.parseInt(line.trim(), 10) - 1
				const choice = state.choices[index]
				return choice === undefined ? undefined : { value: choice.value }
			},
			// EOF: no choice was picked — settle the empty string (a piped stream can't be re-prompted).
			'',
		)
	}

	checkbox(options: CheckboxOptions): Promise<readonly string[]> {
		const state = createCheckboxState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, checkboxReduce)
		return this.#listFallback(
			options.message,
			options.styler,
			state.choices,
			FALLBACK_CHECKBOX_HINT,
			(line) => {
				const indices = line
					.split(',')
					.map((part) => Number.parseInt(part.trim(), 10) - 1)
					.filter((index) => index >= 0 && index < state.choices.length)
				if (options.min !== undefined && indices.length < options.min) return undefined
				if (options.max !== undefined && indices.length > options.max) return undefined
				const values = indices
					.map((index) => state.choices[index]?.value)
					.filter((value): value is string => value !== undefined)
				return { value: values }
			},
			// EOF: nothing selected — settle the empty list (a piped stream can't be re-prompted).
			[],
		)
	}

	editor(options: EditorOptions): Promise<string> {
		const state = createEditorState(options)
		if (isRawCapable(this.#input)) return this.#drive(state, editorReduce)
		return this.#editorFallback(options)
	}

	// === The raw-mode kernel

	/**
	 * The irreducible Node raw-mode primitive — the ONLY place raw mode is touched. Switches the input
	 * into raw mode (each keypress delivered immediately, no echo), resumes its flow, and subscribes
	 * `handler` to `'data'`; returns a cleanup closure that unsubscribes, leaves raw mode, and pauses
	 * the stream. The closure is ALWAYS invoked (submit / cancel / throw), so raw mode and the listener
	 * never leak.
	 */
	#enterRaw(handler: (chunk: string | Uint8Array) => void): () => void {
		this.#input.setRawMode?.(true)
		this.#input.resume?.()
		this.#input.on('data', handler)
		return () => {
			this.#input.off('data', handler)
			this.#input.setRawMode?.(false)
			this.#input.pause?.()
		}
	}

	/**
	 * Drive ONE interactive prompt over raw-mode stdin — the generic engine all six TTY prompts share.
	 * Renders the reducer's initial `view`, enters raw mode once, and on each keypress runs `parseKey`
	 * → `reduce` → an in-place re-render; on `submit` it cleans up + resolves the reducer's `value`, on
	 * `cancel` (ctrl-c) it cleans up + rejects a {@link TerminalError} (`CANCEL`). Raw mode is entered
	 * exactly once and cleaned up on every exit path (submit / cancel / a throw inside a step), so no
	 * raw mode and no `'data'` listener ever leak. The cursor is hidden for the duration and restored
	 * on exit.
	 */
	#drive<T, S>(initial: S, reduce: (state: S, key: KeyEvent) => PromptStep<T, S>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let state = initial
			// Render the first view, tracking how many lines it spans so the next redraw climbs over them.
			this.#output.write(CURSOR_HIDE)
			const firstView = reduce(state, parseKey('')).view
			this.#output.write(firstView)
			let lines = lineCount(firstView)

			const handler = (chunk: string | Uint8Array): void => {
				const step = reduce(state, parseKey(chunk))
				state = step.state
				if (step.status === 'active') {
					this.#render(step.view, lines)
					lines = lineCount(step.view)
					return
				}
				// Terminal step (submit / cancel): paint the final committed view, then tear down.
				this.#render(step.view, lines)
				cleanup()
				this.#output.write(`${CURSOR_SHOW}${LINE_FEED}`)
				if (step.status === 'submit' && step.value !== undefined) resolve(step.value)
				else reject(new TerminalError('CANCEL', 'Prompt cancelled'))
			}

			const cleanup = this.#enterRaw(handler)
		})
	}

	/** Redraw a prompt view in place — climb over the previous view's `previousLines`, clear, and write the new view (the pure cursor-math is {@link redrawPrefix}). */
	#render(view: string, previousLines: number): void {
		this.#output.write(`${redrawPrefix(previousLines)}${view}`)
	}

	// === Non-TTY fallbacks (node:readline line input)

	/**
	 * Read a single line via `node:readline` and accept it through `take` — the non-TTY line-input
	 * fallback shared by `input` / `password` / `confirm`. Re-prompts until `take` returns a value (so
	 * validation still gates), writing the prompt header each round. A piped stream cannot enter raw
	 * mode, so there is no masking / live edit — just a validated line read.
	 *
	 * @remarks
	 * The re-prompt loop is bounded by end-of-input: once the stream reaches EOF (a piped stream that
	 * ran out, or one with no trailing newline) it can never deliver another line, so re-prompting
	 * would SPIN. On EOF the loop accepts the final line through `take` if it passes, else returns the
	 * caller's `eof` fallback (the default / empty value) — the prompt always settles, never spins.
	 */
	async #lineFallback<T>(
		message: string,
		styler: StylerInterface | undefined,
		take: (answer: string) => { readonly value: T } | undefined,
		eof: (answer: string) => T,
	): Promise<T> {
		const paint = styler ?? createStyler()
		for (;;) {
			const { answer, ended } = await this.#question(`${paint.cyan('?')} ${paint.bold(message)} `)
			const accepted = take(answer)
			if (accepted !== undefined) return accepted.value
			if (ended) return eof(answer)
		}
	}

	/**
	 * Print a numbered choice list, then read one readline line and accept it through `take` — the
	 * non-TTY fallback for `select` / `checkbox`. The list is rendered once; the user types the
	 * number(s); `take` parses + gates the line, re-prompting until it returns a value.
	 */
	async #listFallback<T>(
		message: string,
		styler: StylerInterface | undefined,
		choices: readonly { readonly name: string }[],
		hint: string,
		take: (line: string) => { readonly value: T } | undefined,
		eof: T,
	): Promise<T> {
		const paint = styler ?? createStyler()
		let list = `${paint.cyan('?')} ${paint.bold(message)}\n`
		choices.forEach((choice, index) => {
			list += `  ${paint.dim(`${String(index + 1)})`)} ${choice.name}\n`
		})
		this.#output.write(list)
		for (;;) {
			const { answer, ended } = await this.#question(`${paint.dim(`${hint}:`)} `)
			const accepted = take(answer)
			if (accepted !== undefined) return accepted.value
			// EOF on a piped stream — no further line can arrive, so settle the empty fallback rather
			// than spin re-prompting an exhausted stream (a select with no answer ⇒ '', checkbox ⇒ []).
			if (ended) return eof
		}
	}

	/**
	 * The non-TTY `editor` fallback — read lines until EOF (the readline `close`), join them, and fall
	 * back to the default when empty. A piped stream has no ctrl-d keypress, so end-of-input is the
	 * natural terminator.
	 *
	 * @remarks
	 * Single-pass by necessity: `#lines` drains the whole stream to EOF in one read, so there is no
	 * second block to re-prompt for (re-reading an exhausted stream returns nothing forever). Validation
	 * is still applied; on a validation FAILURE the best-effort block is returned rather than spinning
	 * on the consumed stream — the EOF analogue of the raw-mode editor's re-edit, which a piped stream
	 * cannot offer.
	 */
	async #editorFallback(options: EditorOptions): Promise<string> {
		const paint = options.styler ?? createStyler()
		this.#output.write(
			`${paint.cyan('?')} ${paint.bold(options.message)} ${paint.dim('(EOF to finish)')}\n`,
		)
		const text = await this.#lines()
		return text.length > 0 ? text : (options.default ?? '')
	}

	/**
	 * Ask one readline question on the resolved streams and resolve the typed (un-trimmed) line plus
	 * whether the stream ENDED. EOF (the readline `close`) before `rl.question`'s callback fires
	 * resolves instead of hanging — a piped stream commonly ends WITHOUT a trailing newline (or is
	 * empty), and the `question` callback only fires on a NEWLINE-terminated line, so without this the
	 * prompt would wait forever. The trailing unterminated line is still recovered: readline emits it
	 * as a `'line'` event just before `'close'`, so the last seen line (or `''` for a truly empty
	 * stream) is returned with `ended: true`. The `ended` flag lets the fallback loops settle rather
	 * than re-prompt an exhausted stream (which would SPIN). Settling is one-shot (a `close` after a
	 * delivered line is ignored, so a normal newline-terminated line reports `ended: false`).
	 */
	#question(prompt: string): Promise<{ readonly answer: string; readonly ended: boolean }> {
		const rl = createInterface(this.#readline())
		return new Promise<{ readonly answer: string; readonly ended: boolean }>((resolve) => {
			let settled = false
			let last = ''
			const settle = (answer: string, ended: boolean): void => {
				if (settled) return
				settled = true
				rl.close()
				resolve({ answer, ended })
			}
			// Track the most recent line so an EOF-on-`close` can recover an unterminated final line.
			rl.on('line', (line) => {
				last = line
			})
			rl.question(prompt, (answer) => settle(answer, false))
			// EOF before a completed question: settle the recovered partial line (or '') as ended.
			rl.on('close', () => settle(last, true))
		})
	}

	/** Read every line from the input until EOF and resolve them joined by newlines (the editor fallback's reader). */
	#lines(): Promise<string> {
		const rl = createInterface(this.#readline())
		const collected: string[] = []
		return new Promise<string>((resolve) => {
			rl.on('line', (line) => collected.push(line))
			rl.on('close', () => resolve(collected.join('\n')))
		})
	}

	/**
	 * Narrow the resolved streams to the `node:readline` `createInterface` boundary (§14, never an
	 * `as`). The non-TTY fallback only runs on a real piped `process.stdin` (or a `PassThrough` a test
	 * injects), both genuine readables; a minimal non-readable fake reaching here means the fallback
	 * was driven with a stream it cannot use, which fails loudly rather than silently.
	 */
	#readline(): { input: NodeJS.ReadableStream; output?: NodeJS.WritableStream } {
		// Bind to locals first — a guard narrows a local, not a `#private` field access.
		const input = this.#input
		const output = this.#output
		if (!isReadable(input)) throw new Error('Terminal fallback requires a readable input stream')
		return { input, output: isWritable(output) ? output : undefined }
	}
}
