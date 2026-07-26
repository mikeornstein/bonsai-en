import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeWorldFrames } from '../sim/tree';
import type { NodeId, TreeState } from '../sim/types';
import { createGround, createPotGroup } from './pot';
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
  private ground = createGround();
  private dirty = true;

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
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#152218');
    this.scene.fog = new THREE.Fog('#152218', 1.8, 5);

    this.camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / window.innerHeight,
      0.01,
      50,
    );
    // Frame pot + full sapling (not inside the canopy)
    this.camera.position.set(0.24, 0.2, 0.28);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.11, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 1.2;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.update();

    const hemi = new THREE.HemisphereLight(0xd0e8ff, 0x3d2a1a, 0.7);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.55);
    sun.position.set(0.9, 1.8, 1.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.05;
    sun.shadow.camera.far = 5;
    sun.shadow.camera.left = -0.4;
    sun.shadow.camera.right = 0.4;
    sun.shadow.camera.top = 0.45;
    sun.shadow.camera.bottom = -0.2;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x9ec0ff, 0.35);
    fill.position.set(-1.2, 0.6, -0.8);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xc8e6a0, 0.2);
    rim.position.set(0.2, 0.4, -1.2);
    this.scene.add(rim);

    this.scene.add(this.ground);
    this.scene.add(this.pot);
    this.scene.add(this.treeRenderer.group);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
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

  /**
   * Softly reframe camera target/distance so growing trees stay in view
   * without fighting manual orbit too hard.
   */
  frameTree(tree: TreeState): void {
    const frames = computeWorldFrames(tree);
    let maxY = 0.08;
    let maxR = 0.04;
    for (const f of frames.values()) {
      maxY = Math.max(maxY, f.tip[1], f.base[1]);
      maxR = Math.max(maxR, Math.hypot(f.tip[0], f.tip[2]));
    }
    const soil = 0.052;
    const height = maxY + soil;
    const targetY = Math.min(0.28, Math.max(0.09, height * 0.45));
    this.controls.target.y += (targetY - this.controls.target.y) * 0.15;

    const desiredDist = Math.min(
      0.85,
      Math.max(0.22, Math.max(height * 1.6, maxR * 3.2) + 0.12),
    );
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length() || desiredDist;
    // Only pull back if tree outgrows current framing
    if (dist < desiredDist * 0.92) {
      offset.setLength(dist + (desiredDist - dist) * 0.2);
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

    const tip = new THREE.Vector3(...frame.tip);
    tip.add(this.treeRenderer.group.position);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()).negate(),
      tip,
    );
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;

    const base = new THREE.Vector3(...frame.base).add(
      this.treeRenderer.group.position,
    );
    const dir = hit.sub(base).normalize();
    return [dir.x, dir.y, dir.z];
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.treeRenderer.dispose();
    this.renderer.dispose();
  }
}
