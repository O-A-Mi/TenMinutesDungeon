import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store.js';

describe('memory account, run and leaderboard behavior', () => {
	it('preserves guest run data when linking an account and only ranks verified accounts', async () => {
		const store = new MemoryStore();
		const guest = await store.createGuest('Errante Um');
		const earlierRun = await store.startRun(guest.id, 101, 'sword');
		const registered = await store.registerGuest(guest.id, {
			displayName: 'Errante Um',
			email: 'one@example.com',
			passwordHash: 'test-hash',
			countryCode: 'BR',
			regionCode: 'SP',
		});
		expect(registered.ok).toBe(true);
		await store.saveAuthToken(
			guest.id,
			'verify_email',
			'verify-hash',
			new Date(Date.now() + 60_000).toISOString(),
		);
		const verified = await store.verifyEmailToken('verify-hash');
		expect(verified?.emailVerified).toBe(true);
		const finished = await store.finishRun(guest.id, {
			runId: earlierRun.id,
			outcome: 'guardian',
			elapsedMs: 60_000,
			activePlayMs: 55_000,
			roomsCleared: 7,
			zonesCleared: 1,
			enemiesDefeated: 8,
			guardiansDefeated: 1,
			acceptedRewardIds: ['iron-skin'],
		});
		expect(finished?.playerId).toBe(guest.id);

		const unverified = await store.createGuest('Errante Dois');
		await store.registerGuest(unverified.id, {
			displayName: 'Errante Dois',
			email: 'two@example.com',
			passwordHash: 'test-hash',
			countryCode: 'BR',
			regionCode: 'SP',
		});
		const unverifiedRun = await store.startRun(unverified.id, 202, 'blunderbuss');
		await store.finishRun(unverified.id, {
			runId: unverifiedRun.id,
			outcome: 'guardian',
			elapsedMs: 20_000,
			roomsCleared: 12,
			zonesCleared: 1,
			enemiesDefeated: 30,
			guardiansDefeated: 1,
			acceptedRewardIds: [],
		});

		const ranking = await store.ranking('regional', 'BR', 'SP');
		expect(ranking).toHaveLength(1);
		expect(ranking[0]?.playerId).toBe(guest.id);
		expect((await store.getProfile(guest.id))?.history).toHaveLength(1);
	});

	it('uses the same run statistics and deterministic tiebreak order for national and regional lists', async () => {
		const store = new MemoryStore();
		const entries = [];
		for (const [name, email, rooms, active] of [
			['Mais rápido', 'fast@example.com', 5, 30_000],
			['Mais salas', 'rooms@example.com', 6, 45_000],
		] as const) {
			const guest = await store.createGuest(name);
			await store.registerGuest(guest.id, {
				displayName: name,
				email,
				passwordHash: 'test-hash',
				countryCode: 'BR',
				regionCode: 'RJ',
			});
			await store.saveAuthToken(
				guest.id,
				'verify_email',
				`${email}-token`,
				new Date(Date.now() + 60_000).toISOString(),
			);
			await store.verifyEmailToken(`${email}-token`);
			const run = await store.startRun(guest.id, 303, 'knife');
			await store.finishRun(guest.id, {
				runId: run.id,
				outcome: 'guardian',
				elapsedMs: 60_000,
				activePlayMs: active,
				roomsCleared: rooms,
				zonesCleared: 1,
				enemiesDefeated: 0,
				guardiansDefeated: 1,
				acceptedRewardIds: [],
			});
			entries.push(guest.id);
		}
		const national = await store.ranking('national', 'BR', null),
			regional = await store.ranking('regional', 'BR', 'RJ');
		expect(national.map((row) => row.playerId)).toEqual(entries.slice().reverse());
		expect(regional).toEqual(national);
	});

	it('does not make a changed region effective before the next ranking week', async () => {
		const store = new MemoryStore();
		const guest = await store.createGuest('Errante');
		await store.registerGuest(guest.id, {
			displayName: 'Errante',
			email: 'region@example.com',
			passwordHash: 'test-hash',
			countryCode: 'BR',
			regionCode: 'SP',
		});
		await store.saveAuthToken(
			guest.id,
			'verify_email',
			'region-token',
			new Date(Date.now() + 60_000).toISOString(),
		);
		await store.verifyEmailToken('region-token');
		const run = await store.startRun(guest.id, 404, 'sword');
		await store.finishRun(guest.id, {
			runId: run.id,
			outcome: 'guardian',
			elapsedMs: 50_000,
			roomsCleared: 3,
			zonesCleared: 1,
			enemiesDefeated: 2,
			guardiansDefeated: 1,
			acceptedRewardIds: [],
		});
		await store.updateProfile(guest.id, {
			displayName: 'Errante',
			countryCode: 'BR',
			regionCode: 'RJ',
		});
		expect(await store.ranking('regional', 'BR', 'RJ')).toEqual([]);
		expect(await store.ranking('regional', 'BR', 'SP')).toHaveLength(1);
	});
});
