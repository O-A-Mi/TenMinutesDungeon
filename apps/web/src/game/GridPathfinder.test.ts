import { describe, expect, it } from 'vitest';
import { findGridPath } from './GridPathfinder';

describe('grid pathfinder', () => {
	it('routes around a prop wall instead of stopping', () => {
		const blocked = new Set(['2,1', '2,2', '2,3']);
		const path = findGridPath({ x: 1, y: 2 }, { x: 3, y: 2 }, 5, 5, (x, y) =>
			blocked.has(`${x},${y}`),
		);
		expect(path.length).toBeGreaterThan(2);
		expect(path.some((p) => blocked.has(`${p.x},${p.y}`))).toBe(false);
		expect(path.at(-1)).toEqual({ x: 3, y: 2 });
	});
	it('returns no path when fully enclosed', () => {
		const path = findGridPath({ x: 1, y: 1 }, { x: 3, y: 3 }, 5, 5, (x, y) => x === 2 || y === 2);
		expect(path).toEqual([]);
	});
});
