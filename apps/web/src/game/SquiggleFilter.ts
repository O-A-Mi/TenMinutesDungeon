import { Filter, GlProgram, UniformGroup } from 'pixi.js';

const vertex = `in vec2 aPosition;out vec2 vTextureCoord;uniform vec4 uInputSize;uniform vec4 uOutputFrame;uniform vec4 uOutputTexture;void main(){vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;p.x=p.x*(2.0/uOutputTexture.x)-1.0;p.y=p.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z;gl_Position=vec4(p,0.0,1.0);vTextureCoord=aPosition*(uOutputFrame.zw*uInputSize.zw);}`;
const fragment = `in vec2 vTextureCoord;out vec4 finalColor;uniform sampler2D uTexture;uniform float uTime;uniform float uStrength;float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}void main(){vec2 cell=floor(vTextureCoord*vec2(24.0,32.0));float frame=floor(uTime*6.0);float n=noise(cell+vec2(frame*3.14159265,frame*2.71828182))*6.2831853;vec2 direction=vec2(cos(n),sin(n));vec2 uv=vTextureCoord+direction*uStrength*0.005;finalColor=texture(uTexture,uv);}`;

export class SquiggleFilter extends Filter {
	private uniforms: UniformGroup;
	constructor() {
		const uniforms = new UniformGroup({
			uTime: { value: 0, type: 'f32' },
			uStrength: { value: 0.18, type: 'f32' },
		});
		super({
			glProgram: GlProgram.from({ vertex, fragment, name: 'character-squiggle' }),
			resources: { squiggleUniforms: uniforms },
		});
		this.uniforms = uniforms;
	}
	update(time: number, strength: number) {
		this.uniforms.uniforms.uTime = time;
		this.uniforms.uniforms.uStrength = strength;
	}
}
