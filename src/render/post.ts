import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Soft vignette + contrast lift so the bonsai reads as the hero.
 * Keeps the zen-garden IBL present in reflections without a busy look.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.34 },
    lift: { value: 0.02 },
    contrast: { value: 1.1 },
    // Slight mid-tone saturation so green foliage pops against soft bg
    sat: { value: 1.06 },
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
    uniform float sat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Soft contrast around mid-gray
      col = (col - 0.5) * contrast + 0.5;
      col += lift;
      // Gentle saturation
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, sat);
      // Radial vignette — pulls the eye to the tree / pot
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.88, 0.18, length(d) * 1.4);
      col *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

/** Subtle product-shot DOF: focus on bonsai, soft floor / far field. */
const DOF_APERTURE = 0.018;
const DOF_MAX_BLUR = 0.0075;

type BokehUniforms = {
  focus: { value: number };
  aspect: { value: number };
  aperture: { value: number };
  maxblur: { value: number };
  nearClip: { value: number };
  farClip: { value: number };
  [key: string]: { value: unknown };
};

export type StudioPostOptions = {
  /** Skip BokehPass (soft GL / SwiftShader) — grade + SMAA only. */
  light?: boolean;
};

export class StudioPost {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bokeh: BokehPass | null = null;
  private bokehUniforms: BokehUniforms | null = null;
  private smaa: SMAAPass;
  private grade: ShaderPass;
  private enabled = true;
  private dofEnabled = true;
  private camera: THREE.Camera;
  private light: boolean;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: StudioPostOptions = {},
  ) {
    this.camera = camera;
    this.light = opts.light ?? false;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Full DOF only on real GPUs — depth pass is too heavy for soft GL
    if (!this.light) {
      this.bokeh = new BokehPass(scene, camera, {
        focus: 0.52,
        aperture: DOF_APERTURE,
        maxblur: DOF_MAX_BLUR,
      });
      this.bokehUniforms = this.bokeh.uniforms as BokehUniforms;
      this.composer.addPass(this.bokeh);
    } else {
      this.dofEnabled = false;
    }

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

  /** Swap the camera used by render + DOF (e.g. ortho audit views). */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
    if (this.bokeh) {
      this.bokeh.camera = camera;
      // Ortho geometry audits need full sharpness — no DOF
      const isPersp = camera instanceof THREE.PerspectiveCamera;
      this.setDofEnabled(isPersp);
      if (isPersp && this.bokehUniforms) {
        this.bokehUniforms.aspect.value = camera.aspect;
        this.bokehUniforms.nearClip.value = camera.near;
        this.bokehUniforms.farClip.value = camera.far;
      }
    }
  }

  /**
   * Keep focus plane on the orbit target (bonsai / pot center).
   * `distance` is camera→target world distance (matches Bokeh view-Z focus).
   */
  setFocusDistance(distance: number): void {
    if (!this.dofEnabled || !this.bokehUniforms) return;
    this.bokehUniforms.focus.value = Math.max(0.05, distance);
  }

  setDofEnabled(on: boolean): void {
    if (!this.bokeh) return;
    this.dofEnabled = on;
    this.bokeh.enabled = on;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    const pr = this.renderer.getPixelRatio();
    this.smaa.setSize(width * pr, height * pr);
    this.bokeh?.setSize(width * pr, height * pr);
    if (this.bokehUniforms) {
      if (this.camera instanceof THREE.PerspectiveCamera) {
        this.bokehUniforms.aspect.value = this.camera.aspect;
      } else {
        this.bokehUniforms.aspect.value = width / Math.max(height, 1);
      }
    }
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
    }
  }

  dispose(): void {
    this.composer.dispose();
    this.bokeh?.dispose();
  }
}
