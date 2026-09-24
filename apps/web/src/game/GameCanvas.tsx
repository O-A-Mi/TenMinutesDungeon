import { useEffect, useRef } from 'react';
import type { SeededRun, WeaponId } from '@tmd/shared';
import { GameEngine } from './GameEngine';
import type { GameCallbacks } from './types';
export function GameCanvas({
	weaponId,
	dungeon,
	callbacks,
	paused,
	timerSeconds,
	reduceFlashes = false,
	showRangeGuide = true,
	zoneIndex,
	emblemIds,
	onEngine,
}: {
	weaponId: WeaponId;
	dungeon: SeededRun;
	callbacks: GameCallbacks;
	paused: boolean;
	timerSeconds?: number;
	reduceFlashes?: boolean;
	showRangeGuide?: boolean;
	zoneIndex: number;
	emblemIds: string[];
	onEngine: (engine: GameEngine | null) => void;
}) {
	const host = useRef<HTMLDivElement>(null),
		engineRef = useRef<GameEngine | null>(null);
	useEffect(() => {
		if (!host.current) return;
		const base = {
			weaponId,
			dungeon,
			callbacks,
			emblemIds,
			reduceFlashes,
			showRangeGuide,
			zoneIndex,
		};
		const options = timerSeconds === undefined ? base : { ...base, timerSeconds };
		const engine = new GameEngine(options);
		engineRef.current = engine;
		void engine.mount(host.current).then(() => onEngine(engine));
		return () => {
			engineRef.current = null;
			onEngine(null);
			engine.destroy();
		};
	}, [weaponId, dungeon, timerSeconds, zoneIndex]);
	useEffect(() => {
		engineRef.current?.setReduceFlashes(reduceFlashes);
	}, [reduceFlashes]);
	useEffect(() => {
		engineRef.current?.setShowRangeGuide(showRangeGuide);
	}, [showRangeGuide]);
	useEffect(() => {
		engineRef.current?.setCallbacks(callbacks);
	}, [callbacks]);
	useEffect(() => {
		engineRef.current?.setEmblems(emblemIds);
	}, [emblemIds.join('|')]);
	return <div className="game-canvas" ref={host} data-paused={paused} />;
}
