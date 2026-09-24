import type { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PvpHub } from './pvp.js';

function fakeSocket() {
	const messages: Array<{ type: string; payload: any }> = [];
	const socket = {
		readyState: 1,
		send(raw: string) {
			messages.push(JSON.parse(raw));
		},
	} as unknown as WebSocket;
	return { socket, messages };
}

afterEach(() => vi.useRealTimers());

describe('PvP matchmaking', () => {
	it('returns an unmatched player after the bounded queue window', () => {
		vi.useFakeTimers();
		const hub = new PvpHub(undefined, 500),
			connection = fakeSocket();
		const client = hub.connect('session-a', 'player-a', 'sword', connection.socket);
		hub.handle(client, 'queue.join', {});
		vi.advanceTimersByTime(500);
		expect(connection.messages.map((message) => message.type)).toContain('queue.timeout');
		expect(hub.queue).toEqual([]);
	});

	it('cancels both queue deadlines when two players share a generated room', () => {
		vi.useFakeTimers();
		const hub = new PvpHub(undefined, 500),
			connectionA = fakeSocket(),
			connectionB = fakeSocket();
		const a = hub.connect('session-a', 'player-a', 'sword', connectionA.socket);
		const b = hub.connect('session-b', 'player-b', 'knife', connectionB.socket);
		hub.handle(a, 'queue.join', {});
		hub.handle(b, 'queue.join', {});
		expect(connectionA.messages.map((message) => message.type)).toContain('pvp.room');
		expect(connectionB.messages.map((message) => message.type)).toContain('pvp.room');
		hub.handle(a, 'pvp.forfeit', {});
		vi.advanceTimersByTime(500);
		expect(connectionA.messages.map((message) => message.type)).not.toContain('queue.timeout');
		expect(connectionB.messages.map((message) => message.type)).not.toContain('queue.timeout');
		expect(connectionB.messages.map((message) => message.type)).toContain('match.ended');
	});
});
