import {
	Application,
	Assets,
	Container,
	Graphics,
	Rectangle,
	Sprite,
	Text,
	Texture,
} from 'pixi.js';
import {
	BLUNDERBUSS_EMBLEM_CRIT_CHANCE,
	CriticalBag,
	CRYPT_ZONE,
	EMBLEMS,
	ENEMIES,
	PROP_MATERIALS,
	ROOM_HEIGHT,
	ROOM_WIDTH,
	TILESET_MANIFEST,
	TILE_SIZE,
	WEAPONS,
	deriveSeed,
	decisionIntervalSeconds,
	emblemTier,
	findEmblem,
	isSolidTile,
	scaleEnemyForZone,
	selectEnemyAttack,
	tileAt,
	type EnemyDefinition,
	type EnemyAttackDefinition,
	type RoomDefinition,
	type SeededRun,
	type TileId,
	type WeaponDefinition,
	type WeaponId,
} from '@tmd/shared';
import { Input } from './Input';
import { CharacterView } from './CharacterView';
import { inspectTilesetOccupancy, isOptionalOverlay } from './TileOccupancy';
import {
	canAutoPickupKnife,
	isKnifePickupReady,
	knifePickupProgress,
	KNIFE_PICKUP_DELAY_MS,
} from './ProjectileRecovery';
import type { GameCallbacks, HudSnapshot } from './types';
import { PaletteFilter } from './PaletteFilter';
import { findGridPath } from './GridPathfinder';
import { selectAmbientLightAnchors } from './AmbientLighting';

interface Actor {
	id: string;
	x: number;
	y: number;
	health: number;
	maxHealth: number;
	radius: number;
	view: CharacterView;
	bar: Graphics;
	definition: EnemyDefinition;
	cooldown: number;
	dead?: boolean;
	damaged?: boolean;
	pathClock: number;
	path: { x: number; y: number }[];
	knockbackX: number;
	knockbackY: number;
	staggerMs: number;
	abilityCooldownMs: number;
	pendingAttack?: {
		attack: EnemyAttackDefinition;
		remainingMs: number;
		targetX: number;
		targetY: number;
		marker: Graphics;
	};
}
interface Projectile {
	x: number;
	y: number;
	vx: number;
	vy: number;
	damage: number;
	life: number;
	bounces: number;
	maxBounces: number;
	owner: 'player' | 'enemy';
	view: Graphics;
	trailView?: Graphics;
	trail: ProjectileTrailPoint[];
	lastTrailX: number;
	lastTrailY: number;
	rotation: number;
	indicator?: Container;
	indicatorRing?: Graphics;
	indicatorLabel?: Text;
	critical: boolean;
	knife?: boolean;
	returning?: boolean;
	hitIds?: Set<string>;
	landedAt?: number;
	distance: number;
	maxDistance: number;
	propInteraction: 'block' | 'damage-and-continue' | 'ignore';
	distanceDamageBonus?: number;
}
interface ProjectileTrailPoint {
	x: number;
	y: number;
	rotation: number;
	age: number;
}
interface DamageLabel {
	targetId: string;
	view: Text;
	amount: number;
	critical: boolean;
	elapsed: number;
	duration: number;
}
interface Destructible {
	index: number;
	tile: TileId;
	x: number;
	y: number;
	health: number;
	maxHealth: number;
	sprite: Sprite;
	cracks: Graphics;
	debrisColor: number;
}
interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	gravity: number;
	spin: number;
	view: Graphics;
}
interface GameOptions {
	weaponId: WeaponId;
	dungeon: SeededRun;
	callbacks: GameCallbacks;
	timerSeconds?: number;
	emblemIds: string[];
	reduceFlashes?: boolean;
	showRangeGuide?: boolean;
	zoneIndex: number;
}

interface StoredKnife {
	x: number;
	y: number;
	landedAt: number;
}
interface FallingRock {
	x: number;
	y: number;
	targetY: number;
	damage: number;
	knockdownMs: number;
	view: Graphics;
}

const VIEW_WIDTH = ROOM_WIDTH * TILE_SIZE;
const VIEW_HEIGHT = ROOM_HEIGHT * TILE_SIZE;
const CAMERA_ZOOM = 1.5;
const CAMERA_FOLLOW = 7.5;

function drawPixelLightDisc(
	graphics: Graphics,
	cx: number,
	cy: number,
	radius: number,
	color: number,
	alpha: number,
) {
	const pixelSize = 4;
	const snappedRadius = Math.max(pixelSize, Math.floor(radius / pixelSize) * pixelSize);
	const diameter = snappedRadius * 2;
	for (let y = 0; y < diameter; y += pixelSize) {
		const centerY = y + pixelSize / 2 - snappedRadius;
		const extent = Math.sqrt(Math.max(0, snappedRadius ** 2 - centerY ** 2));
		const width = Math.min(
			diameter,
			Math.max(pixelSize, Math.round((extent * 2) / pixelSize) * pixelSize),
		);
		graphics.rect(cx - width / 2, cy - snappedRadius + y, width, pixelSize).fill({ color, alpha });
	}
}

