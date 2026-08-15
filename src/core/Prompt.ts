import type {
	AnswerError,
	Parked,
	ParkRequest,
	PendingForm,
	PromptEventMap,
	PromptInterface,
	PromptOptions,
	TimerHandler,
} from './types.js'
import type { Result } from '@orkestrel/contract'
import type { EmitterInterface } from '@orkestrel/emitter'
import type { FieldError, FormInterface, FormResult, FormValues } from '@orkestrel/form'
import { DEFAULT_PROMPT_TIMEOUT_MS } from './constants.js'
import { TerminalError } from './errors.js'
import { defaultTimer } from './helpers.js'
import { attempt } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { isFieldError, isFormError, serializeForm } from '@orkestrel/form'

/**
 * The headless form broker. It parks live forms, exposes their serialized schemas, and applies
 * remote answers to the authoritative form.
 *
 * @remarks
 * A parked record carries one call to `serializeForm`. A failed fill or submit leaves the record
 * parked for another answer. A successful submit settles the form once, emits `answer`, and removes
 * the record. Timeout and teardown abandon every unsettled form through its own `destroy` method.
 *
 * @example
 * ```ts
 * const form = createForm({ fields: [{ control: 'text', name: 'name' }] })
 * const prompt = createPrompt()
 * const id = prompt.park(form)
 * prompt.answer(id, { name: 'Ada' })
 * await form.answer // { name: 'Ada' }
 * ```
 */
export class Prompt implements PromptInterface {
	readonly #timeout: number
	readonly #timer: TimerHandler
	readonly #cap: number | undefined
	readonly #parked = new Map<string, Parked>()
	readonly #emitter: Emitter<PromptEventMap>
	#destroyed = false

	constructor(options?: PromptOptions) {
		this.#timeout = options?.timeout ?? DEFAULT_PROMPT_TIMEOUT_MS
		this.#timer = options?.timer ?? defaultTimer
		this.#cap = options?.cap
		this.#emitter = new Emitter({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
	}

	get emitter(): EmitterInterface<PromptEventMap> {
		return this.#emitter
	}

	get count(): number {
		return this.#parked.size
	}

	pending(): readonly PendingForm[]
	pending(id: string): PendingForm | undefined
	pending(id?: string): readonly PendingForm[] | PendingForm | undefined {
		if (id !== undefined) return this.#parked.get(id)?.pending
		const forms: PendingForm[] = []
		for (const parked of this.#parked.values()) forms.push(parked.pending)
		return forms
	}

	park(form: FormInterface, request?: ParkRequest): string {
		if (this.#destroyed) {
			form.destroy()
			throw new TerminalError('EXPIRE', 'The broker has been destroyed')
		}
		if (this.#cap !== undefined && this.#parked.size >= this.#cap) {
			form.destroy()
			throw new TerminalError('LIMIT', `The parked-form cap (${String(this.#cap)}) was reached`, {
				cap: this.#cap,
			})
		}

		const id = crypto.randomUUID()
		const pending: PendingForm = {
			id,
			schema: serializeForm(form.schema),
			status: 'pending',
			time: Date.now(),
			...(request?.from !== undefined ? { from: request.from } : {}),
			...(request?.to !== undefined ? { to: request.to } : {}),
		}
		const cancel = this.#timer(() => this.#expire(id), this.#timeout)
		this.#parked.set(id, { form, pending, cancel })
		this.#emitter.emit('pending', pending)
		return id
	}

	answer(id: string, values: FormValues): Result<FormValues, AnswerError> {
		const outcome = attempt(() => this.#answer(id, values))
		if (outcome.success) return outcome.value
		return {
			success: false,
			error: {
				reason: 'rejected',
				errors: [{ field: 'form', message: 'The form rejected the answer' }],
			},
		}
	}

	destroy(): void {
		if (this.#destroyed) return
		this.#destroyed = true
		for (const id of [...this.#parked.keys()]) this.#expire(id)
		this.#emitter.destroy()
	}

	#answer(id: string, values: FormValues): Result<FormValues, AnswerError> {
		const parked = this.#parked.get(id)
		if (parked === undefined || parked.pending.status !== 'pending') {
			return { success: false, error: { reason: 'unknown' } }
		}

		const outcome = attempt(() => this.#submit(parked.form, values))
		if (!outcome.success) {
			return {
				success: false,
				error: { reason: 'rejected', errors: this.#errors(outcome.error, parked.form) },
			}
		}
		if (!outcome.value.success) {
			return {
				success: false,
				error: { reason: 'rejected', errors: outcome.value.error },
			}
		}

		parked.cancel()
		const answered: Parked = {
			...parked,
			pending: { ...parked.pending, status: 'answered' },
		}
		this.#parked.set(id, answered)
		this.#emitter.emit('answer', id, outcome.value.value)
		this.#parked.delete(id)
		return outcome.value
	}

	#submit(form: FormInterface, values: FormValues): FormResult {
		for (const [field, value] of Object.entries(values)) {
			const outcome = attempt(() => form.fill(field, value))
			if (!outcome.success) {
				return { success: false, error: this.#errors(outcome.error, form, field) }
			}
		}
		return form.submit()
	}

	#errors(error: unknown, form: FormInterface, field?: string): readonly FieldError[] {
		if (isFormError(error)) {
			if (isFieldError(error.context)) return [error.context]
			const named = error.context?.field
			return [
				{
					field: typeof named === 'string' ? named : this.#field(form, field),
					message: error.message,
				},
			]
		}
		return [
			{
				field: this.#field(form, field),
				message: 'The form rejected the answer',
			},
		]
	}

	#field(form: FormInterface, field?: string): string {
		return field ?? form.schema.fields[0]?.name ?? form.schema.name ?? 'form'
	}

	#expire(id: string): void {
		const parked = this.#parked.get(id)
		if (parked === undefined || parked.pending.status !== 'pending') return
		parked.cancel()
		const expired: Parked = {
			...parked,
			pending: { ...parked.pending, status: 'expired' },
		}
		this.#parked.set(id, expired)
		parked.form.destroy()
		this.#emitter.emit('expire', id)
		this.#parked.delete(id)
	}
}
