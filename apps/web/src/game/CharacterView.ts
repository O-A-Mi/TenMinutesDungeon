import { Container, Graphics } from 'pixi.js';
import { SquiggleFilter } from './SquiggleFilter';

export class CharacterView extends Container {
	private body = new Graphics();
	private echoA = new Graphics();
	private echoB = new Graphics();
	private lighting = new Graphics();
	private warmLight = new Graphics();
	private clock = 0;
	private baseColor: number;
	private flashMs = 0;
	private wasFlashing = false;
	private godrayLit = false;
	private squiggle = new SquiggleFilter();
	constructor(
		color: number,
		private size = 22,
	) {
		super();
		this.baseColor = color;
		this.lighting.blendMode = 'multiply';
		this.warmLight.blendMode = 'screen';
		this.addChild(this.echoA, this.echoB, this.body, this.lighting, this.warmLight);
		this.draw(color);
		this.drawLighting(0x3a203f, 0.32);
		this.filters = [this.squiggle];
	}
	private drawLighting(color: number, alpha: number) {
		const s = this.size;
		this.lighting
			.clear()
			.circle(0, -s * 0.18, s * 0.28)
			.fill({ color, alpha })
			.roundRect(-s * 0.32, 0, s * 0.64, s * 0.68, 3)
			.fill({ color, alpha })
			.moveTo(-s * 0.32, s * 0.18)
			.lineTo(-s * 0.52, s * 0.62)
			.stroke({ color, alpha, width: 4 })
			.moveTo(s * 0.32, s * 0.18)
			.lineTo(s * 0.52, s * 0.62)
			.stroke({ color, alpha, width: 4 });
	}
	private drawWarmLight(alpha: number) {
		const s = this.size;
		this.warmLight
			.clear()
			.circle(0, s * 0.12, s * 0.65)
			.fill({ color: 0xffdda0, alpha });
	}
	setAmbientLighting(insideGodray: boolean) {
		if (insideGodray === this.godrayLit) return;
		this.godrayLit = insideGodray;
		this.drawLighting(0x3a203f, insideGodray ? 0.16 : 0.32);
		this.drawWarmLight(insideGodray ? 0.28 : 0);
	}
	private draw(color: number) {
		const s = this.size;
		const paint = (g: Graphics, alpha: number) => {
			g.clear()
				.circle(0, -s * 0.18, s * 0.28)
				.fill({ color: 0xe8d6bd, alpha })
				.roundRect(-s * 0.32, 0, s * 0.64, s * 0.68, 3)
				.fill({ color, alpha })
				.moveTo(-s * 0.32, s * 0.18)
				.lineTo(-s * 0.52, s * 0.62)
				.stroke({ color, alpha, width: 4 })
				.moveTo(s * 0.32, s * 0.18)
				.lineTo(s * 0.52, s * 0.62)
				.stroke({ color, alpha, width: 4 });
		};
		paint(this.echoA, 0.14);
		paint(this.echoB, 0.1);
		paint(this.body, 1);
	}
	setColor(color: number) {
		this.baseColor = color;
		this.draw(color);
	}
	flash(durationMs = 100) {
		this.flashMs = Math.max(this.flashMs, durationMs);
		this.wasFlashing = true;
		this.draw(0xffffff);
	}
	animate(dt: number, moving: boolean) {
		this.clock += dt;
		this.flashMs = Math.max(0, this.flashMs - dt * 1000);
		if (this.flashMs === 0 && this.wasFlashing) {
			this.draw(this.baseColor);
			this.wasFlashing = false;
		}
		const bounce = moving ? Math.sin(this.clock * 12) * 2.2 : Math.sin(this.clock * 3) * 0.35;
		const angle = moving ? Math.sin(this.clock * 10) * ((3 * Math.PI) / 180) : 0;
		this.body.y = bounce;
		this.body.rotation = angle;
		this.lighting.y = bounce;
		this.lighting.rotation = angle;
		this.warmLight.y = bounce;
		this.warmLight.rotation = angle;
		this.echoA.x = Math.sin(this.clock * 17) * 1.5;
		this.echoA.y = bounce - 1;
		this.echoB.x = Math.cos(this.clock * 13) * 1.3;
		this.echoB.y = bounce + 1;
		this.squiggle.update(this.clock, moving ? 0.36 : 0.14);
	}
}
