import type { RunResult, ScoreBreakdown } from './types.js';
export function calculateScore(result: RunResult): ScoreBreakdown {
	const rooms = result.roomsCleared * 100,
		zones = (result.zonesCleared ?? 0) * 1500,
		guardians = (result.guardiansDefeated ?? 0) * 1000,
		enemies = result.enemiesDefeated * 25,
		elites = 0,
		pvpVictories = (result.pvpVictories ?? 0) * 750,
		extractedLoot = result.extractedLootValue ?? 0,
		timeRemaining = Math.floor((result.timeRemainingMs ?? 0) / 1000) * 2,
		penalties = result.outcome === 'collapse' ? -500 : 0;
	return {
		rooms,
		zones,
		guardians,
		enemies,
		elites,
		pvpVictories,
		extractedLoot,
		timeRemaining,
		penalties,
		total: Math.max(
			0,
			rooms +
				zones +
				guardians +
				enemies +
				elites +
				pvpVictories +
				extractedLoot +
				timeRemaining +
				penalties,
		),
	};
}
export function verifyRunResult(result: RunResult) {
	const flags: string[] = [];
	if ((result.zonesCleared ?? 0) > 3) flags.push('zones_exceeded');
	if ((result.guardiansDefeated ?? 0) > (result.zonesCleared ?? 0) + 1)
		flags.push('guardian_count');
	if (result.roomsCleared > 30) flags.push('room_count');
	if (result.enemiesDefeated > 500) flags.push('enemy_count');
	if ((result.activePlayMs ?? result.elapsedMs) > result.elapsedMs + 1000)
		flags.push('active_time');
	if (result.events?.some((event, index) => event.sequence !== index)) flags.push('event_sequence');
	return { verified: flags.length === 0, flags, score: calculateScore(result) };
}
