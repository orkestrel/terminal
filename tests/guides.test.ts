// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow are this
// package's own, as is the executed section that closes the file.

import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The package identity that binds its manifest, module map, and README pitch. */
const PACKAGE_NAME = '@orkestrel/terminal'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/terminal.md'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({
	[PACKAGE_NAME]: 'src/core',
	'@src/core': 'src/core',
	'@src/server': 'src/server',
})
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([])

/** The NUL byte a hostile wire string smuggles into an identity slot, built without a raw control character. */
const NUL = String.fromCharCode(0)
/** The BEL byte a hostile wire theme smuggles into a glyph, built without a raw control character. */
const BEL = String.fromCharCode(7)

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md', 'package.json'],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { isRecord, parseJSON } = await import('@orkestrel/contract')
	const { CSI, createStyler, ESC, strip } = await import('@orkestrel/console')
	const { createForm } = await import('@orkestrel/form')
	const {
		computeSymbolKey,
		createSourceManager,
		extractFenceImports,
		findMissing,
		findMissingSymbols,
		isExternalLink,
		resolveLink,
	} = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const {
		createCheckboxState,
		createConfirmState,
		createDatabaseTerminalStore,
		createEditorState,
		createInputState,
		createMemoryTerminalStore,
		createPasswordState,
		createPrompt,
		createPromptTheme,
		createSelectState,
		createTerminalManager,
		DEFAULT_PROMPT_THEME,
		editLine,
		isAbortError,
		isInsecureRemote,
		isPendingForm,
		isPendingFormStatus,
		isPrintable,
		isTerminalError,
		isTerminalSnapshot,
		isWireEvent,
		parseKey,
		reduceCheckbox,
		reduceConfirm,
		reduceEditor,
		reduceInput,
		reducePassword,
		reduceSelect,
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
		RETURN,
		sanitizeDisplayText,
		sanitizeSchema,
		sanitizeThemeIcons,
		serializeDestroy,
		serializeExpire,
		serializePending,
		toggleIndex,
	} = await import('@src/core')
	const {
		CLEAR_DOWN,
		fieldToText,
		filterDisabled,
		filterEnabled,
		isInputStream,
		isReadable,
		lineCount,
		redrawPrefix,
		renderCursorUp,
		renderGroupHeader,
		renderLockedLine,
		renderNumberedList,
		renderSuggestionLine,
		renderUnavailableLine,
		supportsRawMode,
		valueToText,
	} = await import('@src/server')
	const { stdin } = await import('node:process')
	const { describe, expect, it } = await import('vitest')
	const sources = createSourceManager({ files, modules: MODULES })
	const own = requireValue(
		rows.find((row) => row.entry.spec === GUIDE_SPEC),
		`Missing manifest row: ${GUIDE_SPEC}`,
	)
	const manifest = parseJSON(requireValue(files['package.json'], 'Missing inventory: package.json'))
	if (!isRecord(manifest)) throw new Error('Invalid package manifest: package.json')

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(own.entry.spec).toBe(GUIDE_SPEC)
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. The native report owns their comparison. The manifest assertion
	// binds that report to this package rather than allowing an unrelated package identity.
	it('opens the README with the guide tagline', () => {
		expect(manifest.name).toBe(PACKAGE_NAME)
		expect(report.pitch).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})
			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})
			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})
			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})
			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. The native report owns the
			// comparison and names both sides; converge the two sides through the native entry,
			// never by weakening this assertion. A titled example is compared only where that
			// title is present on both sides, so an untitled `@example` block is outside this case.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				for (const fence of fences) {
					for (const { specifier, names } of extractFenceImports(fence.code)) {
						const imported = sources.source(specifier)
						if (imported === undefined) continue
						const surface = imported.surface().map((symbol) => symbol.name)
						expect(findMissing(names, surface)).toEqual([])
					}
				}
			})

			it('resolves every relative link', () => {
				const broken = guide
					.links()
					.filter((href) => !isExternalLink(href))
					.map((href) => resolveLink(entry.spec, href))
					.filter((path) => !source.exists(path))
				expect(broken).toEqual([])
			})
			it('links only to test files that exist', () => {
				const missing = guide
					.tests()
					.map((href) => resolveLink(entry.spec, href))
					.filter((path) => !source.exists(path))
				expect(missing).toEqual([])
			})
		})
	}

	// Name resolution is not a behavioural proof, so each case here drives part of one flagship fence of
	// `guides/terminal.md` through the real exports and asserts the value its comments claim. Change a
	// fence, change the transcription beside it. A fence line whose comment claims no value — a TTY
	// walk, an emission, a teardown, a resolved default — carries no case here.
	describe('guide fences', () => {
		it('parks and answers one form exactly as the broker fence claims', async () => {
			const prompt = createPrompt()
			const form = createForm({
				fields: [
					{
						control: 'text',
						name: 'name',
						rule: { required: true, custom: (value) => value !== 'root' || 'root is reserved' },
					},
				],
			})
			const id = prompt.park(form)

			// The whole outcome is compared, so the fence's `result.error.errors` claim — the
			// authoritative form's own FieldError list, from a rule that never crossed the wire — is
			// asserted rather than skipped.
			expect(prompt.answer(id, { name: 'root' })).toEqual({
				success: false,
				error: { reason: 'rejected', errors: [{ field: 'name', message: 'root is reserved' }] },
			})
			// The refused form stays parked, which is what the fence's retry loop rests on.
			expect(prompt.pending(id)?.id).toBe(id)

			expect(prompt.answer(id, { name: 'Ada' })).toEqual({ success: true, value: { name: 'Ada' } })
			expect(await form.answer).toEqual({ name: 'Ada' })
			expect(prompt.pending(id)).toBeUndefined()
			prompt.destroy()
		})

		it('lists every parked record the broker fence claims', () => {
			const prompt = createPrompt()
			const first = prompt.park(createForm({ fields: [{ control: 'text', name: 'name' }] }))
			const second = prompt.park(createForm({ fields: [{ control: 'text', name: 'role' }] }))
			expect(prompt.pending().map((record) => record.id)).toEqual([first, second])
			prompt.destroy()
		})

		it('flags the endpoints and abort errors the bridge fence claims', () => {
			expect(isInsecureRemote('http://host/forms')).toBe(true)
			expect(isInsecureRemote('http://localhost:3000/forms')).toBe(false)
			expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
		})

		it('builds the wire frames the HTTP-spine fence claims', () => {
			const prompt = createPrompt()
			const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
			const id = prompt.park(form)
			const parked = requireValue(prompt.pending(id), 'Missing parked record')

			expect(serializePending(parked)).toEqual({
				event: 'pending',
				data: JSON.stringify(parked),
				id: parked.id,
			})
			expect(serializeExpire(id)).toEqual({ event: 'expire', data: `{"id":"${id}"}` })
			expect(serializeDestroy()).toEqual({ event: 'destroy', data: '' })
			prompt.destroy()
		})

		it('narrows the wire values the relay fence claims', () => {
			const prompt = createPrompt()
			const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
			const id = prompt.park(form)
			const frame = serializePending(requireValue(prompt.pending(id), 'Missing parked record'))

			expect(isWireEvent(frame)).toBe(true)
			const payload: unknown = JSON.parse(frame.data)
			expect(isPendingForm(payload)).toBe(true)
			expect(isPendingFormStatus('pending')).toBe(true)
			expect(isPendingForm({ id: '7', schema: 'nope', status: 'pending', time: 0 })).toBe(false)
			expect(isTerminalSnapshot({ id: 'agent', timeout: 30_000 })).toBe(true)
			prompt.destroy()
		})

		it('sanitizes exactly what the untrusted-schema fence claims', () => {
			expect(sanitizeDisplayText('Q\rOVERWRITE\nNEXT\tX')).toBe('QOVERWRITENEXTX')

			const clean = sanitizeSchema({
				fields: [
					{
						control: 'select',
						name: `ro${NUL}le`,
						label: `${ESC}[31mRole`,
						default: `ad${NUL}min`,
						choices: [{ value: `ad${NUL}min`, label: `Ad${NUL}min` }],
						meta: { anything: true },
					},
				],
			})
			// The identity and the answer survive byte for byte; the label and the choice label are
			// cleaned; the metadata is dropped. The whole schema is compared, so no claim is skipped.
			expect(clean).toEqual({
				fields: [
					{
						control: 'select',
						name: `ro${NUL}le`,
						label: 'Role',
						default: `ad${NUL}min`,
						choices: [{ value: `ad${NUL}min`, label: 'Admin' }],
					},
				],
			})

			expect(sanitizeThemeIcons({ icons: { pointer: `=>${BEL}` } })).toEqual({
				icons: { pointer: '=>' },
			})
		})

		it('returns the reducer values the direct-drive fence claims', () => {
			let text = createInputState({ control: 'text', name: 'name', label: 'Name' })
			expect(strip(renderInputView(text))).toBe('? Name › ')
			text = reduceInput(text, parseKey('A')).state
			expect(reduceInput(text, parseKey(RETURN))).toMatchObject({ status: 'submit', value: 'A' })

			const confirm = createConfirmState({ control: 'confirm', name: 'ok', label: 'Continue?' })
			expect(strip(renderConfirmView(confirm))).toBe('? Continue? (y/N)')
			expect(reduceConfirm(confirm, parseKey('y'))).toMatchObject({ status: 'submit', value: true })

			expect(editLine('hi', parseKey('!'))).toBe('hi!')
			expect(editLine('hi', parseKey(`${CSI}A`))).toBeUndefined()
			expect(isPrintable('a')).toBe(true)
		})

		it('masks the typed value the direct-drive fence claims a password view hides', () => {
			let password = createPasswordState({ control: 'password', name: 'token', label: 'Token' })
			password = reducePassword(password, parseKey('s')).state
			const view = renderPasswordView(password)
			expect(strip(view)).toBe('? Token › *')
			// The typed character reaches the submitted value without ever reaching the view.
			expect(view).not.toContain('s')
			expect(reducePassword(password, parseKey(RETURN))).toMatchObject({
				status: 'submit',
				value: 's',
			})
		})

		it('moves and wraps the select focus the direct-drive fence claims', () => {
			let select = createSelectState({
				control: 'select',
				name: 'role',
				label: 'Role',
				default: 'admin',
				choices: [
					{ value: 'admin', label: 'Admin' },
					{ value: 'viewer', label: 'Viewer' },
				],
			})
			select = reduceSelect(select, parseKey(`${CSI}B`)).state
			expect(strip(renderSelectView(select))).toBe('? Role\n  ○ Admin\n› ● Viewer')
			// Down again from the last row returns to the first, which is the fence's wrapping claim.
			select = reduceSelect(select, parseKey(`${CSI}B`)).state
			expect(strip(renderSelectView(select))).toBe('? Role\n› ● Admin\n  ○ Viewer')
		})

		it('toggles the focused box the direct-drive fence claims', () => {
			let checkbox = createCheckboxState({
				control: 'checkbox',
				name: 'scopes',
				label: 'Scopes',
				default: ['read'],
				choices: [
					{ value: 'read', label: 'Read' },
					{ value: 'write', label: 'Write' },
				],
			})
			// The fence's `default: ['read']` ticks the first box, so the space that follows is
			// observably a toggle rather than a set.
			expect(strip(renderCheckboxView(checkbox))).toBe('? Scopes\n› ☑ Read\n  ☐ Write\n1 selected')
			const seeded = checkbox.checked
			checkbox = reduceCheckbox(checkbox, parseKey(' ')).state
			expect(strip(renderCheckboxView(checkbox))).toBe('? Scopes\n› ☐ Read\n  ☐ Write\n0 selected')
			expect(toggleIndex(checkbox.checked, 1)).toEqual([1])
			// Copy-on-write: the list the reducer read is the list it left behind.
			expect(seeded).toEqual([0])
		})

		it('commits and renders the editor lines the direct-drive fence claims', () => {
			let editor = createEditorState({ control: 'editor', name: 'notes', label: 'Notes' })
			editor = reduceEditor(editor, parseKey('h')).state
			expect(strip(renderEditorView(editor))).toBe('? Notes (Ctrl+D to finish)\n› h')
			// Return commits the line in progress, so the view then carries a committed line too.
			editor = reduceEditor(editor, parseKey(RETURN)).state
			editor = reduceEditor(editor, parseKey('i')).state
			expect(strip(renderEditorView(editor))).toBe('? Notes (Ctrl+D to finish)\nh\n› i')
		})

		it('renders the themed line shapes the re-theme fence claims', () => {
			const theme = createPromptTheme({
				icons: { pointer: '=>', selected: '*' },
				roles: {
					message: { foreground: 'magenta', attributes: ['bold'] },
					hint: { attributes: ['italic'] },
				},
			})
			expect(theme.icons.question).toBe('?')
			expect(DEFAULT_PROMPT_THEME.roles.content).toEqual({ attributes: [] })

			const styler = createStyler()
			expect(strip(renderPromptHeader(styler, theme, 'Role'))).toBe('? Role')
			expect(strip(renderHintedHeader(styler, theme, 'Role', 'arrows move'))).toBe(
				'? Role arrows move',
			)
			expect(strip(renderSubmitHeader(styler, theme, 'Role'))).toBe('✔ Role')
			expect(strip(renderErrorLine(styler, theme, 'Role: This field is required'))).toBe(
				'✖ Role: This field is required',
			)

			// The state factory's own partial theme reaches the view it builds: the supplied pointer
			// replaces its slot, and every slot the fence leaves unnamed keeps its default glyph.
			expect(
				strip(
					renderSelectView(
						createSelectState(
							{ control: 'select', name: 'role', choices: [{ value: 'admin', label: 'Admin' }] },
							styler,
							{ icons: { pointer: '=>' } },
						),
					),
				),
			).toBe('? role\n=> ● Admin')
		})

		it('round-trips the snapshot the store fence claims', async () => {
			const memory = createMemoryTerminalStore()
			await memory.set({ id: 'agent', timeout: 30_000 })
			expect(await memory.get('agent')).toEqual({ id: 'agent', timeout: 30_000 })
			await memory.delete('agent')
			expect(await memory.get('agent')).toBeUndefined()
			// An absent id is a no-op rather than a throw.
			await expect(memory.delete('absent')).resolves.toBeUndefined()
		})

		it('round-trips the snapshot through the default driver the database-store fence claims', async () => {
			const database = createDatabaseTerminalStore()
			await database.set({ id: 'agent', timeout: 30_000 })
			expect(await database.get('agent')).toEqual({ id: 'agent', timeout: 30_000 })

			// The fence hands that store to a manager, which reads the row back through `open`.
			const manager = createTerminalManager({ store: database })
			const restored = await manager.open('agent')
			expect(restored).toBeDefined()
			expect(restored?.pending()).toEqual([])
			manager.destroy()
		})

		it('routes, refuses, and answers exactly as the manager fence claims', async () => {
			const manager = createTerminalManager()
			const agent = manager.add('agent')
			const user = manager.add('user')
			// `add` is idempotent: a second call returns the mounted broker rather than clobbering it.
			expect(manager.add('agent')).toBe(agent)
			expect(manager.terminals()).toEqual([agent, user])
			expect(manager.terminal('agent')).toBe(agent)
			expect(manager.terminal('nobody')).toBeUndefined()

			const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
			const answers = manager.ask('user', 'agent', form)
			const parked = requireValue(manager.pending('agent')[0], 'Missing parked record')
			expect(parked).toMatchObject({ from: 'user', to: 'agent' })

			// While that edge is live the reverse ask would close a cycle, so it refuses without parking.
			const deadlock: unknown = await manager
				.ask('agent', 'user', createForm({ fields: [{ control: 'text', name: 'x' }] }))
				.catch((error: unknown) => error)
			expect(isTerminalError(deadlock)).toBe(true)
			expect(deadlock).toMatchObject({ code: 'DEADLOCK' })
			expect(manager.pending('user')).toEqual([])

			const target: unknown = await manager
				.ask('user', 'nobody', createForm({ fields: [{ control: 'text', name: 'x' }] }))
				.catch((error: unknown) => error)
			expect(isTerminalError(target)).toBe(true)
			expect(target).toMatchObject({ code: 'TARGET' })

			expect(manager.answer('agent', parked.id, { name: 'Ada' })).toEqual({
				success: true,
				value: { name: 'Ada' },
			})
			expect(await answers).toEqual({ name: 'Ada' })

			// With no store the manager persists nothing, and `open` hands back the live broker.
			expect(await manager.save('agent')).toBe(false)
			expect(await manager.open('agent')).toBe(agent)

			const bounded = manager.add('bounded', { cap: 100 })
			for (let index = 0; index < 100; index += 1) {
				bounded.park(createForm({ fields: [{ control: 'text', name: 'name' }] }))
			}
			let refusal: unknown
			try {
				bounded.park(createForm({ fields: [{ control: 'text', name: 'name' }] }))
			} catch (error: unknown) {
				refusal = error
			}
			expect(isTerminalError(refusal)).toBe(true)
			expect(refusal).toMatchObject({ code: 'LIMIT' })

			// The array overload succeeds only when every name was mounted.
			expect(manager.remove(['agent'])).toBe(true)
			expect(manager.remove(['nobody'])).toBe(false)
			manager.remove()
			expect(manager.terminals()).toEqual([])
			// The manager stays usable after a full removal, and destroying it drops every broker.
			expect(manager.add('again')).toBeDefined()
			manager.destroy()
			expect(manager.terminals()).toEqual([])
		})

		it('persists and restores the endpoint config the manager fence claims a store adds', async () => {
			const store = createMemoryTerminalStore()
			const manager = createTerminalManager({ store })
			manager.add('agent', { timeout: 30_000 })
			expect(await manager.save('agent')).toBe(true)
			expect(await store.get('agent')).toEqual({ id: 'agent', timeout: 30_000 })

			manager.remove('agent')
			// The restored broker is empty: a parked promise is process-bound and never resurrected.
			const restored = await manager.open('agent')
			expect(restored).toBeDefined()
			expect(restored?.pending()).toEqual([])
			manager.destroy()
		})

		it('returns the server-helper values the injected-streams fence claims', () => {
			const input = {
				on: () => undefined,
				off: () => undefined,
				setRawMode: () => undefined,
				resume: () => undefined,
				pause: () => undefined,
				isTTY: true,
			}
			expect(isInputStream(input)).toBe(true)
			expect(supportsRawMode(input)).toBe(true)
			expect(isReadable(stdin)).toBe(true)

			expect(lineCount('one\ntwo\nthree')).toBe(3)
			expect(renderCursorUp(2)).toBe(`${CSI}2A`)
			expect(renderCursorUp(0)).toBe('')
			expect(redrawPrefix(3)).toBe(`${CSI}2A${RETURN}${CLEAR_DOWN}`)

			expect(fieldToText({ control: 'date', name: 'born', label: 'Birthday' })).toEqual({
				control: 'text',
				name: 'born',
				label: 'Birthday (YYYY-MM-DD)',
			})
			expect(valueToText(true)).toBe('yes')
			expect(valueToText(['read', 'write'])).toBe('read, write')

			const styler = createStyler()
			const theme = createPromptTheme()
			const choices = [
				{ value: 'admin', label: 'Admin' },
				{ value: 'root', label: 'Root', disabled: true },
			]
			expect(filterEnabled(choices).map((choice) => choice.value)).toEqual(['admin'])
			expect(filterDisabled(choices).map((choice) => choice.value)).toEqual(['root'])
			expect(strip(renderGroupHeader(styler, theme, 'Account'))).toBe('Account')
			expect(strip(renderLockedLine(styler, theme, 'Code', valueToText('fixed')))).toBe(
				'○ Code (locked) fixed',
			)
			expect(strip(renderSuggestionLine(styler, theme, choices))).toBe('Suggestions: admin, root')
			expect(strip(renderUnavailableLine(styler, theme, filterDisabled(choices)))).toBe(
				'Unavailable: Root',
			)
			expect(strip(renderNumberedList(styler, theme, filterEnabled(choices)))).toBe('  1) Admin')
		})
	})
})
