import * as THREE from 'three';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import type { Internode, NodeId, Season, TreeState } from '../sim/types';
import {
  barkMaterialForSegment,
  createBarkMaterial,
  createCoachHighlightMaterial,
  createCoachHighlightRimMaterial,
  createFoliageMaterial,
  createFoliageTipMaterial,
  createHighlightMaterial,
  createHighlightRimMaterial,
  createWireMaterial,
} from './materials';
import { POT_SOIL_LOCAL_Y } from './pot';

const UP = new THREE.Vector3(0, 1, 0);
/**
 * GPU / aliasing epsilon only — visual diameter follows sim (#58).
 * Old floor 0.0016 m (~3.2 mm diam) fattened every twig into a stick.
 */
const MIN_VISUAL_RADIUS = 0.00012;
/**
 * Minimum pick-proxy radius (m). Thin mesh stays fine; raycast uses a
 * slightly fatter invisible collider so prune/wire remain usable (#58).
 */
const PICK_MIN_RADIUS = 0.0024;
/**
 * Soft cap so large trees stay interactive on mobile / headless.
 * Lowered from 16k (#34) — pad clouds still read full; write/rebuild cost drops.
 */
const MAX_SCALE_INSTANCES = 9000;

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
  /** Invisible fat collider for thin wood — not drawn (#58). */
  pickProxy: THREE.Mesh | null;
  /** Optional surface-root flare lobes (root only) (#57). */
  flareLobes: THREE.Mesh[];
  r0: number;
  r1: number;
}

/** Local-space flare lobe: unit cylinder along +Y, reoriented in applyPose. */
interface FlareLobeSpec {
  mesh: THREE.Mesh;
  /** Radians around trunk +Y. */
  azimuth: number;
  /** Outward length along soil plane. */
  length: number;
  /** Slight downward pitch into soil (radians). */
  pitch: number;
}

/** Training wire coil — helix baked in local +Y; re-oriented from live frames. */
interface WirePoseHandle {
  mesh: THREE.Mesh;
  nodeId: NodeId;
}

/** Cut scar disc at live tip. */
interface ScarPoseHandle {
  mesh: THREE.Mesh;
  nodeId: NodeId;
}

/** Bud swell sphere — local t/azimuth; position from live frame each pose. */
interface BudPoseHandle {
  mesh: THREE.Mesh;
  nodeId: NodeId;
  t: number;
  azimuth: number;
  size: number;
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
  private coachMat: THREE.MeshBasicMaterial | null = null;
  private coachRimMat: THREE.MeshBasicMaterial | null = null;
  private branchGroup = new THREE.Group();
  private foliageGroup = new THREE.Group();
  private wireGroup = new THREE.Group();
  private highlightMesh: THREE.Mesh | null = null;
  private highlightRim: THREE.Mesh | null = null;
  /** Practice overflow coach tips (warm ink), distinct from selection. */
  private coachMeshes: Array<{
    id: NodeId;
    mesh: THREE.Mesh;
    rim: THREE.Mesh;
  }> = [];
  private selectedId: NodeId | null = null;
  private coachIds: NodeId[] = [];
  private scaleGeo: THREE.BufferGeometry | null = null;
  /** Branch cylinder tessellation — 10 is enough for bonsai scale (#34 rebuild cost). */
  private radialSegments = 10;
  private readonly _dummy = new THREE.Object3D();
  private readonly _jointGeo = new THREE.SphereGeometry(1, 12, 10);
  /** Scratch vectors for decoration re-pose (avoid GC in applyPose). */
  private readonly _vBase = new THREE.Vector3();
  private readonly _vTip = new THREE.Vector3();
  private readonly _vDir = new THREE.Vector3();
  private readonly _vN = new THREE.Vector3();
  private readonly _vB = new THREE.Vector3();
  private readonly _vSpin = new THREE.Vector3();
  private readonly _vUp = new THREE.Vector3(0, 0, 1);
  /** Branch mesh handles for per-frame physics pose streaming. */
  private poseHandles = new Map<NodeId, SegmentPoseHandles>();
  /** Root flare lobe specs for live re-pose (session mesh only). */
  private flareLobeSpecs: FlareLobeSpec[] = [];
  /** Wire / scar / bud attachments re-placed from live frames in applyPose. */
  private wirePoseHandles: WirePoseHandle[] = [];
  private scarPoseHandles: ScarPoseHandle[] = [];
  private budPoseHandles: BudPoseHandle[] = [];
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
  /** Shared invisible material for pick proxies (thin-wood hit bias). */
  private pickMat: THREE.MeshBasicMaterial | null = null;
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
    if (!this.coachMat) this.coachMat = createCoachHighlightMaterial();
    if (!this.coachRimMat) this.coachRimMat = createCoachHighlightRimMaterial();
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

