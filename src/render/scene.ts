import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import { bendDirFromViewDelta } from '../sim/tools/wire';
import type { NodeId, TreeState } from '../sim/types';
import {
  PEDESTAL_HEIGHT,
  POT_SOIL_LOCAL_Y,
  createPotGroup,
  createStudioBase,
} from './pot';
import { StudioPost, seasonGradeFor, type SeasonGradeParams } from './post';
import type { Season } from '../sim/types';
import {
  createStudioBackgroundTexture,
  createZenGardenEnvEquirectTexture,
} from './textures';
import { TreeRenderer } from './treeMesh';
import { SumiChallenge } from './sumi';

function clampDot(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function detectSoftGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext() as WebGLRenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return false;
    const gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
    return /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpu);
  } catch {
    return false;
  }
}

/** Named camera presets for screenshot / geometry audit harness. */
export type CameraViewName =
  | 'default'
  | 'front'
  | 'right'
  | 'top'
  | 'top-close'
  | 'front-low';

export class BonsaiScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** Active camera (perspective play camera or ortho audit camera). */
  camera: THREE.Camera;
  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  readonly treeRenderer: TreeRenderer;
  readonly sumi: SumiChallenge;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  private pot: THREE.Group;
  private studioBase: THREE.Group;
  /** Raises pot + tree onto the pedestal top. */
  private stage = new THREE.Group();
  private dirty = true;
  private bgTex: THREE.Texture;
  private envMap: THREE.Texture | null = null;
  private post: StudioPost | null = null;
  /** DOF preference applied when post stack becomes available. */
  private dofWanted = true;
  private softGL = false;
  private view: CameraViewName = 'default';
  /**
   * True after the player has orbited/zoomed/panned this session.
   * When set, growth-time auto-fit must not reframe (#60).
   */
  private cameraUserOwned = false;
  /**
   * Practice front lock (#66): disable orbit rotate so eyes stay on the
   * front-plane (x–y) that sumi score uses. Zoom/pan stay available.
   */
  private frontLock = false;
  /** Saved play-camera pose so audit views can restore cleanly. */
  private savedPerspPos = new THREE.Vector3(0.34, 0.24, 0.42);
  private savedPerspTarget = new THREE.Vector3(0, PEDESTAL_HEIGHT + 0.12, 0);
  private savedControlsEnabled = true;
  /** Camera kinematics for physics inertial field. */
  private prevCamPos = new THREE.Vector3(0.34, 0.24, 0.42);
  private prevCamVel = new THREE.Vector3();
  private prevCamDir = new THREE.Vector3(0, 0, -1);
  private camMotionReady = false;
  private lastCamAccel = new THREE.Vector3();
  private prevCamOmega = new THREE.Vector3();
  private pendingSeasonGrade: SeasonGradeParams | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // WebGL first — fail fast with a clear error if unavailable
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    if (!this.renderer.getContext()) {
      throw new Error('WebGL context could not be created');
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Open plant midtones vs bright cyclorama (was 1.08 — tree read as silhouette)
    this.renderer.toneMappingExposure = 1.16;

    this.softGL = detectSoftGL(this.renderer);

    this.scene = new THREE.Scene();
    try {
      this.bgTex = createStudioBackgroundTexture();
      this.scene.background = this.bgTex;
    } catch {
      this.bgTex = new THREE.Texture();
      this.scene.background = new THREE.Color(0xe6e1d8);
    }

    const aspect =
      Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1);
    this.perspectiveCamera = new THREE.PerspectiveCamera(32, aspect, 0.01, 50);
    this.perspectiveCamera.position.set(0.34, 0.24, 0.42);

    // Ortho frustum is set in setView(); half-extents are aspect-aware.
    this.orthoCamera = new THREE.OrthographicCamera(
      -0.25 * aspect,
      0.25 * aspect,
      0.25,
      -0.25,
      0.01,
      20,
    );
    this.camera = this.perspectiveCamera;

    this.controls = new OrbitControls(this.perspectiveCamera, canvas);
    this.controls.target.set(0, PEDESTAL_HEIGHT + 0.12, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.16;
    this.controls.maxDistance = 1.5;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.update();
    // Once the player orbits/zooms, growth must not steal framing (#60)
    this.controls.addEventListener('start', () => {
      this.cameraUserOwned = true;
    });
    canvas.addEventListener(
      'wheel',
      () => {
        this.cameraUserOwned = true;
      },
      { passive: true },
    );

    this.setupLights();

    // Heavy scene graph after renderer is alive
    this.treeRenderer = new TreeRenderer();
    this.sumi = new SumiChallenge();
    this.pot = createPotGroup();
    this.studioBase = createStudioBase();

    this.stage.position.y = PEDESTAL_HEIGHT;
    this.stage.add(this.pot);
    this.stage.add(this.treeRenderer.group);

    this.scene.add(this.studioBase);
    this.scene.add(this.stage);
    this.scene.add(this.sumi.group);

    // IBL + post are best-effort (must not block boot)
    try {
      this.setupEnvironment();
    } catch (err) {
      console.warn('[bonsai-en] environment setup failed', err);
    }

    // Post is optional polish — never block boot. Soft GL (SwiftShader)
    // skips the stack entirely so the main thread stays interactive for
    // screenshot harnesses; real GPUs get DOF + grade after first frame.
    if (!this.softGL) {
      requestAnimationFrame(() => {
        try {
          this.post = new StudioPost(this.renderer, this.scene, this.camera);
          this.post.setSize(
            Math.max(window.innerWidth, 1),
            Math.max(window.innerHeight, 1),
          );
          if (this.pendingSeasonGrade) {
            this.post.setSeasonGrade(this.pendingSeasonGrade);
          }
          // Honor ?dof=0 / harness set before post existed
          this.post.setDofEnabled(this.dofWanted);
        } catch (err) {
          console.warn('[bonsai-en] post stack disabled', err);
          this.post = null;
        }
      });
    }

    window.addEventListener('resize', this.onResize);
  }

  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // Zen-garden HDRI → realistic ceramic / wire reflections without a busy backdrop
    const equirect = createZenGardenEnvEquirectTexture();
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    const envRT = pmrem.fromEquirectangular(equirect);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;
    // IBL for glaze / bark form; foliage stays mostly sheen-driven
    this.scene.environmentIntensity = 0.68;
    equirect.dispose();
    pmrem.dispose();
  }

  private setupLights(): void {
    // Cool sky / warm ground — lifts shadow-side bark + pads without flattening
    const hemi = new THREE.HemisphereLight(0xf0f5fc, 0xd8cbb8, 0.58);
    this.hemiLight = hemi;
    this.scene.add(hemi);

    // Soft window key — slightly less hard than before so canopy shadow doesn't ink out
    const sun = new THREE.DirectionalLight(0xfff4e8, 1.28);
    sun.position.set(1.15, 1.55, 0.55);
    sun.castShadow = true;
    // Must be in the scene graph for the light to track the target
    sun.target.position.set(0, PEDESTAL_HEIGHT + 0.04, 0);
    this.scene.add(sun.target);
    this.keyLight = sun;

    // Higher res + tight frustum so mm-scale feet resolve on the pedestal top
    const map = this.softGL ? 1024 : 2048;
    sun.shadow.mapSize.set(map, map);
    const sc = sun.shadow.camera;
    sc.near = 0.2;
    sc.far = 4;
    sc.left = -0.38;
    sc.right = 0.38;
    sc.top = 0.38;
    sc.bottom = -0.38;
    sc.updateProjectionMatrix();
    // Bias tuned for FOOT_H ≈ 0.004. Prior normalBias 0.01 (~3× foot height)
    // caused heavy peter-panning — shadows floated off the pedestal.
    sun.shadow.bias = -0.00006;
    sun.shadow.normalBias = 0.0003;
    // Slightly softer contact under canopy (still readable on pedestal)
    sun.shadow.radius = this.softGL ? 1.2 : 2.0;
    this.scene.add(sun);

    // Cool fill opens the key-shadow side of trunk and pads
    const fill = new THREE.DirectionalLight(0xd4e2ff, 0.48);
    fill.position.set(-1.5, 1.0, -0.55);
    this.fillLight = fill;
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.28);
    rim.position.set(0.05, 0.75, -1.5);
    this.scene.add(rim);

    // Floor bounce — opens underside of pads / lower trunk without killing contact shadow
    const bounce = new THREE.DirectionalLight(0xece4d6, 0.14);
    bounce.position.set(0.15, 0.05, -0.35);
    this.scene.add(bounce);
  }

  /**
   * Subtle season grade on post stack + mild key/fill Kelvin shift.
   * Soft GL (no post): light path only.
   */
  applySeasonLook(season: Season): void {
    const grade = seasonGradeFor(season);
    this.pendingSeasonGrade = grade;
    this.post?.setSeasonGrade(grade);
    this.treeRenderer.setSeason(season);
    // Tip pad assignment depends on season — rebuild when it changes
    this.dirty = true;

    // Window Kelvin / intensity by season — temp shift, not “turn off the plant”
    if (this.keyLight) {
      const colors: Record<Season, number> = {
        dormant: 0xe8eef8,
        earlyFlush: 0xf2f6ec,
        mainFlush: 0xf6f8e8,
        hardening: 0xfff0dc,
        rest: 0xeeece8,
      };
      // Floors raised so dormant/rest stay readable midtones
      const intensities: Record<Season, number> = {
        dormant: 1.12,
        earlyFlush: 1.26,
        mainFlush: 1.34,
        hardening: 1.28,
        rest: 1.16,
      };
      this.keyLight.color.setHex(colors[season]);
      this.keyLight.intensity = intensities[season];
      // Keep window direction; slight seasonal elevation
      const elev = season === 'dormant' ? 1.35 : season === 'rest' ? 1.4 : 1.55;
      this.keyLight.position.set(1.15, elev, 0.55);
    }
    if (this.hemiLight) {
      if (season === 'dormant' || season === 'rest') {
        this.hemiLight.intensity = 0.52;
        this.hemiLight.color.setHex(0xe8eef4);
      } else if (season === 'mainFlush' || season === 'earlyFlush') {
        this.hemiLight.intensity = 0.6;
        this.hemiLight.color.setHex(0xf0f6ec);
      } else {
        this.hemiLight.intensity = 0.56;
        this.hemiLight.color.setHex(0xf4f0e8);
      }
    }
    if (this.fillLight) {
      // Cool fill stays strong in cool seasons so bark form remains
      this.fillLight.intensity =
        season === 'dormant' ? 0.54 : season === 'rest' ? 0.5 : 0.46;
    }
  }

  private onResize = () => {
    const w = Math.max(window.innerWidth, 1);
    const h = Math.max(window.innerHeight, 1);
    const aspect = w / h;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    // Keep ortho aspect in sync if currently in an audit view
    if (this.view !== 'default') {
      this.applyOrthoFrustum(this.view);
    }
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
  };

  /**
   * Switch between the play perspective camera and orthographic audit views.
   * Used by the Puppeteer screenshot harness (`window.__bonsai.setView`).
   */
  setView(view: CameraViewName): void {
    if (view === 'default') {
      // Restore play pose + FOV (close-ups may have narrowed it)
      this.perspectiveCamera.position.copy(this.savedPerspPos);
      this.perspectiveCamera.fov = 32;
      this.perspectiveCamera.near = 0.01;
      this.perspectiveCamera.far = 50;
      this.perspectiveCamera.updateProjectionMatrix();
      this.controls.target.copy(this.savedPerspTarget);
      this.controls.enabled = this.savedControlsEnabled;
      this.controls.enableDamping = true;
      // Front lock only affects rotate; keep zoom/pan for framing (#66)
      this.controls.enableRotate = !this.frontLock;
      this.controls.object = this.perspectiveCamera;
      this.controls.update();
      this.view = 'default';
      this.camera = this.perspectiveCamera;
      this.post?.setCamera(this.camera);
      return;
    }

    // Snapshot play pose once when leaving default
    if (this.view === 'default') {
      this.savedPerspPos.copy(this.perspectiveCamera.position);
      this.savedPerspTarget.copy(this.controls.target);
      this.savedControlsEnabled = this.controls.enabled;
    }

    this.view = view;
    this.controls.enabled = false;
    this.controls.enableDamping = false;

    const target = this.computeViewTarget(view);
    const dist = 1.2;
    const cam = this.orthoCamera;
    cam.up.set(0, 1, 0);

    switch (view) {
      case 'front':
        cam.position.set(target.x, target.y, target.z + dist);
        break;
      case 'front-low':
        cam.position.set(target.x, target.y, target.z + dist);
        break;
      case 'right':
        cam.position.set(target.x + dist, target.y, target.z);
        break;
      case 'top':
      case 'top-close':
        cam.up.set(0, 0, -1);
        cam.position.set(target.x, target.y + dist, target.z);
        break;
    }

    cam.lookAt(target);
    this.applyOrthoFrustum(view);
    this.camera = cam;
    this.post?.setCamera(this.camera);
  }

  private computeViewTarget(view: CameraViewName): THREE.Vector3 {
    // Stage origin is pedestal top; soil sits at POT_SOIL_LOCAL_Y above that.
    const soilY = PEDESTAL_HEIGHT + POT_SOIL_LOCAL_Y;
    if (view === 'front-low') {
      return new THREE.Vector3(0, PEDESTAL_HEIGHT + 0.03, 0);
    }
    if (view === 'top' || view === 'top-close') {
      return new THREE.Vector3(0, soilY, 0);
    }
    // Front / right: center on pot + lower trunk
    return new THREE.Vector3(0, soilY + 0.06, 0);
  }

  private applyOrthoFrustum(view: CameraViewName): void {
    const w = Math.max(window.innerWidth, 1);
    const h = Math.max(window.innerHeight, 1);
    const aspect = w / h;

    // Half-height of the orthographic window in world units
    let halfH = 0.22;
    if (view === 'top') halfH = 0.16;
    if (view === 'top-close') halfH = 0.1;
    if (view === 'front-low') halfH = 0.14;
    if (view === 'front' || view === 'right') halfH = 0.2;

    const halfW = halfH * aspect;
    const cam = this.orthoCamera;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = 0.02;
    cam.far = 8;
    cam.updateProjectionMatrix();
  }

  getView(): CameraViewName {
    return this.view;
  }

  /**
   * Perspective close-up for detail audit plates (nebari / joints / foliage).
   * Target is soil-local tree space (same as `listNodes().tipX/Y/Z` / base*).
   * Physics should be frozen by the harness. Call `setView('default')` to exit.
   */
  setCloseUp(opts: {
    x: number;
    y: number;
    z: number;
    distance?: number;
    /** Radians around +Y from +Z (0 = front). */
    azimuth?: number;
    /** Radians above horizontal. */
    elevation?: number;
    fov?: number;
  }): void {
    // Snapshot play pose once when leaving free orbit
    if (this.view === 'default' && this.controls.enabled) {
      this.savedPerspPos.copy(this.perspectiveCamera.position);
      this.savedPerspTarget.copy(this.controls.target);
      this.savedControlsEnabled = this.controls.enabled;
    }

    // Stay on perspective camera (not ortho audit)
    this.view = 'default';
    this.camera = this.perspectiveCamera;
    this.post?.setCamera(this.camera);

    // Frames are tree-group local; stage lifts by PEDESTAL_HEIGHT
    const target = new THREE.Vector3(
      opts.x,
      PEDESTAL_HEIGHT + this.treeRenderer.group.position.y + opts.y,
      opts.z,
    );

    const dist = opts.distance ?? 0.08;
    const az = opts.azimuth ?? 0.35;
    const el = opts.elevation ?? 0.28;
    const fov = opts.fov ?? 28;

    const cam = this.perspectiveCamera;
    cam.fov = fov;
    cam.near = 0.005;
    cam.far = 20;
    cam.aspect =
      Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1);
    cam.updateProjectionMatrix();

    const cosEl = Math.cos(el);
    cam.position.set(
      target.x + Math.sin(az) * cosEl * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * cosEl * dist,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(target);

    this.controls.object = cam;
    this.controls.target.copy(target);
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    this.controls.update();
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Whether a structural tree mesh rebuild is pending. */
  isTreeDirty(): boolean {
    return this.dirty;
  }

  setSelected(id: NodeId | null): void {
    this.treeRenderer.setSelected(id);
    this.dirty = true;
  }

  /**
   * Practice coach overflow tip highlights (warm ink).
   * Empty array clears. Marks dirty when the set actually changes.
   */
  setCoachHighlights(ids: readonly NodeId[]): void {
    const prev = this.treeRenderer.getCoachHighlights();
    this.treeRenderer.setCoachHighlights(ids);
    const next = this.treeRenderer.getCoachHighlights();
    if (
      prev.length !== next.length ||
      prev.some((id, i) => id !== next[i])
    ) {
      this.dirty = true;
    }
  }

  syncTree(tree: TreeState, frames?: Map<NodeId, NodeWorld>): void {
    if (!this.dirty) return;
    try {
      this.treeRenderer.rebuild(tree, frames);
    } catch (err) {
      console.error('[bonsai-en] tree rebuild failed', err);
    }
    this.dirty = false;
  }

  /** Apply live physics pose without structural rebuild. */
  applyTreePose(tree: TreeState, frames: Map<NodeId, NodeWorld>): void {
    this.treeRenderer.applyPose(tree, frames);
  }

  /**
   * Sample camera linear/angular acceleration after controls update.
   * Call once per frame with the same dt as physics.
   */
  sampleCameraMotion(dt: number): {
    accel: [number, number, number];
    alpha: [number, number, number];
    active: boolean;
  } {
    const inactive = {
      accel: [0, 0, 0] as [number, number, number],
      alpha: [0, 0, 0] as [number, number, number],
      active: false,
    };
    if (this.view !== 'default' || !this.controls.enabled || dt <= 1e-6) {
      this.camMotionReady = false;
      this.lastCamAccel.set(0, 0, 0);
      this.prevCamOmega.set(0, 0, 0);
      return inactive;
    }

    const pos = this.perspectiveCamera.position;
    const dir = this.perspectiveCamera.getWorldDirection(new THREE.Vector3());

    if (!this.camMotionReady) {
      this.prevCamPos.copy(pos);
      this.prevCamDir.copy(dir);
      this.prevCamVel.set(0, 0, 0);
      this.prevCamOmega.set(0, 0, 0);
      this.camMotionReady = true;
      return inactive;
    }

    const vel = pos.clone().sub(this.prevCamPos).multiplyScalar(1 / dt);
    const accel = vel.clone().sub(this.prevCamVel).multiplyScalar(1 / dt);

    // Angular velocity from direction change
    const cross = new THREE.Vector3().crossVectors(this.prevCamDir, dir);
    const sin = cross.length();
    const cos = clampDot(this.prevCamDir.dot(dir), -1, 1);
    const ang = Math.atan2(sin, cos);
    const omega =
      sin > 1e-8
        ? cross.normalize().multiplyScalar(ang / dt)
        : new THREE.Vector3();
    const alpha = omega.clone().sub(this.prevCamOmega).multiplyScalar(1 / dt);

    this.prevCamPos.copy(pos);
    this.prevCamDir.copy(dir);
    this.prevCamVel.copy(vel);
    this.lastCamAccel.copy(accel);
    this.prevCamOmega.copy(omega);

    // Dead-zone: OrbitControls damping leaves tiny residuals forever.
    // Only treat as "camera force" when the user is clearly moving the view.
    const aLen = accel.length();
    const wLen = omega.length();
    const alphaLen = alpha.length();
    if (aLen < 2.5 && wLen < 1.2 && alphaLen < 8) {
      return inactive;
    }

    // Soft clamp so a single frame of huge accel can't explode the tree
    const clampA = 25;
    const ax = Math.max(-clampA, Math.min(clampA, accel.x));
    const ay = Math.max(-clampA, Math.min(clampA, accel.y));
    const az = Math.max(-clampA, Math.min(clampA, accel.z));
    const clampAl = 40;
    const alx = Math.max(-clampAl, Math.min(clampAl, alpha.x));
    const aly = Math.max(-clampAl, Math.min(clampAl, alpha.y));
    const alz = Math.max(-clampAl, Math.min(clampAl, alpha.z));

    return {
      accel: [ax, ay, az],
      alpha: [alx, aly, alz],
      active: true,
    };
  }

  /** Whether play-camera controls are active (not ortho audit). */
  isPlayView(): boolean {
    return this.view === 'default';
  }

  /** Player has taken framing control (orbit/zoom) this session. */
  isCameraUserOwned(): boolean {
    return this.cameraUserOwned;
  }

  /**
   * Mark framing as player-owned so growth auto-fit stops.
   * Called from orbit start / wheel; also available to the harness.
   */
  claimCameraOwnership(): void {
    this.cameraUserOwned = true;
  }

  /**
   * Clear user framing ownership (e.g. new sapling). Next frameTree may auto-fit.
   */
  releaseCameraOwnership(): void {
    this.cameraUserOwned = false;
  }

  /**
   * Soft-snap the **play** camera to the front viewing face (looking along −Z
   * toward the target). Sumi ghost + practice score are front-plane (x–y);
   * this keeps eyes aligned without switching to ortho audit `setView('front')`.
   * No-op while in orthographic / close-up harness views.
   */
  snapToFrontFace(): void {
    if (this.view !== 'default') return;

    const target = this.controls.target;
    const offset = this.perspectiveCamera.position.clone().sub(target);
    let dist = offset.length();
    if (!Number.isFinite(dist) || dist < 0.16) dist = 0.55;
    dist = clampDot(dist, 0.28, 1.05);

    // Mild elevation so the pot reads product-like, still nearly pure front
    const elev = 0.32; // radians above horizontal
    const cosEl = Math.cos(elev);
    const sinEl = Math.sin(elev);
    this.perspectiveCamera.position.set(
      target.x,
      target.y + sinEl * dist,
      target.z + cosEl * dist,
    );
    this.perspectiveCamera.up.set(0, 1, 0);
    this.controls.update();
  }

  /**
   * When locked (practice), orbit rotate is disabled so accidental drag cannot
   * desync perception from the front-only score. Zoom + pan remain.
   * Locking also soft-snaps to front. Harness: `setFrontLock`.
   */
  setFrontLock(on: boolean): void {
    this.frontLock = on;
    if (this.view === 'default') {
      this.controls.enableRotate = !on;
      if (on) this.snapToFrontFace();
    }
  }

  isFrontLock(): boolean {
    return this.frontLock;
  }

  /**
   * True when the play camera azimuth is near pure front (+Z → origin).
   * @param maxYawRad — half-angle tolerance (default ~20°)
   */
  isFrontFaceAligned(maxYawRad = 0.35): boolean {
    if (this.view !== 'default') {
      // Ortho front / front-low count as aligned; other audits do not
      return this.view === 'front' || this.view === 'front-low';
    }
    const offset = this.perspectiveCamera.position.clone().sub(this.controls.target);
    // Yaw from +Z (front): 0 when camera sits on the +Z side of the target
    const yaw = Math.atan2(offset.x, offset.z);
    return Math.abs(yaw) <= maxYawRad;
  }

  /**
   * Restore play orbit after wire-tool steal. Respects front lock (#66)
   * and leaves ortho audits alone.
   */
  restorePlayControls(): void {
    if (this.view !== 'default') return;
    this.controls.enabled = true;
    this.controls.enableDamping = true;
    this.controls.enableRotate = !this.frontLock;
  }

  /**
   * Ease orbit target / distance to fit the living canopy.
   * @param opts.force — reframe even if the player owns the camera (boot, new sapling, explicit Frame)
   *
   * Growth ticks call without force; if the user has orbited/zoomed, this is a no-op (#60).
   */
  frameTree(tree: TreeState, opts?: { force?: boolean }): void {
    // Don't fight orthographic audit views
    if (this.view !== 'default') return;
    // Respect user framing during plant-time growth
    if (this.cameraUserOwned && !opts?.force) return;

    const frames = computeWorldFrames(tree);
    let maxY = 0.08;
    let maxR = 0.04;
    for (const f of frames.values()) {
      maxY = Math.max(maxY, f.tip[1], f.base[1]);
      maxR = Math.max(maxR, Math.hypot(f.tip[0], f.tip[2]));
    }
    const soil = PEDESTAL_HEIGHT + POT_SOIL_LOCAL_Y;
    const height = maxY + soil;
    const targetY = Math.min(0.36, Math.max(0.11, soil + maxY * 0.38));
    this.controls.target.y += (targetY - this.controls.target.y) * 0.15;

    const desiredDist = Math.min(
      1.05,
      Math.max(0.28, Math.max(height * 1.75, maxR * 3.4) + 0.16),
    );
    const offset = this.perspectiveCamera.position
      .clone()
      .sub(this.controls.target);
    const dist = offset.length() || desiredDist;
    if (dist < desiredDist * 0.92 || dist > desiredDist * 1.35) {
      const next = dist + (desiredDist - dist) * 0.18;
      offset.setLength(next);
      this.perspectiveCamera.position.copy(this.controls.target).add(offset);
    }
    this.controls.update();
  }

  pickNode(clientX: number, clientY: number): NodeId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.treeRenderer.pickables,
      false,
    );
    if (!hits.length) return null;
    const id = hits[0].object.userData.nodeId as string | undefined;
    return id ?? null;
  }

  /**
   * Absolute aim (legacy): map pointer to a direction from branch base through
   * a camera-facing plane at the tip. Prefer {@link bendDirectionFromDrag}
   * for interactive shaping — absolute aim is hard to predict.
   */
  bendDirectionFromPointer(
    tree: TreeState,
    nodeId: NodeId,
    clientX: number,
    clientY: number,
  ): [number, number, number] | null {
    const frames = computeWorldFrames(tree);
    const frame = frames.get(nodeId);
    if (!frame) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const tipWorld = new THREE.Vector3(...frame.tip);
    this.treeRenderer.group.localToWorld(tipWorld);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()).negate(),
      tipWorld,
    );
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;

    const baseWorld = new THREE.Vector3(...frame.base);
    this.treeRenderer.group.localToWorld(baseWorld);
    const dir = hit.sub(baseWorld).normalize();
    return [dir.x, dir.y, dir.z];
  }

  /**
   * Incremental viewing-plane bend from screen-space drag deltas.
   * Uses camera right/up so motion stays in the picture plane; damping and
   * max rate live in `bendDirFromViewDelta` (~0.15°/px effective).
   */
  bendDirectionFromDrag(
    tree: TreeState,
    nodeId: NodeId,
    dxPx: number,
    dyPx: number,
  ): [number, number, number] | null {
    const frames = computeWorldFrames(tree);
    const frame = frames.get(nodeId);
    if (!frame) return null;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    right.normalize();
    up.normalize();

    const current: [number, number, number] = [
      frame.dir[0],
      frame.dir[1],
      frame.dir[2],
    ];
    const next = bendDirFromViewDelta(
      current,
      [right.x, right.y, right.z],
      [up.x, up.y, up.z],
      dxPx,
      dyPx,
    );
    return [next[0], next[1], next[2]];
  }

  /**
   * @param skipControlsUpdate when true, caller already ran controls.update()
   *   (Game does this before sampling camera motion for physics).
   */
  render(skipControlsUpdate = false): void {
    if (this.view === 'default' && !skipControlsUpdate) {
      this.controls.update();
    }
    if (this.post?.isEnabled) {
      try {
        // Focus plane: stable subject depth at lower-canopy / pot-rim mass
        // (orbit target + slight upward bias so primary pads stay in the DOF slab)
        if (this.view === 'default' && this.camera instanceof THREE.PerspectiveCamera) {
          const focusPoint = this.controls.target.clone();
          focusPoint.y += 0.025;
          const focusDist = this.perspectiveCamera.position.distanceTo(focusPoint);
          this.post.setFocusDistance(focusDist);
        }
        this.post.render();
        return;
      } catch (err) {
        console.warn('[bonsai-en] post render failed, falling back', err);
        this.post?.setEnabled(false);
        this.post = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Product-GPU DOF toggle for A/B (`?dof=0` / harness). No-op on soft GL. */
  setDofEnabled(on: boolean): void {
    this.dofWanted = on;
    this.post?.setDofEnabled(on);
  }

  getDofEnabled(): boolean {
    if (!this.post) return false;
    return this.post.isDofEnabled;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.treeRenderer.dispose();
    this.sumi.dispose();
    this.post?.dispose();
    this.bgTex.dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
  }
}
