export class SeededRng {
	private state: number;
	constructor(seed: number) {
		this.state = seed >>> 0 || 0x6d2b79f5;
	}
	next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	int(min: number, max: number): number {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}
	pick<T>(items: readonly T[]): T {
		return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
	}
	shuffle<T>(items: readonly T[]): T[] {
		const out = [...items];
		for (let i = out.length - 1; i > 0; i--) {
			const j = this.int(0, i);
			[out[i], out[j]] = [out[j]!, out[i]!];
		}
		return out;
	}
}

export function deriveSeed(seed: number, scope: string, index = 0): number {
	let hash = (seed ^ 0x811c9dc5 ^ index) >>> 0;
	for (let i = 0; i < scope.length; i++) {
		hash ^= scope.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash || 0x6d2b79f5;
}

export function createCriticalBag(seed: number, chance: number, cycle = 0, fractionalCarry = 0) {
	const exact = Math.max(0, Math.min(1, chance)) * 20 + fractionalCarry;
	const criticals = Math.floor(exact);
	const carry = exact - criticals;
	const rng = new SeededRng(deriveSeed(seed, 'critical-bag', cycle));
	return {
		size: 20 as const,
		cursor: 0,
		entries: rng.shuffle(Array.from({ length: 20 }, (_, i) => i < criticals)),
		pendingCritChance: chance,
		cycle,
		fractionalCarry: carry,
	};
}
