import * as THREE from 'three';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import type { Internode, NodeId, TreeState } from '../sim/types';
import {
  barkMaterialForSegment,
  createBarkMaterial,
  createFoliageMaterial,
  createFoliageTipMaterial,
  createHighlightMaterial,
  createHighlightRimMaterial,
  createWireMaterial,
} from './materials';
import { POT_SOIL_LOCAL_Y } from './pot';

const UP = new THREE.Vector3(0, 1, 0);
const MIN_VISUAL_RADIUS = 0.0016;
/** Soft cap so large trees stay interactive on mobile / headless. */
const MAX_SCALE_INSTANCES = 16000;

interface ScaleInstance {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  tip: boolean;
}

/**
 * Slightly cupped scale quad — better light catch than a flat plane.
 */
function createScaleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1.3, 2, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Gentle cup along X; tip lifts slightly
    const cup = (1 - x * x) * 0.08;
    pos.setZ(i, cup);
    pos.setY(i, y + 0.12);
  }
  geo.computeVertexNormals();
  return geo;
}

interface SegmentPoseHandles {
  segment: THREE.Mesh;
  jointBase: THREE.Mesh;
  jointTip: THREE.Mesh | null;
  r0: number;
  r1: number;
}

export class TreeRenderer {
  readonly group = new THREE.Group();
  /** Lazily created so scene boot isn't blocked by procedural textures. */
  private barkMat: THREE.MeshStandardMaterial | null = null;
  private foliageMat: THREE.MeshPhysicalMaterial | null = null;
  private foliageTipMat: THREE.MeshPhysicalMaterial | null = null;
  private wireMat: THREE.MeshPhysicalMaterial | null = null;
  private highlightMat: THREE.MeshBasicMaterial | null = null;
  private highlightRimMat: THREE.MeshBasicMaterial | null = null;
  private branchGroup = new THREE.Group();
  private foliageGroup = new THREE.Group();
  private wireGroup = new THREE.Group();
  private highlightMesh: THREE.Mesh | null = null;
  private highlightRim: THREE.Mesh | null = null;
  private selectedId: NodeId | null = null;
  private scaleGeo: THREE.BufferGeometry | null = null;
  private radialSegments = 14;
  private readonly _dummy = new THREE.Object3D();
  private readonly _jointGeo = new THREE.SphereGeometry(1, 12, 10);
  /** Branch mesh handles for per-frame physics pose streaming. */
  private poseHandles = new Map<NodeId, SegmentPoseHandles>();
  /** Last tree used for foliage re-pose (structural rebuild only). */
  private poseTree: TreeState | null = null;
  private matureFoliage: THREE.InstancedMesh | null = null;
  private tipFoliage: THREE.InstancedMesh | null = null;

  readonly pickables: THREE.Object3D[] = [];

  constructor() {
    this.group.name = 'tree';
    this.group.add(this.branchGroup, this.foliageGroup, this.wireGroup);
  }

  private ensureMaterials(): void {
    if (!this.barkMat) this.barkMat = createBarkMaterial();
    if (!this.foliageMat) this.foliageMat = createFoliageMaterial();
    if (!this.foliageTipMat) this.foliageTipMat = createFoliageTipMaterial();
    if (!this.wireMat) this.wireMat = createWireMaterial();
    if (!this.highlightMat) this.highlightMat = createHighlightMaterial();
    if (!this.highlightRimMat) this.highlightRimMat = createHighlightRimMaterial();
    if (!this.scaleGeo) this.scaleGeo = createScaleGeometry();
  }

  setSelected(id: NodeId | null): void {
    this.selectedId = id;
  }

