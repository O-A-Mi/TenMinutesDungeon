import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createTransport } from 'nodemailer';
import {
	CRYPT_ZONE,
	ENEMIES,
	PROTOCOL_VERSION,
	REWARDS,
	TILESET_MANIFEST,
	WEAPONS,
	accountLoginSchema,
	accountRegistrationSchema,
	finishRunSchema,
	guestSessionSchema,
	passwordResetRequestSchema,
	passwordResetSchema,
	profileUpdateSchema,
	rankingQuerySchema,
	startRunSchema,
	wsEnvelopeSchema,
	generateRun,
	type RunResult,
	type WeaponId,
} from '@tmd/shared';
import { MemoryStore, PostgresStore, type PlayerRecord } from './store.js';
import { PvpHub } from './pvp.js';

const app = Fastify({ logger: true });
const allowedOrigins = new Set(
	(
		process.env.APP_ORIGINS ??
		'http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173'
	)
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean),
);
await app.register(cors, {
	credentials: true,
	origin(origin, callback) {
		if (!origin || allowedOrigins.has(origin)) callback(null, true);
		else callback(new Error('Origin not allowed'), false);
	},
});
await app.register(websocket);
const store = process.env.DATABASE_URL
	? new PostgresStore(process.env.DATABASE_URL)
	: new MemoryStore();
await store.initialize();
const pvp = new PvpHub((result) => store.savePvpMatch(result));
const cookieName = 'tmd_session';
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const rateBuckets = new Map<string, { count: number; start: number }>();
const mailConfig = readMailConfig();
const mailer = mailConfig
	? createTransport({
			host: mailConfig.host,
			port: mailConfig.port,
			secure: mailConfig.port === 465,
			auth: { user: mailConfig.user, pass: mailConfig.password },
		})
	: null;

app.addHook('onRequest', async (req, reply) => {
	const origin = req.headers.origin;
	if (origin && !allowedOrigins.has(origin))
		return reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED' });
	if (
		['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
		origin &&
		!allowedOrigins.has(origin)
	)
		return reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED' });
});
app.get('/health', async () => ({
	status: 'ok',
	storage: process.env.DATABASE_URL ? 'postgres' : 'memory',
	protocolVersion: PROTOCOL_VERSION,
	mailConfigured: Boolean(mailer),
}));
app.get('/api/catalog', async () => ({
	zone: CRYPT_ZONE,
	weapons: WEAPONS,
	enemies: ENEMIES,
	rewards: REWARDS,
	tilesetManifest: TILESET_MANIFEST,
}));
app.get('/api/session', async (req, reply) => {
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	return { sessionId: session.sessionId, player: publicPlayer(session.player) };
});
app.post('/api/sessions/guest', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	const parsed = guestSessionSchema.safeParse(req.body ?? {});
	if (!parsed.success) return reply.code(400).send({ code: 'INVALID_GUEST' });
	const player = await store.createGuest(parsed.data.displayName);
	const sessionId = randomUUID();
	await setSession(reply, player.id, sessionId, req);
	return { sessionId, player: publicPlayer(player) };
});

