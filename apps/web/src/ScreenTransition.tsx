import { useCallback, useRef, useState } from 'react';

export function useScreenTransition() {
	const [phase, setPhase] = useState<'idle' | 'covering' | 'covered' | 'revealing'>('idle');
	const running = useRef(false);
	const run = useCallback(async (swap: () => void | Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setPhase('covering');
		await wait(200);
		setPhase('covered');
		await swap();
		await wait(500);
		setPhase('revealing');
		await wait(200);
		setPhase('idle');
		running.current = false;
	}, []);
	return { phase, run, busy: phase !== 'idle' };
}

export function ScreenTransition({
	phase,
}: {
	phase: 'idle' | 'covering' | 'covered' | 'revealing';
}) {
	return (
		<div className={`screen-transition ${phase}`} aria-hidden="true">
			<i className="transition-wine" />
			<i className="transition-black" />
		</div>
	);
}
function wait(ms: number) {
	return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}