  rebuild(tree: TreeState, frames?: Map<NodeId, NodeWorld>): void {
    this.ensureMaterials();
    this.clearGroup(this.branchGroup);
    this.clearGroup(this.foliageGroup);
    this.clearGroup(this.wireGroup);
    this.pickables.length = 0;
    this.poseHandles.clear();
    this.matureFoliage = null;
    this.tipFoliage = null;
    this.poseTree = tree;
    if (this.highlightMesh) {
      this.group.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      this.highlightMesh = null;
    }
    if (this.highlightRim) {
      this.group.remove(this.highlightRim);
      this.highlightRim.geometry.dispose();
      this.highlightRim = null;
    }

    const live = frames ?? computeWorldFrames(tree);
    // Slightly bury the root so the trunk emerges from soil rather than floating on a disc
    this.group.position.set(0, POT_SOIL_LOCAL_Y - 0.0025, 0);

    const scales: ScaleInstance[] = [];

    for (const node of Object.values(tree.nodes)) {
      if (!node.living) continue;
      const frame = live.get(node.id);
      if (!frame || node.length < 1e-6) continue;

      this.addBranchSegment(node.id, node, frame, tree);
      this.collectScales(node, frame, tree, scales);
      if (node.wire) {
        this.addWireVisual(frame, Math.max(node.radius, MIN_VISUAL_RADIUS));
      }
    }

    // Soft cap for performance on large trees
    if (scales.length > MAX_SCALE_INSTANCES) {
      // Prefer keeping tips; subsample mature pads
      const tips = scales.filter((s) => s.tip);
      const mature = scales.filter((s) => !s.tip);
      const budget = Math.max(0, MAX_SCALE_INSTANCES - tips.length);
      const step = Math.max(1, Math.ceil(mature.length / Math.max(1, budget)));
      const kept: ScaleInstance[] = [...tips];
      for (let i = 0; i < mature.length && kept.length < MAX_SCALE_INSTANCES; i += step) {
        kept.push(mature[i]);
      }
      scales.length = 0;
      scales.push(...kept);
    }

    this.buildInstancedFoliage(scales);

    if (this.selectedId && live.has(this.selectedId)) {
      const node = tree.nodes[this.selectedId];
      const frame = live.get(this.selectedId)!;
      if (node) {
        const baseR = Math.max(node.radius, MIN_VISUAL_RADIUS);
        // Soft moss wash — slight overscale, not neon tube
        const r = baseR * 1.22;
        this.highlightMesh = this.makeTaperedSegment(
          r,
          r * 0.88,
          frame,
          this.highlightMat!,
        );
        this.highlightMesh.userData.nodeId = this.selectedId;
        this.highlightMesh.renderOrder = 2;
        this.group.add(this.highlightMesh);
        // Thin ink rim (backside shell) for edge read on green pads
        const rimR = baseR * 1.38;
        this.highlightRim = this.makeTaperedSegment(
          rimR,
          rimR * 0.9,
          frame,
          this.highlightRimMat!,
        );
        this.highlightRim.userData.nodeId = this.selectedId;
        this.highlightRim.renderOrder = 1;
        this.group.add(this.highlightRim);
      }
    }
  }

  /**
   * Stream live physics pose onto existing meshes without a full rebuild.
   * Foliage instance matrices are regenerated from the live frames.
   */
  applyPose(tree: TreeState, frames: Map<NodeId, NodeWorld>): void {
    for (const [id, handles] of this.poseHandles) {
      const frame = frames.get(id);
      if (!frame) continue;
      this.placeSegment(handles.segment, frame);
      handles.jointBase.position.set(...frame.base);
      if (handles.jointTip) {
        handles.jointTip.position.set(...frame.tip);
      }
    }

    if (this.selectedId) {
      const frame = frames.get(this.selectedId);
      if (frame) {
        if (this.highlightMesh) this.placeSegment(this.highlightMesh, frame);
        if (this.highlightRim) this.placeSegment(this.highlightRim, frame);
      }
    }

    // Foliage follows host segments (rigid attachment in phase 1)
    if (this.poseTree === tree && (this.matureFoliage || this.tipFoliage)) {
      const scales: ScaleInstance[] = [];
      for (const node of Object.values(tree.nodes)) {
        if (!node.living) continue;
        const frame = frames.get(node.id);
        if (!frame || node.length < 1e-6) continue;
        this.collectScales(node, frame, tree, scales);
      }
      if (scales.length > MAX_SCALE_INSTANCES) {
        const tips = scales.filter((s) => s.tip);
        const mature = scales.filter((s) => !s.tip);
        const budget = Math.max(0, MAX_SCALE_INSTANCES - tips.length);
        const step = Math.max(1, Math.ceil(mature.length / Math.max(1, budget)));
        const kept: ScaleInstance[] = [...tips];
        for (
          let i = 0;
          i < mature.length && kept.length < MAX_SCALE_INSTANCES;
          i += step
        ) {
          kept.push(mature[i]);
        }
        scales.length = 0;
        scales.push(...kept);
      }
      this.writeFoliageInstances(scales);
    }
  }

