import { EMBLEMS } from './content.js';
import type {
	CombatStats,
	EmblemDefinition,
	EmblemTier,
	EnemyAttackDefinition,
	EnemyDefinition,
	InventoryState,
} from './types.js';

export const ZONE_MULTIPLIERS = [1, 1.25, 1.5] as const;

export function scaleEnemyForZone(base: EnemyDefinition, zoneIndex: number): EnemyDefinition {
	const multiplier = ZONE_MULTIPLIERS[Math.max(0, Math.min(2, zoneIndex))]!;
	return {
		...base,
		maxHealth: Math.round(base.maxHealth * multiplier),
		damage: Math.round(base.damage * multiplier),
		attackSpeed: base.attackSpeed * multiplier,
		attacks: base.attacks.filter((attack) => attack.unlockZone <= zoneIndex + 1),
	};
}

export function decisionIntervalSeconds(intelligenceLevel: number) {
	return Math.max(0.12, 0.66 - Math.max(1, Math.min(10, intelligenceLevel)) * 0.052);
}

export function selectEnemyAttack(
	attacks: EnemyAttackDefinition[],
	distance: number,
	roll: number,
) {
	const available = attacks.filter((attack) => distance <= attack.range);
	if (!available.length) return undefined;
	const total = available.reduce((sum, attack) => sum + attack.weight, 0);
	let cursor = Math.max(0, Math.min(0.999999, roll)) * total;
	for (const attack of available) {
		cursor -= attack.weight;
		if (cursor <= 0) return attack;
	}
	return available.at(-1);
}

export function emblemRarity(quantity: number) {
	return (['common', 'uncommon', 'rare'] as const)[Math.max(0, Math.min(2, quantity - 1))]!;
}
export function findEmblem(id: string) {
	return EMBLEMS.find((emblem) => emblem.id === id);
}
export function emblemTier(emblem: EmblemDefinition, quantity: number): EmblemTier {
	return emblem.tiers[Math.max(0, Math.min(2, quantity - 1))]!;
}
export function emblemConflicts(inventory: InventoryState, candidateId: string) {
	const candidate = findEmblem(candidateId);
	if (!candidate) return [];
	return inventory.slots.filter((slot) => {
		if (slot.kind !== 'emblem') return false;
		const equipped = findEmblem(slot.itemId);
		return Boolean(
			candidate.conflictsWith?.includes(slot.itemId) ||
			equipped?.conflictsWith?.includes(candidateId),
		);
	});
}
export function applyCombatModifiers(stats: CombatStats, tier: EmblemTier) {
	const result = { ...stats };
	for (const key of Object.keys(tier.modifiers ?? {}) as (keyof CombatStats)[])
		result[key] += tier.modifiers?.[key] ?? 0;
	return result;
}
