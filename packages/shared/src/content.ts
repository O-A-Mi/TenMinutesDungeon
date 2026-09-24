import type {
	EnemyDefinition,
	RewardDefinition,
	TileId,
	TilesetManifest,
	WeaponDefinition,
	ZoneDefinition,
} from './types.js';
import enemyContracts from './enemies.json' with { type: 'json' };
import emblemContracts from './emblems.json' with { type: 'json' };
import { emblemDefinitionSchema, enemyDefinitionSchema } from './schemas.js';
import type { EmblemDefinition } from './types.js';

const ids: TileId[][] = [
	['floor_0', 'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5'],
	['wall_n', 'wall_e', 'wall_s', 'wall_w', 'outer_nw', 'outer_ne'],
	['outer_se', 'outer_sw', 'inner_nw', 'inner_ne', 'inner_se', 'inner_sw'],
	['door_v_closed', 'door_v_open', 'door_h_closed', 'door_h_open', 'exit_closed', 'exit_open'],
	['prop_0', 'prop_1', 'prop_2', 'prop_3', 'prop_4', 'prop_5'],
	['deco_0', 'deco_1', 'deco_2', 'pillar', 'hazard', 'void'],
];
export const TILESET_MANIFEST = Object.fromEntries(
	ids.flatMap((row, y) => row.map((id, x) => [id, { column: x, row: y }])),
) as TilesetManifest;
export type PropMaterial = 'glass' | 'wood' | 'ceramic' | 'stone' | 'metal';
export const BLUNDERBUSS_EMBLEM_CRIT_CHANCE = 0.1;
export const PROP_MATERIALS: Record<
	`prop_${0 | 1 | 2 | 3 | 4 | 5}` | 'pillar',
	{ material: PropMaterial; health: number; debrisColor: number }
> = {
	prop_0: { material: 'glass', health: 24, debrisColor: 0xd5c8ad },
	prop_1: { material: 'wood', health: 48, debrisColor: 0x967153 },
	prop_2: { material: 'stone', health: 92, debrisColor: 0x91877b },
	prop_3: { material: 'ceramic', health: 58, debrisColor: 0xbca77e },
	prop_4: { material: 'metal', health: 120, debrisColor: 0x9c9a91 },
	prop_5: { material: 'wood', health: 48, debrisColor: 0x967153 },
	pillar: { material: 'stone', health: 180, debrisColor: 0x91877b },
};

export const CRYPT_ZONE: ZoneDefinition = {
	id: 'alchemical-crypt',
	name: 'Cripta do Horologista',
	durationSeconds: 600,
	guardianId: 'chronarch',
	palette: {
		shadow: 0x0b090d,
		dark: 0x211820,
		mid: 0x62434a,
		light: 0xb78b62,
		highlight: 0xf2d89b,
	},
};
export const ZONES: ZoneDefinition[] = [
	CRYPT_ZONE,
	{
		id: 'ossuary-engine',
		name: 'Engenho Ossuário',
		durationSeconds: 600,
		guardianId: 'chronarch',
		palette: {
			shadow: 0x080b0d,
			dark: 0x172329,
			mid: 0x42606a,
			light: 0xa6b8ad,
			highlight: 0xe8e4cf,
		},
	},
	{
		id: 'midnight-foundry',
		name: 'Fundição da Meia-Noite',
		durationSeconds: 600,
		guardianId: 'chronarch',
		palette: {
			shadow: 0x0c080b,
			dark: 0x29121d,
			mid: 0x713345,
			light: 0xc36a4b,
			highlight: 0xf1c879,
		},
	},
];

export const WEAPONS: Record<string, WeaponDefinition> = {
	blunderbuss: {
		id: 'blunderbuss',
		name: 'Bacamarte',
		description: 'Explosão brutal, sem críticos.',
		maxHealth: 100,
		damage: 12,
		cooldownMs: 850,
		moveSpeed: 145,
		critChance: 0,
		critMultiplier: 1,
		range: 96,
		spreadDegrees: 24,
		projectiles: 6,
		maxBounces: 0,
		knockback: 22,
	},
	sword: {
		id: 'sword',
		name: 'Espada',
		description: 'Arco confiável e avanço curto.',
		maxHealth: 110,
		damage: 24,
		cooldownMs: 430,
		moveSpeed: 155,
		critChance: 0.18,
		critMultiplier: 1.75,
		range: 68,
		spreadDegrees: 82,
		projectiles: 1,
		maxBounces: 0,
		knockback: 12,
	},
	knife: {
		id: 'knife',
		name: 'Faca',
		description: 'Ricochetes elevam o crítico.',
		maxHealth: 90,
		damage: 14,
		cooldownMs: 330,
		moveSpeed: 170,
		critChance: 0.32,
		critMultiplier: 2,
		range: 420,
		spreadDegrees: 0,
		projectiles: 1,
		maxBounces: 2,
		knockback: 5,
	},
};

export const ENEMIES = Object.fromEntries(
	Object.entries(enemyContracts).map(([id, value]) => [id, enemyDefinitionSchema.parse(value)]),
) as Record<string, EnemyDefinition>;

export const EMBLEMS = emblemContracts.map((value) =>
	emblemDefinitionSchema.parse(value),
) as EmblemDefinition[];

export const REWARDS: RewardDefinition[] = [
	{
		id: 'half-minute',
		name: 'Grãos da Ampulheta',
		description: '+30s na próxima zona.',
		kind: 'time',
		timeBonusSeconds: 30,
	},
	{
		id: 'full-minute',
		name: 'Ampulheta Roubada',
		description: '+1min na próxima zona.',
		kind: 'time',
		timeBonusSeconds: 60,
	},
	...EMBLEMS.map((emblem): RewardDefinition => ({
		id: emblem.id,
		name: emblem.name,
		description: emblem.description,
		kind: emblem.kind,
		...(emblem.weaponId ? { weaponId: emblem.weaponId } : {}),
		...(emblem.effect ? { effect: emblem.effect } : {}),
		iconName: emblem.iconName,
		stackMode: emblem.stackMode,
		...(emblem.conflictsWith ? { conflictsWith: emblem.conflictsWith } : {}),
		maxStack: 3,
	})),
];
