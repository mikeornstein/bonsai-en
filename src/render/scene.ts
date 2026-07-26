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

export class BonsaiScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly treeRenderer = new TreeRenderer();
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  private pot = createPotGroup();
  private studioBase = createStudioBase();
  /** Raises pot + tree onto the pedestal top. */
  private stage = new THREE.Group();
  private dirty = true;
  private bgTex = createStudioBackgroundTexture();
  private envMap: THREE.Texture | null = null;
  private post: StudioPost | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;

    this.scene = new THREE.Scene();
    this.scene.background = this.bgTex;

    this.camera = new THREE.PerspectiveCamera(
      32,
      window.innerWidth / window.innerHeight,
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

    this.stage.position.y = PEDESTAL_HEIGHT;
    this.stage.add(this.pot);
    this.stage.add(this.treeRenderer.group);

    this.scene.add(this.studioBase);
    this.scene.add(this.stage);

    // Lightweight equirect IBL (avoids RoomEnvironment ReadPixels stalls)
    this.setupEnvironment();

    // Soft SMAA + grade — skip software GL (SwiftShader / screenshot CI)
    const gl = this.renderer.getContext() as WebGLRenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
      : '';
    const isSoftGL = /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpu);
    if (!isSoftGL) {
      try {
        this.post = new StudioPost(this.renderer, this.scene, this.camera);
        this.post.setSize(window.innerWidth, window.innerHeight);
      } catch {
        this.post = null;
      }
    }

    window.addEventListener('resize', this.onResize);
  }

  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const equirect = createStudioEnvEquirectTexture();
    const envRT = pmrem.fromEquirectangular(equirect);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.7;
    equirect.dispose();
    pmrem.dispose();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xf2f6ff, 0xc8b8a4, 0.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6ea, 1.4);
    sun.position.set(0.75, 2.1, 1.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.05;
    sun.shadow.camera.far = 6;
    sun.shadow.camera.left = -0.55;
    sun.shadow.camera.right = 0.55;
    sun.shadow.camera.top = 0.55;
    sun.shadow.camera.bottom = -0.2;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = 3;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xd8e4ff, 0.3);
    fill.position.set(-1.5, 0.85, -0.7);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0.1, 0.55, -1.4);
    this.scene.add(rim);
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
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
    this.treeRenderer.rebuild(tree);
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
      this.post.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
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
