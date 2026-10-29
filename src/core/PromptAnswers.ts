import type { FieldError, FormValues } from '@orkestrel/form'

/** Holds the answer and refusal carried between attempts of one remote prompt. */
export class PromptAnswers {
	#values: FormValues | undefined
	#errors: readonly FieldError[] = []

	get values(): FormValues | undefined {
		return this.#values
	}

	get errors(): readonly FieldError[] {
		return this.#errors
	}

	replace(values: FormValues, errors: readonly FieldError[]): void {
		this.#values = values
		this.#errors = errors
	}
}