  private visualRadius(r: number): number {
    return Math.max(r, MIN_VISUAL_RADIUS);
  }

  private addBranchSegment(
    id: NodeId,
    node: Internode,
    frame: NodeWorld,
    tree: TreeState,
  ): void {
    let r0 = this.visualRadius(node.radius);
    // Nebari flare on root internode — stronger base so the trunk seats in soil
    if (node.parentId === null) {
      r0 *= 1.85;
    }
    let r1 = r0 * 0.82;
    if (node.children.length) {
      let sum = 0;
      for (const c of node.children) {
        sum += this.visualRadius(tree.nodes[c]?.radius ?? node.radius * 0.7);
      }
      r1 = sum / node.children.length;
    } else {
      r1 = r0 * 0.55;
    }

    const mat = barkMaterialForSegment(this.barkMat!, node.length, node.radius);
    // Younger / thinner shoots: greener cambium tint
    const youth = Math.max(0, 1 - node.lignification);
    if (youth > 0.15) {
      mat.color.offsetHSL(0.06, 0.1 * youth, 0.05 * youth);
      mat.roughness = Math.max(0.5, 1 - youth * 0.28);
      if (mat.normalScale) {
        mat.normalScale.set(0.45 + youth * 0.2, 0.45 + youth * 0.2);
      }
    } else {
      // Mature trunk: stronger normal, cooler tint
      mat.color.offsetHSL(-0.02, -0.04, -0.03);
      if (mat.normalScale) {
        mat.normalScale.set(1.15, 1.15);
      }
    }

    const mesh = this.makeTaperedSegment(r0, r1, frame, mat);
    mesh.userData.nodeId = id;
    mesh.userData.disposeMat = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.branchGroup.add(mesh);
    this.pickables.push(mesh);

    // Joint collar at base — hides cylinder seams
    const jointR = r0 * 1.02;
    const joint = new THREE.Mesh(this._jointGeo, mat);
    joint.position.set(...frame.base);
    joint.scale.set(jointR, jointR * 0.85, jointR);
    joint.castShadow = true;
    joint.receiveShadow = true;
    joint.userData.nodeId = id;
    this.branchGroup.add(joint);

    // Tip joint when branching (collar into children)
    let tipJoint: THREE.Mesh | null = null;
    if (node.children.length > 0) {
      tipJoint = new THREE.Mesh(this._jointGeo, mat);
      tipJoint.position.set(...frame.tip);
      tipJoint.scale.set(r1 * 1.05, r1 * 0.9, r1 * 1.05);
      tipJoint.castShadow = true;
      tipJoint.receiveShadow = true;
      tipJoint.userData.nodeId = id;
      this.branchGroup.add(tipJoint);
    }

    this.poseHandles.set(id, {
      segment: mesh,
      jointBase: joint,
      jointTip: tipJoint,
      r0,
      r1,
    });
  }

