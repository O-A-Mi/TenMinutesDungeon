import { createCriticalBag } from './rng.js';
import type { CriticalBagState } from './types.js';

export class CriticalBag {
	state: CriticalBagState;
	constructor(
		private readonly seed: number,
		chance: number,
		state?: CriticalBagState,
	) {
		this.state = state ?? createCriticalBag(seed, chance);
	}
	setChance(chance: number) {
		this.state.pendingCritChance = Math.max(0, Math.min(1, chance));
	}
	draw(): boolean {
		if (this.state.cursor >= this.state.size) {
			this.state = createCriticalBag(
				this.seed,
				this.state.pendingCritChance,
				this.state.cycle + 1,
				this.state.fractionalCarry,
			);
		}
		return this.state.entries[this.state.cursor++] ?? false;
	}
	snapshot(): CriticalBagState {
		return { ...this.state, entries: [...this.state.entries] };
	}
}
