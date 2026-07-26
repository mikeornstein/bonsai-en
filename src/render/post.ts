import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Soft vignette + slight contrast lift for product-photo grade.
 * Kept subtle — zen, not cinematic HDR game look.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.28 },
    lift: { value: 0.03 },
    contrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float lift;
    uniform float contrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Soft contrast around mid-gray
      col = (col - 0.5) * contrast + 0.5;
      col += lift;
      // Radial vignette
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.15, length(d) * 1.35);
      col *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

export class StudioPost {
  readonly composer: EffectComposer;
  private smaa: SMAAPass;
  private grade: ShaderPass;
  private enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(size.x * pr));
    const h = Math.max(1, Math.floor(size.y * pr));
    this.smaa = new SMAAPass(w, h);
    this.composer.addPass(this.smaa);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass handles color space / tone mapping for composer path
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const pr = this.renderer.getPixelRatio();
    this.smaa.setSize(width * pr, height * pr);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  render(): void {
    if (this.enabled) {
      this.composer.render();
    } else {
      // Caller must render scene directly
    }
  }

  dispose(): void {
    this.composer.dispose();
  }
}
