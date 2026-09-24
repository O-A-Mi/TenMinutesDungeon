import { z } from 'zod';

const combatStatsSchema = z.object({
	maxHealth: z.number().positive(),
	damage: z.number().nonnegative(),
	cooldownMs: z.number().positive(),
	moveSpeed: z.number().nonnegative(),
	critChance: z.number().min(0).max(1),
	critMultiplier: z.number().min(1),
	range: z.number().nonnegative(),
});
const combatModifierSchema = z
	.object({
		maxHealth: z.number(),
		damage: z.number(),
		cooldownMs: z.number(),
		moveSpeed: z.number(),
		critChance: z.number(),
		critMultiplier: z.number(),
		range: z.number(),
	})
	.partial();
export const enemyAttackSchema = z.object({
	id: z.string().min(1),
	type: z.enum(['punch', 'distance', 'wave-distance', 'ground-punch', 'ground-punch-rocks-fell']),
	unlockZone: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	telegraphMs: z.number().int().min(100).max(2000),
	cooldownMs: z.number().int().positive(),
	range: z.number().positive(),
	weight: z.number().positive(),
	projectiles: z.number().int().positive().max(12).optional(),
	knockdownMs: z.number().int().positive().max(2000).optional(),
	propInteraction: z.enum(['block', 'damage-and-continue', 'ignore']).optional(),
});
export const enemyDefinitionSchema = combatStatsSchema.extend({
	id: z.string().min(1),
	name: z.string().min(1),
	behavior: z.enum(['chaser', 'shooter', 'brute', 'guardian']),
	color: z.number().int().min(0).max(0xffffff),
	sprite: z.string().min(1),
	intelligenceLevel: z.number().int().min(1).max(10),
	collisionAction: z.enum(['avoid', 'destroy-props']),
	knockbackTendency: z.number().min(0).max(1),
	canHeal: z.boolean(),
	canDodge: z.boolean(),
	canDash: z.boolean(),
	attackSpeed: z.number().positive(),
	attacks: z.array(enemyAttackSchema).min(1),
});
const emblemTierSchema = z.object({
	rarity: z.enum(['common', 'uncommon', 'rare']),
	modifiers: combatModifierSchema.optional(),
	spreadDegrees: z.number().min(0).max(180).optional(),
	projectiles: z.number().int().positive().max(20).optional(),
	lifesteal: z.number().min(0).max(1).optional(),
	damageReduction: z.number().min(0).max(0.9).optional(),
	distanceDamageBonus: z.number().min(0).max(3).optional(),
	enemyDamageMultiplier: z.number().min(1).max(3).optional(),
	timeBonusSeconds: z.number().int().nonnegative().optional(),
});
export const emblemDefinitionSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().min(1),
	iconName: z.string().regex(/^[a-z0-9-]+$/),
	kind: z.enum(['general', 'weapon', 'rare']),
	category: z.enum(['offense', 'healing', 'defense', 'mobility', 'risk-reward']),
	weaponId: z.enum(['blunderbuss', 'sword', 'knife']).optional(),
	maxStack: z.literal(3),
	stackMode: z.enum(['additive-per-copy', 'tier-total', 'once']),
	effect: z
		.enum([
			'enable_blunderbuss_crit',
			'extra_knife_bounce',
			'double_sword_arc',
			'recall_width',
			'sawn_barrel',
			'precision_barrel',
			'vampirism',
			'damage_reduction',
			'extra_dash',
			'cursed_clock',
		])
		.optional(),
	conflictsWith: z.array(z.string().min(1)).optional(),
	tiers: z.tuple([emblemTierSchema, emblemTierSchema, emblemTierSchema]),
});

export const weaponIdSchema = z.enum(['blunderbuss', 'sword', 'knife']);
export const guestSessionSchema = z.object({
	displayName: z.string().trim().min(2).max(24).optional(),
});
export const accountRegistrationSchema = z.object({
	displayName: z.string().trim().min(2).max(24),
	email: z.email().max(254),
	password: z.string().min(10).max(128),
	countryCode: z.string().regex(/^[A-Z]{2}$/),
	regionCode: z.string().trim().min(1).max(12),
});
export const accountLoginSchema = z.object({
	email: z.email().max(254),
	password: z.string().min(1).max(128),
	mergeGuest: z.boolean().optional().default(false),
});
export const passwordResetRequestSchema = z.object({ email: z.email().max(254) });
export const passwordResetSchema = z.object({
	token: z.string().min(32).max(128),
	password: z.string().min(10).max(128),
});
export const profileUpdateSchema = z.object({
	displayName: z.string().trim().min(2).max(24),
	countryCode: z.string().regex(/^[A-Z]{2}$/),
	regionCode: z.string().trim().min(1).max(12),
});
export const rankingQuerySchema = z.object({
	scope: z.enum(['national', 'regional']).default('national'),
});
export const startRunSchema = z.object({
	weaponId: weaponIdSchema,
	seed: z.number().int().nonnegative().optional(),
});
export const runEventSchema = z.object({
	sequence: z.number().int().nonnegative(),
	tick: z.number().int().nonnegative(),
	type: z.enum([
		'run_started',
		'zone_started',
		'room_entered',
		'enemy_defeated',
		'item_collected',
		'item_discarded',
		'potion_used',
		'emblem_stacked',
		'guardian_defeated',
		'reward_selected',
		'zone_completed',
		'extraction_started',
		'run_finished',
	]),
	zoneIndex: z.number().int().min(0).max(2),
	roomId: z.string().optional(),
	payload: z.record(z.string(), z.unknown()),
	previousHash: z.string(),
	hash: z.string(),
});
export const finishRunSchema = z.object({
	runId: z.string().min(1),
	outcome: z.enum(['escaped', 'guardian', 'death', 'collapse']),
	elapsedMs: z.number().int().nonnegative(),
	activePlayMs: z.number().int().nonnegative().optional(),
	roomsCleared: z.number().int().nonnegative(),
	zonesCleared: z.number().int().min(0).max(3).optional(),
	enemiesDefeated: z.number().int().nonnegative(),
	guardiansDefeated: z.number().int().min(0).max(3).optional(),
	pvpVictories: z.number().int().nonnegative().optional(),
	extractedLootValue: z.number().int().nonnegative().optional(),
	timeRemainingMs: z.number().int().nonnegative().optional(),
	acceptedRewardIds: z.array(z.string()).max(18),
	events: z.array(runEventSchema).max(2000).optional(),
});
export const regionSchema = z.object({
	countryCode: z.string().regex(/^[A-Z]{2}$/),
	regionCode: z.string().trim().min(1).max(12),
});
export const wsEnvelopeSchema = z.object({
	version: z.literal(1),
	type: z.string().min(1),
	requestId: z.string(),
	sessionId: z.string(),
	sequence: z.number().int().nonnegative(),
	timestamp: z.number().int(),
	payload: z.unknown(),
});
