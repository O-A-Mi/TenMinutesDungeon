type IconName = 'hourglass' | 'time' | 'weapon' | 'emblem' | 'potion' | 'crosshair';
export function Icon({ name, className }: { name: IconName; className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" role="img" aria-hidden="true">
			<use href={`#icon-${name}`} />
		</svg>
	);
}
export function IconDefinitions() {
	return (
		<svg
			aria-hidden="true"
			style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
		>
			<defs>
				<symbol id="icon-hourglass" viewBox="0 0 24 24">
					<path
						d="M6 3h12M6 21h12M8 4c0 4 1 6 4 8-3 2-4 4-4 8m8-16c0 4-1 6-4 8 3 2 4 4 4 8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					/>
				</symbol>
				<symbol id="icon-time" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
					<path d="M12 7v6l4 2" fill="none" stroke="currentColor" strokeWidth="2" />
				</symbol>
				<symbol id="icon-weapon" viewBox="0 0 24 24">
					<path
						d="m4 20 5-5m1-1L19 5l-1-1-9 9m1 1 3 3-3 3-6-6 3-3 3 3Z"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					/>
				</symbol>
				<symbol id="icon-emblem" viewBox="0 0 24 24">
					<path
						d="m12 2 3 5 6 1-4 5 1 7-6-3-6 3 1-7-4-5 6-1 3-5Z"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					/>
				</symbol>
				<symbol id="icon-potion" viewBox="0 0 24 24">
					<path
						d="M9 3h6M10 4v5l-5 8c-1 2 0 4 3 4h8c3 0 4-2 3-4l-5-8V4"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					/>
				</symbol>
				<symbol id="icon-crosshair" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" />
					<path d="M12 1v6m0 10v6M1 12h6m10 0h6" stroke="currentColor" strokeWidth="2" />
				</symbol>
			</defs>
		</svg>
	);
}
