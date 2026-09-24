import { Filter, GlProgram, UniformGroup } from 'pixi.js';
import type { ZonePalette } from '@tmd/shared';
const vertex = `in vec2 aPosition;out vec2 vTextureCoord;uniform vec4 uInputSize;uniform vec4 uOutputFrame;uniform vec4 uOutputTexture;void main(){vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;p.x=p.x*(2.0/uOutputTexture.x)-1.0;p.y=p.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z;gl_Position=vec4(p,0.0,1.0);vTextureCoord=aPosition*(uOutputFrame.zw*uInputSize.zw);}`;
const fragment = `in vec2 vTextureCoord;out vec4 finalColor;uniform sampler2D uTexture;uniform vec4 uShadow;uniform vec4 uDark;uniform vec4 uMid;uniform vec4 uLight;uniform vec4 uHighlight;void main(){vec4 source=texture(uTexture,vTextureCoord);if(source.a<=0.0){finalColor=source;return;}vec3 raw=source.rgb/source.a;float l=dot(raw,vec3(.2126,.7152,.0722));vec4 mapped=l<.20?uShadow:l<.40?uDark:l<.65?uMid:l<.85?uLight:uHighlight;finalColor=vec4(mapped.rgb*source.a,source.a);}`;
export class PaletteFilter extends Filter {
	constructor(palette: ZonePalette) {
		const uniforms = new UniformGroup({
			uShadow: { value: color(palette.shadow), type: 'vec4<f32>' },
			uDark: { value: color(palette.dark), type: 'vec4<f32>' },
			uMid: { value: color(palette.mid), type: 'vec4<f32>' },
			uLight: { value: color(palette.light), type: 'vec4<f32>' },
			uHighlight: { value: color(palette.highlight), type: 'vec4<f32>' },
		});
		super({
			glProgram: GlProgram.from({ vertex, fragment, name: 'five-band-zone-palette' }),
			resources: { paletteUniforms: uniforms },
		});
	}
}
function color(value: number) {
	return new Float32Array([
		((value >> 16) & 255) / 255,
		((value >> 8) & 255) / 255,
		(value & 255) / 255,
		1,
	]);
}
