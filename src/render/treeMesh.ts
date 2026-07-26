import * as THREE from 'three';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import type { Internode, NodeId, Season, TreeState } from '../sim/types';
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
  /** Season drives tip flush color (Phase B). */
  private season: Season = 'mainFlush';
  private scarGroup = new THREE.Group();
  private budGroup = new THREE.Group();
  private scarMat: THREE.MeshStandardMaterial | null = null;
  private budMat: THREE.MeshStandardMaterial | null = null;
  private feedbackUntil = 0;

  readonly pickables: THREE.Object3D[] = [];

  constructor() {
    this.group.name = 'tree';
    this.group.add(
      this.branchGroup,
      this.foliageGroup,
      this.wireGroup,
      this.scarGroup,
      this.budGroup,
    );
  }

  setSeason(season: Season): void {
    if (this.season === season) return;
    this.season = season;
    this.applySeasonFoliageTint();
  }

  /** Brief visual pulse after prune/pinch — canopy settles; status is secondary. */
  pulseToolFeedback(kind: 'prune' | 'pinch'): void {
    this.feedbackUntil = performance.now() + (kind === 'prune' ? 150 : 100);
    // Soft opacity dip on foliage reads as cut without confetti
    if (this.foliageMat) {
      this.foliageMat.opacity = 0.82;
      this.foliageMat.transparent = true;
    }
    if (this.foliageTipMat) {
      this.foliageTipMat.opacity = 0.78;
      this.foliageTipMat.transparent = true;
    }
    window.setTimeout(() => {
      if (performance.now() >= this.feedbackUntil) {
        if (this.foliageMat) {
          this.foliageMat.opacity = 1;
          this.foliageMat.transparent = false;
        }
        if (this.foliageTipMat) {
          this.foliageTipMat.opacity = 1;
          this.foliageTipMat.transparent = false;
        }
      }
    }, kind === 'prune' ? 160 : 110);
  }

  private applySeasonFoliageTint(): void {
    if (!this.foliageMat || !this.foliageTipMat) return;
    // Mature pad stays evergreen midtones; tips shift with flush.
    // Cool seasons are relatively darker, not black felt (#42 value pass).
    switch (this.season) {
      case 'earlyFlush':
      case 'mainFlush':
        this.foliageTipMat.color.set('#72a856');
        this.foliageTipMat.sheenColor?.set('#a8d46e');
        this.foliageMat.color.set('#4f8248');
        break;
      case 'hardening':
        this.foliageTipMat.color.set('#5a8a4a');
        this.foliageTipMat.sheenColor?.set('#7aaa58');
        this.foliageMat.color.set('#467840');
        break;
      case 'rest':
      case 'dormant':
        this.foliageTipMat.color.set('#4e7a46');
        this.foliageTipMat.sheenColor?.set('#6a9052');
        this.foliageMat.color.set('#426e3c');
        break;
    }
  }

  private ensureMaterials(): void {
    if (!this.barkMat) this.barkMat = createBarkMaterial();
    if (!this.foliageMat) this.foliageMat = createFoliageMaterial();
    if (!this.foliageTipMat) this.foliageTipMat = createFoliageTipMaterial();
    if (!this.wireMat) this.wireMat = createWireMaterial();
    if (!this.highlightMat) this.highlightMat = createHighlightMaterial();
    if (!this.highlightRimMat) this.highlightRimMat = createHighlightRimMaterial();
    if (!this.scarMat) {
      this.scarMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#3a2a22'),
        roughness: 0.95,
        metalness: 0,
      });
    }
    if (!this.budMat) {
      this.budMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#6a8a48'),
        roughness: 0.7,
        metalness: 0,
      });
    }
    if (!this.scaleGeo) this.scaleGeo = createScaleGeometry();
    this.applySeasonFoliageTint();
  }

  setSelected(id: NodeId | null): void {
    this.selectedId = id;
  }

  rebuild(tree: TreeState, frames?: Map<NodeId, NodeWorld>): void {
    this.ensureMaterials();
    this.clearGroup(this.branchGroup);
    this.clearGroup(this.foliageGroup);
    this.clearGroup(this.wireGroup);
    this.clearGroup(this.scarGroup);
    this.clearGroup(this.budGroup);
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
        this.addWireVisual(
          frame,
          Math.max(node.radius, MIN_VISUAL_RADIUS),
          node.wire.setAmount,
          node.lignification,
        );
      }
      if (node.wound > 0.05) {
        this.addScarVisual(frame, node);
      }
      this.addBudMarkers(node, frame);
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
    // Nebari flare on root + near-root — trunk seats in soil, not a pole in cake
    if (node.parentId === null) {
      r0 *= 2.35;
    } else {
      // Depth-aware taper boost for presentation
      let depth = 0;
      let p: NodeId | null = node.parentId;
      while (p && depth < 6) {
        depth += 1;
        p = tree.nodes[p]?.parentId ?? null;
      }
      if (depth <= 1) r0 *= 1.35;
      else if (depth === 2) r0 *= 1.12;
    }
    let r1 = r0 * 0.78;
    if (node.children.length) {
      let sum = 0;
      for (const c of node.children) {
        sum += this.visualRadius(tree.nodes[c]?.radius ?? node.radius * 0.7);
      }
      r1 = Math.min(r0 * 0.92, (sum / node.children.length) * 1.05);
    } else {
      r1 = r0 * 0.48;
    }
    // Stronger visual taper root→tip on long segments
    if (node.length > 0.02 && node.parentId === null) {
      r1 = Math.min(r1, r0 * 0.62);
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
      mat.color.offsetHSL(-0.03, -0.06, -0.04);
      mat.roughness = Math.min(0.98, mat.roughness + 0.04);
      if (mat.normalScale) {
        mat.normalScale.set(1.25, 1.25);
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
   * Juniper pad language: elliptical pad clouds with density falloff and
   * intentional negative space — not per-internode bottle-brush confetti.
   */
  private collectScales(
    node: Internode,
    frame: NodeWorld,
    _tree: TreeState,
    out: ScaleInstance[],
  ): void {
    const isTip = node.children.length === 0;
    // Bare structural wood — trunk / thick leaders show bark only
    if (node.parentId === null) return;
    if (!isTip && node.radius >= 0.0042) return;
    if (!isTip && node.lignification > 0.6) return;
    if (!isTip && node.foliage.every((f) => !f.living)) return;

    const base = new THREE.Vector3(...frame.base);
    const tip = new THREE.Vector3(...frame.tip);
    const dir = new THREE.Vector3(...frame.dir).normalize();
    const len = node.length;
    const r = this.visualRadius(node.radius);

    const sideRef =
      Math.abs(dir.y) > 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(dir, sideRef).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, dir).normalize();

    // Prefer fewer, larger pad volumes over dense wrong scales
    const padCenters: Array<{ t: number; side: number; elev: number }> = [];
    if (isTip) {
      // One primary tip pad + optional small secondary for silhouette gaps
      padCenters.push({ t: 0.72, side: 0, elev: 0.15 });
      if (len > 0.012) padCenters.push({ t: 0.42, side: 0.55, elev: -0.1 });
      if (len > 0.022) padCenters.push({ t: 0.55, side: -0.65, elev: 0.05 });
    } else {
      // Sparse mid-shoot pads only where living foliage clusters exist
      const living = node.foliage.filter((f) => f.living);
      const nPads = Math.min(2, Math.max(1, living.length));
      for (let i = 0; i < nPads; i++) {
        const f = living[i] ?? living[0];
        padCenters.push({
          t: f?.t ?? 0.5,
          side: Math.sin(f?.azimuth ?? i) * 0.4,
          elev: Math.cos((f?.azimuth ?? i) * 1.3) * 0.2,
        });
      }
    }

    const tipGrowth =
      isTip ||
      node.lignification < 0.35 ||
      this.season === 'earlyFlush' ||
      this.season === 'mainFlush';

    for (let pi = 0; pi < padCenters.length; pi++) {
      const pad = padCenters[pi];
      const center = base
        .clone()
        .addScaledVector(dir, pad.t * len)
        .addScaledVector(normal, pad.side * r * 2.2)
        .addScaledVector(binormal, pad.elev * r * 1.6);

      // Elliptical pad cloud — denser core, soft falloff edge
      const count = isTip ? (pi === 0 ? 36 : 18) : 14;
      const rx = isTip ? 0.0065 + r * 1.8 : 0.0042 + r * 1.2;
      const ry = isTip ? 0.0042 + r * 1.1 : 0.0028 + r * 0.8;
      const rz = isTip ? 0.0055 + r * 1.4 : 0.0035 + r * 1.0;
      const scaleBase = isTip ? 0.0032 : 0.0022;

      for (let i = 0; i < count; i++) {
        // Deterministic quasi-uniform in unit ball shell
        const u = (i + 0.5) / count;
        const ang = u * Math.PI * 2 * 2.7 + pi * 1.7 + node.ageDays * 0.02;
        const elev = Math.asin(2 * ((i * 0.618) % 1) - 1);
        const fall = 0.25 + 0.75 * ((i * 7) % 10) / 10;
        const cosE = Math.cos(elev);
        const ox = Math.cos(ang) * cosE * rx * fall;
        const oy = Math.sin(elev) * ry * fall;
        const oz = Math.sin(ang) * cosE * rz * fall;

        const spin = new THREE.Vector3(
          normal.x * ox + binormal.x * oz + dir.x * oy,
          normal.y * ox + binormal.y * oz + dir.y * oy,
          normal.z * ox + binormal.z * oz + dir.z * oy,
        );
        const pos = center.clone().add(spin);

        const face = spin
          .clone()
          .normalize()
          .multiplyScalar(0.55)
          .addScaledVector(dir, 0.45)
          .normalize();
        if (face.lengthSq() < 1e-6) face.copy(dir);

        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          face,
        );
        const edge = fall;
        const sc = scaleBase * (0.75 + (1 - edge) * 0.45) * (0.9 + (i % 3) * 0.06);
        const isTipScale =
          tipGrowth && (isTip ? pad.t > 0.5 || pi === 0 : false) && fall < 0.75;

        out.push({
          position: pos,
          quaternion: quat,
          scale: new THREE.Vector3(sc * 1.15, sc * 1.35, sc),
          tip: isTipScale,
        });
      }
    }

    // Tiny tip apex cloud for silhouette read at thumbnail size
    if (isTip) {
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const elev = (i % 4) / 4;
        const spin2 = new THREE.Vector3(
          normal.x * Math.cos(ang) + binormal.x * Math.sin(ang),
          normal.y * Math.cos(ang) + binormal.y * Math.sin(ang),
          normal.z * Math.cos(ang) + binormal.z * Math.sin(ang),
        ).normalize();
        const sc = 0.002 + (i % 3) * 0.0002;
        out.push({
          position: tip
            .clone()
            .addScaledVector(dir, 0.0006 + elev * 0.0018)
            .addScaledVector(spin2, r * 0.4 + elev * 0.0015),
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            spin2.clone().multiplyScalar(0.4).addScaledVector(dir, 0.8).normalize(),
          ),
          scale: new THREE.Vector3(sc, sc * 1.3, sc),
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

  /**
   * Training wire — dulls as setAmount rises (visual lignify cue).
   * setAmount 0 = bright training metal; 1 = dull held wood.
   */
  private addWireVisual(
    frame: NodeWorld,
    radius: number,
    setAmount = 0,
    lignification = 0,
  ): void {
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
    // Slightly thinner as set progresses (wire less dominant when wood holds)
    const tubeR = 0.00055 * (1 - setAmount * 0.25);
    const geo = new THREE.TubeGeometry(curve, segs, tubeR, 6, false);
    const mat = this.wireMat!.clone();
    // Dull aluminum → dark oxidized as set progresses
    const dull = Math.max(setAmount, lignification * 0.35);
    mat.color.setRGB(
      0.69 - dull * 0.28,
      0.63 - dull * 0.22,
      0.56 - dull * 0.12,
    );
    mat.metalness = 0.84 - dull * 0.45;
    mat.roughness = 0.45 + dull * 0.4;
    mat.envMapIntensity = 0.85 - dull * 0.5;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.disposeMat = true;
    this.wireGroup.add(mesh);
  }

  /** Cut scar — dark when fresh (high wound), fades as wound decays. */
  private addScarVisual(frame: NodeWorld, node: Internode): void {
    const tip = new THREE.Vector3(...frame.tip);
    const dir = new THREE.Vector3(...frame.dir).normalize();
    const r = this.visualRadius(node.radius) * (0.9 + node.wound * 0.4);
    const mat = this.scarMat!.clone();
    // Fresh cut: redder/darker; healed: cooler charcoal
    const w = node.wound;
    mat.color.setRGB(0.22 + w * 0.2, 0.12 + w * 0.05, 0.1);
    mat.roughness = 0.9 - w * 0.1;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 12),
      mat,
    );
    disc.position.copy(tip).addScaledVector(dir, 0.0002);
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    disc.userData.disposeMat = true;
    this.scarGroup.add(disc);
  }

  /** Pre-break bud swell when breakForce is high. */
  private addBudMarkers(node: Internode, frame: NodeWorld): void {
    const base = new THREE.Vector3(...frame.base);
    const dir = new THREE.Vector3(...frame.dir).normalize();
    const r = this.visualRadius(node.radius);
    const sideRef =
      Math.abs(dir.y) > 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(dir, sideRef).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, dir).normalize();

    for (const bud of node.buds) {
      if (bud.state === 'dead') continue;
      // Only show swell when stimulus is legible
      if (bud.breakForce < 0.35 && bud.state !== 'flushing') continue;
      const force = Math.min(1.2, bud.breakForce);
      const size = 0.00055 + force * 0.0011;
      const ang = bud.azimuth;
      const spin = new THREE.Vector3(
        normal.x * Math.cos(ang) + binormal.x * Math.sin(ang),
        normal.y * Math.cos(ang) + binormal.y * Math.sin(ang),
        normal.z * Math.cos(ang) + binormal.z * Math.sin(ang),
      ).normalize();
      const mat = this.budMat!.clone();
      if (bud.state === 'flushing') {
        mat.color.set('#7aaa50');
      } else {
        // Rising potential: warmer green as force rises
        mat.color.setRGB(0.35 + force * 0.15, 0.5 + force * 0.12, 0.28);
      }
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(size, 8, 6),
        mat,
      );
      sphere.position
        .copy(base)
        .addScaledVector(dir, bud.t * node.length)
        .addScaledVector(spin, r + size * 0.6);
      sphere.userData.disposeMat = true;
      this.budGroup.add(sphere);
    }
  }

  private clearGroup(g: THREE.Group): void {
    const sharedMats = new Set<THREE.Material>();
    if (this.barkMat) sharedMats.add(this.barkMat);
    if (this.foliageMat) sharedMats.add(this.foliageMat);
    if (this.foliageTipMat) sharedMats.add(this.foliageTipMat);
    if (this.wireMat) sharedMats.add(this.wireMat);
    if (this.highlightMat) sharedMats.add(this.highlightMat);
    if (this.highlightRimMat) sharedMats.add(this.highlightRimMat);
    if (this.scarMat) sharedMats.add(this.scarMat);
    if (this.budMat) sharedMats.add(this.budMat);
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
    this.scarMat?.dispose();
    this.budMat?.dispose();
    this.clearGroup(this.scarGroup);
    this.clearGroup(this.budGroup);
  }
}
