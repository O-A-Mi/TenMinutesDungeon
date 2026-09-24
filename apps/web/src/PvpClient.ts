import {
	PROTOCOL_VERSION,
	type PvpRoomPayload,
	type PvpSnapshotPayload,
	type WeaponId,
	type WsEnvelope,
} from '@tmd/shared';
import type { Identity } from './api';
export type PvpStatus = 'idle' | 'searching' | 'matched' | 'won' | 'lost' | 'unavailable';
export class PvpClient {
	socket?: WebSocket;
	sequence = 0;
	status: PvpStatus = 'idle';
	sessionId = '';
	private reconnectTimer: number | undefined;
	private reconnectStartedAt: number | undefined;
	private manuallyClosed = false;
	private socketOpen = false;
	private presenceReady = false;
	private handshakeComplete = false;
	constructor(
		private identity: Identity,
		private weaponId: WeaponId,
		private onStatus: (s: PvpStatus, message: string) => void,
		private onSnapshot: (snapshot: PvpSnapshotPayload) => void,
		private onRoom: (room: PvpRoomPayload) => void,
	) {}
	connect(reconnecting = false) {
		this.manuallyClosed = false;
		this.socketOpen = false;
		this.presenceReady = false;
		this.handshakeComplete = false;
		this.sessionId = this.identity.sessionId;
		const configured = import.meta.env.VITE_WS_URL as string | undefined;
		const base =
			configured ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
		this.socket = new WebSocket(`${base}?weaponId=${this.weaponId}`);
		this.socket.onopen = () => {
			this.socketOpen = true;
			this.completeHandshake(reconnecting);
		};
		this.socket.onmessage = (e) => this.receive(JSON.parse(String(e.data)), reconnecting);
		this.socket.onerror = () => {
			if (this.status !== 'matched')
				this.onStatus('unavailable', 'O círculo está silencioso. Retorne à dungeon.');
		};
		this.socket.onclose = () => {
			if (this.manuallyClosed) return;
			if (this.status === 'matched') this.scheduleReconnect();
			else if (this.status === 'searching')
				this.onStatus('unavailable', 'Conexão com o círculo perdida.');
		};
	}
	leave() {
		this.manuallyClosed = true;
		if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
		this.send(this.status === 'matched' ? 'pvp.forfeit' : 'queue.leave', {});
		this.socket?.close();
	}
	sendInput(payload: {
		moveX: number;
		moveY: number;
		aimX: number;
		aimY: number;
		attack: boolean;
	}) {
		this.send('pvp.input', payload);
	}
	private receive(message: WsEnvelope<any>, reconnecting: boolean) {
		if (message.type === 'presence.ready') {
			this.presenceReady = true;
			this.completeHandshake(reconnecting, message.payload?.reconnected === true);
		}
		if (message.type === 'queue.timeout') {
			this.status = 'unavailable';
			this.onStatus(
				'unavailable',
				'Nenhum adversário encontrado. O círculo foi encerrado sem prêmio.',
			);
		}
		if (message.type === 'match.found') {
			this.status = 'matched';
			this.onStatus('matched', 'Duelo encontrado. Derrube o outro errante.');
		}
		if (message.type === 'pvp.room') this.onRoom(message.payload as PvpRoomPayload);
		if (message.type === 'pvp.snapshot') this.onSnapshot(message.payload as PvpSnapshotPayload);
		if (message.type === 'match.ended') {
			if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
			this.reconnectStartedAt = undefined;
			const won = message.payload.winnerSessionId === this.sessionId;
			this.status = won ? 'won' : 'lost';
			this.onStatus(
				this.status,
				won ? 'Vitória. Sigilo raro conquistado.' : 'Derrota. Seu tempo continua perdido.',
			);
		}
	}
	private completeHandshake(reconnecting: boolean, serverResumed = false) {
		if (!this.socketOpen || !this.presenceReady || this.handshakeComplete) return;
		this.handshakeComplete = true;
		if (reconnecting) {
			this.reconnectStartedAt = undefined;
			if (!serverResumed) {
				this.status = 'unavailable';
				this.onStatus('unavailable', 'O prazo de retomada do duelo expirou.');
				return;
			}
			this.status = 'matched';
			this.onStatus('matched', 'Conexão retomada. O duelo continua.');
			return;
		}
		this.send('queue.join', { weaponId: this.weaponId });
		this.status = 'searching';
		this.onStatus('searching', 'Procurando outro errante…');
	}
	private scheduleReconnect() {
		if (this.reconnectStartedAt === undefined) this.reconnectStartedAt = Date.now();
		const elapsed = Date.now() - this.reconnectStartedAt;
		if (elapsed >= 8_500) {
			this.status = 'unavailable';
			this.onStatus('unavailable', 'A conexão não voltou a tempo. O duelo foi encerrado.');
			return;
		}
		if (this.reconnectTimer !== undefined) return;
		this.reconnectTimer = window.setTimeout(
			() => {
				this.reconnectTimer = undefined;
				this.connect(true);
			},
			Math.min(350, 8_500 - elapsed),
		);
	}
	private send(type: string, payload: unknown) {
		if (this.socket?.readyState !== WebSocket.OPEN) return;
		this.socket.send(
			JSON.stringify({
				version: PROTOCOL_VERSION,
				type,
				requestId: crypto.randomUUID(),
				sessionId: this.sessionId,
				sequence: ++this.sequence,
				timestamp: Date.now(),
				payload,
			}),
		);
	}
}
