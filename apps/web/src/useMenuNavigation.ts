import { useEffect } from 'react';

const selector = 'button:not(:disabled), select:not(:disabled), input:not(:disabled)';

export function useMenuNavigation(enabled: boolean, contextKey: string) {
	useEffect(() => {
		if (!enabled) return;
		const candidates = () => {
			const overlays = [...document.querySelectorAll<HTMLElement>('.overlay')].filter(isVisible);
			const scope: ParentNode = overlays.at(-1) ?? document;
			return [...scope.querySelectorAll<HTMLElement>(selector)].filter(isVisible);
		};
		const focusFirst = window.setTimeout(() => {
			const items = candidates();
			if (
				!(document.activeElement instanceof HTMLElement) ||
				document.activeElement === document.body ||
				!items.includes(document.activeElement)
			)
				items[0]?.focus();
		}, 40);
		const onKey = (event: KeyboardEvent) => {
			const direction = directionFor(event.code);
			if (!direction) return;
			const items = candidates();
			if (!items.length) return;
			const current =
				document.activeElement instanceof HTMLElement && items.includes(document.activeElement)
					? document.activeElement
					: items[0]!;
			if (
				current instanceof HTMLInputElement &&
				current.type === 'range' &&
				(event.code === 'ArrowLeft' || event.code === 'ArrowRight')
			)
				return;
			const step = direction === 'up' || direction === 'left' ? -1 : 1;
			const currentIndex = items.indexOf(current);
			const linearMenu = current.closest('[data-navigation="linear"]');
			if (linearMenu) {
				event.preventDefault();
				const next = items[(currentIndex + step + items.length) % items.length];
				next?.focus();
				next?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
				return;
			}
			const fallback = items[(currentIndex + step + items.length) % items.length];
			const next = spatialNeighbor(current, items, direction) ?? fallback;
			event.preventDefault();
			next?.focus();
			next?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
		};
		window.addEventListener('keydown', onKey);
		return () => {
			clearTimeout(focusFirst);
			window.removeEventListener('keydown', onKey);
		};
	}, [enabled, contextKey]);
}

function directionFor(code: string): 'up' | 'down' | 'left' | 'right' | null {
	if (code === 'ArrowUp' || code === 'KeyW') return 'up';
	if (code === 'ArrowDown' || code === 'KeyS') return 'down';
	if (code === 'ArrowLeft' || code === 'KeyA') return 'left';
	if (code === 'ArrowRight' || code === 'KeyD') return 'right';
	return null;
}

function spatialNeighbor(
	current: HTMLElement,
	items: HTMLElement[],
	direction: 'up' | 'down' | 'left' | 'right',
) {
	const source = center(current.getBoundingClientRect());
	const vertical = direction === 'up' || direction === 'down';
	const sign = direction === 'up' || direction === 'left' ? -1 : 1;
	return items
		.filter((item) => item !== current)
		.map((item) => {
			const point = center(item.getBoundingClientRect());
			const primary = vertical ? point.y - source.y : point.x - source.x;
			const secondary = vertical ? Math.abs(point.x - source.x) : Math.abs(point.y - source.y);
			return { item, primary, score: Math.abs(primary) + secondary * 2.4 };
		})
		.filter((entry) => Math.sign(entry.primary) === sign && Math.abs(entry.primary) > 2)
		.sort((a, b) => a.score - b.score)[0]?.item;
}

function center(rect: DOMRect) {
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
function isVisible(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}
