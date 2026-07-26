import * as THREE from 'three';
import { computeWorldFrames, type NodeWorld } from '../sim/tree';
import type { Internode, NodeId, TreeState } from '../sim/types';
import {
  createBarkMaterial,
  createFoliageMaterial,
  createFoliageTipMaterial,
  createHighlightMaterial,
  createWireMaterial,
} from './materials';

const UP = new THREE.Vector3(0, 1, 0);

/** Minimum display radius so young wood still reads as bark (meters). */
const MIN_VISUAL_RADIUS = 0.0018;

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

  /** Scale-pad: flattened ellipsoid for juniper foliage clumps. */
  private padGeo: THREE.BufferGeometry;
  /** Tiny needle spike for pad surface detail. */
  private needleGeo: THREE.BufferGeometry;
  private radialSegments = 8;

  readonly pickables: THREE.Object3D[] = [];

  constructor() {
    this.group.name = 'tree';
    this.group.add(this.branchGroup, this.foliageGroup, this.wireGroup);

    // Soft clump (slightly elongated) — reads as juniper pad mass, not flat discs
    this.padGeo = new THREE.SphereGeometry(1, 7, 5);
    this.padGeo.scale(0.85, 1.05, 0.7);

    // Tiny scale spike
    this.needleGeo = new THREE.ConeGeometry(0.28, 1.1, 3, 1, false);
    this.needleGeo.translate(0, 0.55, 0);
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
    this.group.position.set(0, 0.052, 0);

    for (const node of Object.values(tree.nodes)) {
      if (!node.living) continue;
      const frame = frames.get(node.id);
      if (!frame || node.length < 1e-6) continue;

      this.addBranchSegment(node.id, node, frame, tree);
      this.addFoliage(node.id, node, frame, tree);
      if (node.wire) {
        this.addWireVisual(frame, Math.max(node.radius, MIN_VISUAL_RADIUS));
      }
    }

    if (this.selectedId && frames.has(this.selectedId)) {
      const node = tree.nodes[this.selectedId];
      const frame = frames.get(this.selectedId)!;
      if (node) {
        const r = Math.max(node.radius, MIN_VISUAL_RADIUS) * 1.4;
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
    const r0 = this.visualRadius(node.radius);
    let r1 = r0 * 0.82;
    if (node.children.length) {
      let sum = 0;
      for (const c of node.children) {
        sum += this.visualRadius(tree.nodes[c]?.radius ?? node.radius * 0.7);
      }
      r1 = sum / node.children.length;
    } else {
      // Soft tip taper
      r1 = r0 * 0.55;
    }

    const mesh = this.makeTaperedSegment(r0, r1, frame, this.barkMat);
    mesh.userData.nodeId = id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.branchGroup.add(mesh);
    this.pickables.push(mesh);
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
   * Juniper-style pads: foliage mostly on tips / thin outer wood,
   * sparse on thick structural trunk so bark stays readable.
   */
  private addFoliage(
    id: NodeId,
    node: Internode,
    frame: NodeWorld,
    tree: TreeState,
  ): void {
    const living = node.foliage.filter((f) => f.living);
    if (!living.length) return;

    const isTip = node.children.length === 0;
    const depthFromTip = (() => {
      // Prefer foliage on outer shoots: fewer children / thinner wood
      if (isTip) return 0;
      if (node.radius >= 0.0055) return 3;
      if (node.children.length >= 2) return 2;
      return 1;
    })();
    // Density: tips full, laterals medium, structural trunk almost bare
    let density = 1;
    if (depthFromTip >= 3) density = 0.08;
    else if (depthFromTip === 2) density = 0.35;
    else if (depthFromTip === 1) density = 0.7;
    else density = 1.2;

    const base = new THREE.Vector3(...frame.base);
    const dir = new THREE.Vector3(...frame.dir).normalize();
    const len = node.length;
    const r = this.visualRadius(node.radius);

    // Branch-local frame
    const sideRef = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(dir, sideRef).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, dir).normalize();

    for (let fi = 0; fi < living.length; fi++) {
      if (density < 1 && ((fi * 17 + id.length) % 100) / 100 > density) continue;
      const f = living[fi];
      const along = base.clone().addScaledVector(dir, f.t * len);

      // Pad sits beside the branch, slightly outward
      const radial = normal
        .clone()
        .multiplyScalar(Math.cos(f.azimuth))
        .add(binormal.clone().multiplyScalar(Math.sin(f.azimuth)))
        .normalize();

      // Compact clumps (cm-scale) so bark and structure stay readable
      const padRadius = 0.0038 + Math.min(0.0045, Math.sqrt(f.area) * 0.28);
      const padPos = along
        .clone()
        .addScaledVector(radial, r + padRadius * 0.35);

      const mat = isTip || f.ageDays < 40 ? this.foliageTipMat : this.foliageMat;

      // 2–3 overlapping clumps per foliage site → softer juniper mass
      const clumps = isTip ? 3 : 2;
      for (let c = 0; c < clumps; c++) {
        const jitter = (c - (clumps - 1) * 0.5) * padRadius * 0.55;
        const pad = new THREE.Mesh(this.padGeo, mat);
        pad.position
          .copy(padPos)
          .addScaledVector(dir, jitter * 0.4)
          .addScaledVector(binormal, jitter * 0.35)
          .addScaledVector(radial, Math.abs(jitter) * 0.2);
        const s = padRadius * (0.75 + 0.2 * f.efficiency - c * 0.08);
        pad.scale.set(s * 0.95, s * 1.1, s * 0.85);
        const outward = radial
          .clone()
          .addScaledVector(dir, 0.15 + c * 0.05)
          .normalize();
        pad.quaternion.setFromUnitVectors(UP, outward);
        pad.rotateY(f.azimuth + c * 0.7);
        pad.castShadow = true;
        pad.userData.nodeId = id;
        this.foliageGroup.add(pad);
      }

      // Very sparse scale spikes
      if (isTip || density > 0.6) {
        for (let n = 0; n < 2; n++) {
          const ang = f.azimuth + n * 1.7;
          const needle = new THREE.Mesh(this.needleGeo, mat);
          const nDir = radial
            .clone()
            .multiplyScalar(0.5)
            .add(dir.clone().multiplyScalar(0.35))
            .add(binormal.clone().multiplyScalar(Math.sin(ang) * 0.3))
            .normalize();
          needle.position.copy(padPos).addScaledVector(nDir, padRadius * 0.35);
          const nLen = padRadius * 0.4;
          needle.scale.set(padRadius * 0.06, nLen, padRadius * 0.06);
          needle.quaternion.setFromUnitVectors(UP, nDir);
          needle.userData.nodeId = id;
          this.foliageGroup.add(needle);
        }
      }
    }

    // Extra tip spray so leaders read as living growing points
    if (isTip && living.length > 0) {
      const tip = new THREE.Vector3(...frame.tip);
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + node.ageDays * 0.01;
        const radial = normal
          .clone()
          .multiplyScalar(Math.cos(ang))
          .add(binormal.clone().multiplyScalar(Math.sin(ang)))
          .normalize();
        const spray = new THREE.Mesh(this.padGeo, this.foliageTipMat);
        spray.position
          .copy(tip)
          .addScaledVector(dir, 0.0015)
          .addScaledVector(radial, r + 0.0025);
        spray.scale.set(0.0032, 0.0022, 0.0038);
        spray.quaternion.setFromUnitVectors(
          UP,
          radial.clone().addScaledVector(dir, 0.55).normalize(),
        );
        spray.castShadow = true;
        spray.userData.nodeId = id;
        this.foliageGroup.add(spray);
      }
    }

    void tree;
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
    const segs = 28;
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
    const geo = new THREE.TubeGeometry(curve, segs, 0.0007, 5, false);
    const mesh = new THREE.Mesh(geo, this.wireMat);
    mesh.castShadow = true;
    this.wireGroup.add(mesh);
  }

  private clearGroup(g: THREE.Group): void {
    const shared = new Set<THREE.Material>([
      this.barkMat,
      this.foliageMat,
      this.foliageTipMat,
      this.wireMat,
      this.highlightMat,
    ]);
    while (g.children.length) {
      const c = g.children.pop()!;
      if (c instanceof THREE.Mesh) {
        // Shared geos — only dispose unique geometries
        if (
          c.geometry !== this.padGeo &&
          c.geometry !== this.needleGeo
        ) {
          c.geometry.dispose();
        }
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          if (!shared.has(m)) m.dispose();
        }
      }
    }
  }

  dispose(): void {
    this.clearGroup(this.branchGroup);
    this.clearGroup(this.foliageGroup);
    this.clearGroup(this.wireGroup);
    this.padGeo.dispose();
    this.needleGeo.dispose();
    this.barkMat.dispose();
    this.foliageMat.dispose();
    this.foliageTipMat.dispose();
    this.wireMat.dispose();
    this.highlightMat.dispose();
  }
}