export class GameEngine {
	app = new Application();
	input = new Input();
	root = new Container();
	world = new Container();
	floorLighting = new Container();
	effects = new Container();
	playerView = new CharacterView(0xd9b36c, 25);
	player = { x: 320, y: 160, health: 100, maxHealth: 100, radius: 13, cooldown: 0 };
	enemies: Actor[] = [];
	projectiles: Projectile[] = [];
	currentRoom!: RoomDefinition;
	currentRoomId = '';
	roomVisited = new Set<string>();
	kills = 0;
	elapsed = 0;
	remainingMs = 600_000;
	collapseMs = 30_000;
	phase: 'active' | 'collapse' | 'complete' = 'active';
	paused = false;
	disposed = false;
	initialized = false;
	accumulator = 0;
	lastTime = 0;
	interactionLatch = false;
	hudClock = 0;
	private camera = { x: 320, y: 160 };
	private tileTextures = new Map<TileId, Texture>();
	private occupiedTiles = new Set<TileId>();
	private criticalBag: CriticalBag;
	private knifeProjectile: Projectile | null = null;
	private transitioning = false;
	private crosshair = new Graphics();
	private rangeGuide = new Graphics();
	private combatInputLocked = false;
	private damageLabels: DamageLabel[] = [];
	private destructibles = new Map<number, Destructible>();
	private particles: Particle[] = [];
	private particlePool: Graphics[] = [];
	private effectTimers = new Set<ReturnType<typeof setTimeout>>();
	private shakeMs = 0;
	private shakeStrength = 0;
	private bossActor: Actor | null = null;
	private bossCollapseMs = 0;
	private bossCollapseElapsed = 0;
	private bossRays: Graphics | null = null;
	private bossRewardTriggered = false;
	private ambientDust: Graphics[] = [];
	private ambientLightAreas: { x: number; y: number; radius: number }[] = [];
	private droppedKnives = new Map<string, StoredKnife>();
	private knockedDownMs = 0;
	private recoilMs = 0;
	private fallingRocks: FallingRock[] = [];
	weapon: WeaponDefinition;
	readonly opts;
	constructor(opts: GameOptions) {
		this.opts = opts;
		this.weapon = buildWeapon(opts.weaponId, opts.emblemIds);
		this.player.maxHealth = this.weapon.maxHealth;
		this.player.health = this.weapon.maxHealth;
		this.remainingMs = (opts.timerSeconds ?? CRYPT_ZONE.durationSeconds) * 1000;
		this.criticalBag = new CriticalBag(
			deriveSeed(opts.dungeon.seed, 'critical'),
			this.weapon.critChance,
		);
	}
	async mount(host: HTMLElement) {
		const palette = this.opts.dungeon.zones[0]?.definition.palette ?? CRYPT_ZONE.palette;
		await this.app.init({
			width: VIEW_WIDTH,
			height: VIEW_HEIGHT,
			background: palette.shadow,
			antialias: false,
			resolution: 1,
			autoDensity: false,
			preference: 'webgl',
		});
		this.initialized = true;
		if (this.disposed) {
			this.app.destroy(true, { children: true });
			return;
		}
		await this.loadTileset();
		if (this.disposed) {
			this.app.destroy(true, { children: true });
			return;
		}
		this.app.canvas.setAttribute('aria-label', 'Sala da Cripta do Horologista');
		this.app.canvas.style.imageRendering = 'pixelated';
		this.app.canvas.tabIndex = 0;
		host.appendChild(this.app.canvas);
		this.app.stage.addChild(this.root);
		this.root.addChild(
			this.world,
			this.floorLighting,
			this.effects,
			this.rangeGuide,
			this.playerView,
			this.crosshair,
		);
		this.world.filters = [new PaletteFilter(palette)];
		this.effects.filters = [new PaletteFilter(palette)];
		this.root.scale.set(CAMERA_ZOOM);
		this.root.position.set(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
		this.root.pivot.set(this.camera.x, this.camera.y);
		this.input.attach(this.app.canvas);
		this.loadRoom(this.opts.dungeon.graph.startRoomId);
		this.lastTime = performance.now();
		this.app.ticker.add(() => this.frame(performance.now()));
		window.addEventListener('keydown', this.keyHandler);
	}
	private keyHandler = (e: KeyboardEvent) => {
		if (e.code === 'Escape') {
			this.paused = !this.paused;
			this.opts.callbacks.onPause();
		}
		if (e.code === 'KeyE') void this.interact();
		if (e.code === 'KeyR') this.recallKnife();
		if (e.code === 'KeyQ' && this.opts.callbacks.onUsePotion?.())
			this.player.health = Math.min(this.player.maxHealth, this.player.health + 35);
		if (e.code === 'Tab') {
			e.preventDefault();
			this.opts.callbacks.onInventory?.();
		}
	};
	setPaused(value: boolean) {
		this.paused = value;
	}
	setReduceFlashes(value: boolean) {
		this.opts.reduceFlashes = value;
	}
	setShowRangeGuide(value: boolean) {
		this.opts.showRangeGuide = value;
	}
	setCallbacks(callbacks: GameCallbacks) {
		this.opts.callbacks = callbacks;
	}
	setEmblems(ids: string[]) {
		this.opts.emblemIds = [...ids];
		const previousMax = this.player.maxHealth;
		this.weapon = buildWeapon(this.opts.weaponId, ids);
		this.player.maxHealth = this.weapon.maxHealth;
		this.player.health = Math.min(
			this.player.maxHealth,
			this.player.health + this.player.maxHealth - previousMax,
		);
		this.criticalBag.setChance(this.weapon.critChance);
	}
	setCombatInputLocked(value: boolean) {
		this.combatInputLocked = value;
	}
	destroy() {
		this.disposed = true;
		window.removeEventListener('keydown', this.keyHandler);
		this.clearEffectTimers();
		this.particlePool.forEach((view) => view.destroy());
		this.particlePool = [];
		this.particles = [];
		if (this.initialized) {
			this.input.detach(this.app.canvas);
			this.app.destroy(true, { children: true });
			this.initialized = false;
		}
	}
	private async loadTileset() {
		const url = '/tilesets/tileset_dungeon_1.png';
		const [atlas, occupied] = await Promise.all([
			Assets.load<Texture>(url),
			inspectTilesetOccupancy(url, TILESET_MANIFEST),
		]);
		this.occupiedTiles = occupied;
		atlas.source.scaleMode = 'nearest';
		for (const [id, cell] of Object.entries(TILESET_MANIFEST) as [
			TileId,
			{ column: number; row: number },
		][]) {
			this.tileTextures.set(
				id,
				new Texture({
					source: atlas.source,
					frame: new Rectangle(cell.column * TILE_SIZE, cell.row * TILE_SIZE, TILE_SIZE, TILE_SIZE),
				}),
			);
		}
	}
	private updateCamera(dt: number) {
		const halfWidth = VIEW_WIDTH / (2 * CAMERA_ZOOM),
			halfHeight = VIEW_HEIGHT / (2 * CAMERA_ZOOM);
		const aimX = (this.input.mouse.x - VIEW_WIDTH / 2) / CAMERA_ZOOM + this.camera.x,
			aimY = (this.input.mouse.y - VIEW_HEIGHT / 2) / CAMERA_ZOOM + this.camera.y;
		const dx = aimX - this.player.x,
			dy = aimY - this.player.y,
			d = Math.hypot(dx, dy) || 1;
		const strength = this.weapon.id === 'sword' ? 0.1 : 0.2;
		const lookX = (dx / d) * Math.min(VIEW_WIDTH * strength, d * 0.28),
			lookY = (dy / d) * Math.min(VIEW_HEIGHT * strength, d * 0.28);
		const targetX = Math.max(halfWidth, Math.min(VIEW_WIDTH - halfWidth, this.player.x + lookX));
		const targetY = Math.max(halfHeight, Math.min(VIEW_HEIGHT - halfHeight, this.player.y + lookY));
		const blend = 1 - Math.exp(-CAMERA_FOLLOW * dt);
		this.camera.x += (targetX - this.camera.x) * blend;
		this.camera.y += (targetY - this.camera.y) * blend;
		if (this.weapon.id !== 'sword') {
			this.crosshair
				.clear()
				.circle(0, 0, 6)
				.stroke({ color: 0xf4f1e9, width: 1 })
				.moveTo(-10, 0)
				.lineTo(-4, 0)
				.moveTo(4, 0)
				.lineTo(10, 0)
				.moveTo(0, -10)
				.lineTo(0, -4)
				.moveTo(0, 4)
				.lineTo(0, 10)
				.stroke({ color: 0xa83f3f, width: 1 });
			this.crosshair.position.set(aimX, aimY);
			this.crosshair.visible = true;
		} else this.crosshair.visible = false;
		this.rangeGuide.clear();
		if (this.weapon.id === 'blunderbuss' && this.opts.showRangeGuide !== false) {
			const angle = Math.atan2(dy, dx);
			const half = (this.weapon.spreadDegrees * Math.PI) / 360;
			const range = this.weapon.range;
			const ax = this.player.x + Math.cos(angle - half) * range;
			const ay = this.player.y + Math.sin(angle - half) * range;
			const bx = this.player.x + Math.cos(angle + half) * range;
			const by = this.player.y + Math.sin(angle + half) * range;
			this.rangeGuide
				.moveTo(this.player.x, this.player.y)
				.lineTo(Math.round(ax), Math.round(ay))
				.moveTo(this.player.x, this.player.y)
				.lineTo(Math.round(bx), Math.round(by))
				.arc(this.player.x, this.player.y, range, angle - half, angle + half)
				.stroke({ color: 0xf2d89b, width: 1, alpha: 0.48 });
			this.rangeGuide.visible = true;
		} else this.rangeGuide.visible = false;
	}
	private frame(now: number) {
		if (this.disposed) return;
		const delta = Math.min(100, now - this.lastTime);
		this.lastTime = now;
		if (this.paused) return;
		this.accumulator += delta;
		while (this.accumulator >= 1000 / 60) {
			this.update(1 / 60);
			this.accumulator -= 1000 / 60;
		}
		this.render();
	}
	private update(dt: number) {
		this.elapsed += dt * 1000;
		this.updateDamageLabels(dt);
		this.updateAmbientDust(dt);
		if (this.bossCollapseMs > 0) {
			this.bossCollapseMs = Math.max(0, this.bossCollapseMs - dt * 1000);
			this.bossCollapseElapsed += dt;
			const progress = 1 - this.bossCollapseMs / 1500;
			if (this.bossActor) {
				this.bossActor.view.animate(dt, false);
				this.bossActor.view.position.set(
					Math.round(this.bossActor.x),
					Math.round(this.bossActor.y),
				);
			}
			if (this.bossRays) {
				this.bossRays.alpha = Math.max(0.08, 1 - progress * 0.8);
				this.bossRays.scale.set(0.25 + progress * 1.25);
				this.bossRays.rotation += dt * 0.18;
			}
			if (this.bossCollapseMs === 0 && !this.bossRewardTriggered) {
				this.bossRewardTriggered = true;
				if (this.bossActor) this.bossActor.view.visible = false;
				this.bossRays?.destroy();
				this.bossRays = null;
				this.bossActor = null;
				this.opts.callbacks.onReward();
			}
			this.hudClock += dt;
			if (this.hudClock > 0.08) {
				this.hudClock = 0;
				this.emitHud();
			}
			return;
		}
		if (this.phase === 'active') {
			this.remainingMs = Math.max(0, this.remainingMs - dt * 1000);
			if (this.remainingMs <= 0) this.phase = 'collapse';
		} else if (this.phase === 'collapse') {
			this.collapseMs = Math.max(0, this.collapseMs - dt * 1000);
			if (this.collapseMs <= 0) {
				this.phase = 'complete';
				this.opts.callbacks.onResult(this.result('collapse'));
			}
		}
		const axis = this.input.axis(),
			mag = Math.hypot(axis.x, axis.y) || 1,
			moving = this.knockedDownMs <= 0 && (axis.x !== 0 || axis.y !== 0);
		this.knockedDownMs = Math.max(0, this.knockedDownMs - dt * 1000);
		const speed = this.weapon.moveSpeed * dt;
		const nx = this.player.x + (axis.x / mag) * speed,
			ny = this.player.y + (axis.y / mag) * speed;
		if (this.knockedDownMs <= 0) {
			if (!this.blocked(nx, this.player.y, this.player.radius)) this.player.x = nx;
			if (!this.blocked(this.player.x, ny, this.player.radius)) this.player.y = ny;
		}
		this.player.cooldown = Math.max(0, this.player.cooldown - dt * 1000);
		if (
			!this.combatInputLocked &&
			this.knockedDownMs <= 0 &&
			this.input.mouse.down &&
			this.player.cooldown <= 0
		)
			this.attack();
		for (const enemy of this.enemies) {
			if (enemy.dead) continue;
			this.updateEnemyKnockback(enemy, dt);
			enemy.staggerMs = Math.max(0, enemy.staggerMs - dt * 1000);
			enemy.cooldown -= dt * 1000;
			enemy.abilityCooldownMs = Math.max(0, enemy.abilityCooldownMs - dt * 1000);
			const dx = this.player.x - enemy.x,
				dy = this.player.y - enemy.y,
				d = Math.hypot(dx, dy) || 1;
			if (enemy.pendingAttack) {
				enemy.pendingAttack.remainingMs -= dt * 1000;
				if (enemy.pendingAttack.remainingMs <= 0) this.executeEnemyAttack(enemy);
				continue;
			}
			if (enemy.staggerMs > 0) continue;
			if (this.useEnemyAbility(enemy, dx, dy, d)) continue;
			const desired =
				enemy.definition.behavior === 'shooter' || enemy.definition.behavior === 'guardian'
					? Math.min(1, Math.max(-1, (d - 150) / 50))
					: 1;
			if (d > Math.min(...enemy.definition.attacks.map((attack) => attack.range)) * 0.7)
				this.moveEnemy(enemy, dt, desired);
			if (enemy.cooldown <= 0) {
				const roll =
					((deriveSeed(this.opts.dungeon.seed, enemy.id, Math.floor(this.elapsed / 100)) >>> 0) %
						10000) /
					10000;
				const attack = selectEnemyAttack(enemy.definition.attacks, d, roll);
				if (attack) this.beginEnemyAttack(enemy, attack);
			}
		}
		for (const p of this.projectiles) {
			for (const ghost of p.trail) ghost.age += dt;
			p.trail = p.trail.filter((ghost) => ghost.age < 0.2);
			if (p.knife && p.landedAt !== undefined) {
				if (p.returning) {
					const dx = this.player.x - p.x,
						dy = this.player.y - p.y,
						d = Math.hypot(dx, dy) || 1;
					p.vx = (dx / d) * 430;
					p.vy = (dy / d) * 430;
					if (d < this.player.radius + 7) {
						p.life = 0;
						this.knifeProjectile = null;
						this.droppedKnives.delete(this.currentRoomId);
						continue;
					}
				} else {
					const distance = Math.hypot(this.player.x - p.x, this.player.y - p.y);
					if (canAutoPickupKnife(p.landedAt, this.elapsed, distance)) {
						p.life = 0;
						this.knifeProjectile = null;
						this.droppedKnives.delete(this.currentRoomId);
						continue;
					}
					p.vx = 0;
					p.vy = 0;
					p.life = 999;
					continue;
				}
			}
			p.life -= dt;
			const ox = p.x,
				oy = p.y;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.distance += Math.hypot(p.x - ox, p.y - oy);
			if (!p.knife && p.distance >= p.maxDistance) {
				p.life = 0;
				this.spark(p.x, p.y, p.owner === 'player' ? 0xf2d89b : 0xa85952);
				continue;
			}
			if (p.knife && Math.hypot(p.x - p.lastTrailX, p.y - p.lastTrailY) >= 4) {
				p.trail.push({ x: ox, y: oy, rotation: p.rotation, age: 0 });
				if (p.trail.length > 12) p.trail.shift();
				p.lastTrailX = p.x;
				p.lastTrailY = p.y;
				if (!p.landedAt) p.rotation += dt * 13;
			}
			if (!p.returning && this.blocked(p.x, p.y, 4)) {
				const hitDestructible =
					p.owner === 'player' || p.propInteraction === 'damage-and-continue'
						? this.damagePropAt(p.x, p.y, p.damage * (p.critical ? this.weapon.critMultiplier : 1))
						: false;
				if (p.propInteraction === 'damage-and-continue' && hitDestructible) continue;
				if (p.propInteraction === 'ignore') continue;
				if (p.maxBounces > p.bounces) {
					const hitX = this.blocked(p.x, oy, 4),
						hitY = this.blocked(ox, p.y, 4);
					if (hitX) p.vx *= -1;
					if (hitY) p.vy *= -1;
					if (!hitX && !hitY) {
						p.vx *= -1;
						p.vy *= -1;
					}
					p.x = ox;
					p.y = oy;
					p.bounces++;
					if (!p.critical && this.opts.dungeon.seed % 100 < (p.bounces === 1 ? 47 : 82))
						p.critical = true;
					this.spark(p.x, p.y, 0xd9b36c);
				} else if (p.knife) {
					p.landedAt = this.elapsed;
					p.x = ox;
					p.y = oy;
				} else p.life = 0;
			}
			if (p.owner === 'player') {
				for (const enemy of this.enemies) {
					if (
						!enemy.dead &&
						Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.radius + 5 &&
						!p.hitIds?.has(enemy.id)
					) {
						p.hitIds?.add(enemy.id);
						this.hurtEnemy(
							enemy,
							p.damage *
								(1 + (p.distanceDamageBonus ?? 0) * Math.min(1, p.distance / p.maxDistance)) *
								(p.critical ? this.weapon.critMultiplier : 1),
							p.critical,
							p.vx,
							p.vy,
						);
						if (p.knife && !p.returning) {
							p.landedAt = this.elapsed;
							p.vx = 0;
							p.vy = 0;
						} else if (this.weapon.id !== 'blunderbuss' && !p.returning) p.life = 0;
					}
				}
			} else if (Math.hypot(this.player.x - p.x, this.player.y - p.y) < this.player.radius + 5) {
				this.hurtPlayer(p.damage);
				p.life = 0;
			}
		}
		this.projectiles = this.projectiles.filter((p) => {
			if (p.life <= 0) {
				if (this.knifeProjectile === p) this.knifeProjectile = null;
				p.view.destroy();
				p.trailView?.destroy();
				p.indicator?.destroy({ children: true });
				return false;
			}
			return true;
		});
		this.updateParticles(dt);
		this.updateFallingRocks(dt);
		if (
			this.phase === 'collapse' &&
			this.currentRoomId === this.opts.dungeon.graph.startRoomId &&
			Math.hypot(this.player.x - 320, this.player.y - 160) < 54
		) {
			this.phase = 'complete';
			this.opts.callbacks.onResult(this.result('escaped'));
			return;
		}
		this.playerView.animate(dt, moving);
		this.recoilMs = Math.max(0, this.recoilMs - dt * 1000);
		if (this.recoilMs <= 0) {
			this.playerView.rotation *= Math.max(0, 1 - dt * 20);
			this.playerView.scale.x += (1 - this.playerView.scale.x) * Math.min(1, dt * 20);
			this.playerView.scale.y += (1 - this.playerView.scale.y) * Math.min(1, dt * 20);
		}
		this.playerView.setAmbientLighting(this.insideAmbientLight(this.player.x, this.player.y));
		for (const enemy of this.enemies)
			if (!enemy.dead) {
				enemy.view.animate(
					dt,
					Math.abs(this.player.x - enemy.x) + Math.abs(this.player.y - enemy.y) > 1,
				);
				enemy.view.setAmbientLighting(this.insideAmbientLight(enemy.x, enemy.y));
			}
		this.shakeMs = Math.max(0, this.shakeMs - dt * 1000);
		this.updateCamera(dt);
		this.hudClock += dt;
		if (this.hudClock > 0.1) {
			this.hudClock = 0;
			this.emitHud();
		}
	}
	private render() {
		this.root.pivot.set(
			Math.round(this.camera.x * CAMERA_ZOOM) / CAMERA_ZOOM,
			Math.round(this.camera.y * CAMERA_ZOOM) / CAMERA_ZOOM,
		);
		const shake = this.shakeMs > 0 ? this.shakeStrength * (this.shakeMs / 180) : 0;
		this.root.position.set(
			VIEW_WIDTH / 2 + Math.sin(this.elapsed * 0.17) * shake,
			VIEW_HEIGHT / 2 + Math.cos(this.elapsed * 0.21) * shake,
		);
		this.playerView.position.set(Math.round(this.player.x), Math.round(this.player.y));
		for (const e of this.enemies) e.view.position.set(Math.round(e.x), Math.round(e.y));
		for (const p of this.projectiles) {
			p.view.position.set(Math.round(p.x), Math.round(p.y));
			if (p.knife) {
				p.view.rotation = p.rotation;
				p.trailView?.clear();
				for (const ghost of p.trail) {
					const alpha = (1 - ghost.age / 0.2) * 0.28;
					drawKnifeSilhouette(p.trailView!, ghost.x, ghost.y, ghost.rotation, 0xf2d89b, alpha);
				}
				if (p.indicator && p.indicatorRing && p.indicatorLabel) {
					const isLanded = p.landedAt !== undefined && !p.returning;
					p.indicator.visible = isLanded;
					if (isLanded) {
						const progress = knifePickupProgress(p.landedAt, this.elapsed);
						p.indicator.position.set(Math.round(p.x), Math.round(p.y) - 19);
						p.indicatorRing
							.clear()
							.circle(0, 0, 8)
							.stroke({ color: 0x170f14, width: 3, alpha: 0.95 });
						if (progress > 0)
							p.indicatorRing
								.arc(0, 0, 8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
								.stroke({ color: 0xf2d89b, width: 2 });
						p.indicatorLabel.text = isKnifePickupReady(p.landedAt, this.elapsed)
							? 'R'
							: String(Math.ceil((KNIFE_PICKUP_DELAY_MS * (1 - progress)) / 1_000));
					}
				}
			}
		}
	}
	private loadRoom(id: string) {
		this.recoverKnifeForTransition();
		const source = this.opts.dungeon.rooms.find((r) => r.id === id);
		if (!source) return;
		const room = this.prepareRoom(source);
		this.currentRoom = room;
		this.currentRoomId = id;
		this.roomVisited.add(id);
		this.clearEffectTimers();
		this.world.removeChildren().forEach((c) => c.destroy());
		this.floorLighting.removeChildren().forEach((c) => c.destroy());
		this.recycleParticles();
		this.effects.removeChildren().forEach((c) => c.destroy());
		this.damageLabels = [];
		this.destructibles.clear();
		this.enemies = [];
		this.projectiles = [];
		this.fallingRocks = [];
		this.ambientDust = [];
		this.ambientLightAreas = [];
		this.drawRoom(room);
		this.root.addChild(this.playerView, this.crosshair);
		for (const spawn of room.spawns) {
			if (spawn.kind === 'enemy' || spawn.kind === 'guardian') {
				const def = scaleEnemyForZone(ENEMIES[spawn.enemyId!]!, this.opts.zoneIndex);
				const view = new CharacterView(
					def.color,
					def.behavior === 'guardian' ? 34 : def.behavior === 'brute' ? 29 : 22,
				);
				const bar = new Graphics();
				bar.visible = false;
				view.addChild(bar);
				const actor: Actor = {
					id: spawn.id,
					x: (spawn.tile.x + 0.5) * TILE_SIZE,
					y: (spawn.tile.y + 0.5) * TILE_SIZE,
					health: def.maxHealth,
					maxHealth: def.maxHealth,
					radius: def.behavior === 'guardian' ? 22 : 14,
					view,
					bar,
					definition: def,
					cooldown: 500,
					pathClock: 0,
					path: [],
					knockbackX: 0,
					knockbackY: 0,
					staggerMs: 0,
					abilityCooldownMs: 0,
				};
				this.enemies.push(actor);
				this.root.addChild(view);
			}
		}
		const storedKnife = this.droppedKnives.get(id);
		if (storedKnife && this.weapon.id === 'knife') {
			const knife = this.spawnProjectile(
				storedKnife.x,
				storedKnife.y,
				0,
				0,
				this.weapon.damage,
				this.weapon.maxBounces,
				'player',
				false,
				true,
			);
			knife.landedAt = storedKnife.landedAt;
			knife.life = 999;
			this.knifeProjectile = knife;
		}
		if (room.kind === 'pvp') this.drawPrompt('E  ENTRAR NO CÍRCULO DE DUELO', 0xc59871);
		else if (room.kind === 'reward') this.drawPrompt('E  CONSULTAR O ALTAR', 0xd9b36c);
		else if (room.kind === 'start' && this.roomVisited.size > 1)
			this.drawPrompt('E  EXTRAIR LOOT E ENCERRAR A DESCIDA', 0xd9b36c);
		this.emitHud();
	}
	private prepareRoom(room: RoomDefinition): RoomDefinition {
		const tiles = room.grid.tiles.map((tile, index) =>
			isOptionalOverlay(tile) && !this.occupiedTiles.has(tile)
				? (`floor_${(index * 5 + room.grid.width) % 6}` as TileId)
				: tile,
		);
		return { ...room, grid: { ...room.grid, tiles } };
	}
	private drawRoom(room: RoomDefinition) {
		const palette = this.opts.dungeon.zones[0]?.definition.palette ?? CRYPT_ZONE.palette;
		const underlay = new Graphics();
		const terrain: Sprite[] = [];
		const overlays: Sprite[] = [];
		for (let y = 0; y < room.grid.height; y++)
			for (let x = 0; x < room.grid.width; x++) {
				const tile = tileAt(room.grid, x, y);
				const px = x * TILE_SIZE,
					py = y * TILE_SIZE;
				underlay.rect(px, py, TILE_SIZE, TILE_SIZE).fill(palette.dark);
				if (tile !== 'void') {
					const floorId = (
						tile.startsWith('floor_') ? tile : `floor_${(x * 11 + y * 7) % 6}`
					) as TileId;
					const floorTexture = this.tileTextures.get(floorId);
					if (floorTexture) {
						const floor = new Sprite(floorTexture);
						floor.position.set(px, py);
						floor.roundPixels = true;
						floor.tint = 0xd8d0dc;
						terrain.push(floor);
					}
				}
				if (!tile.startsWith('floor_') && tile !== 'void') {
					const overlayTexture = this.tileTextures.get(tile);
					if (overlayTexture) {
						const overlay = new Sprite(overlayTexture);
						overlay.position.set(px, py);
						overlay.roundPixels = true;
						if (isSolidTile(tile)) overlay.tint = 0x868086;
						if (isDestructible(tile) && this.occupiedTiles.has(tile)) {
							const material = PROP_MATERIALS[tile as keyof typeof PROP_MATERIALS];
							const mask = new Sprite(overlayTexture);
							mask.position.set(0, 0);
							const cracks = new Graphics();
							cracks.mask = mask;
							overlay.addChild(mask, cracks);
							const index = y * room.grid.width + x;
							this.destructibles.set(index, {
								index,
								tile,
								x,
								y,
								health: material.health,
								maxHealth: material.health,
								sprite: overlay,
								cracks,
								debrisColor: material.debrisColor,
							});
						}
						overlays.push(overlay);
					}
				}
			}
		const depthShade = this.drawFloorDepth(room);
		this.world.addChild(underlay, ...terrain, ...overlays);
		this.floorLighting.addChild(depthShade);
		this.drawAmbientLights(room, palette.highlight);
		for (const door of room.doors) {
			const label = new Text({
				text: 'E',
				style: { fontFamily: 'Pixelify Sans', fontSize: 13, fill: 0xf2d89b, fontWeight: 'bold' },
			});
			label.anchor.set(0.5);
			label.position.set((door.tile.x + 0.5) * 32, (door.tile.y + 0.5) * 32);
			this.world.addChild(label);
		}
	}
	private drawPrompt(text: string, color: number) {
		const panel = new Graphics()
			.roundRect(160, 265, 320, 34, 3)
			.fill({ color: 0x0b090d, alpha: 0.88 })
			.stroke({ color, width: 1 });
		const label = new Text({
			text,
			style: { fontFamily: 'Pixelify Sans', fontSize: 13, fill: color, letterSpacing: 2 },
		});
		label.anchor.set(0.5);
		label.position.set(320, 282);
		this.world.addChild(panel, label);
	}
	private attack() {
		if (this.weapon.id === 'knife' && this.knifeProjectile) return;
		this.player.cooldown = this.weapon.cooldownMs;
		const aimX = (this.input.mouse.x - VIEW_WIDTH / 2) / CAMERA_ZOOM + this.camera.x,
			aimY = (this.input.mouse.y - VIEW_HEIGHT / 2) / CAMERA_ZOOM + this.camera.y;
		const dx = aimX - this.player.x,
			dy = aimY - this.player.y,
			d = Math.hypot(dx, dy) || 1;
		if (this.weapon.id === 'sword') {
			const critical = this.criticalBag.draw();
			for (const e of this.enemies) {
				const ex = e.x - this.player.x,
					ey = e.y - this.player.y,
					ed = Math.hypot(ex, ey) || 1;
				const dot = (ex / ed) * (dx / d) + (ey / ed) * (dy / d);
				if (ed <= this.weapon.range && dot > Math.cos((this.weapon.spreadDegrees * Math.PI) / 360))
					this.hurtEnemy(
						e,
						this.weapon.damage * (critical ? this.weapon.critMultiplier : 1),
						critical,
						dx,
						dy,
					);
			}
			for (const prop of this.destructibles.values()) {
				const px = (prop.x + 0.5) * TILE_SIZE - this.player.x,
					py = (prop.y + 0.5) * TILE_SIZE - this.player.y,
					pd = Math.hypot(px, py) || 1,
					dot = (px / pd) * (dx / d) + (py / pd) * (dy / d);
				if (
					pd <= this.weapon.range + 12 &&
					dot > Math.cos((this.weapon.spreadDegrees * Math.PI) / 360)
				)
					this.damageDestructible(
						prop,
						this.weapon.damage * (critical ? this.weapon.critMultiplier : 1),
					);
			}
			const nx = this.player.x + (dx / d) * 10,
				ny = this.player.y + (dy / d) * 10;
			if (!this.blocked(nx, ny, this.player.radius)) {
				this.player.x = nx;
				this.player.y = ny;
			}
			this.slash(Math.atan2(dy, dx));
			return;
		}
		const critical = this.weapon.critChance > 0 ? this.criticalBag.draw() : false;
		const shotSeed = deriveSeed(this.opts.dungeon.seed, 'spread', Math.floor(this.elapsed));
		for (let i = 0; i < this.weapon.projectiles; i++) {
			const unit = ((Math.imul(shotSeed, i + 1) >>> 0) % 10000) / 10000;
			const spread = ((unit - 0.5) * this.weapon.spreadDegrees * Math.PI) / 180;
			const angle = Math.atan2(dy, dx) + spread;
			const bounces =
				this.weapon.maxBounces + this.opts.emblemIds.filter((id) => id === 'third-angle').length;
			const p = this.spawnProjectile(
				this.player.x,
				this.player.y,
				Math.cos(angle) * 330,
				Math.sin(angle) * 330,
				this.weapon.damage,
				bounces,
				'player',
				critical,
				this.weapon.id === 'knife',
				this.weapon.range,
				'block',
				this.weapon.id === 'blunderbuss' ? this.blunderbussDistanceBonus() : 0,
			);
			if (p.knife) this.knifeProjectile = p;
		}
		if (this.weapon.id === 'blunderbuss') {
			this.shotFlash(Math.atan2(dy, dx));
			this.recoilMs = 120;
			this.playerView.rotation = Math.atan2(dy, dx) + Math.PI / 2;
			this.playerView.scale.set(1.08, 0.9);
		}
	}
	private blunderbussDistanceBonus() {
		const quantity = this.opts.emblemIds.filter((id) => id === 'precision-barrel').length;
		const emblem = findEmblem('precision-barrel');
		return emblem && quantity ? (emblemTier(emblem, quantity).distanceDamageBonus ?? 0) : 0;
	}
	private beginEnemyAttack(enemy: Actor, attack: EnemyAttackDefinition) {
		const marker = new Graphics();
		const targetX = this.player.x;
		const targetY = this.player.y;
		if (attack.type === 'ground-punch-rocks-fell') {
			for (let i = 0; i < (attack.projectiles ?? 3); i++) {
				const offset = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 32;
				this.drawAttackWarningArea(marker, targetX + offset, targetY + (i === 0 ? 0 : 10), 16);
			}
		} else {
			this.drawAttackWarningArea(
				marker,
				targetX,
				targetY,
				attack.type === 'ground-punch' ? attack.range : 18,
			);
		}
		marker.roundPixels = true;
		this.effects.addChild(marker);
		enemy.pendingAttack = { attack, remainingMs: attack.telegraphMs, targetX, targetY, marker };
		enemy.cooldown = attack.cooldownMs / enemy.definition.attackSpeed;
	}
	private drawAttackWarningArea(marker: Graphics, x: number, y: number, radius: number) {
		const centerX = Math.round(x);
		const centerY = Math.round(y);
		marker
			.circle(centerX, centerY, radius)
			.fill({ color: 0x9f3441, alpha: 0.44 })
			.stroke({ color: 0xff806b, width: 2, alpha: 0.98 });
		const markHeight = radius >= 32 ? 14 : 9;
		// A dark pixel shadow keeps the warning readable over bright or patterned floors.
		marker
			.rect(centerX - 1, centerY - markHeight / 2 + 1, 4, markHeight)
			.fill(0x34131c)
			.rect(centerX - 1, centerY + markHeight / 2 + 2, 4, 4)
			.fill(0x34131c)
			.rect(centerX - 2, centerY - markHeight / 2, 4, markHeight)
			.fill(0xfff0cf)
			.rect(centerX - 2, centerY + markHeight / 2 + 1, 4, 4)
			.fill(0xfff0cf);
	}
	private cancelEnemyAttack(enemy: Actor) {
		const pending = enemy.pendingAttack;
		if (!pending) return;
		pending.marker.destroy();
		delete enemy.pendingAttack;
	}
	private executeEnemyAttack(enemy: Actor) {
		const pending = enemy.pendingAttack;
		if (!pending) return;
		this.cancelEnemyAttack(enemy);
		const { attack, targetX, targetY } = pending;
		const dx = targetX - enemy.x;
		const dy = targetY - enemy.y;
		const length = Math.hypot(dx, dy) || 1;
		if (attack.type === 'distance') {
			this.spawnProjectile(
				enemy.x,
				enemy.y,
				(dx / length) * 150,
				(dy / length) * 150,
				enemy.definition.damage,
				0,
				'enemy',
				false,
				false,
				attack.range,
				attack.propInteraction ?? 'block',
			);
			return;
		}
		if (attack.type === 'wave-distance') {
			for (const offset of [-0.16, 0, 0.16]) {
				const angle = Math.atan2(dy, dx) + offset;
				const projectile = this.spawnProjectile(
					enemy.x,
					enemy.y,
					Math.cos(angle) * 175,
					Math.sin(angle) * 175,
					enemy.definition.damage,
					0,
					'enemy',
					false,
					false,
					attack.range,
					'damage-and-continue',
				);
				projectile.view
					.clear()
					.arc(0, 0, 10, -0.9, 0.9)
					.stroke({ color: 0xf2d89b, width: 3, alpha: 0.9 });
			}
			return;
		}
		if (attack.type === 'ground-punch-rocks-fell') {
			this.triggerShake(210, this.opts.reduceFlashes ? 2.1 : 4.4);
			for (let i = 0; i < (attack.projectiles ?? 3); i++) {
				const offset = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 32;
				this.spawnFallingRock(
					targetX + offset,
					targetY + (i === 0 ? 0 : 10),
					enemy.definition.damage,
					attack.knockdownMs ?? 600,
				);
			}
			if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) < 70) {
				this.hurtPlayer(enemy.definition.damage);
				this.knockedDownMs = Math.max(this.knockedDownMs, attack.knockdownMs ?? 600);
			}
			return;
		}
		if (attack.type === 'ground-punch')
			this.triggerShake(190, this.opts.reduceFlashes ? 1.8 : 3.8);
		if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) <= attack.range) {
			this.hurtPlayer(enemy.definition.damage);
			if (attack.type === 'ground-punch')
				this.knockedDownMs = Math.max(this.knockedDownMs, attack.knockdownMs ?? 600);
		}
	}
	private rockImpact(x: number, y: number) {
		const rock = new Graphics()
			.rect(-8, -8, 16, 16)
			.fill(0x756069)
			.rect(-5, -5, 8, 7)
			.fill(0xb78b62);
		rock.position.set(Math.round(x), Math.round(y));
		this.effects.addChild(rock);
		this.destroyAfter(rock, 140);
		for (let i = 0; i < 8; i++)
			this.spawnParticle(
				x,
				y,
				0x9a7b68,
				3,
				Math.cos((i * Math.PI) / 4) * 55,
				Math.sin((i * Math.PI) / 4) * 55,
				0.3,
				90,
				i % 2 ? 2 : -2,
			);
		this.triggerShake(150, this.opts.reduceFlashes ? 1.3 : 2.7);
	}
	private spawnFallingRock(x: number, targetY: number, damage: number, knockdownMs: number) {
		const view = new Graphics()
			.rect(-7, -7, 14, 14)
			.fill(0x756069)
			.rect(-4, -5, 7, 6)
			.fill(0xb78b62);
		const y = targetY - 96;
		view.position.set(Math.round(x), Math.round(y));
		view.roundPixels = true;
		this.effects.addChild(view);
		this.fallingRocks.push({ x, y, targetY, damage, knockdownMs, view });
	}
	private updateFallingRocks(dt: number) {
		this.fallingRocks = this.fallingRocks.filter((rock) => {
			rock.y = Math.min(rock.targetY, rock.y + 620 * dt);
			rock.view.position.set(Math.round(rock.x), Math.round(rock.y));
			if (rock.y < rock.targetY) return true;
			rock.view.destroy();
			this.rockImpact(rock.x, rock.targetY);
			if (Math.hypot(this.player.x - rock.x, this.player.y - rock.targetY) < 22) {
				this.hurtPlayer(rock.damage);
				this.knockedDownMs = Math.max(this.knockedDownMs, rock.knockdownMs);
			}
			return false;
		});
	}
	private updateEnemyKnockback(enemy: Actor, dt: number) {
		if (Math.abs(enemy.knockbackX) + Math.abs(enemy.knockbackY) < 1) return;
		const nx = enemy.x + enemy.knockbackX * dt;
		const ny = enemy.y + enemy.knockbackY * dt;
		if (!this.blocked(nx, enemy.y, enemy.radius)) enemy.x = nx;
		else enemy.knockbackX = 0;
		if (!this.blocked(enemy.x, ny, enemy.radius)) enemy.y = ny;
		else enemy.knockbackY = 0;
		const damping = Math.exp(-12 * dt);
		enemy.knockbackX *= damping;
		enemy.knockbackY *= damping;
	}
	private useEnemyAbility(enemy: Actor, dx: number, dy: number, distance: number) {
		if (enemy.abilityCooldownMs > 0) return false;
		if (enemy.definition.canHeal && enemy.health / enemy.maxHealth < 0.35) {
			enemy.health = Math.min(enemy.maxHealth, enemy.health + enemy.maxHealth * 0.12);
			enemy.abilityCooldownMs = 6000 - enemy.definition.intelligenceLevel * 180;
			this.spark(enemy.x, enemy.y, 0x8fc99a);
			return true;
		}
		if (enemy.definition.canDodge) {
			const threat = this.projectiles.find(
				(projectile) =>
					projectile.owner === 'player' &&
					!projectile.knife &&
					Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < 48,
			);
			if (threat) {
				const speed = Math.hypot(threat.vx, threat.vy) || 1;
				const side =
					deriveSeed(this.opts.dungeon.seed, enemy.id, Math.floor(this.elapsed / 300)) % 2 ? 1 : -1;
				const stepX = (-threat.vy / speed) * 28 * side;
				const stepY = (threat.vx / speed) * 28 * side;
				if (!this.blocked(enemy.x + stepX, enemy.y + stepY, enemy.radius)) {
					enemy.x += stepX;
					enemy.y += stepY;
				}
				enemy.abilityCooldownMs = 1800 - enemy.definition.intelligenceLevel * 70;
				return true;
			}
		}
		if (enemy.definition.canDash && distance > 72 && distance < 180) {
			const nextX = enemy.x + (dx / distance) * 30;
			const nextY = enemy.y + (dy / distance) * 30;
			if (!this.blocked(nextX, nextY, enemy.radius)) {
				enemy.x = nextX;
				enemy.y = nextY;
				this.spark(enemy.x, enemy.y, enemy.definition.color);
			}
			enemy.abilityCooldownMs = 2800 - enemy.definition.intelligenceLevel * 90;
			return true;
		}
		return false;
	}
	private enemyShot(enemy: Actor, dx: number, dy: number) {
		this.spawnProjectile(
			enemy.x,
			enemy.y,
			dx * 150,
			dy * 150,
			enemy.definition.damage,
			0,
			'enemy',
			false,
			false,
			enemy.definition.range,
		);
	}
	private spawnProjectile(
		x: number,
		y: number,
		vx: number,
		vy: number,
		damage: number,
		maxBounces: number,
		owner: 'player' | 'enemy',
		critical: boolean,
		knife = false,
		maxDistance = knife ? 9999 : 320,
		propInteraction: Projectile['propInteraction'] = 'block',
		distanceDamageBonus = 0,
	) {
		const view = new Graphics();
		let trailView: Graphics | undefined;
		let indicator: Container | undefined;
		let indicatorRing: Graphics | undefined;
		let indicatorLabel: Text | undefined;
		if (knife) {
			drawKnifeSilhouette(view, 0, 0, 0, 0x160f14, 1, 1.35);
			drawKnifeSilhouette(view, 0, 0, 0, 0xf2d89b, 1);
			view.rect(-3, -1, 5, 2).fill(0xfff7d6);
			view.roundPixels = true;
			trailView = new Graphics();
			trailView.roundPixels = true;
			indicator = new Container();
			indicator.visible = false;
			indicatorRing = new Graphics();
			indicatorLabel = new Text({
				text: '4',
				style: {
					fontFamily: 'Pixelify Sans',
					fontSize: 8,
					fontWeight: 'bold',
					fill: 0xf4f1e9,
					stroke: { color: 0x100b10, width: 2 },
				},
			});
			indicatorLabel.anchor.set(0.5);
			indicator.addChild(indicatorRing, indicatorLabel);
			this.effects.addChild(trailView, view, indicator);
		} else {
			view
				.rect(-5, -5, 10, 10)
				.fill(0x120d12)
				.rect(-4, -4, 8, 8)
				.fill(0xf4f1e9)
				.rect(-3, -3, 6, 6)
				.fill(owner === 'player' ? 0xf2d89b : 0xa85952)
				.rect(-1, -1, 2, 2)
				.fill(owner === 'player' ? 0xfff7d6 : 0xffc5a9);
			view.roundPixels = true;
			this.effects.addChild(view);
		}
		const p: Projectile = {
			x,
			y,
			vx,
			vy,
			damage,
			life: knife ? 999 : 2.2,
			bounces: 0,
			maxBounces,
			owner,
			view,
			...(trailView ? { trailView } : {}),
			trail: [],
			lastTrailX: x,
			lastTrailY: y,
			rotation: Math.atan2(vy, vx),
			...(indicator
				? { indicator, indicatorRing: indicatorRing!, indicatorLabel: indicatorLabel! }
				: {}),
			critical,
			knife,
			hitIds: new Set(),
			distance: 0,
			maxDistance,
			propInteraction,
			...(distanceDamageBonus > 0 ? { distanceDamageBonus } : {}),
		};
		this.projectiles.push(p);
		return p;
	}
	private recallKnife() {
		const p = this.knifeProjectile;
		if (!p || p.returning || !isKnifePickupReady(p.landedAt, this.elapsed)) return;
		p.returning = true;
		p.life = 999;
		p.hitIds = new Set();
	}
	private hurtEnemy(e: Actor, damage: number, critical = false, impactX = 0, impactY = 0) {
		if (e.dead) return;
		const applied = Math.min(e.health, damage);
		e.health = Math.max(0, e.health - damage);
		e.damaged = true;
		e.bar.visible = e.definition.behavior !== 'guardian';
		e.bar
			.clear()
			.rect(-14, -29, 28, 3)
			.fill(0x160f14)
			.rect(-13, -28, 26 * (e.health / e.maxHealth), 1)
			.fill(critical ? 0xf2d89b : 0xa85952);
		e.view.flash(this.opts.reduceFlashes ? 45 : critical ? 140 : 75);
		this.showDamage(e, applied, critical);
		this.spark(e.x, e.y, critical ? 0xf2d89b : 0xc59871);
		this.spawnBlood(e.x, e.y);
		const vampirism = this.emblemTierValue('vampiric-mark', 'lifesteal');
		if (vampirism > 0)
			this.player.health = Math.min(
				this.player.maxHealth,
				this.player.health + applied * vampirism,
			);
		const impactLength = Math.hypot(impactX, impactY) || 1;
		if (e.definition.knockbackTendency < 0.2) e.staggerMs = Math.max(e.staggerMs, 170);
		else {
			const distance = Math.min(
				TILE_SIZE * 2,
				TILE_SIZE * 2 * e.definition.knockbackTendency * (critical ? 1.3 : 1),
			);
			e.knockbackX = (impactX / impactLength) * distance * 8;
			e.knockbackY = (impactY / impactLength) * distance * 8;
		}
		if (critical || damage >= 35) this.triggerShake(180, critical ? 3.3 : 2.3);
		if (e.health <= 0 && !e.dead) {
			e.dead = true;
			this.cancelEnemyAttack(e);
			this.kills++;
			if (e.definition.behavior === 'guardian') {
				this.bossActor = e;
				e.view.setColor(0xffffff);
				e.view.visible = true;
				this.beginBossCollapse(e);
			} else e.view.visible = false;
		}
	}
	private damagePropAt(x: number, y: number, damage: number) {
		const tx = Math.floor(x / TILE_SIZE),
			ty = Math.floor(y / TILE_SIZE);
		const target = this.destructibles.get(ty * this.currentRoom.grid.width + tx);
		if (target) this.damageDestructible(target, damage);
		return Boolean(target);
	}
	private damageDestructible(prop: Destructible, damage: number) {
		if (!this.destructibles.has(prop.index)) return;
		prop.health = Math.max(0, prop.health - damage);
		prop.cracks.clear();
		const crackCount = Math.max(1, Math.ceil((1 - prop.health / prop.maxHealth) * 5));
		for (let i = 0; i < crackCount; i++) {
			const sx = 5 + ((prop.index * 13 + i * 7) % 22),
				sy = 4 + ((prop.index * 5 + i * 9) % 23),
				bend = ((i * 5 + prop.index) % 9) - 4;
			prop.cracks
				.moveTo(sx, sy)
				.lineTo(sx + bend, sy + 5)
				.lineTo(Math.max(1, Math.min(30, sx + bend - 3)), sy + 10)
				.stroke({ color: 0xf4f1e9, alpha: 0.75, width: 1 });
			prop.cracks.rect(sx - 1, sy + 3, 2, 2).fill({ color: 0x100d12, alpha: 0.7 });
		}
		this.spark((prop.x + 0.5) * TILE_SIZE, (prop.y + 0.5) * TILE_SIZE, prop.debrisColor);
		if (prop.health === 0) {
			this.destructibles.delete(prop.index);
			prop.sprite.visible = false;
			prop.cracks.destroy();
			this.spawnDebris(prop);
		}
	}
	private spawnDebris(prop: Destructible) {
		const count = prop.tile === 'pillar' ? 10 : 7;
		for (let i = 0; i < count; i++)
			this.spawnParticle(
				(prop.x + 0.5) * TILE_SIZE,
				(prop.y + 0.7) * TILE_SIZE,
				prop.debrisColor,
				i % 3 === 0 ? 4 : 3,
				Math.sin(prop.index * 17 + i * 9) * 36,
				-25 - Math.abs(Math.cos(prop.index * 11 + i * 5)) * 46,
				2.2,
				95,
				1.6,
			);
	}
	private hurtPlayer(damage: number) {
		const cursedMultiplier = this.emblemTierValue('broken-clock', 'enemyDamageMultiplier') || 1;
		this.player.health = Math.max(0, this.player.health - damage * cursedMultiplier);
		this.playerView.flash(90);
		this.spark(this.player.x, this.player.y, 0xa83f3f);
		this.spawnBlood(this.player.x, this.player.y);
		this.triggerShake(150, 2);
		if (this.player.health <= 0) {
			this.phase = 'complete';
			this.opts.callbacks.onResult(this.result('death'));
		}
	}
	private emblemTierValue(id: string, key: 'lifesteal' | 'enemyDamageMultiplier') {
		const quantity = this.opts.emblemIds.filter((entry) => entry === id).length;
		const emblem = findEmblem(id);
		return emblem && quantity ? (emblemTier(emblem, quantity)[key] ?? 0) : 0;
	}
	private beginBossCollapse(actor: Actor) {
		this.bossCollapseMs = 1500;
		this.bossCollapseElapsed = 0;
		this.bossRewardTriggered = false;
		const rays = new Graphics();
		for (let i = 0; i < 16; i++) {
			const angle = (i * Math.PI) / 8;
			const length = i % 2 ? 118 : 170;
			const width = i % 2 ? 7 : 13;
			const nx = Math.cos(angle),
				ny = Math.sin(angle);
			rays
				.moveTo(nx * 16, ny * 16)
				.lineTo(nx * length - ny * width, ny * length + nx * width)
				.lineTo(nx * length + ny * width, ny * length - nx * width)
				.closePath()
				.fill({
					color: i % 2 ? 0xf2d89b : 0xfff5d8,
					alpha: this.opts.reduceFlashes ? 0.075 : 0.18,
				});
		}
		rays.position.set(actor.x, actor.y);
		rays.alpha = this.opts.reduceFlashes ? 0.32 : 0.85;
		this.effects.addChild(rays);
		this.bossRays = rays;
		actor.view.flash(this.opts.reduceFlashes ? 140 : 360);
		this.triggerShake(180, this.opts.reduceFlashes ? 2.1 : 3.8);
	}
	private showDamage(target: Actor, damage: number, critical: boolean) {
		const existing = this.damageLabels.find(
			(label) => label.targetId === target.id && label.elapsed < 0.14,
		);
		if (existing) {
			existing.amount += damage;
			existing.critical = existing.critical || critical;
			existing.elapsed = 0;
			existing.view.text = `${existing.critical ? '✦ CRÍTICO  ' : ''}${Math.round(existing.amount)}`;
			existing.view.style.fill = existing.critical ? 0xf2d89b : 0xf4f1e9;
			return;
		}
		const view = new Text({
			text: `${critical ? '✦ CRÍTICO  ' : ''}${Math.round(damage)}`,
			style: {
				fontFamily: 'Pixelify Sans',
				fontSize: critical ? 16 : 13,
				fontWeight: 'bold',
				fill: critical ? 0xf2d89b : 0xf4f1e9,
				stroke: { color: 0x0b090d, width: 3 },
			},
		});
		view.anchor.set(0.5);
		view.position.set(target.x, target.y - target.radius - 10);
		this.effects.addChild(view);
		this.damageLabels.push({
			targetId: target.id,
			view,
			amount: damage,
			critical,
			elapsed: 0,
			duration: 0.7,
		});
	}
	private updateDamageLabels(dt: number) {
		for (const label of this.damageLabels) {
			label.elapsed += dt;
			const t = Math.min(1, label.elapsed / label.duration);
			label.view.y -= dt * criticalRise(label.critical);
			label.view.alpha = 1 - t;
			const scale = (label.critical ? 1.18 : 1) + Math.sin(t * Math.PI) * 0.18;
			label.view.scale.set(scale);
		}
		this.damageLabels = this.damageLabels.filter((label) => {
			if (label.elapsed < label.duration) return true;
			label.view.destroy();
			return false;
		});
	}
	private triggerShake(duration: number, strength: number) {
		this.shakeMs = Math.max(this.shakeMs, duration);
		this.shakeStrength = Math.max(this.shakeStrength, strength);
	}
	private shotFlash(angle: number) {
		const g = new Graphics()
			.moveTo(-5, -5)
			.lineTo(24, 0)
			.lineTo(-5, 5)
			.closePath()
			.fill({ color: 0xffe2a4, alpha: this.opts.reduceFlashes ? 0.4 : 0.9 });
		g.position.set(this.player.x + Math.cos(angle) * 17, this.player.y + Math.sin(angle) * 17);
		g.rotation = angle;
		this.effects.addChild(g);
		for (let i = -2; i <= 2; i++) {
			const particleAngle = angle + i * 0.12;
			this.spawnParticle(
				g.x + Math.cos(particleAngle) * 8,
				g.y + Math.sin(particleAngle) * 8,
				0xffe2a4,
				2 + (i & 1),
				Math.cos(particleAngle) * (70 + Math.abs(i) * 10),
				Math.sin(particleAngle) * (70 + Math.abs(i) * 10),
				0.12,
				0,
				i,
			);
		}
		this.destroyAfter(g, 90);
	}
	private async interact() {
		if (this.interactionLatch || this.transitioning) return;
		this.interactionLatch = true;
		setTimeout(() => (this.interactionLatch = false), 250);
		if (this.currentRoom.kind === 'pvp') {
			this.opts.callbacks.onPvp();
			return;
		}
		if (this.currentRoom.kind === 'reward') {
			this.opts.callbacks.onReward();
			return;
		}
		if (
			this.currentRoom.kind === 'start' &&
			this.roomVisited.size > 1 &&
			Math.hypot(this.player.x - 320, this.player.y - 160) < 70
		) {
			this.phase = 'complete';
			this.opts.callbacks.onResult(this.result('escaped'));
			return;
		}
		const nearest = this.currentRoom.doors
			.map((d) => ({
				...d,
				distance: Math.hypot(
					this.player.x - (d.tile.x + 0.5) * 32,
					this.player.y - (d.tile.y + 0.5) * 32,
				),
			}))
			.sort((a, b) => a.distance - b.distance)[0];
		if (nearest && nearest.distance < 58) {
			const swap = () => {
				const previousId = this.currentRoomId;
				const destination = this.opts.dungeon.rooms.find((r) => r.id === nearest.targetRoomId);
				const back = destination?.doors.find((d) => d.targetRoomId === previousId);
				this.loadRoom(nearest.targetRoomId);
				if (back) {
					const inset = 48;
					if (back.direction === 'west') {
						this.player.x = inset;
						this.player.y = (back.tile.y + 0.5) * 32;
					} else if (back.direction === 'east') {
						this.player.x = ROOM_WIDTH * 32 - inset;
						this.player.y = (back.tile.y + 0.5) * 32;
					} else if (back.direction === 'north') {
						this.player.x = (back.tile.x + 0.5) * 32;
						this.player.y = inset;
					} else {
						this.player.x = (back.tile.x + 0.5) * 32;
						this.player.y = ROOM_HEIGHT * 32 - inset;
					}
				} else {
					this.player.x = 320;
					this.player.y = 160;
				}
			};
			this.transitioning = true;
			this.paused = true;
			if (this.opts.callbacks.onRoomTransition) await this.opts.callbacks.onRoomTransition(swap);
			else swap();
			this.paused = false;
			this.lastTime = performance.now();
			this.transitioning = false;
		}
	}
	private blocked(x: number, y: number, r: number) {
		const points = [
			[x - r, y],
			[x + r, y],
			[x, y - r],
			[x, y + r],
		];
		return points.some(([px, py]) => {
			const tx = Math.floor(px! / TILE_SIZE),
				ty = Math.floor(py! / TILE_SIZE),
				tile = tileAt(this.currentRoom.grid, tx, ty);
			if (tile.startsWith('deco_')) return false;
			if (isDestructible(tile))
				return this.destructibles.has(ty * this.currentRoom.grid.width + tx);
			return isSolidTile(tile);
		});
	}
	private recoverKnifeForTransition() {
		if (!this.knifeProjectile) return;
		if (this.knifeProjectile.landedAt !== undefined)
			this.droppedKnives.set(this.currentRoomId, {
				x: this.knifeProjectile.x,
				y: this.knifeProjectile.y,
				landedAt: this.knifeProjectile.landedAt,
			});
		this.knifeProjectile.life = 0;
		this.knifeProjectile = null;
	}
	private tileBlocked(x: number, y: number, ignoreProps = false) {
		const tile = tileAt(this.currentRoom.grid, x, y);
		if (tile.startsWith('deco_')) return false;
		if (isDestructible(tile))
			return !ignoreProps && this.destructibles.has(y * this.currentRoom.grid.width + x);
		return isSolidTile(tile);
	}
	private moveEnemy(enemy: Actor, dt: number, desired: number) {
		enemy.pathClock -= dt;
		if (enemy.pathClock <= 0 || enemy.path.length === 0) {
			enemy.pathClock = decisionIntervalSeconds(enemy.definition.intelligenceLevel);
			const start = { x: Math.floor(enemy.x / TILE_SIZE), y: Math.floor(enemy.y / TILE_SIZE) };
			const goal = {
				x: Math.floor(this.player.x / TILE_SIZE),
				y: Math.floor(this.player.y / TILE_SIZE),
			};
			enemy.path = findGridPath(
				start,
				goal,
				this.currentRoom.grid.width,
				this.currentRoom.grid.height,
				(x, y) => this.tileBlocked(x, y),
			);
			if (!enemy.path.length && enemy.definition.collisionAction === 'destroy-props')
				this.damageNearbyProp(enemy, enemy.definition.damage * dt * 2.5);
		}
		const next = enemy.path[0];
		if (!next) return;
		const tx = (next.x + 0.5) * TILE_SIZE,
			ty = (next.y + 0.5) * TILE_SIZE;
		const dx = tx - enemy.x,
			dy = ty - enemy.y,
			distance = Math.hypot(dx, dy) || 1;
		if (distance < 4) {
			enemy.path.shift();
			return;
		}
		const step = enemy.definition.moveSpeed * dt * desired;
		const nx = enemy.x + (dx / distance) * step,
			ny = enemy.y + (dy / distance) * step;
		if (!this.blocked(nx, enemy.y, enemy.radius)) enemy.x = nx;
		if (!this.blocked(enemy.x, ny, enemy.radius)) enemy.y = ny;
	}
	private damageNearbyProp(enemy: Actor, damage: number) {
		let nearest: Destructible | undefined,
			best = TILE_SIZE * 1.6;
		for (const prop of this.destructibles.values()) {
			const d = Math.hypot(
				(prop.x + 0.5) * TILE_SIZE - enemy.x,
				(prop.y + 0.5) * TILE_SIZE - enemy.y,
			);
			if (d < best) {
				best = d;
				nearest = prop;
			}
		}
		if (nearest) this.damageDestructible(nearest, damage);
	}
	private drawFloorDepth(room: RoomDefinition) {
		const shade = new Graphics();
		shade.blendMode = 'multiply';
		const width = room.grid.width * TILE_SIZE;
		const height = room.grid.height * TILE_SIZE;
		const pixelStep = 4;
		let floorLeft = width;
		let floorTop = height;
		let floorRight = 0;
		let floorBottom = 0;
		for (let y = 0; y < room.grid.height; y++) {
			for (let x = 0; x < room.grid.width; x++) {
				if (!tileAt(room.grid, x, y).startsWith('floor_')) continue;
				floorLeft = Math.min(floorLeft, x * TILE_SIZE);
				floorTop = Math.min(floorTop, y * TILE_SIZE);
				floorRight = Math.max(floorRight, (x + 1) * TILE_SIZE);
				floorBottom = Math.max(floorBottom, (y + 1) * TILE_SIZE);
			}
		}
		if (floorRight <= floorLeft || floorBottom <= floorTop) return shade;

		const depth = Math.max(48, Math.min(floorRight - floorLeft, floorBottom - floorTop) * 0.5);
		const maxDarkness = 0.34;
		for (let y = 0; y < height; y += pixelStep) {
			const tileY = Math.floor((y + pixelStep / 2) / TILE_SIZE);
			for (let x = 0; x < width; x += pixelStep) {
				const tileX = Math.floor((x + pixelStep / 2) / TILE_SIZE);
				if (!tileAt(room.grid, tileX, tileY).startsWith('floor_')) continue;

				const edgeDistance = Math.min(
					x + pixelStep / 2 - floorLeft,
					floorRight - (x + pixelStep / 2),
					y + pixelStep / 2 - floorTop,
					floorBottom - (y + pixelStep / 2),
				);
				const progress = Math.min(1, edgeDistance / depth);
				const smoothProgress = progress * progress * (3 - 2 * progress);
				const alpha = maxDarkness * (1 - smoothProgress);
				if (alpha < 0.004) continue;
				shade.rect(x, y, pixelStep, pixelStep).fill({ color: 0x33213f, alpha });
			}
		}
		return shade;
	}
	private drawAmbientLights(room: RoomDefinition, color: number) {
		const landingGlow = new Graphics();
		const landingMarks: Graphics[] = [];
		const candidates = selectAmbientLightAnchors(room, this.opts.dungeon.seed);
		for (const point of candidates) {
			const cx = (point.x + 0.5) * TILE_SIZE,
				cy = (point.y + 0.5) * TILE_SIZE,
				sy = -16;
			const path = Array.from({ length: 25 }, (_, index) => {
				const t = index / 24;
				return { x: cx, y: sy + (cy - sy) * t };
			});
			const drawBeam = (topHalfWidth: number, bottomHalfWidth: number, alpha: number) => {
				const normals = path.map((point, index) => {
					const before = path[Math.max(0, index - 1)]!;
					const after = path[Math.min(path.length - 1, index + 1)]!;
					const dx = after.x - before.x;
					const dy = after.y - before.y;
					const length = Math.hypot(dx, dy) || 1;
					return { x: -dy / length, y: dx / length };
				});
				const left: { x: number; y: number }[] = [];
				const right: { x: number; y: number }[] = [];
				path.forEach((point, index) => {
					const progress = index / (path.length - 1);
					const halfWidth = topHalfWidth + (bottomHalfWidth - topHalfWidth) * progress;
					left.push({
						x: point.x + normals[index]!.x * halfWidth,
						y: point.y + normals[index]!.y * halfWidth,
					});
					right.push({
						x: point.x - normals[index]!.x * halfWidth,
						y: point.y - normals[index]!.y * halfWidth,
					});
				});
				const beam = new Graphics().moveTo(left[0]!.x, left[0]!.y);
				for (const point of left.slice(1)) beam.lineTo(point.x, point.y);
				for (const point of right.reverse()) beam.lineTo(point.x, point.y);
				return beam.closePath().fill({ color, alpha });
			};
			const rayHalfWidth = 32;
			const halo = drawBeam(2, rayHalfWidth, 0.1);
			const core = drawBeam(1, rayHalfWidth - 4, 0.14);
			this.effects.addChild(halo, core);
			const radius = rayHalfWidth;
			this.ambientLightAreas.push({ x: cx, y: cy, radius });
			drawPixelLightDisc(landingGlow, cx, cy, radius, 0xffe9b0, 0.3);
			const landing = new Graphics();
			drawPixelLightDisc(landing, cx, cy, radius - 4, 0xffe9b0, 0.5);
			landingMarks.push(landing);
			for (let i = 0; i < 7; i++) {
				const dust = new Graphics()
					.rect(0, 0, 1 + (i % 2), 1 + (i % 2))
					.fill({ color, alpha: 0.24 });
				dust.position.set(cx - 28 + ((i * 19) % 56), cy - 55 + ((i * 29) % 80));
				this.effects.addChild(dust);
				this.ambientDust.push(dust);
			}
		}
		if (landingMarks.length) this.effects.addChild(landingGlow, ...landingMarks);
	}
	private insideAmbientLight(x: number, y: number) {
		return this.ambientLightAreas.some(
			(light) => Math.hypot(x - light.x, y - light.y) <= light.radius,
		);
	}
	private updateAmbientDust(dt: number) {
		for (let i = 0; i < this.ambientDust.length; i++) {
			const dust = this.ambientDust[i]!;
			dust.y -= dt * (2 + (i % 4));
			dust.x += Math.sin(this.elapsed * 0.0015 + i) * dt * 2;
			if (dust.y < 18) dust.y = VIEW_HEIGHT - 18;
		}
	}
	private spark(x: number, y: number, color: number) {
		for (let i = 0; i < 5; i++) {
			const angle = Math.random() * Math.PI * 2,
				speed = 28 + Math.random() * 78;
			this.spawnParticle(
				x + (Math.random() - 0.5) * 18,
				y + (Math.random() - 0.5) * 18,
				color,
				2 + Math.random() * 3,
				Math.cos(angle) * speed,
				Math.sin(angle) * speed,
				0.16,
				0,
				Math.random() * 5 - 2.5,
			);
		}
	}
	private spawnBlood(x: number, y: number) {
		for (let i = 0; i < 3; i++) {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
				speed = 24 + Math.random() * 48;
			this.spawnParticle(
				x + (Math.random() - 0.5) * 8,
				y,
				0x842b3a,
				2 + Math.random() * 2,
				Math.cos(angle) * speed,
				Math.sin(angle) * speed,
				0.48,
				80,
				Math.random() * 2 - 1,
			);
		}
	}
	private spawnParticle(
		x: number,
		y: number,
		color: number,
		size: number,
		vx: number,
		vy: number,
		life: number,
		gravity: number,
		spin: number,
	) {
		const view = this.particlePool.pop() ?? new Graphics();
		view
			.clear()
			.rect(-size / 2, -size / 2, size, size)
			.fill(color);
		view.visible = true;
		view.alpha = 1;
		view.position.set(Math.round(x), Math.round(y));
		this.effects.addChild(view);
		this.particles.push({ x, y, vx, vy, life, maxLife: life, gravity, spin, view });
	}
	private updateParticles(dt: number) {
		this.particles = this.particles.filter((p) => {
			p.life -= dt;
			if (p.life <= 0) {
				p.view.parent?.removeChild(p.view);
				p.view.visible = false;
				p.view.alpha = 1;
				p.view.rotation = 0;
				if (this.particlePool.length < 128) this.particlePool.push(p.view);
				else p.view.destroy();
				return false;
			}
			p.vy += p.gravity * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.view.position.set(Math.round(p.x), Math.round(p.y));
			p.view.alpha = Math.min(1, p.life / Math.min(0.22, p.maxLife));
			p.view.rotation += p.spin * dt;
			return true;
		});
	}
	private recycleParticles() {
		for (const p of this.particles) {
			p.view.parent?.removeChild(p.view);
			p.view.visible = false;
			p.view.alpha = 1;
			p.view.rotation = 0;
			if (this.particlePool.length < 128) this.particlePool.push(p.view);
			else p.view.destroy();
		}
		this.particles = [];
	}
	private destroyAfter(view: Graphics, delay: number) {
		const timer = setTimeout(() => {
			this.effectTimers.delete(timer);
			if (view.parent) view.destroy();
		}, delay);
		this.effectTimers.add(timer);
	}
	private clearEffectTimers() {
		for (const timer of this.effectTimers) clearTimeout(timer);
		this.effectTimers.clear();
	}
	private slash(angle: number) {
		const g = new Graphics().arc(0, 0, 48, -0.7, 0.7).stroke({ color: 0xf2d89b, width: 5 });
		g.position.set(this.player.x, this.player.y);
		g.rotation = angle;
		this.effects.addChild(g);
		this.destroyAfter(g, 120);
	}
	private emitHud() {
		const boss =
			this.bossActor ?? this.enemies.find((e) => e.definition.behavior === 'guardian' && !e.dead);
		const hud: HudSnapshot = {
			health: Math.ceil(this.player.health),
			maxHealth: this.player.maxHealth,
			remainingMs: this.phase === 'collapse' ? this.collapseMs : this.remainingMs,
			phase: this.phase,
			roomName: roomLabel(this.currentRoom.kind),
			roomIndex: this.roomVisited.size,
			roomTotal: this.opts.dungeon.rooms.length,
			objective:
				this.currentRoom.kind === 'guardian'
					? 'Derrote o Cronarca'
					: this.phase === 'collapse'
						? 'ALCANCE A SAÍDA'
						: 'Encontre o guardião',
			weaponId: this.weapon.id,
			cooldown: this.player.cooldown / this.weapon.cooldownMs,
			enemies: this.enemies.filter((e) => !e.dead).length,
			...(boss
				? {
						boss: {
							name: boss.definition.name,
							health: Math.max(0, boss.health),
							maxHealth: boss.maxHealth,
							cinematic: this.bossCollapseMs > 0,
						},
					}
				: {}),
		};
		this.opts.callbacks.onHud(hud);
	}
	private result(outcome: 'guardian' | 'death' | 'collapse' | 'escaped') {
		return {
			outcome,
			elapsedMs: Math.round(this.elapsed),
			roomsCleared: this.roomVisited.size,
			enemiesDefeated: this.kills,
		};
	}
}
function roomLabel(kind: RoomDefinition['kind']) {
	return {
		start: 'Vestíbulo',
		combat: 'Câmara Hostil',
		obstacle: 'Oficina Quebrada',
		treasure: 'Relicário',
		event: 'Laboratório',
		reward: 'Altar',
		pvp: 'Círculo de Duelo',
		guardian: 'Relógio-Mor',
	}[kind];
}
function criticalRise(critical: boolean) {
	return critical ? 58 : 38;
}
function isDestructible(tile: TileId) {
	return tile === 'pillar' || tile.startsWith('prop_');
}
function drawKnifeSilhouette(
	graphics: Graphics,
	x: number,
	y: number,
	rotation: number,
	color: number,
	alpha: number,
	scale = 1,
) {
	const shape = [
		[-12, -2],
		[-9, -2],
		[-9, -3],
		[-6, -3],
		[-6, -2],
		[-3, -2],
		[-3, -1],
		[4, -1],
		[10, 0],
		[4, 1],
		[-3, 1],
		[-3, 2],
		[-6, 2],
		[-6, 3],
		[-9, 3],
		[-9, 2],
		[-12, 2],
	];
	const cosine = Math.cos(rotation),
		sine = Math.sin(rotation),
		vertices = shape.flatMap(([localX, localY]) => [
			x + (localX! * cosine - localY! * sine) * scale,
			y + (localX! * sine + localY! * cosine) * scale,
		]);
	graphics.poly(vertices).fill({ color, alpha });
}
function buildWeapon(id: WeaponId, emblems: string[]): WeaponDefinition {
	const weapon: WeaponDefinition = { ...WEAPONS[id]! };
	for (const emblem of EMBLEMS) {
		const stacks = Math.min(3, emblems.filter((entry) => entry === emblem.id).length);
		if (!stacks || (emblem.weaponId && emblem.weaponId !== id)) continue;
		const tier = emblemTier(emblem, stacks);
		const multiplier = emblem.stackMode === 'additive-per-copy' ? stacks : 1;
		const modifier = tier.modifiers;
		weapon.maxHealth += (modifier?.maxHealth ?? 0) * multiplier;
		weapon.damage += (modifier?.damage ?? 0) * multiplier;
		weapon.cooldownMs += (modifier?.cooldownMs ?? 0) * multiplier;
		weapon.moveSpeed += (modifier?.moveSpeed ?? 0) * multiplier;
		weapon.critChance += (modifier?.critChance ?? 0) * multiplier;
		weapon.critMultiplier += (modifier?.critMultiplier ?? 0) * multiplier;
		weapon.range += (modifier?.range ?? 0) * multiplier;
		if (tier.spreadDegrees !== undefined) weapon.spreadDegrees = tier.spreadDegrees;
		if (tier.projectiles !== undefined) weapon.projectiles = tier.projectiles;
	}
	if (id === 'blunderbuss' && emblems.includes('loaded-die'))
		weapon.critChance = Math.min(
			0.8,
			weapon.critChance +
				BLUNDERBUSS_EMBLEM_CRIT_CHANCE * emblems.filter((emblem) => emblem === 'loaded-die').length,
		);
	weapon.maxHealth = Math.max(1, weapon.maxHealth);
	weapon.damage = Math.max(1, weapon.damage);
	weapon.cooldownMs = Math.max(100, weapon.cooldownMs);
	weapon.critChance = Math.min(0.9, Math.max(0, weapon.critChance));
	return weapon;
}
