import { SeededRng, deriveSeed, type RoomDefinition } from '@tmd/shared';

export interface AmbientLightAnchor {
	x: number;
	y: number;
}

/**
 * Picks stable, room-specific floor positions for the ambient godrays.
 * The same run seed and room always produce the same layout, while other rooms
 * and runs receive their own arrangement.
 */
export function selectAmbientLightAnchors(
	room: RoomDefinition,
	runSeed: number,
): AmbientLightAnchor[] {
	const rng = new SeededRng(deriveSeed(runSeed, `ambient-lights:${room.id}`));
	const candidates: AmbientLightAnchor[] = [];

	for (let y = 2; y < room.grid.height - 2; y++) {
		for (let x = 2; x < room.grid.width - 2; x++) {
			const tile = room.grid.tiles[y * room.grid.width + x];
			if (!tile?.startsWith('floor_')) continue;
			if (room.spawns.some((spawn) => Math.hypot(spawn.tile.x - x, spawn.tile.y - y) < 3))
				continue;
			candidates.push({ x, y });
		}
	}

	if (!candidates.length) return [];

	const targetCount = Math.min(rng.int(2, 3), candidates.length);
	const randomized = rng.shuffle(candidates);
	const selected: AmbientLightAnchor[] = [];
	for (const minimumSpacing of [4.5, 3, 1.5, 0]) {
		for (const candidate of randomized) {
			if (selected.length >= targetCount) break;
			if (
				!selected.some((light) => light.x === candidate.x && light.y === candidate.y) &&
				selected.every(
					(light) => Math.hypot(light.x - candidate.x, light.y - candidate.y) >= minimumSpacing,
				)
			)
				selected.push(candidate);
		}
		if (selected.length >= targetCount) break;
	}

	return selected;
}