app.post('/api/auth/register', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	if (!mailer)
		return reply
			.code(503)
			.send({ code: 'MAIL_UNAVAILABLE', message: 'O envio de e-mail ainda não foi configurado.' });
	const parsed = accountRegistrationSchema.safeParse(req.body);
	if (!parsed.success)
		return reply.code(400).send({ code: 'INVALID_REGISTRATION', issues: parsed.error.issues });
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const input = parsed.data;
	const registered = await store.registerGuest(session.player.id, {
		...input,
		email: input.email.trim().toLowerCase(),
		passwordHash: hashPassword(input.password),
	});
	if (!registered.ok)
		return reply
			.code(registered.reason === 'EMAIL_TAKEN' ? 409 : 409)
			.send({ code: registered.reason });
	const token = opaqueToken();
	await store.saveAuthToken(
		registered.player.id,
		'verify_email',
		hashToken(token),
		new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	);
	try {
		await sendAccountEmail({
			to: input.email,
			displayName: input.displayName,
			kind: 'verify',
			token,
		});
	} catch (error) {
		req.log.error({ err: error }, 'email verification delivery failed');
		return reply.code(503).send({
			code: 'MAIL_DELIVERY_FAILED',
			message: 'Conta criada, mas o e-mail não foi enviado. Tente reenviar a verificação.',
		});
	}
	return { accepted: true, email: input.email, verificationRequired: true };
});
app.post('/api/auth/verify-email', async (req, reply) => {
	const body = req.body as { token?: unknown };
	if (typeof body?.token !== 'string' || body.token.length < 32)
		return reply.code(400).send({ code: 'INVALID_TOKEN' });
	const player = await store.verifyEmailToken(hashToken(body.token));
	if (!player) return reply.code(400).send({ code: 'TOKEN_EXPIRED_OR_INVALID' });
	const old = await sessionFor(req);
	if (old) await store.revokeSession(hashToken(cookieValue(req, cookieName) ?? ''));
	const sessionId = randomUUID();
	await setSession(reply, player.id, sessionId, req);
	return { verified: true, sessionId, player: publicPlayer(player) };
});
app.post('/api/auth/login', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	const parsed = accountLoginSchema.safeParse(req.body);
	if (!parsed.success) return reply.code(400).send({ code: 'INVALID_LOGIN' });
	const account = await store.getAccountByEmail(parsed.data.email.trim().toLowerCase());
	if (!account?.passwordHash || !verifyPassword(parsed.data.password, account.passwordHash))
		return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
	if (!account.emailVerified) return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED' });
	const current = await sessionFor(req);
	if (parsed.data.mergeGuest && current && !current.player.accountEmail) {
		const merged = await store.mergeGuestData(current.player.id, account.id);
		if (!merged) return reply.code(409).send({ code: 'GUEST_MERGE_REJECTED' });
	}
	const oldCookie = cookieValue(req, cookieName);
	if (oldCookie) await store.revokeSession(hashToken(oldCookie));
	const sessionId = randomUUID();
	await setSession(reply, account.id, sessionId, req);
	return { sessionId, player: publicPlayer(account) };
});
app.post('/api/auth/logout', async (req, reply) => {
	const cookie = cookieValue(req, cookieName);
	if (cookie) await store.revokeSession(hashToken(cookie));
	clearSession(reply, req);
	return { ok: true };
});
app.post('/api/auth/resend-verification', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	if (!session.player.accountEmail || session.player.emailVerified) return { accepted: true };
	if (!mailer) return reply.code(503).send({ code: 'MAIL_UNAVAILABLE' });
	const token = opaqueToken();
	await store.saveAuthToken(
		session.player.id,
		'verify_email',
		hashToken(token),
		new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	);
	await sendAccountEmail({
		to: session.player.accountEmail,
		displayName: session.player.displayName,
		kind: 'verify',
		token,
	});
	return { accepted: true };
});
app.post('/api/auth/password/reset-request', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	const parsed = passwordResetRequestSchema.safeParse(req.body);
	if (!parsed.success) return reply.code(400).send({ code: 'INVALID_EMAIL' });
	const account = await store.getAccountByEmail(parsed.data.email.trim().toLowerCase());
	if (account?.emailVerified && mailer) {
		const token = opaqueToken();
		await store.saveAuthToken(
			account.id,
			'password_reset',
			hashToken(token),
			new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		);
		try {
			await sendAccountEmail({
				to: account.accountEmail!,
				displayName: account.displayName,
				kind: 'reset',
				token,
			});
		} catch (error) {
			req.log.error({ err: error }, 'password reset delivery failed');
		}
	}
	return { accepted: true };
});
app.post('/api/auth/password/reset', async (req, reply) => {
	if (!allowAuth(req, reply)) return;
	const parsed = passwordResetSchema.safeParse(req.body);
	if (!parsed.success) return reply.code(400).send({ code: 'INVALID_RESET' });
	const changed = await store.resetPasswordToken(
		hashToken(parsed.data.token),
		hashPassword(parsed.data.password),
	);
	if (!changed) return reply.code(400).send({ code: 'TOKEN_EXPIRED_OR_INVALID' });
	clearSession(reply, req);
	return { changed: true };
});