  private makeTaperedSegment(
    r0: number,
    r1: number,
    frame: NodeWorld,
    mat: THREE.Material,
  ): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(
      Math.max(0.0005, r1),
      Math.max(0.0005, r0),
      1,
      this.radialSegments,
      1,
      false,
    );
    const mesh = new THREE.Mesh(geo, mat);
    this.placeSegment(mesh, frame);
    return mesh;
  }

  private placeSegment(mesh: THREE.Mesh, frame: NodeWorld): void {
    const base = new THREE.Vector3(...frame.base);
    const tip = new THREE.Vector3(...frame.tip);
    const mid = base.clone().add(tip).multiplyScalar(0.5);
    const dir = tip.clone().sub(base);
    const len = dir.length() || 1e-6;
    dir.multiplyScalar(1 / len);
    mesh.position.copy(mid);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(UP, dir);
  }

  /**
   * Continuous juniper scale sleeves + tip pads (not sparse leaf clusters).
   * Helical rings wrap the shoot so foliage reads as solid green volume.
   */
  private collectScales(
    node: Internode,
    frame: NodeWorld,
    _tree: TreeState,
    out: ScaleInstance[],
  ): void {
    const isTip = node.children.length === 0;
    // Bare structural wood — trunk / leaders show bark only
    if (node.parentId === null) return;
    if (!isTip && node.radius >= 0.0038) return;
    if (!isTip && node.lignification > 0.55) return;
    // Non-tips only if they still carry living foliage pads
    if (!isTip && node.foliage.every((f) => !f.living)) return;

    const base = new THREE.Vector3(...frame.base);
    const dir = new THREE.Vector3(...frame.dir).normalize();
    const len = node.length;
    const r = this.visualRadius(node.radius);

    const sideRef =
      Math.abs(dir.y) > 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(dir, sideRef).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, dir).normalize();

    // Dense pad mass on tips; lighter wrap on thin green shoots only
    const rings = isTip
      ? Math.max(10, Math.floor(len / 0.0018))
      : Math.max(4, Math.floor(len / 0.0032));
    const perRing = isTip ? 13 : 8;
    const layers = isTip ? 4 : 2;
    const scaleBase = isTip ? 0.0026 : 0.0019;
    const tipGrowth = isTip || node.lignification < 0.35;

    for (let ring = 0; ring < rings; ring++) {
      const t = (ring + 0.5) / rings;
      // Slightly denser toward tip
      const densify = 0.75 + t * 0.45;
      const along = base.clone().addScaledVector(dir, t * len);
      const ringTwist = t * 2.4 + node.ageDays * 0.01;

      for (let layer = 0; layer < layers; layer++) {
        const nAround = Math.max(6, Math.floor(perRing * densify) - layer * 2);
        for (let k = 0; k < nAround; k++) {
          const ang = ringTwist + (k / nAround) * Math.PI * 2 + layer * 0.4;
          const cos = Math.cos(ang);
          const sin = Math.sin(ang);
          const spin = new THREE.Vector3(
            normal.x * cos + binormal.x * sin,
            normal.y * cos + binormal.y * sin,
            normal.z * cos + binormal.z * sin,
          ).normalize();

          const radialOff = r + scaleBase * (0.35 + layer * 0.55);
          const pos = along
            .clone()
            .addScaledVector(spin, radialOff)
            .addScaledVector(dir, (k % 3) * scaleBase * 0.04);

          // Scales wrap tightly around the axis
          const face = spin
            .clone()
            .multiplyScalar(0.92)
            .addScaledVector(dir, 0.12 + layer * 0.05)
            .normalize();

          const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            face,
          );
          quat.multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              ang * 0.6 + layer * 0.3,
            ),
          );

          const sc = scaleBase * (0.85 + (k % 4) * 0.05) * (1 - layer * 0.08);
          out.push({
            position: pos,
            quaternion: quat,
            scale: new THREE.Vector3(sc, sc * 1.2, sc),
            tip: tipGrowth && t > 0.55,
          });
        }
      }
    }

    // Tip pad cloud — soft conical mass of overlapping scales
    if (isTip) {
      const tip = new THREE.Vector3(...frame.tip);
      for (let i = 0; i < 48; i++) {
        const u = i / 48;
        const ang = u * Math.PI * 2 * 3.2;
        const elev = (i % 8) / 8;
        const spin2 = new THREE.Vector3(
          normal.x * Math.cos(ang) + binormal.x * Math.sin(ang),
          normal.y * Math.cos(ang) + binormal.y * Math.sin(ang),
          normal.z * Math.cos(ang) + binormal.z * Math.sin(ang),
        ).normalize();
        const face = spin2
          .clone()
          .multiplyScalar(0.5 + elev * 0.2)
          .addScaledVector(dir, 0.7 - elev * 0.15)
          .normalize();
        const sc = 0.0016 + (i % 5) * 0.00015;
        out.push({
          position: tip
            .clone()
            .addScaledVector(dir, 0.0004 + elev * 0.0022)
            .addScaledVector(spin2, r * 0.35 + elev * 0.002),
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            face,
          ),
          scale: new THREE.Vector3(sc, sc * 1.25, sc),
          tip: true,
        });
      }
    }
  }

  private buildInstancedFoliage(scales: ScaleInstance[]): void {
    if (!scales.length) return;
    const mature: ScaleInstance[] = [];
    const tips: ScaleInstance[] = [];
    for (const s of scales) {
      (s.tip ? tips : mature).push(s);
    }
    if (mature.length) {
      this.matureFoliage = this.makeInstancedScales(mature, this.foliageMat!);
      this.foliageGroup.add(this.matureFoliage);
    }
    if (tips.length) {
      this.tipFoliage = this.makeInstancedScales(tips, this.foliageTipMat!);
      this.foliageGroup.add(this.tipFoliage);
    }
  }

  private writeFoliageInstances(scales: ScaleInstance[]): void {
    const mature: ScaleInstance[] = [];
    const tips: ScaleInstance[] = [];
    for (const s of scales) {
      (s.tip ? tips : mature).push(s);
    }
    if (this.matureFoliage && mature.length === this.matureFoliage.count) {
      this.fillInstanceMatrices(this.matureFoliage, mature);
    }
    if (this.tipFoliage && tips.length === this.tipFoliage.count) {
      this.fillInstanceMatrices(this.tipFoliage, tips);
    }
  }

  private fillInstanceMatrices(
    mesh: THREE.InstancedMesh,
    items: ScaleInstance[],
  ): void {
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      this._dummy.position.copy(s.position);
      this._dummy.quaternion.copy(s.quaternion);
      this._dummy.scale.copy(s.scale);
      this._dummy.updateMatrix();
      mesh.setMatrixAt(i, this._dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private makeInstancedScales(
    items: ScaleInstance[],
    mat: THREE.Material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.scaleGeo!, mat, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    this.fillInstanceMatrices(mesh, items);
    return mesh;
  }

  private addWireVisual(frame: NodeWorld, radius: number): void {
    const points: THREE.Vector3[] = [];
    const base = new THREE.Vector3(...frame.base);
    const tip = new THREE.Vector3(...frame.tip);
    const dir = tip.clone().sub(base);
    const len = dir.length() || 1e-6;
    dir.normalize();

    const normal = new THREE.Vector3(1, 0, 0);
    if (Math.abs(dir.dot(normal)) > 0.9) normal.set(0, 0, 1);
    const binormal = new THREE.Vector3().crossVectors(dir, normal).normalize();
    normal.crossVectors(binormal, dir).normalize();

    const turns = 4;
    const segs = 40;
    const amp = radius + 0.0014;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ang = t * turns * Math.PI * 2;
      points.push(
        base
          .clone()
          .addScaledVector(dir, t * len)
          .addScaledVector(normal, Math.cos(ang) * amp)
          .addScaledVector(binormal, Math.sin(ang) * amp),
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, segs, 0.00055, 6, false);
    const mesh = new THREE.Mesh(geo, this.wireMat!);
    mesh.castShadow = true;
    this.wireGroup.add(mesh);
  }

  private clearGroup(g: THREE.Group): void {
    const sharedMats = new Set<THREE.Material>();
    if (this.barkMat) sharedMats.add(this.barkMat);
    if (this.foliageMat) sharedMats.add(this.foliageMat);
    if (this.foliageTipMat) sharedMats.add(this.foliageTipMat);
    if (this.wireMat) sharedMats.add(this.wireMat);
    if (this.highlightMat) sharedMats.add(this.highlightMat);
    if (this.highlightRimMat) sharedMats.add(this.highlightRimMat);
    while (g.children.length) {
      const c = g.children.pop()!;
      if (c instanceof THREE.Mesh || c instanceof THREE.InstancedMesh) {
        if (c.geometry !== this.scaleGeo && c.geometry !== this._jointGeo) {
          c.geometry.dispose();
        }
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          // Dispose only material instances we cloned (maps stay shared)
          if (!sharedMats.has(m) && c.userData.disposeMat) {
            m.dispose();
          }
        }
      }
    }
  }

  dispose(): void {
    this.clearGroup(this.branchGroup);
    this.clearGroup(this.foliageGroup);
    this.clearGroup(this.wireGroup);
    this.scaleGeo?.dispose();
    this._jointGeo.dispose();
    this.barkMat?.dispose();
    this.foliageMat?.dispose();
    this.foliageTipMat?.dispose();
    this.wireMat?.dispose();
    this.highlightMat?.dispose();
    this.highlightRimMat?.dispose();
  }
}
