import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
	CriticalBag,
	PROTOCOL_VERSION,
	ROOM_HEIGHT,
	ROOM_WIDTH,
	TILE_SIZE,
	WEAPONS,
	deriveSeed,
	generateRun,
	isSolidTile,
	tileAt,
	type PlayerInputPayload,
	type PvpRoomPayload,
	type PvpSnapshotPayload,
	type RoomDefinition,
	type TileCoord,
	type WeaponId,
	type WsEnvelope,
} from '@tmd/shared';

interface Client {
	sessionId: string;
	playerId: string;
	socket: WebSocket;
	weaponId: WeaponId;
	sequence: number;
	matchId?: string;
	queueTimer?: NodeJS.Timeout | undefined;
	reconnectTimer?: NodeJS.Timeout | undefined;
}
interface Fighter {
	sessionId: string;
	playerId: string;
	x: number;
	y: number;
	health: number;
	weaponId: WeaponId;
	input: PlayerInputPayload;
	lastAttack: number;
	criticalBag: CriticalBag;
}
interface Match {
	id: string;
	seed: number;
	room: RoomDefinition;
	spawns: [TileCoord, TileCoord];
	players: [Fighter, Fighter];
	tick: number;
	interval: NodeJS.Timeout;
}

export class PvpHub {
	clients = new Map<string, Client>();
	queue: string[] = [];
	matches = new Map<string, Match>();
	constructor(
		private readonly onFinished?: (result: {
			id: string;
			playerA: string;
			playerB: string;
			winnerId: string | null;
			reason: string;
			roomSeed: number;
			roomDefinition: RoomDefinition;
		}) => Promise<void> | void,
		private readonly queueTimeoutMs = 20_000,
	) {}
	connect(sessionId: string, playerId: string, weaponId: WeaponId, socket: WebSocket) {
		const previous = this.clients.get(sessionId);
		if (previous?.reconnectTimer) clearTimeout(previous.reconnectTimer);
		const client: Client = {
			sessionId,
			playerId,
			weaponId,
			socket,
			sequence: previous?.sequence ?? 0,
			...(previous?.matchId ? { matchId: previous.matchId } : {}),
		};
		this.clients.set(sessionId, client);
		this.send(client, 'presence.ready', { reconnected: Boolean(previous) });
		if (client.matchId) this.sendSnapshot(client.matchId);
		return client;
	}
	disconnect(sessionId: string) {
		const c = this.clients.get(sessionId);
		if (!c) return;
		if (c.matchId) {
			c.reconnectTimer = setTimeout(() => this.forfeit(sessionId, 'disconnect'), 10_000);
		} else {
			this.leaveQueue(sessionId);
			this.clients.delete(sessionId);
		}
	}
	handle(client: Client, type: string, payload: any) {
		if (type === 'queue.join') {
			if (!this.queue.includes(client.sessionId)) {
				this.queue.push(client.sessionId);
				client.queueTimer = setTimeout(() => {
					if (!this.queue.includes(client.sessionId)) return;
					this.queue = this.queue.filter((id) => id !== client.sessionId);
					client.queueTimer = undefined;
					this.send(client, 'queue.timeout', { searchDurationMs: this.queueTimeoutMs });
				}, this.queueTimeoutMs);
			}
			this.send(client, 'queue.joined', { position: this.queue.indexOf(client.sessionId) + 1 });
			this.tryMatch();
		} else if (type === 'queue.leave') this.leaveQueue(client.sessionId);
		else if (type === 'pvp.input' && client.matchId) {
			const match = this.matches.get(client.matchId);
			const fighter = match?.players.find((p) => p.sessionId === client.sessionId);
			if (fighter) fighter.input = normalizeInput(payload);
		} else if (type === 'pvp.forfeit') this.forfeit(client.sessionId, 'forfeit');
		else if (type === 'ping') this.send(client, 'pong', { clientTime: payload?.clientTime });
	}
	private tryMatch() {
		while (this.queue.length >= 2) {
			const a = this.queue.shift()!,
				b = this.queue.shift()!;
			const ca = this.clients.get(a),
				cb = this.clients.get(b);
			if (!ca || !cb) continue;
			if (ca.queueTimer) clearTimeout(ca.queueTimer);
			if (cb.queueTimer) clearTimeout(cb.queueTimer);
			ca.queueTimer = undefined;
			cb.queueTimer = undefined;
			this.startMatch(ca, cb);
		}
	}
	private startMatch(a: Client, b: Client) {
		const id = randomUUID();
		const seed = parseInt(id.replaceAll('-', '').slice(0, 8), 16);
		const generated = generateRun(seed);
		const room = generated.zones[0]!.rooms.find((candidate) => candidate.kind === 'pvp')!;
		const spawns: [TileCoord, TileCoord] = [
			{ x: 3, y: 4 },
			{ x: 16, y: 4 },
		];
		const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
		const fighter = (c: Client, index: number): Fighter => ({
			sessionId: c.sessionId,
			playerId: c.playerId,
			x: (spawns[index]!.x + 0.5) * TILE_SIZE,
			y: (spawns[index]!.y + 0.5) * TILE_SIZE,
			health: 100,
			weaponId: c.weaponId,
			input: { ...idle },
			lastAttack: 0,
			criticalBag: new CriticalBag(
				deriveSeed(seed, `pvp:${index}`),
				WEAPONS[c.weaponId]!.critChance,
			),
		});
		const match: Match = {
			id,
			seed,
			room,
			spawns,
			players: [fighter(a, 0), fighter(b, 1)],
			tick: 0,
			interval: setInterval(() => this.step(id), 50),
		};
		a.matchId = id;
		b.matchId = id;
		this.matches.set(id, match);
		this.send(a, 'match.found', { matchId: id, opponent: b.playerId });
		this.send(b, 'match.found', { matchId: id, opponent: a.playerId });
		const payload: PvpRoomPayload = {
			matchId: id,
			seed,
			room,
			spawns,
			players: [
				{ sessionId: a.sessionId, playerId: a.playerId, weaponId: a.weaponId },
				{ sessionId: b.sessionId, playerId: b.playerId, weaponId: b.weaponId },
			],
		};
		this.broadcast(match, 'pvp.room', payload);
		this.sendSnapshot(id);
	}
	private step(id: string) {
		const m = this.matches.get(id);
		if (!m) return;
		m.tick++;
		for (const p of m.players) {
			const mag = Math.hypot(p.input.moveX, p.input.moveY) || 1;
			const nx = p.x + (p.input.moveX / mag) * 7,
				ny = p.y + (p.input.moveY / mag) * 7;
			if (!this.blocked(m.room, nx, p.y, 11)) p.x = nx;
			if (!this.blocked(m.room, p.x, ny, 11)) p.y = ny;
			const weapon = WEAPONS[p.weaponId]!;
			if (p.input.attack && m.tick - p.lastAttack >= Math.ceil(weapon.cooldownMs / 50)) {
				p.lastAttack = m.tick;
				const other = m.players.find((x) => x !== p)!;
				const dx = other.x - p.x,
					dy = other.y - p.y,
					d = Math.hypot(dx, dy) || 1;
				const aim = Math.hypot(p.input.aimX, p.input.aimY) || 1;
				const dot = (dx / d) * (p.input.aimX / aim) + (dy / d) * (p.input.aimY / aim);
				const arc = Math.cos(((weapon.spreadDegrees || 60) * Math.PI) / 360);
				if (d <= weapon.range && dot >= arc) {
					const critical = p.criticalBag.draw();
					const damage = weapon.damage * (critical ? weapon.critMultiplier : 1);
					other.health = Math.max(0, other.health - damage);
					this.broadcast(m, 'pvp.hit', {
						source: p.sessionId,
						target: other.sessionId,
						damage,
						critical,
						weaponId: p.weaponId,
					});
					if (other.health <= 0) {
						this.finish(m, p.sessionId, 'defeat');
						return;
					}
				}
			}
		}
		if (m.tick % 2 === 0) this.sendSnapshot(id);
		if (m.tick >= 1200) {
			const winner = [...m.players].sort((a, b) => b.health - a.health)[0]!;
			this.finish(m, winner.sessionId, 'timeout');
		}
	}
	private blocked(room: RoomDefinition, x: number, y: number, radius: number) {
		const points: [[number, number], [number, number], [number, number], [number, number]] = [
			[x - radius, y],
			[x + radius, y],
			[x, y - radius],
			[x, y + radius],
		];
		return points.some(([px, py]) => {
			if (px < 0 || py < 0 || px >= ROOM_WIDTH * TILE_SIZE || py >= ROOM_HEIGHT * TILE_SIZE)
				return true;
			return isSolidTile(tileAt(room.grid, Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE)));
		});
	}
	private sendSnapshot(id: string) {
		const m = this.matches.get(id);
		if (!m) return;
		const payload: PvpSnapshotPayload = {
			matchId: id,
			tick: m.tick,
			players: m.players.map((p) => ({
				sessionId: p.sessionId,
				x: p.x,
				y: p.y,
				health: p.health,
				weaponId: p.weaponId,
			})),
		};
		this.broadcast(m, 'pvp.snapshot', payload);
	}
	private forfeit(sessionId: string, reason: string) {
		const c = this.clients.get(sessionId);
		const m = c?.matchId ? this.matches.get(c.matchId) : undefined;
		if (!m) return;
		const winner = m.players.find((p) => p.sessionId !== sessionId)?.sessionId;
		if (winner) this.finish(m, winner, reason);
	}
	private finish(m: Match, winnerSessionId: string, reason: string) {
		clearInterval(m.interval);
		const winner = m.players.find((p) => p.sessionId === winnerSessionId);
		this.broadcast(m, 'match.ended', { winnerSessionId, reason, rewardId: 'duelist-sigil' });
		for (const p of m.players) {
			const c = this.clients.get(p.sessionId);
			if (c) {
				delete c.matchId;
				if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
				if (c.socket.readyState !== 1) this.clients.delete(p.sessionId);
			}
		}
		this.matches.delete(m.id);
		if (this.onFinished)
			void Promise.resolve(
				this.onFinished({
					id: m.id,
					playerA: m.players[0].playerId,
					playerB: m.players[1].playerId,
					winnerId: winner?.playerId ?? null,
					reason,
					roomSeed: m.seed,
					roomDefinition: m.room,
				}),
			).catch(() => {});
	}
	private leaveQueue(id: string) {
		this.queue = this.queue.filter((x) => x !== id);
		const c = this.clients.get(id);
		if (c) {
			if (c.queueTimer) clearTimeout(c.queueTimer);
			c.queueTimer = undefined;
			this.send(c, 'queue.left', {});
		}
	}
	private broadcast(m: Match, type: string, payload: unknown) {
		m.players.forEach((p) => {
			const c = this.clients.get(p.sessionId);
			if (c) this.send(c, type, payload);
		});
	}
	private send(c: Client, type: string, payload: unknown) {
		if (c.socket.readyState !== 1) return;
		const msg: WsEnvelope = {
			version: PROTOCOL_VERSION,
			type,
			requestId: randomUUID(),
			sessionId: c.sessionId,
			sequence: ++c.sequence,
			timestamp: Date.now(),
			payload,
		};
		c.socket.send(JSON.stringify(msg));
	}
}
function normalizeInput(value: any): PlayerInputPayload {
	return {
		moveX: clamp(value?.moveX),
		moveY: clamp(value?.moveY),
		aimX: clamp(value?.aimX),
		aimY: clamp(value?.aimY),
		attack: Boolean(value?.attack),
	};
}
function clamp(n: any) {
	return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}
