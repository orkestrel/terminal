import type { FieldChoice, FormField } from '@orkestrel/form'
import {
	CLEAR_DOWN,
	CSI_UP,
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
} from '@src/server'
import { RETURN, createPromptTheme } from '@src/core'
import { createStyler, strip } from '@orkestrel/console'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

describe('stream guards', () => {
	it('accepts exactly the minimal input stream shape', () => {
		const input = { on() {}, off() {} }
		expect(isInputStream(input)).toBe(true)
		expect(isInputStream({ on() {} })).toBe(false)
		expect(isInputStream(null)).toBe(false)
		expect(isInputStream(Object.create(null))).toBe(false)
	})

	it('narrows a real Node readable stream', () => {
		const stream = new PassThrough()
		expect(isReadable(stream)).toBe(true)
		expect(isReadable({ on() {}, off() {} })).toBe(false)
		stream.destroy()
	})

	it('selects raw mode only for a TTY with setRawMode', () => {
		expect(supportsRawMode({ on() {}, off() {}, isTTY: true, setRawMode() {} })).toBe(true)
		expect(supportsRawMode({ on() {}, off() {}, isTTY: true })).toBe(false)
		expect(supportsRawMode({ on() {}, off() {}, isTTY: false, setRawMode() {} })).toBe(false)
	})
})

describe('cursor math', () => {
	it('counts physical view lines from newline boundaries', () => {
		expect(lineCount('')).toBe(1)
		expect(lineCount('one')).toBe(1)
		expect(lineCount('one\ntwo\n')).toBe(3)
	})

	it('renders a cursor-up sequence only for a positive count', () => {
		expect(renderCursorUp(-1)).toBe('')
		expect(renderCursorUp(0)).toBe('')
		expect(renderCursorUp(2)).toBe(CSI_UP.replace('{count}', '2'))
	})

	it('builds the reposition-and-clear prefix from the previous line count', () => {
		expect(redrawPrefix(1)).toBe(`${RETURN}${CLEAR_DOWN}`)
		expect(redrawPrefix(3)).toBe(`${renderCursorUp(2)}${RETURN}${CLEAR_DOWN}`)
	})
})

describe('field projections', () => {
	it('projects every line-read control to a text field with its cue and default', () => {
		const fields: readonly FormField[] = [
			{ control: 'text', name: 'text', label: 'Text', default: 'seed' },
			{ control: 'number', name: 'number', label: 'Number', default: 42 },
			{ control: 'date', name: 'date', label: 'Date', default: '2026-08-15' },
			{ control: 'time', name: 'time', label: 'Time', default: '12:30' },
			{ control: 'datetime', name: 'datetime', label: 'Datetime', default: '2026-08-15T12:30' },
			{ control: 'color', name: 'color', label: 'Color', default: '#112233' },
			{ control: 'file', name: 'file', label: 'File' },
		]

		expect(fields.map(fieldToText)).toEqual([
			{ control: 'text', name: 'text', label: 'Text', default: 'seed' },
			{ control: 'text', name: 'number', label: 'Number (number)', default: '42' },
			{ control: 'text', name: 'date', label: 'Date (YYYY-MM-DD)', default: '2026-08-15' },
			{ control: 'text', name: 'time', label: 'Time (HH:MM)', default: '12:30' },
			{
				control: 'text',
				name: 'datetime',
				label: 'Datetime (YYYY-MM-DDTHH:MM)',
				default: '2026-08-15T12:30',
			},
			{ control: 'text', name: 'color', label: 'Color (#rrggbb)', default: '#112233' },
			{ control: 'text', name: 'file', label: 'File (path)' },
		])
	})

	it('projects held answers for read-only rendering', () => {
		expect(valueToText(undefined)).toBe('')
		expect(valueToText('Ada')).toBe('Ada')
		expect(valueToText(42)).toBe('42')
		expect(valueToText(true)).toBe('yes')
		expect(valueToText(false)).toBe('no')
		expect(valueToText(['a', 'b'])).toBe('a, b')
	})

	it('partitions enabled and disabled choices without reordering', () => {
		const choices: readonly FieldChoice[] = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B', disabled: true },
			{ value: 'c', label: 'C' },
		]
		expect(filterEnabled(choices).map((choice) => choice.value)).toEqual(['a', 'c'])
		expect(filterDisabled(choices).map((choice) => choice.value)).toEqual(['b'])
	})
})

describe('whole-form lines', () => {
	const styler = createStyler()
	const theme = createPromptTheme()
	const choices: readonly FieldChoice[] = [
		{ value: 'admin', label: 'Admin' },
		{ value: 'viewer', label: 'Viewer', help: 'Read only' },
	]

	it('renders group and locked lines', () => {
		expect(strip(renderGroupHeader(styler, theme, 'Identity'))).toBe('Identity')
		expect(strip(renderLockedLine(styler, theme, 'Code', 'ABC'))).toBe('○ Code (locked) ABC')
		expect(strip(renderLockedLine(styler, theme, 'Code', ''))).toBe('○ Code (locked)')
	})

	it('renders open-select suggestions and unavailable choices', () => {
		expect(strip(renderSuggestionLine(styler, theme, choices))).toBe('Suggestions: admin, viewer')
		expect(strip(renderUnavailableLine(styler, theme, choices))).toBe('Unavailable: Admin, Viewer')
	})

	it('renders numbered choices with declared labels', () => {
		expect(strip(renderNumberedList(styler, theme, choices))).toBe('  1) Admin\n  2) Viewer')
	})
})
