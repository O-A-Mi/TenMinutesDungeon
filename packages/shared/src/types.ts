export const TILE_SIZE = 32;
export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 10;
export const SAVE_VERSION = 2;
export const PROTOCOL_VERSION = 1;
export const TILESET_VERSION = 1;
export const SEED_VERSION = 2;
export const CONTENT_VERSION = 3;

export type WeaponId = 'blunderbuss' | 'sword' | 'knife';
export type ZoneId = 'alchemical-crypt' | 'ossuary-engine' | 'midnight-foundry';
export type RoomKind =
	'start' | 'combat' | 'obstacle' | 'treasure' | 'event' | 'reward' | 'pvp' | 'guardian';
export type Direction = 'north' | 'east' | 'south' | 'west';
export type TileId =
	| `floor_${0 | 1 | 2 | 3 | 4 | 5}`
	| 'wall_n'
	| 'wall_e'
	| 'wall_s'
	| 'wall_w'
	| 'outer_nw'
	| 'outer_ne'
	| 'outer_se'
	| 'outer_sw'
	| 'inner_nw'
	| 'inner_ne'
	| 'inner_se'
	| 'inner_sw'
	| 'door_v_closed'
	| 'door_v_open'
	| 'door_h_closed'
	| 'door_h_open'
	| 'exit_closed'
	| 'exit_open'
	| `prop_${0 | 1 | 2 | 3 | 4 | 5}`
	| `deco_${0 | 1 | 2}`
	| 'pillar'
	| 'hazard'
	| 'void';

export interface TileCoord {
	x: number;
	y: number;
}
export interface AtlasCell {
	column: number;
	row: number;
}
export type TilesetManifest = Record<TileId, AtlasCell>;
export interface DoorDefinition {
	direction: Direction;
	targetRoomId: string;
	tile: TileCoord;
}
export interface SpawnDefinition {
	id: string;
	kind: 'player' | 'enemy' | 'guardian' | 'reward' | 'pvp';
	tile: TileCoord;
	enemyId?: string;
}
export interface RoomGrid {
	width: number;
	height: number;
	tiles: TileId[];
}
export interface RoomDefinition {
	id: string;
	kind: RoomKind;
	grid: RoomGrid;
	doors: DoorDefinition[];
	spawns: SpawnDefinition[];
}
export interface DungeonNode {
	id: string;
	kind: RoomKind;
	depth: number;
	links: string[];
}
export interface DungeonGraph {
	startRoomId: string;
	guardianRoomId: string;
	nodes: DungeonNode[];
}
export interface ZonePalette {
	shadow: number;
	dark: number;
	mid: number;
	light: number;
	highlight: number;
}
export interface ZoneDefinition {
	id: ZoneId;
	name: string;
	durationSeconds: number;
	palette: ZonePalette;
	guardianId: string;
}
export interface GeneratedZone {
	definition: ZoneDefinition;
	graph: DungeonGraph;
	rooms: RoomDefinition[];
}
export interface SeededRun {
	seed: number;
	seedVersion: number;
	contentVersion: number;
	graph: DungeonGraph;
	rooms: RoomDefinition[];
	zones: GeneratedZone[];
}

export interface CombatStats {
	maxHealth: number;
	damage: number;
	cooldownMs: number;
	moveSpeed: number;
	critChance: number;
	critMultiplier: number;
	range: number;
}
export interface WeaponDefinition extends CombatStats {
	id: WeaponId;
	name: string;
	description: string;
	spreadDegrees: number;
	projectiles: number;
	maxBounces: number;
	knockback: number;
}
export interface EnemyDefinition extends CombatStats {
	id: string;
	name: string;
	behavior: 'chaser' | 'shooter' | 'brute' | 'guardian';
	color: number;
	sprite: string;
	intelligenceLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
	collisionAction: 'avoid' | 'destroy-props';
	knockbackTendency: number;
	canHeal: boolean;
	canDodge: boolean;
	canDash: boolean;
	attackSpeed: number;
	attacks: EnemyAttackDefinition[];
}
export type EnemyAttackType =
	'punch' | 'distance' | 'wave-distance' | 'ground-punch' | 'ground-punch-rocks-fell';
export interface EnemyAttackDefinition {
	id: string;
	type: EnemyAttackType;
	unlockZone: 1 | 2 | 3;
	telegraphMs: number;
	cooldownMs: number;
	range: number;
	weight: number;
	projectiles?: number;
	knockdownMs?: number;
	propInteraction?: 'block' | 'damage-and-continue' | 'ignore';
}
export type RewardKind = 'general' | 'weapon' | 'time' | 'rare';
export type EmblemEffect =
	| 'enable_blunderbuss_crit'
	| 'extra_knife_bounce'
	| 'double_sword_arc'
	| 'recall_width'
	| 'sawn_barrel'
	| 'precision_barrel'
	| 'vampirism'
	| 'damage_reduction'
	| 'extra_dash'
	| 'cursed_clock';
