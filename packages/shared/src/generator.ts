import {
	CONTENT_VERSION,
	ROOM_HEIGHT,
	ROOM_WIDTH,
	SEED_VERSION,
	type Direction,
	type DungeonGraph,
	type GeneratedZone,
	type RoomDefinition,
	type RoomKind,
	type SeededRun,
	type TileId,
} from './types.js';
import { deriveSeed, SeededRng } from './rng.js';
import { ZONES } from './content.js';

const opposite: Record<Direction, Direction> = {
	north: 'south',
	east: 'west',
	south: 'north',
	west: 'east',
};
const doorTile: Record<Direction, { x: number; y: number }> = {
	north: { x: 10, y: 0 },
	south: { x: 10, y: 9 },
	west: { x: 0, y: 5 },
	east: { x: 19, y: 5 },
};
const kinds: RoomKind[] = ['combat', 'obstacle', 'combat', 'treasure', 'event'];

export function generateRun(seed: number): SeededRun {
	const zones = ZONES.map((definition, index) =>
		generateZone(deriveSeed(seed, 'zone', index), definition, index),
	);
	const first = zones[0]!;
	return {
		seed,
		seedVersion: SEED_VERSION,
		contentVersion: CONTENT_VERSION,
		graph: first.graph,
		rooms: first.rooms,
		zones,
	};
}

function generateZone(
	seed: number,
	definition: GeneratedZone['definition'],
	zoneIndex: number,
): GeneratedZone {
	const rng = new SeededRng(seed);
	const mainLength = rng.int(5, 7);
	const nodes: DungeonGraph['nodes'] = [];
	for (let depth = 0; depth < mainLength; depth++) {
		const kind: RoomKind =
			depth === 0 ? 'start' : depth === mainLength - 1 ? 'guardian' : rng.pick(kinds);
		nodes.push({ id: `z${zoneIndex}-room-${depth}`, kind, depth, links: [] });
		if (depth > 0) {
			nodes[depth - 1]!.links.push(`z${zoneIndex}-room-${depth}`);
			nodes[depth]!.links.push(`z${zoneIndex}-room-${depth - 1}`);
		}
	}
	const branchCount = rng.int(1, 2);
	for (let i = 0; i < branchCount; i++) {
		const parent = rng.int(1, mainLength - 2);
		const id = `z${zoneIndex}-branch-${i}`;
		const kind: RoomKind = i === 0 ? 'pvp' : 'reward';
		nodes.push({ id, kind, depth: parent + 1, links: [`z${zoneIndex}-room-${parent}`] });
		nodes[parent]!.links.push(id);
	}
	const graph: DungeonGraph = {
		startRoomId: `z${zoneIndex}-room-0`,
		guardianRoomId: `z${zoneIndex}-room-${mainLength - 1}`,
		nodes,
	};
	const rooms = nodes.map((node) => buildRoom(node.id, node.kind, node.links, rng));
	return { definition, graph, rooms };
}

function buildRoom(id: string, kind: RoomKind, links: string[], rng: SeededRng): RoomDefinition {
	const tiles: TileId[] = [];
	for (let y = 0; y < ROOM_HEIGHT; y++)
		for (let x = 0; x < ROOM_WIDTH; x++) {
			if (y === 0) tiles.push(x === 0 ? 'outer_nw' : x === ROOM_WIDTH - 1 ? 'outer_ne' : 'wall_n');
			else if (y === ROOM_HEIGHT - 1)
				tiles.push(x === 0 ? 'outer_sw' : x === ROOM_WIDTH - 1 ? 'outer_se' : 'wall_s');
			else if (x === 0) tiles.push('wall_w');
			else if (x === ROOM_WIDTH - 1) tiles.push('wall_e');
			else tiles.push(`floor_${rng.int(0, 5)}` as TileId);
		}
	const directions: Direction[] = ['west', 'east', 'north', 'south'];
	const doors = links.map((targetRoomId, index) => {
		const direction = directions[index % 4]!;
		const tile = doorTile[direction];
		tiles[tile.y * ROOM_WIDTH + tile.x] =
			direction === 'north' || direction === 'south' ? 'door_v_open' : 'door_h_open';
		return { direction, targetRoomId, tile };
	});
	const spawns: RoomDefinition['spawns'] = [];
	if (kind === 'start') spawns.push({ id: `${id}-player`, kind: 'player', tile: { x: 10, y: 5 } });
	if (kind === 'guardian')
		spawns.push({
			id: `${id}-guardian`,
			kind: 'guardian',
			enemyId: 'chronarch',
			tile: { x: 10, y: 4 },
		});
	if (['combat', 'obstacle', 'treasure', 'event'].includes(kind)) {
		const count = kind === 'combat' ? rng.int(3, 5) : rng.int(1, 3);
		const roster = ['wretch', 'acolyte', 'hulker'];
		for (let i = 0; i < count; i++)
			spawns.push({
				id: `${id}-enemy-${i}`,
				kind: 'enemy',
				enemyId: rng.pick(roster),
				tile: { x: rng.int(3, 16), y: rng.int(2, 7) },
			});
	}
	if (kind === 'pvp') spawns.push({ id: `${id}-pvp`, kind: 'pvp', tile: { x: 10, y: 4 } });
	if (kind === 'reward') spawns.push({ id: `${id}-reward`, kind: 'reward', tile: { x: 10, y: 4 } });
	const template = rng.int(0, 2);
	for (const point of templateObstacles(kind, template))
		if (!spawns.some((s) => s.tile.x === point.x && s.tile.y === point.y)) {
			const mirroredX = kind === 'pvp' ? Math.min(point.x, ROOM_WIDTH - 1 - point.x) : point.x;
			tiles[point.y * ROOM_WIDTH + point.x] = point.pillar
				? 'pillar'
				: (`prop_${(mirroredX + point.y + template) % 6}` as TileId);
		}
	const obstacleCount = kind === 'obstacle' ? 8 : kind === 'pvp' ? 0 : rng.int(0, 3);
	for (let i = 0; i < obstacleCount; i++) {
		const x = rng.int(3, 16),
			y = rng.int(2, 7);
		if (!spawns.some((s) => s.tile.x === x && s.tile.y === y))
			tiles[y * ROOM_WIDTH + x] =
				rng.next() < 0.28 ? 'pillar' : (`prop_${rng.int(0, 5)}` as TileId);
	}
	return { id, kind, grid: { width: ROOM_WIDTH, height: ROOM_HEIGHT, tiles }, doors, spawns };
}

