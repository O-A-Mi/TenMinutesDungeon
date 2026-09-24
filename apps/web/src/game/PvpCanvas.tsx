import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import {
	CRYPT_ZONE,
	ROOM_HEIGHT,
	ROOM_WIDTH,
	TILE_SIZE,
	TILESET_MANIFEST,
	tileAt,
	type PvpRoomPayload,
	type PvpSnapshotPayload,
	type TileId,
} from '@tmd/shared';
import { CharacterView } from './CharacterView';
import { PaletteFilter } from './PaletteFilter';

interface FighterView {
	body: CharacterView;
	bar: Graphics;
	x: number;
	y: number;
}
export function PvpCanvas({
	roomData,
	snapshot,
	ownSessionId,
	onAim,
}: {
	roomData: PvpRoomPayload;
	snapshot: PvpSnapshotPayload | null;
	ownSessionId: string;
	onAim: (x: number, y: number) => void;
}) {
	const host = useRef<HTMLDivElement>(null),
		snapshotRef = useRef(snapshot),
		actors = useRef(new Map<string, FighterView>());
	useEffect(() => {
		snapshotRef.current = snapshot;
	}, [snapshot]);
	useEffect(() => {
		let disposed = false;
		let app: Application | undefined;
		let ticker: (() => void) | undefined;
		const mount = async () => {
			if (!host.current) return;
			app = new Application();
			await app.init({
				width: ROOM_WIDTH * TILE_SIZE,
				height: ROOM_HEIGHT * TILE_SIZE,
				background: CRYPT_ZONE.palette.shadow,
				antialias: false,
				resolution: 1,
				autoDensity: false,
				preference: 'webgl',
			});
			if (disposed) {
				app.destroy(true, { children: true });
				return;
			}
			app.canvas.setAttribute('aria-label', 'Arena PvP na sala da cripta');
			app.canvas.style.imageRendering = 'pixelated';
			host.current.appendChild(app.canvas);
			const world = new Container();
			world.filters = [new PaletteFilter(CRYPT_ZONE.palette)];
			app.stage.addChild(world);
			const atlas = await Assets.load<Texture>('/tilesets/tileset_dungeon_1.png');
			if (disposed) {
				app.destroy(true, { children: true });
				return;
			}
			atlas.source.scaleMode = 'nearest';
			const underlay = new Graphics(),
				floors: Sprite[] = [],
				overlays: Sprite[] = [];
			for (let y = 0; y < roomData.room.grid.height; y++)
				for (let x = 0; x < roomData.room.grid.width; x++) {
					const tile = tileAt(roomData.room.grid, x, y),
						px = x * TILE_SIZE,
						py = y * TILE_SIZE;
					underlay.rect(px, py, TILE_SIZE, TILE_SIZE).fill(CRYPT_ZONE.palette.dark);
					if (tile === 'void') continue;
					const floorId = (
						tile.startsWith('floor_') ? tile : `floor_${(x * 11 + y * 7) % 6}`
					) as TileId;
					const floorCell = TILESET_MANIFEST[floorId];
					const floor = new Sprite(
						new Texture({
							source: atlas.source,
							frame: new Rectangle(
								floorCell.column * TILE_SIZE,
								floorCell.row * TILE_SIZE,
								TILE_SIZE,
								TILE_SIZE,
							),
						}),
					);
					floor.position.set(px, py);
					floor.roundPixels = true;
					floors.push(floor);
					if (!tile.startsWith('floor_')) {
						const cell = TILESET_MANIFEST[tile];
						const overlay = new Sprite(
							new Texture({
								source: atlas.source,
								frame: new Rectangle(
									cell.column * TILE_SIZE,
									cell.row * TILE_SIZE,
									TILE_SIZE,
									TILE_SIZE,
								),
							}),
						);
						overlay.position.set(px, py);
						overlay.roundPixels = true;
						overlays.push(overlay);
					}
				}
			world.addChild(underlay, ...floors, ...overlays);
			const actorLayer = new Container();
			world.addChild(actorLayer);
			for (const player of roomData.players) {
				const body = new CharacterView(player.sessionId === ownSessionId ? 0xd9b36c : 0xa85952, 25);
				const bar = new Graphics();
				body.addChild(bar);
				const spawn =
					roomData.spawns[roomData.players.findIndex((p) => p.sessionId === player.sessionId)]!;
				body.position.set((spawn.x + 0.5) * TILE_SIZE, (spawn.y + 0.5) * TILE_SIZE);
				actorLayer.addChild(body);
				actors.current.set(player.sessionId, { body, bar, x: body.x, y: body.y });
			}
			ticker = () => {
				const dt = app!.ticker.deltaMS / 1000;
				const state = snapshotRef.current;
				if (!state) return;
				for (const player of state.players) {
					const actor = actors.current.get(player.sessionId);
					if (!actor) continue;
					const moving = Math.hypot(player.x - actor.x, player.y - actor.y) > 1;
					actor.x = player.x;
					actor.y = player.y;
					actor.body.position.set(Math.round(player.x), Math.round(player.y));
					actor.body.animate(dt, moving);
					actor.bar
						.clear()
						.rect(-16, -35, 32, 4)
						.fill(0x130e12)
						.rect(-15, -34, (30 * Math.max(0, player.health)) / 100, 2)
						.fill(player.sessionId === ownSessionId ? 0xd9b36c : 0xb74c4b);
				}
			};
			app.ticker.add(ticker);
		};
		void mount().catch(() => {});
		return () => {
			disposed = true;
			if (app && ticker) app.ticker.remove(ticker);
			actors.current.clear();
			if (app?.renderer) app.destroy(true, { children: true });
		};
	}, [roomData, ownSessionId]);
	return (
		<div
			ref={host}
			className="pvp-pixi-host"
			onPointerMove={(event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				onAim(
					Math.max(
						0,
						Math.min(
							ROOM_WIDTH * TILE_SIZE,
							((event.clientX - rect.left) / rect.width) * ROOM_WIDTH * TILE_SIZE,
						),
					),
					Math.max(
						0,
						Math.min(
							ROOM_HEIGHT * TILE_SIZE,
							((event.clientY - rect.top) / rect.height) * ROOM_HEIGHT * TILE_SIZE,
						),
					),
				);
			}}
		/>
	);
}
