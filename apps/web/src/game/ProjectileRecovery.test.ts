import { describe, expect, it } from 'vitest';
import { canAutoPickupKnife, isKnifePickupReady, knifePickupProgress } from './ProjectileRecovery';

describe('knife recovery', () => {
	it('unlocks pickup exactly four seconds after landing, including at time zero', () => {
		expect(isKnifePickupReady(0, 3_999)).toBe(false);
		expect(isKnifePickupReady(0, 4_000)).toBe(true);
	});

	it('allows proximity pickup only when ready and inside the pickup radius', () => {
		expect(canAutoPickupKnife(1_000, 4_999, 0)).toBe(false);
		expect(canAutoPickupKnife(1_000, 5_000, 30)).toBe(true);
		expect(canAutoPickupKnife(1_000, 5_000, 31)).toBe(false);
	});

	it('reports a clamped circular timer progress', () => {
		expect(knifePickupProgress(1_000, 1_000)).toBe(0);
		expect(knifePickupProgress(1_000, 3_000)).toBe(0.5);
		expect(knifePickupProgress(1_000, 6_000)).toBe(1);
	});
});