function templateObstacles(
	kind: RoomKind,
	variant: number,
): Array<{ x: number; y: number; pillar?: boolean }> {
	if (kind === 'start' || kind === 'reward') return [];
	if (kind === 'pvp')
		return variant === 0
			? [
					{ x: 7, y: 3, pillar: true },
					{ x: 12, y: 3, pillar: true },
					{ x: 7, y: 6, pillar: true },
					{ x: 12, y: 6, pillar: true },
				]
			: variant === 1
				? [
						{ x: 8, y: 3 },
						{ x: 11, y: 3 },
						{ x: 8, y: 6 },
						{ x: 11, y: 6 },
					]
				: [
						{ x: 6, y: 4, pillar: true },
						{ x: 13, y: 4, pillar: true },
						{ x: 6, y: 5, pillar: true },
						{ x: 13, y: 5, pillar: true },
					];
	if (kind === 'guardian')
		return variant === 0
			? [
					{ x: 5, y: 3, pillar: true },
					{ x: 14, y: 3, pillar: true },
					{ x: 5, y: 7, pillar: true },
					{ x: 14, y: 7, pillar: true },
				]
			: variant === 1
				? [
						{ x: 4, y: 5, pillar: true },
						{ x: 15, y: 5, pillar: true },
					]
				: [
						{ x: 7, y: 3 },
						{ x: 12, y: 3 },
						{ x: 7, y: 7 },
						{ x: 12, y: 7 },
					];
	if (kind === 'obstacle')
		return variant === 0
			? [
					{ x: 6, y: 3 },
					{ x: 6, y: 4 },
					{ x: 13, y: 6 },
					{ x: 13, y: 7 },
				]
			: variant === 1
				? [
						{ x: 5, y: 3, pillar: true },
						{ x: 10, y: 3, pillar: true },
						{ x: 15, y: 3, pillar: true },
						{ x: 5, y: 7, pillar: true },
						{ x: 10, y: 7, pillar: true },
						{ x: 15, y: 7, pillar: true },
					]
				: [
						{ x: 8, y: 2 },
						{ x: 8, y: 3 },
						{ x: 11, y: 6 },
						{ x: 11, y: 7 },
					];
	return variant === 0
		? [
				{ x: 6, y: 3 },
				{ x: 13, y: 7 },
			]
		: variant === 1
			? [
					{ x: 5, y: 6, pillar: true },
					{ x: 14, y: 4, pillar: true },
				]
			: [
					{ x: 8, y: 3 },
					{ x: 11, y: 7 },
				];
}

export function validateRun(run: SeededRun): string[] {
	const errors: string[] = [];
	for (const zone of run.zones.length
		? run.zones
		: [{ definition: run.zones[0]!.definition, graph: run.graph, rooms: run.rooms }]) {
		const byId = new Map(zone.graph.nodes.map((n) => [n.id, n]));
		const seen = new Set<string>();
		const queue = [zone.graph.startRoomId];
		while (queue.length) {
			const id = queue.shift()!;
			if (seen.has(id)) continue;
			seen.add(id);
			byId.get(id)?.links.forEach((link) => queue.push(link));
		}
		if (!seen.has(zone.graph.guardianRoomId))
			errors.push(`${zone.definition.id}:guardian_unreachable`);
		for (const room of zone.rooms) {
			if (room.grid.width > ROOM_WIDTH || room.grid.height > ROOM_HEIGHT)
				errors.push(`${room.id}:oversized`);
			if (room.grid.tiles.length !== room.grid.width * room.grid.height)
				errors.push(`${room.id}:invalid_grid`);
			for (const spawn of room.spawns)
				if (isBlocked(room.grid.tiles[spawn.tile.y * room.grid.width + spawn.tile.x]!))
					errors.push(`${room.id}:${spawn.id}:blocked_spawn`);
		}
	}
	return errors;
}
function isBlocked(tile: TileId) {
	return (
		tile === 'void' ||
		tile === 'pillar' ||
		tile.startsWith('wall_') ||
		tile.startsWith('outer_') ||
		tile.startsWith('inner_') ||
		tile.startsWith('prop_') ||
		tile.endsWith('_closed')
	);
}
