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
    // Lighter vignette so upper canopy midtones aren't crushed at frame edge
    vignette: { value: 0.24 },
    lift: { value: 0.032 },
    contrast: { value: 1.06 },
    // Slight mid-tone saturation so green foliage pops against soft bg
    sat: { value: 1.05 },
    // Season temperature: negative = cooler, positive = warmer (subtle)
    temp: { value: 0.0 },
    // Mild green ambient bias for flush seasons
    greenBias: { value: 0.0 },
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
    uniform float temp;
    uniform float greenBias;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Soft contrast around mid-gray
      col = (col - 0.5) * contrast + 0.5;
      col += lift;
      // Temperature: shift R/B slightly (not Instagram)
      col.r += temp * 0.04;
      col.b -= temp * 0.035;
      // Flush seasons: whisper of greener ambient
      col.g += greenBias * 0.03;
      col.r -= greenBias * 0.01;
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

/** Subtle season grade — feel season before reading the HUD. */
export type SeasonGradeParams = {
  vignette: number;
  lift: number;
  contrast: number;
  sat: number;
  temp: number;
  greenBias: number;
};

export function seasonGradeFor(
  season: 'dormant' | 'earlyFlush' | 'mainFlush' | 'hardening' | 'rest',
): SeasonGradeParams {
  switch (season) {
    case 'dormant':
      // Cooler + lower sat — temp shift only; keep plant midtones open
      return {
        vignette: 0.28,
        lift: 0.028,
        contrast: 1.02,
        sat: 0.94,
        temp: -0.55,
        greenBias: -0.12,
      };
    case 'earlyFlush':
      return {
        vignette: 0.22,
        lift: 0.034,
        contrast: 1.05,
        sat: 1.07,
        temp: -0.1,
        greenBias: 0.5,
      };
    case 'mainFlush':
      return {
        vignette: 0.2,
        lift: 0.036,
        contrast: 1.06,
        sat: 1.1,
        temp: 0.05,
        greenBias: 0.65,
      };
    case 'hardening':
      // Warmer, drier — relative to flush, not unreadable
      return {
        vignette: 0.24,
        lift: 0.028,
        contrast: 1.08,
        sat: 1.02,
        temp: 0.45,
        greenBias: 0.05,
      };
    case 'rest':
      // Muted green — still readable bark/pads
      return {
        vignette: 0.26,
        lift: 0.026,
        contrast: 1.03,
        sat: 0.9,
        temp: -0.15,
        greenBias: 0.08,
      };
  }
}

/**
 * Subtle product-shot DOF: thin-lens feel on far floor only.
 * Prior aperture 0.018 / maxblur 0.0075 read as soft mush on subject.
 */
const DOF_APERTURE = 0.0085;
const DOF_MAX_BLUR = 0.0038;
/** Exponential smooth on focus distance (per setFocusDistance call ≈ frame). */
const DOF_FOCUS_SMOOTH = 0.14;

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
  /** Actual BokehPass on/off (respects camera + user preference). */
  private dofEnabled = true;
  /** User/harness preference — survives ortho audit temporary disable. */
  private dofWanted = true;
  private camera: THREE.Camera;
  private light: boolean;
  /** Smoothed focus distance (world units, camera→subject). */
  private focusSmoothed = 0.52;
  private focusInitialized = false;

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
      this.dofWanted = false;
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
      // Ortho geometry audits need full sharpness — DOF forced off, preference kept
      this.applyDofState();
      if (
        camera instanceof THREE.PerspectiveCamera &&
        this.bokehUniforms
      ) {
        this.bokehUniforms.aspect.value = camera.aspect;
        this.bokehUniforms.nearClip.value = camera.near;
        this.bokehUniforms.farClip.value = camera.far;
      }
    }
  }

  /**
   * Keep focus plane on the subject (orbit target / canopy bias).
   * `distance` is camera→subject world distance (matches Bokeh view-Z focus).
   * Smoothed so orbit damping does not swim the focus plane every frame.
   */
  setFocusDistance(distance: number): void {
    if (!this.dofEnabled || !this.bokehUniforms) return;
    const target = Math.max(0.05, distance);
    if (!this.focusInitialized) {
      this.focusSmoothed = target;
      this.focusInitialized = true;
    } else {
      this.focusSmoothed += (target - this.focusSmoothed) * DOF_FOCUS_SMOOTH;
    }
    this.bokehUniforms.focus.value = this.focusSmoothed;
  }

  /**
   * User / harness DOF preference. Ortho audits still force full-sharp while active.
   */
  setDofEnabled(on: boolean): void {
    if (!this.bokeh) return;
    this.dofWanted = on;
    this.applyDofState();
    if (this.dofEnabled) {
      // Avoid a large focus snap when re-enabling after orbit / A/B
      this.focusInitialized = false;
    }
  }

  get isDofEnabled(): boolean {
    return this.dofEnabled && !!this.bokeh?.enabled;
  }

  private applyDofState(): void {
    if (!this.bokeh) return;
    const isPersp = this.camera instanceof THREE.PerspectiveCamera;
    const on = this.dofWanted && isPersp;
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

  /** Drive subtle global grade from plant season (no Instagram filter). */
  setSeasonGrade(params: SeasonGradeParams): void {
    const u = this.grade.uniforms as {
      vignette: { value: number };
      lift: { value: number };
      contrast: { value: number };
      sat: { value: number };
      temp: { value: number };
      greenBias: { value: number };
    };
    u.vignette.value = params.vignette;
    u.lift.value = params.lift;
    u.contrast.value = params.contrast;
    u.sat.value = params.sat;
    u.temp.value = params.temp;
    u.greenBias.value = params.greenBias;
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
