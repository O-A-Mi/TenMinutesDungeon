import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
	verifyRunResult,
	type PublicProfile,
	type RankingEntry,
	type RunResult,
	type WeaponId,
} from '@tmd/shared';

export type AuthTokenPurpose = 'verify_email' | 'password_reset';
export interface PlayerRecord {
	id: string;
	displayName: string;
	createdAt: string;
	accountEmail: string | null;
	emailVerified: boolean;
	passwordHash?: string | null;
	countryCode: string | null;
	regionCode: string | null;
	regionEffectiveAt: string | null;
}
export interface RunRecord {
	id: string;
	playerId: string;
	seed: number;
	weaponId: WeaponId;
	status: 'active' | 'won' | 'lost';
	createdAt: string;
	result?: RunResult;
}
export interface SessionRecord {
	sessionId: string;
	player: PlayerRecord;
}
export interface PvpMatchResult {
	id: string;
	playerA: string;
	playerB: string;
	winnerId: string | null;
	reason: string;
	roomSeed: number;
	roomDefinition: unknown;
}
type AccountRegistration = {
	displayName: string;
	email: string;
	passwordHash: string;
	countryCode: string;
	regionCode: string;
};
interface PlayerRegionRecord {
	countryCode: string;
	regionCode: string;
	effectiveAt: string;
}
export interface Store {
	initialize(): Promise<void>;
	createGuest(displayName?: string): Promise<PlayerRecord>;
	getPlayer(id: string): Promise<PlayerRecord | undefined>;
	getAccountByEmail(email: string): Promise<PlayerRecord | undefined>;
	registerGuest(
		playerId: string,
		input: AccountRegistration,
	): Promise<
		{ ok: true; player: PlayerRecord } | { ok: false; reason: 'EMAIL_TAKEN' | 'NOT_GUEST' }
	>;
	createSession(
		playerId: string,
		sessionId: string,
		sessionHash: string,
		expiresAt: string,
	): Promise<void>;
	getSession(sessionHash: string): Promise<SessionRecord | undefined>;
	revokeSession(sessionHash: string): Promise<void>;
	saveAuthToken(
		playerId: string,
		purpose: AuthTokenPurpose,
		tokenHash: string,
		expiresAt: string,
	): Promise<void>;
	verifyEmailToken(tokenHash: string): Promise<PlayerRecord | undefined>;
	resetPasswordToken(tokenHash: string, passwordHash: string): Promise<boolean>;
	mergeGuestData(guestPlayerId: string, accountPlayerId: string): Promise<boolean>;
	updateProfile(
		playerId: string,
		input: { displayName: string; countryCode: string; regionCode: string },
	): Promise<PlayerRecord | undefined>;
	getProfile(playerId: string): Promise<PublicProfile | undefined>;
	startRun(playerId: string, seed: number, weaponId: WeaponId): Promise<RunRecord>;
	finishRun(playerId: string, result: RunResult): Promise<RunRecord | undefined>;
	getActiveWeapon(playerId: string): Promise<WeaponId | undefined>;
	savePvpMatch(result: PvpMatchResult): Promise<void>;
	history(playerId: string): Promise<RunRecord[]>;
	ranking(
		scope: 'national' | 'regional',
		countryCode: string | null,
		regionCode: string | null,
	): Promise<RankingEntry[]>;
}

