export const KNIFE_PICKUP_DELAY_MS = 4_000;
export const KNIFE_PICKUP_RADIUS = 30;

export function isKnifePickupReady(landedAt: number | undefined, now: number) {
	return landedAt !== undefined && now - landedAt >= KNIFE_PICKUP_DELAY_MS;
}

export function knifePickupProgress(landedAt: number | undefined, now: number) {
	if (landedAt === undefined) return 0;
	return Math.max(0, Math.min(1, (now - landedAt) / KNIFE_PICKUP_DELAY_MS));
}

export function canAutoPickupKnife(landedAt: number | undefined, now: number, distance: number) {
	return isKnifePickupReady(landedAt, now) && distance <= KNIFE_PICKUP_RADIUS;
}