  /**
   * Practice coach overflow tips (warm ink). Empty clears.
   * Distinct from primary selection highlight.
   */
  setCoachHighlights(ids: readonly NodeId[]): void {
    const next = ids.slice(0, 8);
    if (
      next.length === this.coachIds.length &&
      next.every((id, i) => id === this.coachIds[i])
    ) {
      return;
    }
    this.coachIds = next;
  }

  getCoachHighlights(): readonly NodeId[] {
    return this.coachIds;
  }

  private clearCoachMeshes(): void {
    for (const c of this.coachMeshes) {
      this.group.remove(c.mesh);
      this.group.remove(c.rim);
      c.mesh.geometry.dispose();
      c.rim.geometry.dispose();
    }
    this.coachMeshes = [];
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
    this.flareLobeSpecs.length = 0;
    this.wirePoseHandles.length = 0;
    this.scarPoseHandles.length = 0;
    this.budPoseHandles.length = 0;
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
    this.clearCoachMeshes();

    const live = frames ?? computeWorldFrames(tree);
    // Bury root slightly so trunk seats in soil (no floating stick / hard disc cut)
    this.group.position.set(0, POT_SOIL_LOCAL_Y - 0.0045, 0);

    const scales: ScaleInstance[] = [];

    for (const node of Object.values(tree.nodes)) {
      if (!node.living) continue;
      const frame = live.get(node.id);
      if (!frame || node.length < 1e-6) continue;

      this.addBranchSegment(node.id, node, frame, tree);
      this.collectScales(node, frame, tree, scales);
      if (node.wire) {
        this.addWireVisual(
          node.id,
          frame,
          Math.max(node.radius, MIN_VISUAL_RADIUS),
          node.wire.setAmount,
          node.lignification,
        );
      }
      if (node.wound > 0.05) {
        this.addScarVisual(node.id, frame, node);
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

    // Coach overflow tips — warm ink, skip if same as primary selection
    for (const id of this.coachIds) {
      if (id === this.selectedId) continue;
      const node = tree.nodes[id];
      const frame = live.get(id);
      if (!node || !frame || !node.living) continue;
      const baseR = Math.max(node.radius, MIN_VISUAL_RADIUS);
      const r = baseR * 1.28;
      const mesh = this.makeTaperedSegment(r, r * 0.88, frame, this.coachMat!);
      mesh.userData.nodeId = id;
      mesh.userData.coach = true;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      const rimR = baseR * 1.48;
      const rim = this.makeTaperedSegment(
        rimR,
        rimR * 0.9,
        frame,
        this.coachRimMat!,
      );
      rim.userData.nodeId = id;
      rim.userData.coach = true;
      rim.renderOrder = 2;
      this.group.add(rim);
      this.coachMeshes.push({ id, mesh, rim });
    }
  }

  /**
   * Stream live physics pose onto existing meshes without a full rebuild.
   * Branch segments, wire coils, bud orbs, scars, and foliage follow live frames.
   */
  applyPose(tree: TreeState, frames: Map<NodeId, NodeWorld>): void {
    for (const [id, handles] of this.poseHandles) {
      const frame = frames.get(id);
      if (!frame) continue;
      this.placeSegment(handles.segment, frame);
      if (handles.pickProxy) this.placeSegment(handles.pickProxy, frame);
      this.placeJoint(handles.jointBase, frame.base, frame.dir);
      if (handles.jointTip) {
        this.placeJoint(handles.jointTip, frame.tip, frame.dir);
      }
    }
    // Surface root lobes track root base
    if (this.flareLobeSpecs.length) {
      const root = Object.values(tree.nodes).find((n) => n.parentId === null);
      const frame = root ? frames.get(root.id) : undefined;
      if (frame) {
        for (const lobe of this.flareLobeSpecs) {
          this.placeFlareLobe(lobe, frame);
        }
      }
    }

    // Decorations: same live frames as wood (no TubeGeometry rebuild)
    for (const h of this.wirePoseHandles) {
      const frame = frames.get(h.nodeId);
      if (frame) this.placeWireAlongFrame(h.mesh, frame);
    }
    for (const h of this.scarPoseHandles) {
      const frame = frames.get(h.nodeId);
      if (frame) this.placeScarOnFrame(h.mesh, frame);
    }
    for (const h of this.budPoseHandles) {
      const frame = frames.get(h.nodeId);
      const node = tree.nodes[h.nodeId];
      if (frame && node) {
        this.placeBudOnFrame(h.mesh, frame, node, h.t, h.azimuth, h.size);
      }
    }

    if (this.selectedId) {
      const frame = frames.get(this.selectedId);
      if (frame) {
        if (this.highlightMesh) this.placeSegment(this.highlightMesh, frame);
        if (this.highlightRim) this.placeSegment(this.highlightRim, frame);
      }
    }
    for (const c of this.coachMeshes) {
      const frame = frames.get(c.id);
      if (frame) {
        this.placeSegment(c.mesh, frame);
        this.placeSegment(c.rim, frame);
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
      r0 *= 2.65;
    } else {
      // Depth-aware taper boost for presentation
      let depth = 0;
      let p: NodeId | null = node.parentId;
      while (p && depth < 6) {
        depth += 1;
        p = tree.nodes[p]?.parentId ?? null;
      }
      if (depth <= 1) r0 *= 1.42;
      else if (depth === 2) r0 *= 1.15;
    }

    // Parent→child radius continuity: start child near parent tip radius
    if (node.parentId) {
      const parent = tree.nodes[node.parentId];
      if (parent) {
        // Prefer already-built parent tip; else estimate from parent radius
        let parentTipR = this.poseHandles.get(node.parentId)?.r1;
        if (parentTipR == null) {
          let pr = this.visualRadius(parent.radius);
          if (parent.parentId === null) pr *= 2.65;
          parentTipR = pr * 0.78;
        }
        // Soft blend — avoid hard step-down at crotch
        r0 = Math.max(r0, parentTipR * 0.72);
        r0 = Math.min(r0, parentTipR * 1.08);
      }
    }

    let r1 = r0 * 0.78;
    if (node.children.length) {
      let sum = 0;
      for (const c of node.children) {
        sum += this.visualRadius(tree.nodes[c]?.radius ?? node.radius * 0.7);
      }
      // Tip radius sits slightly above mean child base so crotch fills without a ball
      r1 = Math.min(r0 * 0.9, (sum / node.children.length) * 1.02);
    } else {
      r1 = r0 * 0.48;
    }
    // Stronger visual taper root→tip on long segments
    if (node.length > 0.02 && node.parentId === null) {
      r1 = Math.min(r1, r0 * 0.58);
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
    } else if (node.parentId === null) {
      // Root/base bark: darker, rougher — reads as aged nebari
      mat.color.offsetHSL(-0.02, -0.04, -0.08);
      mat.roughness = Math.min(0.99, mat.roughness + 0.08);
      if (mat.normalScale) {
        mat.normalScale.set(1.4, 1.4);
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

    // Pick: fatten hit target without fattening the drawn mesh (#58)
    let pickProxy: THREE.Mesh | null = null;
    if (Math.min(r0, r1) < PICK_MIN_RADIUS) {
      if (!this.pickMat) {
        this.pickMat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        });
      }
      const pickR0 = Math.max(r0, PICK_MIN_RADIUS);
      const pickR1 = Math.max(r1, PICK_MIN_RADIUS * 0.75);
      pickProxy = this.makeTaperedSegment(pickR0, pickR1, frame, this.pickMat);
      pickProxy.userData.nodeId = id;
      pickProxy.castShadow = false;
      pickProxy.receiveShadow = false;
      // Keep in scene graph so raycast finds it; fully transparent
      this.branchGroup.add(pickProxy);
      this.pickables.push(pickProxy);
    } else {
      this.pickables.push(mesh);
    }

    // Joint collar at base — elongated capsule blend, not a ball bearing (#57).
    // Root skips the base sphere (flare lobes + tapered cylinder seat the nebari;
    // a sphere here left a hard ring seam in soil close-ups).
    let joint: THREE.Mesh;
    if (node.parentId === null) {
      // Invisible placeholder so poseHandles stay uniform
      joint = new THREE.Mesh(this._jointGeo, mat);
      joint.visible = false;
      joint.scale.set(r0, r0, r0);
      this.placeJoint(joint, frame.base, frame.dir);
      this.branchGroup.add(joint);
    } else {
      const jointR = Math.max(r0 * 0.98, MIN_VISUAL_RADIUS);
      joint = new THREE.Mesh(this._jointGeo, mat);
      // Local Y = branch axis after placeJoint; scale (perp, along, perp)
      joint.scale.set(jointR * 0.92, jointR * 1.22, jointR * 0.92);
      joint.castShadow = true;
      joint.receiveShadow = true;
      joint.userData.nodeId = id;
      this.placeJoint(joint, frame.base, frame.dir);
      this.branchGroup.add(joint);
    }

    // Tip joint when branching — sized to mean child, stretched along parent axis
    let tipJoint: THREE.Mesh | null = null;
    if (node.children.length > 0) {
      let childR = r1;
      let nC = 0;
      for (const c of node.children) {
        const cr = this.visualRadius(tree.nodes[c]?.radius ?? node.radius * 0.7);
        childR += cr;
        nC += 1;
      }
      const blendR = Math.max(childR / (nC + 1), MIN_VISUAL_RADIUS);
      tipJoint = new THREE.Mesh(this._jointGeo, mat);
      // Collar, not marble — slightly flattened on the perpendicular
      tipJoint.scale.set(blendR * 0.94, blendR * 1.16, blendR * 0.94);
      tipJoint.castShadow = true;
      tipJoint.receiveShadow = true;
      tipJoint.userData.nodeId = id;
      this.placeJoint(tipJoint, frame.tip, frame.dir);
      this.branchGroup.add(tipJoint);
    }

    const flareLobes: THREE.Mesh[] = [];
    if (node.parentId === null) {
      // Surface root flare lobes — visual only, seats trunk in soil
      this.addRootFlareLobes(frame, r0, mat, flareLobes);
    }

    this.poseHandles.set(id, {
      segment: mesh,
      jointBase: joint,
      jointTip: tipJoint,
      pickProxy,
      flareLobes,
      r0,
      r1,
    });
  }

  /**
   * Orient a joint ellipsoid so local +Y follows branch direction.
   * Scale is set by caller (perp, along, perp) for capsule-like collars.
   */
  private placeJoint(
    mesh: THREE.Mesh,
    pos: readonly [number, number, number],
    dir: readonly [number, number, number],
  ): void {
    mesh.position.set(pos[0], pos[1], pos[2]);
    this._vDir.set(dir[0], dir[1], dir[2]).normalize();
    if (this._vDir.lengthSq() < 1e-8) this._vDir.set(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(UP, this._vDir);
  }

  /** Visual-only surface roots at nebari — tapered lobes into soil plane. */
  private addRootFlareLobes(
    frame: NodeWorld,
    baseR: number,
    mat: THREE.Material,
    out: THREE.Mesh[],
  ): void {
    // Deterministic 5-lobe flare; lengths vary slightly for organic read
    const lobes = 5;
    for (let i = 0; i < lobes; i++) {
      const az = (i / lobes) * Math.PI * 2 + 0.41;
      const len = baseR * (2.4 + (i % 3) * 0.35);
      const rBase = baseR * (0.42 - (i % 2) * 0.06);
      const rTip = rBase * 0.22;
      const pitch = 0.22 + (i % 3) * 0.04; // slight dig into soil
      const geo = new THREE.CylinderGeometry(
        Math.max(0.0004, rTip),
        Math.max(0.0005, rBase),
        1,
        8,
        1,
        false,
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.nodeId = 'root';
      const spec: FlareLobeSpec = { mesh, azimuth: az, length: len, pitch };
      this.placeFlareLobe(spec, frame);
      this.branchGroup.add(mesh);
      this.flareLobeSpecs.push(spec);
      out.push(mesh);
    }
  }

  private placeFlareLobe(spec: FlareLobeSpec, frame: NodeWorld): void {
    this._vBase.set(...frame.base);
    // Prefer horizontal outward from trunk; fall back if base is odd
    const outX = Math.cos(spec.azimuth);
    const outZ = Math.sin(spec.azimuth);
    // Direction: mostly radial + slight down into soil
    this._vDir.set(outX * Math.cos(spec.pitch), -Math.sin(spec.pitch), outZ * Math.cos(spec.pitch)).normalize();
    // Lobe origin at root base, offset slightly outward so it reads as flare not stick-through
    const start = this._vBase
      .clone()
      .add(new THREE.Vector3(outX, 0, outZ).multiplyScalar(0.0008));
    // Cylinder is unit along +Y; center at mid-lobe
    const mid = start.clone().addScaledVector(this._vDir, spec.length * 0.5);
    spec.mesh.position.copy(mid);
    spec.mesh.scale.set(1, spec.length, 1);
    spec.mesh.quaternion.setFromUnitVectors(UP, this._vDir);
  }

  private makeTaperedSegment(
    r0: number,
    r1: number,
    frame: NodeWorld,
    mat: THREE.Material,
  ): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(
      Math.max(MIN_VISUAL_RADIUS, r1),
      Math.max(MIN_VISUAL_RADIUS, r0),
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
   * Pads originate on bark (origin cluster) then fan outward.
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
      padCenters.push({ t: 0.72, side: 0.15, elev: 0.12 });
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
          side: Math.sin(f?.azimuth ?? i) * 0.55 || 0.4,
          elev: Math.cos((f?.azimuth ?? i) * 1.3) * 0.25,
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
      // Radial attach direction on bark (not floating beside wood)
      const attachDir = normal
        .clone()
        .multiplyScalar(pad.side || 0.2)
        .addScaledVector(binormal, pad.elev)
        .normalize();
      if (attachDir.lengthSq() < 1e-6) attachDir.copy(normal);

      const onBark = base
        .clone()
        .addScaledVector(dir, pad.t * len)
        .addScaledVector(attachDir, r * 0.95);

      // Origin cluster — dense tiny scales seated on bark before pad fans out
      const originCount = isTip && pi === 0 ? 10 : 6;
      for (let oi = 0; oi < originCount; oi++) {
        const u = (oi + 0.5) / originCount;
        const ang = u * Math.PI * 2 + pi * 0.9 + node.ageDays * 0.01;
        const spread = r * (0.15 + (oi % 3) * 0.08);
        const along = ((oi % 5) - 2) * r * 0.12;
        const opos = onBark
          .clone()
          .addScaledVector(attachDir, r * 0.08 + (oi % 2) * 0.00015)
          .addScaledVector(dir, along)
          .addScaledVector(
            normal.clone().multiplyScalar(Math.cos(ang)).addScaledVector(binormal, Math.sin(ang)),
            spread,
          );
        const osc = 0.0011 + (oi % 3) * 0.00015;
        out.push({
          position: opos,
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            attachDir
              .clone()
              .multiplyScalar(0.65)
              .addScaledVector(dir, 0.35)
              .normalize(),
          ),
          scale: new THREE.Vector3(osc * 1.05, osc * 1.2, osc),
          tip: tipGrowth && isTip && pi === 0 && oi < 3,
        });
      }

      // Pad cloud fans outward from bark origin (keep mass near wood)
      const center = onBark
        .clone()
        .addScaledVector(attachDir, (isTip ? 0.0022 : 0.0014) + r * 0.35)
        .addScaledVector(dir, isTip && pi === 0 ? 0.0008 : 0);

      const count = isTip ? (pi === 0 ? 34 : 16) : 12;
      const rx = isTip ? 0.0055 + r * 1.4 : 0.0034 + r * 1.0;
      const ry = isTip ? 0.0034 + r * 0.9 : 0.0022 + r * 0.65;
      const rz = isTip ? 0.0044 + r * 1.1 : 0.0026 + r * 0.8;
      const scaleBase = isTip ? 0.0028 : 0.0019;

      for (let i = 0; i < count; i++) {
        // Deterministic quasi-uniform in unit ball shell
        const u = (i + 0.5) / count;
        const ang = u * Math.PI * 2 * 2.7 + pi * 1.7 + node.ageDays * 0.02;
        const elev = Math.asin(2 * ((i * 0.618) % 1) - 1);
        // Bias density toward bark (fall closer to origin on inner half)
        const fall = 0.2 + 0.8 * ((i * 7) % 10) / 10;
        const cosE = Math.cos(elev);
        const ox = Math.cos(ang) * cosE * rx * fall;
        const oy = Math.sin(elev) * ry * fall;
        const oz = Math.sin(ang) * cosE * rz * fall;

        const spin = new THREE.Vector3(
          normal.x * ox + binormal.x * oz + dir.x * oy,
          normal.y * ox + binormal.y * oz + dir.y * oy,
          normal.z * ox + binormal.z * oz + dir.z * oy,
        );
        // Keep inner scales closer to wood so pad "leaves" the shoot
        const barkBias = 1 - fall * 0.35;
        const pos = center
          .clone()
          .add(spin)
          .addScaledVector(attachDir, -r * 0.15 * barkBias);

        const face = spin
          .clone()
          .normalize()
          .multiplyScalar(0.5)
          .addScaledVector(dir, 0.35)
          .addScaledVector(attachDir, 0.25)
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

    // Tiny tip apex cloud seated on shoot tip wood
    if (isTip) {
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const elev = (i % 4) / 4;
        const spin2 = new THREE.Vector3(
          normal.x * Math.cos(ang) + binormal.x * Math.sin(ang),
          normal.y * Math.cos(ang) + binormal.y * Math.sin(ang),
          normal.z * Math.cos(ang) + binormal.z * Math.sin(ang),
        ).normalize();
        const sc = 0.0018 + (i % 3) * 0.0002;
        out.push({
          position: tip
            .clone()
            .addScaledVector(dir, 0.0003 + elev * 0.0012)
            .addScaledVector(spin2, r * 0.85 + elev * 0.001),
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            spin2.clone().multiplyScalar(0.45).addScaledVector(dir, 0.75).normalize(),
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
   * Training wire — readable without debug; dulls as setAmount rises.
   * Helix is baked in local +Y (length fixed at rebuild); applyPose re-orients
   * the mesh from live frames without reallocating TubeGeometry.
   * setAmount 0 = bright copper-aluminum coil (fresh); 1 = dull bronze (set).
   * Color + thickness + metalness all shift so set progress is glanceable.
   */
  private addWireVisual(
    nodeId: NodeId,
    frame: NodeWorld,
    radius: number,
    setAmount = 0,
    lignification = 0,
  ): void {
    const base = new THREE.Vector3(...frame.base);
    const tip = new THREE.Vector3(...frame.tip);
    const len = tip.distanceTo(base) || 1e-6;

    // Local helix: segment axis = +Y from 0→len; XZ = wrap radius
    const points: THREE.Vector3[] = [];
    const turns = 4;
    const segs = 40;
    // Coil stands just off the bark; scales with wood so thin twigs aren't
    // wrapped by a fixed ~2 mm gap that dwarfs fine features (#58)
    const amp = radius + Math.min(0.0017, Math.max(0.00035, radius * 0.95));
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ang = t * turns * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(ang) * amp, t * len, Math.sin(ang) * amp),
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    // Thicker when fresh; thinner as wood holds the bend — also scale down
    // on hairline shoots so wire doesn't read thicker than the wood
    const tubeBase = Math.min(0.00072, Math.max(0.00028, radius * 0.55));
    const tubeR = tubeBase * (1 - setAmount * 0.35);
    const geo = new THREE.TubeGeometry(curve, segs, tubeR, 6, false);
    const mat = this.wireMat!.clone();
    // Fresh: bright warm copper-aluminum; set: cool dull bronze
    const dull = Math.max(setAmount, lignification * 0.35);
    mat.color.setRGB(
      0.82 - dull * 0.42, // warm → muted
      0.68 - dull * 0.28,
      0.42 - dull * 0.08,
    );
    mat.metalness = 0.92 - dull * 0.55;
    mat.roughness = 0.28 + dull * 0.52;
    mat.envMapIntensity = 1.05 - dull * 0.65;
    // Soft copper glow when freshly wired (set progress cue)
    mat.emissive = new THREE.Color().setRGB(
      0.12 * (1 - dull),
      0.05 * (1 - dull),
      0.02 * (1 - dull),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.disposeMat = true;
    this.placeWireAlongFrame(mesh, frame);
    this.wireGroup.add(mesh);
    this.wirePoseHandles.push({ mesh, nodeId });
  }

  /** Place local-+Y wire coil so base→tip matches live frame (rigid, no re-tube). */
  private placeWireAlongFrame(mesh: THREE.Mesh, frame: NodeWorld): void {
    this._vBase.set(...frame.base);
    this._vTip.set(...frame.tip);
    this._vDir.copy(this._vTip).sub(this._vBase);
    const len = this._vDir.length() || 1e-6;
    this._vDir.multiplyScalar(1 / len);
    mesh.position.copy(this._vBase);
    mesh.quaternion.setFromUnitVectors(UP, this._vDir);
  }

  /** Cut scar — dark when fresh (high wound), fades as wound decays. */
  private addScarVisual(
    nodeId: NodeId,
    frame: NodeWorld,
    node: Internode,
  ): void {
    const r = this.visualRadius(node.radius) * (0.9 + node.wound * 0.4);
    const mat = this.scarMat!.clone();
    // Fresh cut: redder/darker; healed: cooler charcoal
    const w = node.wound;
    mat.color.setRGB(0.22 + w * 0.2, 0.12 + w * 0.05, 0.1);
    mat.roughness = 0.9 - w * 0.1;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 12), mat);
    disc.userData.disposeMat = true;
    this.placeScarOnFrame(disc, frame);
    this.scarGroup.add(disc);
    this.scarPoseHandles.push({ mesh: disc, nodeId });
  }

  private placeScarOnFrame(mesh: THREE.Mesh, frame: NodeWorld): void {
    this._vTip.set(...frame.tip);
    this._vDir.set(...frame.dir).normalize();
    mesh.position.copy(this._vTip).addScaledVector(this._vDir, 0.0002);
    mesh.quaternion.setFromUnitVectors(this._vUp, this._vDir);
  }

  /** Pre-break bud swell when breakForce is high. */
  private addBudMarkers(node: Internode, frame: NodeWorld): void {
    for (const bud of node.buds) {
      if (bud.state === 'dead') continue;
      // Only show swell when stimulus is legible
      if (bud.breakForce < 0.35 && bud.state !== 'flushing') continue;
      const force = Math.min(1.2, bud.breakForce);
      const size = 0.00055 + force * 0.0011;
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
      sphere.userData.disposeMat = true;
      this.placeBudOnFrame(sphere, frame, node, bud.t, bud.azimuth, size);
      this.budGroup.add(sphere);
      this.budPoseHandles.push({
        mesh: sphere,
        nodeId: node.id,
        t: bud.t,
        azimuth: bud.azimuth,
        size,
      });
    }
  }

  private placeBudOnFrame(
    mesh: THREE.Mesh,
    frame: NodeWorld,
    node: Internode,
    t: number,
    azimuth: number,
    size: number,
  ): void {
    this._vBase.set(...frame.base);
    this._vDir.set(...frame.dir).normalize();
    const r = this.visualRadius(node.radius);
    // Match collectScales side-frame construction for stable azimuth on live pose
    if (Math.abs(this._vDir.y) > 0.9) {
      this._vN.set(1, 0, 0);
    } else {
      this._vN.set(0, 1, 0);
    }
    this._vB.crossVectors(this._vDir, this._vN).normalize();
    this._vN.crossVectors(this._vB, this._vDir).normalize();
    const cosA = Math.cos(azimuth);
    const sinA = Math.sin(azimuth);
    this._vSpin.set(
      this._vN.x * cosA + this._vB.x * sinA,
      this._vN.y * cosA + this._vB.y * sinA,
      this._vN.z * cosA + this._vB.z * sinA,
    ).normalize();
    mesh.position
      .copy(this._vBase)
      .addScaledVector(this._vDir, t * node.length)
      .addScaledVector(this._vSpin, r + size * 0.6);
  }

  private clearGroup(g: THREE.Group): void {
    const sharedMats = new Set<THREE.Material>();
    if (this.barkMat) sharedMats.add(this.barkMat);
    if (this.foliageMat) sharedMats.add(this.foliageMat);
    if (this.foliageTipMat) sharedMats.add(this.foliageTipMat);
    if (this.wireMat) sharedMats.add(this.wireMat);
    if (this.highlightMat) sharedMats.add(this.highlightMat);
    if (this.highlightRimMat) sharedMats.add(this.highlightRimMat);
    if (this.coachMat) sharedMats.add(this.coachMat);
    if (this.coachRimMat) sharedMats.add(this.coachRimMat);
    if (this.scarMat) sharedMats.add(this.scarMat);
    if (this.budMat) sharedMats.add(this.budMat);
    if (this.pickMat) sharedMats.add(this.pickMat);
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
    this.coachMat?.dispose();
    this.coachRimMat?.dispose();
    this.scarMat?.dispose();
    this.budMat?.dispose();
    this.pickMat?.dispose();
    this.clearCoachMeshes();
    this.clearGroup(this.scarGroup);
    this.clearGroup(this.budGroup);
  }
}
