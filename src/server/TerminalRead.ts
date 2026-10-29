/** Holds reducer state and the rendered line count for one terminal read. */
export class TerminalRead<TState> {
	#state: TState
	#lines: number

	constructor(state: TState, lines: number) {
		this.#state = state
		this.#lines = lines
	}

	get state(): TState {
		return this.#state
	}

	get lines(): number {
		return this.#lines
	}

	advance(state: TState): void {
		this.#state = state
	}

	paint(lines: number): void {
		this.#lines = lines
	}
}
