export class Input {
	keys = new Set<string>();
	mouse = { x: 320, y: 160, down: false };
	private down = (e: KeyboardEvent) => {
		this.keys.add(e.code);
	};
	private up = (e: KeyboardEvent) => this.keys.delete(e.code);
	private move = (e: PointerEvent) => {
		const target = e.currentTarget as HTMLCanvasElement;
		const r = target.getBoundingClientRect();
		this.mouse.x = ((e.clientX - r.left) * target.width) / r.width;
		this.mouse.y = ((e.clientY - r.top) * target.height) / r.height;
	};
	private pointerDown = () => {
		this.mouse.down = true;
	};
	private pointerUp = () => {
		this.mouse.down = false;
	};
	attach(canvas: HTMLCanvasElement) {
		window.addEventListener('keydown', this.down);
		window.addEventListener('keyup', this.up);
		canvas.addEventListener('pointermove', this.move);
		canvas.addEventListener('pointerdown', this.pointerDown);
		window.addEventListener('pointerup', this.pointerUp);
	}
	detach(canvas: HTMLCanvasElement) {
		window.removeEventListener('keydown', this.down);
		window.removeEventListener('keyup', this.up);
		canvas.removeEventListener('pointermove', this.move);
		canvas.removeEventListener('pointerdown', this.pointerDown);
		window.removeEventListener('pointerup', this.pointerUp);
	}
	axis() {
		return {
			x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
			y: Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')),
		};
	}
}
