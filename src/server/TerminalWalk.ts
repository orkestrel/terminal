/** Tracks the group whose heading one form walk has displayed. */
export class TerminalWalk {
	#group: string | undefined

	get group(): string | undefined {
		return this.#group
	}

	enter(group: string | undefined): void {
		this.#group = group
	}
}
