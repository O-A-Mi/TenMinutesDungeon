import { describe, expect, it } from 'vitest';
import type { TilesetManifest } from '@tmd/shared';
import { findOccupiedTiles, isOptionalOverlay } from './TileOccupancy';

describe('tileset occupancy', () => {
	it('detects visible cells and ignores fully transparent cells', () => {
		const pixels = new Uint8ClampedArray(64 * 32 * 4);
		pixels[(3 * 64 + 35) * 4 + 3] = 255;
		const manifest = {
			prop_0: { column: 0, row: 0 },
			prop_1: { column: 1, row: 0 },
		} as unknown as TilesetManifest;
		const occupied = findOccupiedTiles(pixels, 64, 32, manifest);
		expect(occupied.has('prop_0')).toBe(false);
		expect(occupied.has('prop_1')).toBe(true);
	});

	it('classifies props, decorations and pillars as optional overlays', () => {
		expect(isOptionalOverlay('prop_3')).toBe(true);
		expect(isOptionalOverlay('deco_1')).toBe(true);
		expect(isOptionalOverlay('pillar')).toBe(true);
		expect(isOptionalOverlay('wall_n')).toBe(false);
	});
});
