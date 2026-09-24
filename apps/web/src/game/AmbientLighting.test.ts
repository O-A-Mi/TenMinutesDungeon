import { describe, expect, it } from 'vitest';
import type { RoomDefinition, TileId } from '@tmd/shared';
import { selectAmbientLightAnchors } from './AmbientLighting';

function openRoom(id: string): RoomDefinition {
	const width = 20;
	const height = 10;
	return {
		id,
		kind: 'combat',
		grid: { width, height, tiles: Array<TileId>(width * height).fill('floor_0') },
		doors: [],
		spawns: [{ id: `${id}-enemy`, kind: 'enemy', tile: { x: 10, y: 5 } }],
	};
}

describe('selectAmbientLightAnchors', () => {
	it('is deterministic per run and room while varying between rooms', () => {
		const firstRoom = openRoom('z0-room-1');
		const sameRoomAgain = openRoom('z0-room-1');
		const otherRoom = openRoom('z0-room-2');

		const first = selectAmbientLightAnchors(firstRoom, 48291);
		expect(selectAmbientLightAnchors(sameRoomAgain, 48291)).toEqual(first);
		expect(selectAmbientLightAnchors(otherRoom, 48291)).not.toEqual(first);
		expect(selectAmbientLightAnchors(firstRoom, 48292)).not.toEqual(first);
	});

	it('keeps lights on floor tiles, inside the room, and away from spawns', () => {
		const room = openRoom('z0-room-1');
		const anchors = selectAmbientLightAnchors(room, 48291);

		expect(anchors.length).toBeGreaterThanOrEqual(2);
		expect(anchors.length).toBeLessThanOrEqual(3);
		for (const anchor of anchors) {
			expect(anchor.x).toBeGreaterThanOrEqual(2);
			expect(anchor.x).toBeLessThan(room.grid.width - 2);
			expect(anchor.y).toBeGreaterThanOrEqual(2);
			expect(anchor.y).toBeLessThan(room.grid.height - 2);
			expect(room.grid.tiles[anchor.y * room.grid.width + anchor.x]).toMatch(/^floor_/);
			expect(Math.hypot(anchor.x - 10, anchor.y - 5)).toBeGreaterThanOrEqual(3);
		}
	});
});