app.get('/api/profile/:playerId', async (req, reply) => {
	const { playerId } = req.params as { playerId: string };
	const session = await sessionFor(req);
	if (!session || session.player.id !== playerId)
		return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const profile = await store.getProfile(playerId);
	return profile ?? reply.code(404).send({ code: 'PLAYER_NOT_FOUND' });
});
app.patch('/api/profile', async (req, reply) => {
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const parsed = profileUpdateSchema.safeParse(req.body);
	if (!parsed.success)
		return reply.code(400).send({ code: 'INVALID_PROFILE', issues: parsed.error.issues });
	if (session.player.accountEmail && !session.player.emailVerified)
		return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED' });
	await store.updateProfile(session.player.id, parsed.data);
	return store.getProfile(session.player.id);
});
app.get('/api/ranking', async (req, reply) => {
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const parsed = rankingQuerySchema.safeParse(req.query);
	if (!parsed.success) return reply.code(400).send({ code: 'INVALID_SCOPE' });
	const player = await store.getPlayer(session.player.id);
	if (!player?.countryCode || !player.regionCode)
		return reply.code(409).send({ code: 'REGION_REQUIRED' });
	return {
		scope: parsed.data.scope,
		entries: await store.ranking(parsed.data.scope, player.countryCode, player.regionCode),
	};
});
app.post('/api/runs', async (req, reply) => {
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const parsed = startRunSchema.safeParse(req.body);
	if (!parsed.success)
		return reply.code(400).send({ code: 'INVALID_RUN', issues: parsed.error.issues });
	const seed = parsed.data.seed ?? Math.floor(Math.random() * 0x7fffffff);
	const record = await store.startRun(session.player.id, seed, parsed.data.weaponId);
	return { run: record, dungeon: generateRun(seed) };
});
app.post('/api/runs/finish', async (req, reply) => {
	const session = await sessionFor(req);
	if (!session) return reply.code(401).send({ code: 'SESSION_REQUIRED' });
	const parsed = finishRunSchema.safeParse(req.body);
	if (!parsed.success)
		return reply.code(400).send({ code: 'INVALID_RESULT', issues: parsed.error.issues });
	const record = await store.finishRun(session.player.id, parsed.data as RunResult);
	if (!record) return reply.code(409).send({ code: 'RUN_NOT_ACTIVE' });
	return { accepted: true, run: record };
});

app.get('/ws', { websocket: true }, async (socket, request) => {
	const cookie = cookieValue(request, cookieName);
	const auth = cookie ? await store.getSession(hashToken(cookie)) : undefined;
	if (!auth) {
		socket.close(1008, 'Authentication required');
		return;
	}
	const weaponId = (await store.getActiveWeapon(auth.player.id)) ?? 'sword';
	const sessionId = auth.sessionId;
	const client = pvp.connect(sessionId, auth.player.id, weaponId, socket);
	socket.on('message', (raw) => {
		try {
			const parsed = wsEnvelopeSchema.safeParse(JSON.parse(raw.toString()));
			if (parsed.success && parsed.data.sessionId === sessionId)
				pvp.handle(client, parsed.data.type, parsed.data.payload);
		} catch {
			socket.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_MESSAGE' } }));
		}
	});
	socket.on('close', () => pvp.disconnect(sessionId));
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });

