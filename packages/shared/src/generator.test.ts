import { describe, expect, it } from 'vitest';
import { generateRun, validateRun } from './generator.js';
import { ROOM_HEIGHT, ROOM_WIDTH, isSolidTile, tileAt } from './types.js';

describe('procedural dungeon', () => {
	it('is deterministic for the same seed', () => {
		expect(generateRun(4242)).toEqual(generateRun(4242));
	});
	it('creates a valid route for hundreds of seeds', () => {
		for (let seed = 1; seed <= 500; seed++) {
			const run = generateRun(seed);
			expect(validateRun(run), `seed ${seed}`).toEqual([]);
			expect(run.rooms.length).toBeGreaterThanOrEqual(6);
			expect(run.rooms.length).toBeLessThanOrEqual(9);
		}
	});
	it('keeps every room inside 20x10', () => {
		const run = generateRun(91);
		for (const room of run.rooms) {
			expect(room.grid.width).toBe(ROOM_WIDTH);
			expect(room.grid.height).toBe(ROOM_HEIGHT);
			expect(room.grid.tiles).toHaveLength(ROOM_WIDTH * ROOM_HEIGHT);
		}
	});
	it('keeps spawns on walkable cells', () => {
		for (let seed = 1; seed <= 100; seed++) {
			for (const room of generateRun(seed).rooms) {
				for (const spawn of room.spawns)
					expect(
						isSolidTile(tileAt(room.grid, spawn.tile.x, spawn.tile.y)),
						`${seed}:${room.id}`,
					).toBe(false);
			}
		}
	});
	it('builds a mirrored obstacle layout for both duelists in shared PvP rooms', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const room = generateRun(seed).zones[0]!.rooms.find((candidate) => candidate.kind === 'pvp')!;
			for (let y = 1; y < ROOM_HEIGHT - 1; y++)
				for (let x = 1; x < ROOM_WIDTH / 2; x++) {
					const left = tileAt(room.grid, x, y),
						right = tileAt(room.grid, ROOM_WIDTH - 1 - x, y),
						leftObstacle = left.startsWith('prop_') || left === 'pillar',
						rightObstacle = right.startsWith('prop_') || right === 'pillar';
					expect(rightObstacle, `${seed}:${x},${y}`).toBe(leftObstacle);
					if (leftObstacle) expect(right).toBe(left);
				}
		}
	});
});
