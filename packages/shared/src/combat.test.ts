import { describe, expect, it } from 'vitest';
import { EMBLEMS, ENEMIES } from './content.js';
import { emblemConflicts, emblemRarity, scaleEnemyForZone, selectEnemyAttack } from './combat.js';

describe('combat content contracts', () => {
	it('scales enemies from base values and unlocks one attack per zone', () => {
		const base = ENEMIES.wretch!;
		expect(scaleEnemyForZone(base, 0)).toMatchObject({ maxHealth: 28, damage: 8, attackSpeed: 1 });
		expect(scaleEnemyForZone(base, 1)).toMatchObject({
			maxHealth: 35,
			damage: 10,
			attackSpeed: 1.25,
		});
		expect(scaleEnemyForZone(base, 2)).toMatchObject({
			maxHealth: 42,
			damage: 12,
			attackSpeed: 1.5,
		});
		expect([0, 1, 2].map((zone) => scaleEnemyForZone(base, zone).attacks.length)).toEqual([
			1, 2, 3,
		]);
	});

	it('validates intelligence, knockback and three rarity tiers for every contract', () => {
		for (const enemy of Object.values(ENEMIES)) {
			expect(enemy.intelligenceLevel).toBeGreaterThanOrEqual(1);
			expect(enemy.intelligenceLevel).toBeLessThanOrEqual(10);
			expect(enemy.knockbackTendency).toBeGreaterThanOrEqual(0);
			expect(enemy.knockbackTendency).toBeLessThanOrEqual(1);
		}
		for (const emblem of EMBLEMS) {
			expect(emblem.iconName).toMatch(/^[a-z0-9-]+$/);
			expect(emblem.tiers.map((tier) => tier.rarity)).toEqual(['common', 'uncommon', 'rare']);
		}
	});

	it('marks precision and sawn barrel as symmetric conflicts', () => {
		const inventory = {
			capacity: 6 as const,
			slots: [{ kind: 'emblem' as const, itemId: 'sawn-barrel', quantity: 1 as const }],
		};
		expect(emblemConflicts(inventory, 'precision-barrel').map((slot) => slot.itemId)).toEqual([
			'sawn-barrel',
		]);
		expect(emblemRarity(1)).toBe('common');
		expect(emblemRarity(3)).toBe('rare');
	});

	it('selects only attacks in range using deterministic weighted rolls', () => {
		const attacks = ENEMIES.acolyte!.attacks;
		expect(selectEnemyAttack(attacks, 40, 0)?.id).toBe('acolyte-bolt');
		expect(selectEnemyAttack(attacks, 300, 0)).toBeUndefined();
	});
});
