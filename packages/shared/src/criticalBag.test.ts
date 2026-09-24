import { describe, expect, it } from 'vitest';
import { CriticalBag } from './criticalBag.js';

describe('CriticalBag', () => {
	it('delivers the exact number of criticals in a 20 draw cycle', () => {
		const bag = new CriticalBag(1234, 0.25);
		const draws = Array.from({ length: 20 }, () => bag.draw());
		expect(draws.filter(Boolean)).toHaveLength(5);
	});
	it('replays the same order from the same seed', () => {
		const a = new CriticalBag(99, 0.32),
			b = new CriticalBag(99, 0.32);
		expect(Array.from({ length: 60 }, () => a.draw())).toEqual(
			Array.from({ length: 60 }, () => b.draw()),
		);
	});
	it('applies chance changes only after the current bag empties', () => {
		const bag = new CriticalBag(7, 0);
		bag.draw();
		bag.setChance(1);
		expect(Array.from({ length: 19 }, () => bag.draw()).some(Boolean)).toBe(false);
		expect(bag.draw()).toBe(true);
	});
});
