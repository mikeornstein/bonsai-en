import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeWorldFrames } from '../sim/tree';
import type { NodeId, TreeState } from '../sim/types';
import {
  PEDESTAL_HEIGHT,
  POT_SOIL_LOCAL_Y,
  createPotGroup,
  createStudioBase,
} from './pot';
import { StudioPost } from './post';
import {
  createStudioBackgroundTexture,
  createStudioEnvEquirectTexture,
} from './textures';
import { TreeRenderer } from './treeMesh';

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

export class BonsaiScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly treeRenderer: TreeRenderer;
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
  private softGL = false;

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
    this.renderer.toneMappingExposure = 1.02;

    this.softGL = detectSoftGL(this.renderer);

    this.scene = new THREE.Scene();
    try {
      this.bgTex = createStudioBackgroundTexture();
      this.scene.background = this.bgTex;
    } catch {
      this.bgTex = new THREE.Texture();
      this.scene.background = new THREE.Color(0xe6e1d8);
    }

    this.camera = new THREE.PerspectiveCamera(
      32,
      Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1),
      0.01,
      50,
    );
    this.camera.position.set(0.34, 0.24, 0.42);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, PEDESTAL_HEIGHT + 0.12, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.16;
    this.controls.maxDistance = 1.5;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.update();

    this.setupLights();

    // Heavy scene graph after renderer is alive
    this.treeRenderer = new TreeRenderer();
    this.pot = createPotGroup();
    this.studioBase = createStudioBase();

    this.stage.position.y = PEDESTAL_HEIGHT;
    this.stage.add(this.pot);
    this.stage.add(this.treeRenderer.group);

    this.scene.add(this.studioBase);
    this.scene.add(this.stage);

    // IBL + post are best-effort (must not block boot)
    try {
      this.setupEnvironment();
    } catch (err) {
      console.warn('[bonsai-en] environment setup failed', err);
    }

    // Post is optional polish — never block boot. Disabled on soft GL;
    // on real GPUs enable only after first frames so tree always appears.
    if (!this.softGL) {
      requestAnimationFrame(() => {
        try {
          this.post = new StudioPost(this.renderer, this.scene, this.camera);
          this.post.setSize(
            Math.max(window.innerWidth, 1),
            Math.max(window.innerHeight, 1),
          );
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
    const equirect = createStudioEnvEquirectTexture();
    const envRT = pmrem.fromEquirectangular(equirect);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.58;
    equirect.dispose();
    pmrem.dispose();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xf4f7fc, 0xd0c4b0, 0.52);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e8, 1.55);
    sun.position.set(0.9, 2.4, 1.15);
    sun.castShadow = true;
    const map = this.softGL ? 1024 : 2048;
    sun.shadow.mapSize.set(map, map);
    sun.shadow.camera.near = 0.05;
    sun.shadow.camera.far = 6;
    sun.shadow.camera.left = -0.6;
    sun.shadow.camera.right = 0.6;
    sun.shadow.camera.top = 0.6;
    sun.shadow.camera.bottom = -0.25;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = this.softGL ? 2 : 4.5;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xdce6ff, 0.32);
    fill.position.set(-1.6, 0.9, -0.65);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.22);
    rim.position.set(0.05, 0.6, -1.5);
    this.scene.add(rim);
  }

  private onResize = () => {
    const w = Math.max(window.innerWidth, 1);
    const h = Math.max(window.innerHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
  };

  markDirty(): void {
    this.dirty = true;
  }

  setSelected(id: NodeId | null): void {
    this.treeRenderer.setSelected(id);
    this.dirty = true;
  }

  syncTree(tree: TreeState): void {
    if (!this.dirty) return;
    try {
      this.treeRenderer.rebuild(tree);
    } catch (err) {
      console.error('[bonsai-en] tree rebuild failed', err);
    }
    this.dirty = false;
  }

  frameTree(tree: TreeState): void {
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
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length() || desiredDist;
    if (dist < desiredDist * 0.92 || dist > desiredDist * 1.35) {
      const next = dist + (desiredDist - dist) * 0.18;
      offset.setLength(next);
      this.camera.position.copy(this.controls.target).add(offset);
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

  render(): void {
    this.controls.update();
    if (this.post?.isEnabled) {
      try {
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

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.treeRenderer.dispose();
    this.post?.dispose();
    this.bgTex.dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
  }
}