export class MemoryStore implements Store {
	players = new Map<string, PlayerRecord>();
	runs = new Map<string, RunRecord>();
	sessions = new Map<string, { sessionId: string; playerId: string; expiresAt: string }>();
	tokens = new Map<string, { playerId: string; purpose: AuthTokenPurpose; expiresAt: string }>();
	emblems = new Map<string, Set<string>>();
	pvpMatches = new Map<string, PvpMatchResult>();
	regions = new Map<string, PlayerRegionRecord[]>();
	async initialize() {}
	async createGuest(displayName?: string) {
		const id = randomUUID();
		const p: PlayerRecord = {
			id,
			displayName: displayName || `Errante-${id.slice(0, 4)}`,
			createdAt: new Date().toISOString(),
			accountEmail: null,
			emailVerified: false,
			countryCode: null,
			regionCode: null,
			regionEffectiveAt: null,
		};
		this.players.set(id, p);
		return p;
	}
	async getPlayer(id: string) {
		return this.players.get(id);
	}
	async getAccountByEmail(email: string) {
		return [...this.players.values()].find(
			(p) => p.accountEmail?.toLowerCase() === email.toLowerCase(),
		);
	}
	async registerGuest(playerId: string, input: AccountRegistration) {
		const p = this.players.get(playerId);
		if (!p || p.accountEmail || p.passwordHash)
			return { ok: false as const, reason: 'NOT_GUEST' as const };
		if (await this.getAccountByEmail(input.email))
			return { ok: false as const, reason: 'EMAIL_TAKEN' as const };
		const effectiveAt = new Date().toISOString();
		this.regions.set(playerId, [
			{ countryCode: input.countryCode, regionCode: input.regionCode, effectiveAt },
		]);
		Object.assign(p, {
			displayName: input.displayName,
			accountEmail: input.email,
			passwordHash: input.passwordHash,
			countryCode: input.countryCode,
			regionCode: input.regionCode,
			regionEffectiveAt: effectiveAt,
			emailVerified: false,
		});
		return { ok: true as const, player: p };
	}
	async createSession(playerId: string, sessionId: string, sessionHash: string, expiresAt: string) {
		this.sessions.set(sessionHash, { sessionId, playerId, expiresAt });
	}
	async getSession(sessionHash: string) {
		const s = this.sessions.get(sessionHash);
		if (!s || Date.parse(s.expiresAt) <= Date.now()) return;
		const player = this.players.get(s.playerId);
		return player ? { sessionId: s.sessionId, player } : undefined;
	}
	async revokeSession(sessionHash: string) {
		this.sessions.delete(sessionHash);
	}
	async saveAuthToken(
		playerId: string,
		purpose: AuthTokenPurpose,
		tokenHash: string,
		expiresAt: string,
	) {
		for (const [hash, t] of this.tokens)
			if (t.playerId === playerId && t.purpose === purpose) this.tokens.delete(hash);
		this.tokens.set(tokenHash, { playerId, purpose, expiresAt });
	}
	async verifyEmailToken(tokenHash: string) {
		const token = this.tokens.get(tokenHash);
		if (!token || token.purpose !== 'verify_email' || Date.parse(token.expiresAt) <= Date.now())
			return;
		this.tokens.delete(tokenHash);
		const player = this.players.get(token.playerId);
		if (player) {
			player.emailVerified = true;
			return player;
		}
	}
	async resetPasswordToken(tokenHash: string, passwordHash: string) {
		const token = this.tokens.get(tokenHash);
		if (!token || token.purpose !== 'password_reset' || Date.parse(token.expiresAt) <= Date.now())
			return false;
		this.tokens.delete(tokenHash);
		const player = this.players.get(token.playerId);
		if (!player) return false;
		player.passwordHash = passwordHash;
		for (const [hash, s] of this.sessions) if (s.playerId === player.id) this.sessions.delete(hash);
		return true;
	}
	async mergeGuestData(guestId: string, accountId: string) {
		if (guestId === accountId) return true;
		const guest = this.players.get(guestId),
			account = this.players.get(accountId);
		if (!guest || !account || guest.accountEmail || !account.emailVerified) return false;
		for (const r of this.runs.values()) if (r.playerId === guestId) r.playerId = accountId;
		const guestEmblems = this.emblems.get(guestId);
		if (guestEmblems) {
			const target = this.emblems.get(accountId) ?? new Set<string>();
			for (const id of guestEmblems) target.add(id);
			this.emblems.set(accountId, target);
			this.emblems.delete(guestId);
		}
		this.players.delete(guestId);
		for (const [hash, s] of this.sessions) if (s.playerId === guestId) this.sessions.delete(hash);
		if (!account.countryCode && guest.countryCode) {
			account.countryCode = guest.countryCode;
			account.regionCode = guest.regionCode;
			account.regionEffectiveAt = guest.regionEffectiveAt;
			this.regions.set(accountId, this.regions.get(guestId) ?? []);
		}
		this.regions.delete(guestId);
		return true;
	}
	async updateProfile(
		playerId: string,
		input: { displayName: string; countryCode: string; regionCode: string },
	) {
		const p = this.players.get(playerId);
		if (!p) return;
		const history = this.regions.get(playerId) ?? [];
		const latest = history.slice().sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
		const changed = Boolean(
			latest &&
			(latest.countryCode !== input.countryCode || latest.regionCode !== input.regionCode),
		);
		let effectiveAt = latest?.effectiveAt ?? new Date().toISOString();
		if (changed && Date.parse(latest!.effectiveAt) > Date.now()) {
			latest!.countryCode = input.countryCode;
			latest!.regionCode = input.regionCode;
		} else if (changed) {
			effectiveAt = nextUtcMonday().toISOString();
			history.push({ countryCode: input.countryCode, regionCode: input.regionCode, effectiveAt });
			this.regions.set(playerId, history);
		} else if (!latest) {
			history.push({ countryCode: input.countryCode, regionCode: input.regionCode, effectiveAt });
			this.regions.set(playerId, history);
		}
		Object.assign(p, input, { regionEffectiveAt: effectiveAt });
		return p;
	}
	async getProfile(playerId: string): Promise<PublicProfile | undefined> {
		const p = this.players.get(playerId);
		if (!p) return;
		const runs = [...this.runs.values()]
			.filter((r) => r.playerId === playerId && r.result)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		const ranked = runs.filter((r) => verifyRunResult(r.result!).verified);
		const best = [...ranked].sort(
			(a, b) =>
				(b.result?.score?.total ?? verifyRunResult(b.result!).score.total) -
				(a.result?.score?.total ?? verifyRunResult(a.result!).score.total),
		)[0]?.result;
		return {
			player: {
				id: p.id,
				displayName: p.displayName,
				accountEmail: p.accountEmail,
				emailVerified: p.emailVerified,
				countryCode: p.countryCode,
				regionCode: p.regionCode,
				regionEffectiveAt: p.regionEffectiveAt,
			},
			stats: {
				bestScore: best?.score?.total ?? (best ? verifyRunResult(best).score.total : 0),
				bestRooms: Math.max(0, ...ranked.map((r) => r.result!.roomsCleared)),
				totalActivePlayMs: runs.reduce(
					(sum, r) => sum + (r.result?.activePlayMs ?? r.result?.elapsedMs ?? 0),
					0,
				),
				guardiansDefeated: runs.reduce((sum, r) => sum + (r.result?.guardiansDefeated ?? 0), 0),
			},
			history: runs.slice(0, 20).map((r) => ({
				id: r.id,
				outcome: r.result?.outcome ?? null,
				score: r.result?.score?.total ?? (r.result ? verifyRunResult(r.result).score.total : 0),
				roomsCleared: r.result?.roomsCleared ?? 0,
				elapsedMs: r.result?.elapsedMs ?? 0,
				createdAt: r.createdAt,
			})),
			discoveredEmblems: [...(this.emblems.get(playerId) ?? new Set<string>())],
		};
	}
	async startRun(playerId: string, seed: number, weaponId: WeaponId) {
		const r: RunRecord = {
			id: randomUUID(),
			playerId,
			seed,
			weaponId,
			status: 'active',
			createdAt: new Date().toISOString(),
		};
		this.runs.set(r.id, r);
		return r;
	}
	async finishRun(playerId: string, result: RunResult) {
		const r = this.runs.get(result.runId);
		if (!r || r.playerId !== playerId || r.status !== 'active') return;
		const check = verifyRunResult(result);
		r.status = result.outcome === 'guardian' || result.outcome === 'escaped' ? 'won' : 'lost';
		r.result = { ...result, score: check.score };
		if (check.verified) {
			const emblems = this.emblems.get(playerId) ?? new Set<string>();
			for (const id of result.acceptedRewardIds) emblems.add(id);
			this.emblems.set(playerId, emblems);
		}
		return r;
	}
	async getActiveWeapon(playerId: string) {
		return [...this.runs.values()]
			.filter((run) => run.playerId === playerId && run.status === 'active')
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.weaponId;
	}
	async savePvpMatch(result: PvpMatchResult) {
		this.pvpMatches.set(result.id, result);
		if (result.winnerId) {
			const emblems = this.emblems.get(result.winnerId) ?? new Set<string>();
			emblems.add('duelist-sigil');
			this.emblems.set(result.winnerId, emblems);
		}
	}
	async history(playerId: string) {
		return [...this.runs.values()]
			.filter((r) => r.playerId === playerId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 20);
	}
	async ranking(
		scope: 'national' | 'regional',
		countryCode: string | null,
		regionCode: string | null,
	) {
		const rows: RankingEntry[] = [];
		for (const player of this.players.values()) {
			if (!player.emailVerified) continue;
			const region = this.regions
				.get(player.id)
				?.filter((entry) => Date.parse(entry.effectiveAt) <= Date.now())
				.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
			if (!region) continue;
			if (countryCode && region.countryCode !== countryCode) continue;
			if (scope === 'regional' && (!regionCode || region.regionCode !== regionCode)) continue;
			const best = [...this.runs.values()]
				.filter(
					(r) =>
						r.playerId === player.id &&
						r.status !== 'active' &&
						r.result &&
						verifyRunResult(r.result).verified,
				)
				.map((r) => r.result!)
				.sort(
					(a, b) =>
						scoreOf(b) - scoreOf(a) ||
						b.roomsCleared - a.roomsCleared ||
						(b.guardiansDefeated ?? 0) - (a.guardiansDefeated ?? 0) ||
						(a.activePlayMs ?? a.elapsedMs) - (b.activePlayMs ?? b.elapsedMs),
				)[0];
			if (best)
				rows.push({
					rank: 0,
					playerId: player.id,
					displayName: player.displayName,
					score: scoreOf(best),
					roomsCleared: best.roomsCleared,
					guardiansDefeated: best.guardiansDefeated ?? 0,
					activePlayMs: best.activePlayMs ?? best.elapsedMs,
				});
		}
		rows.sort(compareRanking);
		return rows.slice(0, 100).map((r, i) => ({ ...r, rank: i + 1 }));
	}
}

