import {
	generateRun,
	type PublicProfile,
	type RankingEntry,
	type RunResult,
	type SeededRun,
	type WeaponId,
} from '@tmd/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? '';
export interface Identity {
	sessionId: string;
	player: {
		id: string;
		displayName: string;
		accountEmail?: string | null;
		emailVerified?: boolean;
		countryCode?: string | null;
		regionCode?: string | null;
		regionEffectiveAt?: string | null;
	};
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${apiUrl}${path}`, {
		...init,
		credentials: 'include',
		headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
	});
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw Object.assign(new Error(data.message ?? data.code ?? `HTTP ${response.status}`), {
			status: response.status,
			code: data.code,
		});
	}
	return response.json() as Promise<T>;
}
export async function ensureGuest(): Promise<Identity> {
	try {
		const current = await request<Identity>('/api/session');
		localStorage.setItem('tmd.identity', JSON.stringify(current));
		return current;
	} catch {
		try {
			const created = await request<Identity>('/api/sessions/guest', {
				method: 'POST',
				body: '{}',
			});
			localStorage.setItem('tmd.identity', JSON.stringify(created));
			return created;
		} catch {
			const cached = localStorage.getItem('tmd.identity');
			if (cached) return JSON.parse(cached);
			const identity = {
				sessionId: crypto.randomUUID(),
				player: { id: crypto.randomUUID(), displayName: 'Errante offline' },
			};
			localStorage.setItem('tmd.identity', JSON.stringify(identity));
			return identity;
		}
	}
}
export async function refreshIdentity() {
	const identity = await request<Identity>('/api/session');
	localStorage.setItem('tmd.identity', JSON.stringify(identity));
	return identity;
}
export async function registerAccount(input: {
	displayName: string;
	email: string;
	password: string;
	countryCode: string;
	regionCode: string;
}) {
	return request<{ accepted: boolean; email: string; verificationRequired: boolean }>(
		'/api/auth/register',
		{ method: 'POST', body: JSON.stringify(input) },
	);
}
export async function loginAccount(email: string, password: string, mergeGuest: boolean) {
	const identity = await request<Identity>('/api/auth/login', {
		method: 'POST',
		body: JSON.stringify({ email, password, mergeGuest }),
	});
	localStorage.setItem('tmd.identity', JSON.stringify(identity));
	return identity;
}
export async function logoutAccount() {
	await request('/api/auth/logout', { method: 'POST', body: '{}' });
	localStorage.removeItem('tmd.identity');
}
export async function verifyEmail(token: string) {
	const identity = await request<Identity>('/api/auth/verify-email', {
		method: 'POST',
		body: JSON.stringify({ token }),
	});
	localStorage.setItem('tmd.identity', JSON.stringify(identity));
	return identity;
}
export async function resendVerification() {
	return request('/api/auth/resend-verification', { method: 'POST', body: '{}' });
}
export async function requestPasswordReset(email: string) {
	return request('/api/auth/password/reset-request', {
		method: 'POST',
		body: JSON.stringify({ email }),
	});
}
export async function resetPassword(token: string, password: string) {
	return request('/api/auth/password/reset', {
		method: 'POST',
		body: JSON.stringify({ token, password }),
	});
}
export async function updateProfile(input: {
	displayName: string;
	countryCode: string;
	regionCode: string;
}) {
	return request<PublicProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(input) });
}
export async function getProfile(identity: Identity) {
	return request<PublicProfile>(`/api/profile/${encodeURIComponent(identity.player.id)}`);
}
export async function getRanking(scope: 'national' | 'regional') {
	return request<{ scope: string; entries: RankingEntry[] }>(`/api/ranking?scope=${scope}`);
}
export async function startRemoteRun(
	_identity: Identity,
	weaponId: WeaponId,
): Promise<{ runId: string; dungeon: SeededRun }> {
	try {
		const data = await request<{ run: { id: string }; dungeon: Partial<SeededRun> }>('/api/runs', {
			method: 'POST',
			body: JSON.stringify({ weaponId }),
		});
		const remote = data.dungeon;
		const dungeon =
			Array.isArray(remote.zones) && remote.zones.length
				? (remote as SeededRun)
				: generateRun(Number(remote.seed ?? Date.now()));
		return { runId: data.run.id, dungeon };
	} catch {
		const seed = Math.floor(Math.random() * 0x7fffffff);
		return { runId: crypto.randomUUID(), dungeon: generateRun(seed) };
	}
}
export async function finishRemoteRun(_identity: Identity, result: RunResult) {
	try {
		await request('/api/runs/finish', { method: 'POST', body: JSON.stringify(result) });
	} catch {
		localStorage.setItem('tmd.lastResult', JSON.stringify(result));
	}
}
