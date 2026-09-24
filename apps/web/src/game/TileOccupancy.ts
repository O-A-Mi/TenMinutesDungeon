import { TILE_SIZE, type TileId, type TilesetManifest } from '@tmd/shared';

export function findOccupiedTiles(
	pixels: Uint8ClampedArray,
	imageWidth: number,
	imageHeight: number,
	manifest: TilesetManifest,
): Set<TileId> {
	const occupied = new Set<TileId>();
	for (const [id, cell] of Object.entries(manifest) as [
		TileId,
		{ column: number; row: number },
	][]) {
		const startX = cell.column * TILE_SIZE;
		const startY = cell.row * TILE_SIZE;
		const endX = Math.min(startX + TILE_SIZE, imageWidth);
		const endY = Math.min(startY + TILE_SIZE, imageHeight);
		scan: for (let y = startY; y < endY; y++) {
			for (let x = startX; x < endX; x++) {
				if (pixels[(y * imageWidth + x) * 4 + 3]! > 0) {
					occupied.add(id);
					break scan;
				}
			}
		}
	}
	return occupied;
}

export async function inspectTilesetOccupancy(
	url: string,
	manifest: TilesetManifest,
): Promise<Set<TileId>> {
	const image = new Image();
	image.src = url;
	await image.decode();
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('tileset_pixel_context_unavailable');
	context.drawImage(image, 0, 0);
	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	return findOccupiedTiles(imageData.data, canvas.width, canvas.height, manifest);
}

export function isOptionalOverlay(tile: TileId): boolean {
	return tile.startsWith('prop_') || tile.startsWith('deco_') || tile === 'pillar';
}