export type EmblemRarity = 'common' | 'uncommon' | 'rare';
export type EmblemStackMode = 'additive-per-copy' | 'tier-total' | 'once';
export interface EmblemTier {
	rarity: EmblemRarity;
	modifiers?: Partial<CombatStats>;
	spreadDegrees?: number;
	projectiles?: number;
	lifesteal?: number;
	damageReduction?: number;
	distanceDamageBonus?: number;
	enemyDamageMultiplier?: number;
	timeBonusSeconds?: number;
}
export interface EmblemDefinition {
	id: string;
	name: string;
	description: string;
	iconName: string;
	kind: Exclude<RewardKind, 'time'>;
	category: 'offense' | 'healing' | 'defense' | 'mobility' | 'risk-reward';
	weaponId?: WeaponId;
	maxStack: 3;
	stackMode: EmblemStackMode;
	effect?: EmblemEffect;
	conflictsWith?: string[];
	tiers: [EmblemTier, EmblemTier, EmblemTier];
}
export interface RewardDefinition {
	id: string;
	name: string;
	description: string;
	kind: RewardKind;
	weaponId?: WeaponId;
	timeBonusSeconds?: number;
	modifiers?: Partial<CombatStats>;
	effect?: EmblemEffect;
	maxStack?: 3;
	iconName?: string;
	stackMode?: EmblemStackMode;
	conflictsWith?: string[];
}
export interface InventorySlot {
	kind: 'emblem' | 'potion';
	itemId: string;
	quantity: 1 | 2 | 3;
}
export interface InventoryState {
	capacity: 6;
	slots: InventorySlot[];
}
export interface CriticalBagState {
	size: 20;
	cursor: number;
	entries: boolean[];
	pendingCritChance: number;
	cycle: number;
	fractionalCarry: number;
}
export interface PlayerBuild {
	baseWeaponId: WeaponId;
	stats: CombatStats;
	effects: EmblemEffect[];
}
export interface LootEntry {
	id: string;
	value: number;
	rarity: 'common' | 'uncommon' | 'rare';
}
export interface ScoreBreakdown {
	rooms: number;
	zones: number;
	guardians: number;
	enemies: number;
	elites: number;
	pvpVictories: number;
	extractedLoot: number;
	timeRemaining: number;
	penalties: number;
	total: number;
}
export type RunEventType =
	| 'run_started'
	| 'zone_started'
	| 'room_entered'
	| 'enemy_defeated'
	| 'item_collected'
	| 'item_discarded'
	| 'potion_used'
	| 'emblem_stacked'
	| 'guardian_defeated'
	| 'reward_selected'
	| 'zone_completed'
	| 'extraction_started'
	| 'run_finished';
export interface RunEvent {
	sequence: number;
	tick: number;
	type: RunEventType;
	zoneIndex: number;
	roomId?: string;
	payload: Record<string, unknown>;
	previousHash: string;
	hash: string;
}
export interface TimerState {
	remainingMs: number;
	phase: 'active' | 'collapse' | 'complete';
	collapseRemainingMs: number;
}
export interface ZoneState {
	zoneId: string;
	roomId: string;
	roomsCleared: string[];
	guardianDefeated: boolean;
	timer: TimerState;
}
export interface RunState {
	id: string;
	seed: number;
	weaponId: WeaponId;
	status: 'active' | 'won' | 'lost';
	zoneIndex: number;
	zone: ZoneState;
	rewards: string[];
	inventory: InventoryState;
	criticalBag: CriticalBagState;
	unsecuredLoot: LootEntry[];
}
export interface RunResult {
	runId: string;
	outcome: 'escaped' | 'guardian' | 'death' | 'collapse';
	elapsedMs: number;
	activePlayMs?: number;
	roomsCleared: number;
	zonesCleared?: number;
	enemiesDefeated: number;
	guardiansDefeated?: number;
	pvpVictories?: number;
	extractedLootValue?: number;
	timeRemainingMs?: number;
	acceptedRewardIds: string[];
	events?: RunEvent[];
	score?: ScoreBreakdown;
}

export interface RankingEntry {
	rank: number;
	playerId: string;
	displayName: string;
	score: number;
	roomsCleared: number;
	guardiansDefeated: number;
	activePlayMs: number;
}
export interface PublicProfile {
	player: {
		id: string;
		displayName: string;
		accountEmail: string | null;
		emailVerified: boolean;
		countryCode: string | null;
		regionCode: string | null;
		regionEffectiveAt: string | null;
	};
	stats: {
		bestScore: number;
		bestRooms: number;
		totalActivePlayMs: number;
		guardiansDefeated: number;
	};
	history: Array<{
		id: string;
		outcome: string | null;
		score: number;
		roomsCleared: number;
		elapsedMs: number;
		createdAt: string;
	}>;
	discoveredEmblems: string[];
}

export interface WsEnvelope<T = unknown> {
	version: number;
	type: string;
	requestId: string;
	sessionId: string;
	sequence: number;
	timestamp: number;
	payload: T;
}
export interface PlayerInputPayload {
	moveX: number;
	moveY: number;
	aimX: number;
	aimY: number;
	attack: boolean;
}
export interface PvpSnapshotPayload {
	matchId: string;
	tick: number;
	players: Array<{ sessionId: string; x: number; y: number; health: number; weaponId: WeaponId }>;
}
export interface PvpRoomPayload {
	matchId: string;
	seed: number;
	room: RoomDefinition;
	spawns: [TileCoord, TileCoord];
	players: [
		{ sessionId: string; playerId: string; weaponId: WeaponId },
		{ sessionId: string; playerId: string; weaponId: WeaponId },
	];
}

export function tileAt(grid: RoomGrid, x: number, y: number): TileId {
	return grid.tiles[y * grid.width + x] ?? 'void';
}
export function isSolidTile(tile: TileId): boolean {
	return (
		tile.startsWith('wall_') ||
		tile.startsWith('outer_') ||
		tile.startsWith('inner_') ||
		tile.startsWith('prop_') ||
		tile === 'pillar' ||
		tile === 'void' ||
		tile.endsWith('_closed')
	);
}
