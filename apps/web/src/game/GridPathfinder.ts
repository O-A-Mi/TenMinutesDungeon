export interface GridPoint {
	x: number;
	y: number;
}

export function findGridPath(
	start: GridPoint,
	goal: GridPoint,
	width: number,
	height: number,
	isBlocked: (x: number, y: number) => boolean,
): GridPoint[] {
	const key = (p: GridPoint) => p.y * width + p.x;
	const startKey = key(start),
		goalKey = key(goal);
	if (startKey === goalKey) return [];
	const open: GridPoint[] = [start],
		cameFrom = new Map<number, GridPoint>();
	const g = new Map<number, number>([[startKey, 0]]),
		queued = new Set<number>([startKey]);
	while (open.length) {
		open.sort((a, b) => g.get(key(a))! + distance(a, goal) - (g.get(key(b))! + distance(b, goal)));
		const current = open.shift()!,
			currentKey = key(current);
		queued.delete(currentKey);
		if (currentKey === goalKey) {
			const result: GridPoint[] = [];
			let cursor = current;
			while (key(cursor) !== startKey) {
				result.unshift(cursor);
				cursor = cameFrom.get(key(cursor))!;
			}
			return result;
		}
		for (const next of neighbors(current, width, height)) {
			if (key(next) !== goalKey && isBlocked(next.x, next.y)) continue;
			const score = g.get(currentKey)! + 1,
				nextKey = key(next);
			if (score >= (g.get(nextKey) ?? Infinity)) continue;
			cameFrom.set(nextKey, current);
			g.set(nextKey, score);
			if (!queued.has(nextKey)) {
				open.push(next);
				queued.add(nextKey);
			}
		}
	}
	return [];
}
const distance = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function neighbors(p: GridPoint, width: number, height: number) {
	return [
		{ x: p.x + 1, y: p.y },
		{ x: p.x - 1, y: p.y },
		{ x: p.x, y: p.y + 1 },
		{ x: p.x, y: p.y - 1 },
	].filter((n) => n.x >= 0 && n.y >= 0 && n.x < width && n.y < height);
}
