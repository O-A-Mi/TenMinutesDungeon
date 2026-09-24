import { describe, expect, it } from 'vitest';
import { TILESET_MANIFEST, WEAPONS } from './content.js';
describe('content contracts', () => {
	it('maps exactly 36 unique atlas cells', () => {
		const values = Object.values(TILESET_MANIFEST);
		expect(values).toHaveLength(36);
		expect(new Set(values.map((v) => `${v.column},${v.row}`)).size).toBe(36);
		expect(values.every((v) => v.column >= 0 && v.column < 6 && v.row >= 0 && v.row < 6)).toBe(
			true,
		);
	});
	it('keeps the three weapon identities distinct', () => {
		expect(WEAPONS.blunderbuss!.critChance).toBe(0);
		expect(WEAPONS.knife!.maxBounces).toBe(2);
		expect(WEAPONS.sword!.range).toBeLessThan(WEAPONS.knife!.range);
	});
});