export class PostgresStore implements Store {
	private pool: pg.Pool;
	constructor(url: string) {
		this.pool = new pg.Pool({ connectionString: url });
	}
	async initialize() {
		const { readFile } = await import('node:fs/promises');
		const { resolve } = await import('node:path');
		const sql = await readFile(resolve(process.cwd(), 'apps/server/src/db/migrations.sql'), 'utf8');
		await this.pool.query(sql);
	}
	async createGuest(displayName?: string) {
		const id = randomUUID();
		const name = displayName || `Errante-${id.slice(0, 4)}`;
		const { rows } = await this.pool.query(
			'INSERT INTO players(id,display_name) VALUES($1,$2) RETURNING id,display_name,created_at,account_email,email_verified_at,password_hash',
			[id, name],
		);
		return rowPlayer(rows[0]);
	}
	async getPlayer(id: string) {
		const { rows } = await this.pool.query(`${playerSelect} WHERE p.id=$1`, [id]);
		return rows[0] ? rowPlayer(rows[0]) : undefined;
	}
	async getAccountByEmail(email: string) {
		const { rows } = await this.pool.query(
			`${playerSelect} WHERE lower(p.account_email)=lower($1)`,
			[email],
		);
		return rows[0] ? rowPlayer(rows[0]) : undefined;
	}
	async registerGuest(playerId: string, input: AccountRegistration) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const found = await client.query(
				'SELECT account_email,password_hash FROM players WHERE id=$1 FOR UPDATE',
				[playerId],
			);
			if (!found.rows[0] || found.rows[0].account_email || found.rows[0].password_hash) {
				await client.query('ROLLBACK');
				return { ok: false as const, reason: 'NOT_GUEST' as const };
			}
			const { rows } = await client.query(
				'UPDATE players SET display_name=$2,account_email=$3,password_hash=$4,email_verified_at=NULL WHERE id=$1 RETURNING id',
				[playerId, input.displayName, input.email, input.passwordHash],
			);
			if (!rows[0]) {
				await client.query('ROLLBACK');
				return { ok: false as const, reason: 'NOT_GUEST' as const };
			}
			await client.query(
				'INSERT INTO player_region_history(player_id,country_code,region_code,effective_from) VALUES($1,$2,$3,now()) ON CONFLICT(player_id,effective_from) DO NOTHING',
				[playerId, input.countryCode, input.regionCode],
			);
			await client.query('COMMIT');
			const player = await this.getPlayer(playerId);
			return player
				? { ok: true as const, player }
				: { ok: false as const, reason: 'NOT_GUEST' as const };
		} catch (error: any) {
			await client.query('ROLLBACK');
			if (error?.code === '23505') return { ok: false as const, reason: 'EMAIL_TAKEN' as const };
			throw error;
		} finally {
			client.release();
		}
	}
	async createSession(playerId: string, sessionId: string, sessionHash: string, expiresAt: string) {
		await this.pool.query(
			'INSERT INTO player_sessions(session_hash,session_id,player_id,expires_at) VALUES($1,$2,$3,$4)',
			[sessionHash, sessionId, playerId, expiresAt],
		);
	}
	async getSession(sessionHash: string) {
		const query = playerSelect
			.replace('SELECT p.id', 'SELECT s.session_id,p.id')
			.replace('FROM players p', 'FROM player_sessions s JOIN players p ON p.id=s.player_id');
		const { rows } = await this.pool.query(
			`${query} WHERE s.session_hash=$1 AND s.expires_at>now()`,
			[sessionHash],
		);
		return rows[0] ? { sessionId: rows[0].session_id, player: rowPlayer(rows[0]) } : undefined;
	}
	async revokeSession(sessionHash: string) {
		await this.pool.query('DELETE FROM player_sessions WHERE session_hash=$1', [sessionHash]);
	}
	async saveAuthToken(
		playerId: string,
		purpose: AuthTokenPurpose,
		tokenHash: string,
		expiresAt: string,
	) {
		await this.pool.query(
			'DELETE FROM auth_tokens WHERE player_id=$1 AND purpose=$2 AND consumed_at IS NULL',
			[playerId, purpose],
		);
		await this.pool.query(
			'INSERT INTO auth_tokens(token_hash,player_id,purpose,expires_at) VALUES($1,$2,$3,$4)',
			[tokenHash, playerId, purpose, expiresAt],
		);
	}
	async verifyEmailToken(tokenHash: string) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const token = await client.query(
				"SELECT player_id FROM auth_tokens WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
				[tokenHash],
			);
			if (!token.rows[0]) {
				await client.query('ROLLBACK');
				return;
			}
			await client.query('UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1', [
				tokenHash,
			]);
			await client.query('UPDATE players SET email_verified_at=now() WHERE id=$1', [
				token.rows[0].player_id,
			]);
			await client.query('COMMIT');
			return this.getPlayer(token.rows[0].player_id);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async resetPasswordToken(tokenHash: string, passwordHash: string) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const token = await client.query(
				"SELECT player_id FROM auth_tokens WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
				[tokenHash],
			);
			if (!token.rows[0]) {
				await client.query('ROLLBACK');
				return false;
			}
			const id = token.rows[0].player_id;
			await client.query('UPDATE players SET password_hash=$2 WHERE id=$1', [id, passwordHash]);
			await client.query('UPDATE auth_tokens SET consumed_at=now() WHERE token_hash=$1', [
				tokenHash,
			]);
			await client.query('DELETE FROM player_sessions WHERE player_id=$1', [id]);
			await client.query('COMMIT');
			return true;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async mergeGuestData(guestId: string, accountId: string) {
		if (guestId === accountId) return true;
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const valid = await client.query(
				'SELECT account_email,email_verified_at FROM players WHERE id=$1 FOR UPDATE',
				[accountId],
			);
			const guest = await client.query('SELECT account_email FROM players WHERE id=$1 FOR UPDATE', [
				guestId,
			]);
			if (!valid.rows[0]?.email_verified_at || !guest.rows[0] || guest.rows[0].account_email) {
				await client.query('ROLLBACK');
				return false;
			}
			await client.query('UPDATE runs SET player_id=$2 WHERE player_id=$1', [guestId, accountId]);
			await client.query(
				'INSERT INTO discovered_emblems(player_id,emblem_id,first_seen_at) SELECT $2,emblem_id,first_seen_at FROM discovered_emblems WHERE player_id=$1 ON CONFLICT(player_id,emblem_id) DO NOTHING',
				[guestId, accountId],
			);
			await client.query('DELETE FROM discovered_emblems WHERE player_id=$1', [guestId]);
			await client.query(
				'INSERT INTO unlocks(player_id,unlock_id,unlocked_at) SELECT $2,unlock_id,unlocked_at FROM unlocks WHERE player_id=$1 ON CONFLICT(player_id,unlock_id) DO NOTHING',
				[guestId, accountId],
			);
			await client.query('DELETE FROM unlocks WHERE player_id=$1', [guestId]);
			await client.query('UPDATE pvp_matches SET player_a=$2 WHERE player_a=$1', [
				guestId,
				accountId,
			]);
			await client.query('UPDATE pvp_matches SET player_b=$2 WHERE player_b=$1', [
				guestId,
				accountId,
			]);
			await client.query('UPDATE pvp_matches SET winner_id=$2 WHERE winner_id=$1', [
				guestId,
				accountId,
			]);
			await client.query(
				'INSERT INTO player_region_history(player_id,country_code,region_code,effective_from,created_at) SELECT $2,country_code,region_code,effective_from,created_at FROM player_region_history WHERE player_id=$1 ON CONFLICT(player_id,effective_from) DO NOTHING',
				[guestId, accountId],
			);
			await client.query('DELETE FROM player_region_history WHERE player_id=$1', [guestId]);
			await client.query('DELETE FROM player_regions WHERE player_id=$1', [guestId]);
			await client.query('DELETE FROM players WHERE id=$1', [guestId]);
			await client.query('COMMIT');
			return true;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async updateProfile(
		playerId: string,
		input: { displayName: string; countryCode: string; regionCode: string },
	) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await client.query('UPDATE players SET display_name=$2 WHERE id=$1', [
				playerId,
				input.displayName,
			]);
			const existing = await client.query(
				'SELECT country_code,region_code,effective_from FROM player_region_history WHERE player_id=$1 ORDER BY effective_from DESC LIMIT 1 FOR UPDATE',
				[playerId],
			);
			const current = existing.rows[0];
			const changed = Boolean(
				current &&
				(current.country_code !== input.countryCode || current.region_code !== input.regionCode),
			);
			if (!current) {
				await client.query(
					'INSERT INTO player_region_history(player_id,country_code,region_code,effective_from) VALUES($1,$2,$3,now())',
					[playerId, input.countryCode, input.regionCode],
				);
			} else if (changed && new Date(current.effective_from).getTime() > Date.now()) {
				await client.query(
					'UPDATE player_region_history SET country_code=$3,region_code=$4 WHERE player_id=$1 AND effective_from=$2',
					[playerId, current.effective_from, input.countryCode, input.regionCode],
				);
			} else if (changed) {
				await client.query(
					'INSERT INTO player_region_history(player_id,country_code,region_code,effective_from) VALUES($1,$2,$3,$4) ON CONFLICT(player_id,effective_from) DO UPDATE SET country_code=EXCLUDED.country_code,region_code=EXCLUDED.region_code',
					[playerId, input.countryCode, input.regionCode, nextUtcMonday().toISOString()],
				);
			}
			await client.query('COMMIT');
			return this.getPlayer(playerId);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async getProfile(playerId: string): Promise<PublicProfile | undefined> {
		const player = await this.getPlayer(playerId);
		if (!player) return;
		const [stats, history, emblems] = await Promise.all([
			this.pool.query(
				"SELECT COALESCE(MAX(score) FILTER (WHERE verified),0)::int best_score,COALESCE(MAX(rooms_cleared) FILTER (WHERE verified),0)::int best_rooms,COALESCE(SUM(active_play_ms),0)::bigint total_active_play_ms,COALESCE(SUM(guardians_defeated),0)::int guardians_defeated FROM runs WHERE player_id=$1 AND status<>'active'",
				[playerId],
			),
			this.pool.query(
				"SELECT id,outcome,score,rooms_cleared,elapsed_ms,created_at FROM runs WHERE player_id=$1 AND status<>'active' ORDER BY created_at DESC LIMIT 20",
				[playerId],
			),
			this.pool.query(
				'SELECT emblem_id FROM discovered_emblems WHERE player_id=$1 ORDER BY first_seen_at',
				[playerId],
			),
		]);
		return {
			player: {
				id: player.id,
				displayName: player.displayName,
				accountEmail: player.accountEmail,
				emailVerified: player.emailVerified,
				countryCode: player.countryCode,
				regionCode: player.regionCode,
				regionEffectiveAt: player.regionEffectiveAt,
			},
			stats: {
				bestScore: Number(stats.rows[0].best_score),
				bestRooms: Number(stats.rows[0].best_rooms),
				totalActivePlayMs: Number(stats.rows[0].total_active_play_ms),
				guardiansDefeated: Number(stats.rows[0].guardians_defeated),
			},
			history: history.rows.map((r: any) => ({
				id: r.id,
				outcome: r.outcome,
				score: Number(r.score ?? 0),
				roomsCleared: Number(r.rooms_cleared),
				elapsedMs: Number(r.elapsed_ms ?? 0),
				createdAt: new Date(r.created_at).toISOString(),
			})),
			discoveredEmblems: emblems.rows.map((r: any) => r.emblem_id),
		};
	}
	async startRun(playerId: string, seed: number, weaponId: WeaponId) {
		const id = randomUUID();
		const { rows } = await this.pool.query(
			"INSERT INTO runs(id,player_id,seed,weapon_id,status) VALUES($1,$2,$3,$4,'active') RETURNING *",
			[id, playerId, seed, weaponId],
		);
		return rowRun(rows[0]);
	}
	async finishRun(playerId: string, result: RunResult) {
		const status = result.outcome === 'guardian' || result.outcome === 'escaped' ? 'won' : 'lost';
		const check = verifyRunResult(result);
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const { rows } = await client.query(
				"UPDATE runs SET status=$1,outcome=$2,elapsed_ms=$3,rooms_cleared=$4,enemies_defeated=$5,accepted_rewards=$6,zones_cleared=$7,guardians_defeated=$8,extracted_loot_value=$9,time_remaining_ms=$10,active_play_ms=$11,score=$12,verified=$13,verification_flags=$14,finished_at=now() WHERE id=$15 AND player_id=$16 AND status='active' RETURNING *",
				[
					status,
					result.outcome,
					result.elapsedMs,
					result.roomsCleared,
					result.enemiesDefeated,
					JSON.stringify(result.acceptedRewardIds),
					result.zonesCleared ?? 0,
					result.guardiansDefeated ?? 0,
					result.extractedLootValue ?? 0,
					result.timeRemainingMs ?? 0,
					result.activePlayMs ?? result.elapsedMs,
					check.score.total,
					check.verified,
					JSON.stringify(check.flags),
					result.runId,
					playerId,
				],
			);
			if (!rows[0]) {
				await client.query('ROLLBACK');
				return;
			}
			for (const event of result.events ?? [])
				await client.query(
					'INSERT INTO run_events(run_id,sequence,tick,event_type,zone_index,room_id,payload,previous_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
					[
						result.runId,
						event.sequence,
						event.tick,
						event.type,
						event.zoneIndex,
						event.roomId ?? null,
						JSON.stringify(event.payload),
						event.previousHash,
						event.hash,
					],
				);
			if (check.verified)
				for (const id of result.acceptedRewardIds)
					await client.query(
						'INSERT INTO discovered_emblems(player_id,emblem_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
						[playerId, id],
					);
			await client.query('COMMIT');
			return rowRun(rows[0]);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async getActiveWeapon(playerId: string) {
		const { rows } = await this.pool.query(
			"SELECT weapon_id FROM runs WHERE player_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
			[playerId],
		);
		return rows[0]?.weapon_id as WeaponId | undefined;
	}
	async savePvpMatch(result: PvpMatchResult) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(
				"INSERT INTO pvp_matches(id,player_a,player_b,winner_id,status,ended_by,room_seed,room_definition,finished_at) VALUES($1,$2,$3,$4,'finished',$5,$6,$7,now()) ON CONFLICT(id) DO NOTHING",
				[
					result.id,
					result.playerA,
					result.playerB,
					result.winnerId,
					result.reason,
					result.roomSeed,
					JSON.stringify(result.roomDefinition),
				],
			);
			if (result.winnerId)
				await client.query(
					"INSERT INTO discovered_emblems(player_id,emblem_id) VALUES($1,'duelist-sigil') ON CONFLICT DO NOTHING",
					[result.winnerId],
				);
			await client.query('COMMIT');
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
	async history(playerId: string) {
		const { rows } = await this.pool.query(
			'SELECT * FROM runs WHERE player_id=$1 ORDER BY created_at DESC LIMIT 20',
			[playerId],
		);
		return rows.map(rowRun);
	}
	async ranking(
		scope: 'national' | 'regional',
		countryCode: string | null,
		regionCode: string | null,
	) {
		if (!countryCode) return [];
		const regionClause = scope === 'regional' ? 'AND pr.region_code=$3' : '';
		const values = scope === 'regional' ? [countryCode, 100, regionCode] : [countryCode, 100];
		const { rows } = await this.pool.query(
			`WITH best AS (SELECT DISTINCT ON(r.player_id) r.player_id,r.score,r.rooms_cleared,r.guardians_defeated,r.active_play_ms FROM runs r WHERE r.status<>'active' AND r.verified=true ORDER BY r.player_id,r.score DESC,r.rooms_cleared DESC,r.guardians_defeated DESC,r.active_play_ms ASC), ranked AS (SELECT p.id player_id,p.display_name,b.score,b.rooms_cleared,b.guardians_defeated,b.active_play_ms,ROW_NUMBER() OVER(ORDER BY b.score DESC,b.rooms_cleared DESC,b.guardians_defeated DESC,b.active_play_ms ASC,p.display_name ASC) rank FROM best b JOIN players p ON p.id=b.player_id AND p.email_verified_at IS NOT NULL JOIN LATERAL (SELECT history.country_code,history.region_code FROM player_region_history history WHERE history.player_id=p.id AND history.effective_from<=now() ORDER BY history.effective_from DESC LIMIT 1) pr ON true WHERE pr.country_code=$1 ${regionClause}) SELECT * FROM ranked ORDER BY rank LIMIT $2`,
			values,
		);
		return rows.map((r: any) => ({
			rank: Number(r.rank),
			playerId: r.player_id,
			displayName: r.display_name,
			score: Number(r.score),
			roomsCleared: Number(r.rooms_cleared),
			guardiansDefeated: Number(r.guardians_defeated),
			activePlayMs: Number(r.active_play_ms),
		}));
	}
}

const playerSelect = `SELECT p.id,p.display_name,p.created_at,p.account_email,p.email_verified_at,p.password_hash,region.country_code,region.region_code,region.effective_from region_effective_at FROM players p LEFT JOIN LATERAL (SELECT country_code,region_code,effective_from FROM player_region_history pr WHERE pr.player_id=p.id ORDER BY pr.effective_from DESC LIMIT 1) region ON true`;
function rowPlayer(r: any): PlayerRecord {
	return {
		id: r.id,
		displayName: r.display_name,
		createdAt: new Date(r.created_at).toISOString(),
		accountEmail: r.account_email ?? null,
		emailVerified: Boolean(r.email_verified_at),
		...(r.password_hash !== undefined ? { passwordHash: r.password_hash } : {}),
		countryCode: r.country_code ?? null,
		regionCode: r.region_code ?? null,
		regionEffectiveAt: r.region_effective_at ? new Date(r.region_effective_at).toISOString() : null,
	};
}
function rowRun(r: any): RunRecord {
	const result: RunResult | undefined = r.outcome
		? {
				runId: r.id,
				outcome: r.outcome,
				elapsedMs: Number(r.elapsed_ms ?? 0),
				activePlayMs: Number(r.active_play_ms ?? r.elapsed_ms ?? 0),
				roomsCleared: Number(r.rooms_cleared ?? 0),
				zonesCleared: Number(r.zones_cleared ?? 0),
				enemiesDefeated: Number(r.enemies_defeated ?? 0),
				guardiansDefeated: Number(r.guardians_defeated ?? 0),
				pvpVictories: 0,
				extractedLootValue: Number(r.extracted_loot_value ?? 0),
				timeRemainingMs: Number(r.time_remaining_ms ?? 0),
				acceptedRewardIds: jsonArray(r.accepted_rewards),
				score: {
					rooms: 0,
					zones: 0,
					guardians: 0,
					enemies: 0,
					elites: 0,
					pvpVictories: 0,
					extractedLoot: 0,
					timeRemaining: 0,
					penalties: 0,
					total: Number(r.score ?? 0),
				},
			}
		: undefined;
	return {
		id: r.id,
		playerId: r.player_id,
		seed: Number(r.seed),
		weaponId: r.weapon_id,
		status: r.status,
		createdAt: new Date(r.created_at).toISOString(),
		...(result ? { result } : {}),
	};
}
function jsonArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed.map(String) : [];
		} catch {
			return [];
		}
	}
	return [];
}
function scoreOf(result: RunResult) {
	return result.score?.total ?? verifyRunResult(result).score.total;
}
function compareRanking(a: RankingEntry, b: RankingEntry) {
	return (
		b.score - a.score ||
		b.roomsCleared - a.roomsCleared ||
		b.guardiansDefeated - a.guardiansDefeated ||
		a.activePlayMs - b.activePlayMs ||
		a.displayName.localeCompare(b.displayName)
	);
}
function nextUtcMonday() {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	const days = (8 - d.getUTCDay()) % 7 || 7;
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}
