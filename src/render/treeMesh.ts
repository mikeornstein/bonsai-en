import * as THREE from 'three';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import type { Internode, NodeId, TreeState } from '../sim/types';
import {
  barkMaterialForSegment,
  createBarkMaterial,
  createFoliageMaterial,
  createFoliageTipMaterial,
  createHighlightMaterial,
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

export class TreeRenderer {
  readonly group = new THREE.Group();
  private barkMat = createBarkMaterial();
  private foliageMat = createFoliageMaterial();
  private foliageTipMat = createFoliageTipMaterial();
  private wireMat = createWireMaterial();
  private highlightMat = createHighlightMaterial();
  private branchGroup = new THREE.Group();
  private foliageGroup = new THREE.Group();
  private wireGroup = new THREE.Group();
  private highlightMesh: THREE.Mesh | null = null;
  private selectedId: NodeId | null = null;
  private scaleGeo = createScaleGeometry();
  private radialSegments = 14;
  private readonly _dummy = new THREE.Object3D();
  private readonly _jointGeo = new THREE.SphereGeometry(1, 12, 10);

  readonly pickables: THREE.Object3D[] = [];

  constructor() {
    this.group.name = 'tree';
    this.group.add(this.branchGroup, this.foliageGroup, this.wireGroup);
  }

  setSelected(id: NodeId | null): void {
    this.selectedId = id;
  }

  rebuild(tree: TreeState): void {
    this.clearGroup(this.branchGroup);
    this.clearGroup(this.foliageGroup);
    this.clearGroup(this.wireGroup);
    this.pickables.length = 0;
    if (this.highlightMesh) {
      this.group.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      this.highlightMesh = null;
    }

    const frames = computeWorldFrames(tree);
    this.group.position.set(0, POT_SOIL_LOCAL_Y, 0);

    const scales: ScaleInstance[] = [];

    for (const node of Object.values(tree.nodes)) {
      if (!node.living) continue;
      const frame = frames.get(node.id);
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

    if (this.selectedId && frames.has(this.selectedId)) {
      const node = tree.nodes[this.selectedId];
      const frame = frames.get(this.selectedId)!;
      if (node) {
        const r = Math.max(node.radius, MIN_VISUAL_RADIUS) * 1.35;
        this.highlightMesh = this.makeTaperedSegment(
          r,
          r * 0.9,
          frame,
          this.highlightMat,
        );
        this.highlightMesh.userData.nodeId = this.selectedId;
        this.group.add(this.highlightMesh);
      }
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
    // Nebari flare on root internode
    if (node.parentId === null) {
      r0 *= 1.55;
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

    const mat = barkMaterialForSegment(this.barkMat, node.length, node.radius);
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
    if (node.children.length > 0) {
      const tipJoint = new THREE.Mesh(this._jointGeo, mat);
      tipJoint.position.set(...frame.tip);
      tipJoint.scale.set(r1 * 1.05, r1 * 0.9, r1 * 1.05);
      tipJoint.castShadow = true;
      tipJoint.receiveShadow = true;
      tipJoint.userData.nodeId = id;
      this.branchGroup.add(tipJoint);
    }
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
    // Bare structural trunk — keep lower thick wood clean
    if (node.radius >= 0.0075 && !isTip && node.children.length > 1) return;
    // Only foliage-bearing / thin shoots
    if (!isTip && node.radius >= 0.006 && node.foliage.every((f) => !f.living)) {
      return;
    }

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

    // Continuous sleeve: rings along full internode for thin wood
    const rings = isTip
      ? Math.max(8, Math.floor(len / 0.0022))
      : Math.max(5, Math.floor(len / 0.003));
    const perRing = isTip ? 11 : 9;
    const layers = isTip ? 3 : 2;
    const scaleBase = isTip ? 0.0024 : 0.002;
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
      this.foliageGroup.add(
        this.makeInstancedScales(mature, this.foliageMat),
      );
    }
    if (tips.length) {
      this.foliageGroup.add(
        this.makeInstancedScales(tips, this.foliageTipMat),
      );
    }
  }

  private makeInstancedScales(
    items: ScaleInstance[],
    mat: THREE.Material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.scaleGeo, mat, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      this._dummy.position.copy(s.position);
      this._dummy.quaternion.copy(s.quaternion);
      this._dummy.scale.copy(s.scale);
      this._dummy.updateMatrix();
      mesh.setMatrixAt(i, this._dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
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
    const mesh = new THREE.Mesh(geo, this.wireMat);
    mesh.castShadow = true;
    this.wireGroup.add(mesh);
  }

  private clearGroup(g: THREE.Group): void {
    const sharedMats = new Set<THREE.Material>([
      this.barkMat,
      this.foliageMat,
      this.foliageTipMat,
      this.wireMat,
      this.highlightMat,
    ]);
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
    this.scaleGeo.dispose();
    this._jointGeo.dispose();
    this.barkMat.dispose();
    this.foliageMat.dispose();
    this.foliageTipMat.dispose();
    this.wireMat.dispose();
    this.highlightMat.dispose();
  }
}