function readMailConfig() {
	const host = process.env.SMTP_HOST ?? 'smtp.gmail.com',
		port = Number(process.env.SMTP_PORT ?? 587),
		user = process.env.SMTP_USER,
		password = process.env.SMTP_PASSWORD;
	return user && password
		? {
				host,
				port,
				user,
				password,
				from: process.env.SMTP_FROM ?? user,
				baseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, ''),
			}
		: null;
}
function publicPlayer(player: PlayerRecord) {
	return {
		id: player.id,
		displayName: player.displayName,
		accountEmail: player.accountEmail,
		emailVerified: player.emailVerified,
		countryCode: player.countryCode,
		regionCode: player.regionCode,
		regionEffectiveAt: player.regionEffectiveAt,
	};
}
function cookieValue(req: FastifyRequest, name: string) {
	const header = req.headers.cookie ?? '';
	for (const part of header.split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return decodeURIComponent(value.join('='));
	}
	return undefined;
}
async function sessionFor(req: FastifyRequest) {
	const token = cookieValue(req, cookieName);
	return token ? store.getSession(hashToken(token)) : undefined;
}
async function setSession(
	reply: FastifyReply,
	playerId: string,
	sessionId: string,
	req: FastifyRequest,
) {
	const token = opaqueToken();
	await store.createSession(
		playerId,
		sessionId,
		hashToken(token),
		new Date(Date.now() + sessionDurationMs).toISOString(),
	);
	const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
	reply.header(
		'set-cookie',
		`${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secure ? '; Secure' : ''}`,
	);
}
function clearSession(reply: FastifyReply, req: FastifyRequest) {
	const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
	reply.header(
		'set-cookie',
		`${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
	);
}
function opaqueToken() {
	return randomBytes(32).toString('base64url');
}
function hashToken(value: string) {
	return createHash('sha256').update(value).digest('hex');
}
function hashPassword(password: string) {
	const salt = randomBytes(16).toString('hex');
	return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password: string, encoded: string) {
	const [algorithm, salt, hash] = encoded.split('$');
	if (algorithm !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'hex');
	const candidate = scryptSync(password, salt, expected.length);
	return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
function allowAuth(req: FastifyRequest, reply: FastifyReply) {
	const now = Date.now(),
		key = `${req.ip}:${req.routeOptions.url ?? req.url}`;
	const bucket = rateBuckets.get(key);
	if (!bucket || now - bucket.start > 60_000) {
		rateBuckets.set(key, { count: 1, start: now });
		return true;
	}
	if (bucket.count >= 8) {
		reply.code(429).send({ code: 'RATE_LIMITED' });
		return false;
	}
	bucket.count++;
	return true;
}
async function sendAccountEmail(input: {
	to: string;
	displayName: string;
	kind: 'verify' | 'reset';
	token: string;
}) {
	if (!mailer || !mailConfig) throw new Error('SMTP unavailable');
	const verify = input.kind === 'verify';
	const title = verify ? 'Confirme seu e-mail' : 'Redefina sua senha';
	const action = verify ? 'Confirmar e-mail' : 'Criar nova senha';
	const url = `${mailConfig.baseUrl}/?${verify ? 'verify' : 'reset'}=${encodeURIComponent(input.token)}`;
	const name = escapeHtml(input.displayName);
	const link = escapeHtml(url);
	const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#100d12;color:#f1ead5;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:36px 12px;background:#100d12"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #725947;background:#1a151c"><tr><td style="padding:38px 34px"><p style="margin:0 0 12px;color:#c69b68;letter-spacing:4px;font-size:11px">TEN MINUTES DUNGEON</p><h1 style="font-size:27px;margin:0 0 18px;color:#f1ead5">${title}</h1><p style="color:#c5b9ab;line-height:1.7">Olá, ${name}. ${verify ? 'Falta apenas confirmar seu endereço para preservar seu progresso e habilitar o ranking.' : 'Recebemos um pedido para redefinir a senha da sua conta.'}</p><p style="margin:30px 0"><a href="${link}" style="display:inline-block;background:#f1ead5;color:#171219;padding:15px 22px;text-decoration:none;font-weight:bold">${action}</a></p><p style="color:#9a8d81;font-size:12px;line-height:1.6">${verify ? 'Este link expira em 24 horas.' : 'Este link expira em 1 hora.'} Se você não solicitou esta ação, ignore esta mensagem.</p><p style="color:#786c65;font-size:11px;word-break:break-all">${link}</p></td></tr></table></td></tr></table></body></html>`;
	const text = `${title}\n\nOlá, ${input.displayName}. Acesse este link: ${url}\n\n${verify ? 'O link expira em 24 horas.' : 'O link expira em 1 hora.'}`;
	await mailer.sendMail({
		from: `Ten Minutes Dungeon <${mailConfig.from}>`,
		to: input.to,
		subject: `${title} — Ten Minutes Dungeon`,
		text,
		html,
	});
}
function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
	);
}
