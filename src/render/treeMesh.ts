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

const UP = new THREE.Vector3(0, 1, 0);
const MIN_VISUAL_RADIUS = 0.0018;

interface ScaleInstance {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  tip: boolean;
}

/**
 * Builds a single thin scale (rhombus leaf) in the XY plane, tip +Y.
 * Explicit UVs map the full texture (alpha diamond) onto the quad.
 */
function createScaleGeometry(): THREE.BufferGeometry {
  // Unit quad, tip toward +Y — simpler UVs than ShapeGeometry
  const geo = new THREE.PlaneGeometry(1, 1.25, 1, 1);
  geo.translate(0, 0.15, 0);
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
  private radialSegments = 10;
  private readonly _dummy = new THREE.Object3D();

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
    this.group.position.set(0, 0.052, 0);

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
    const r0 = this.visualRadius(node.radius);
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
    if (youth > 0.2) {
      mat.color.offsetHSL(0.05, 0.08 * youth, 0.04 * youth);
      mat.roughness = Math.max(0.55, 1 - youth * 0.25);
    }

    const mesh = this.makeTaperedSegment(r0, r1, frame, mat);
    mesh.userData.nodeId = id;
    mesh.userData.disposeMat = true;
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
    // Cylinder default UV: U around, V along height — good for bark grain
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
   * Place juniper-like scale clusters on outer wood only.
   */
  private collectScales(
    node: Internode,
    frame: NodeWorld,
    _tree: TreeState,
    out: ScaleInstance[],
  ): void {
    const isTip = node.children.length === 0;
    // Bare structural trunk — keep lower thick wood clean
    if (node.radius >= 0.0065 && !isTip && node.children.length > 1) return;

    const living = node.foliage.filter((f) => f.living);
    // Synthetic pad if sim has no foliage clusters on thin shoots
    const sites =
      living.length > 0
        ? living.map((f) => ({
            t: f.t,
            azimuth: f.azimuth,
            area: f.area,
            ageDays: f.ageDays,
            efficiency: f.efficiency,
          }))
        : isTip || node.radius < 0.0045
          ? [
              { t: 0.7, azimuth: 0.3, area: 0.0004, ageDays: 10, efficiency: 1 },
              { t: 0.95, azimuth: 2.1, area: 0.00035, ageDays: 5, efficiency: 1 },
            ]
          : [];

    if (!sites.length) return;

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

    for (const f of sites) {
      const along = base.clone().addScaledVector(dir, f.t * len);
      const radial = normal
        .clone()
        .multiplyScalar(Math.cos(f.azimuth))
        .add(binormal.clone().multiplyScalar(Math.sin(f.azimuth)))
        .normalize();

      // Dense small scales → juniper pad mass (not large holly leaves)
      const count = isTip ? 18 : 12;
      const padR = 0.003 + Math.min(0.0035, Math.sqrt(f.area) * 0.25);
      const tipGrowth = isTip || f.ageDays < 50;

      for (let s = 0; s < count; s++) {
        const ang = f.azimuth + (s / count) * Math.PI * 2 + f.t * 1.7;
        const layer = Math.floor(s / 6);
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const spin = new THREE.Vector3(
          radial.x * cos + binormal.x * sin,
          radial.y * cos + binormal.y * sin,
          radial.z * cos + binormal.z * sin,
        ).normalize();

        const pos = along
          .clone()
          .addScaledVector(spin, r + padR * (0.15 + layer * 0.12))
          .addScaledVector(dir, (s % 5) * padR * 0.12 - padR * 0.15);

        const face = spin
          .clone()
          .multiplyScalar(0.8)
          .addScaledVector(dir, 0.25)
          .normalize();

        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          face,
        );
        quat.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            ang * 0.35 + layer * 0.5,
          ),
        );

        const sc =
          padR * (0.95 + (s % 3) * 0.1) * (0.85 + 0.2 * f.efficiency);
        out.push({
          position: pos,
          quaternion: quat,
          scale: new THREE.Vector3(sc, sc * 1.25, sc),
          tip: tipGrowth,
        });
      }
    }

    // Apex spray
    if (isTip) {
      const tip = new THREE.Vector3(...frame.tip);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const spin2 = new THREE.Vector3(
          normal.x * Math.cos(ang) + binormal.x * Math.sin(ang),
          normal.y * Math.cos(ang) + binormal.y * Math.sin(ang),
          normal.z * Math.cos(ang) + binormal.z * Math.sin(ang),
        ).normalize();
        const face = spin2
          .clone()
          .multiplyScalar(0.5)
          .addScaledVector(dir, 0.7)
          .normalize();
        out.push({
          position: tip
            .clone()
            .addScaledVector(dir, 0.0012)
            .addScaledVector(spin2, r * 0.7 + 0.0008),
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            face,
          ),
          scale: new THREE.Vector3(0.0026, 0.0034, 0.0026),
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
    mesh.receiveShadow = false;
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
    const segs = 32;
    const amp = radius + 0.0015;
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
    const geo = new THREE.TubeGeometry(curve, segs, 0.00065, 5, false);
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
        if (c.geometry !== this.scaleGeo) {
          c.geometry.dispose();
        }
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          if (!sharedMats.has(m) && c.userData.disposeMat) {
            // Dispose cloned maps on bark segment materials
            const std = m as THREE.MeshStandardMaterial;
            std.map?.dispose();
            // don't dispose shared source textures that were cloned — clone() of texture is separate
            std.normalMap?.dispose();
            std.roughnessMap?.dispose();
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
    this.barkMat.dispose();
    this.foliageMat.dispose();
    this.foliageTipMat.dispose();
    this.wireMat.dispose();
    this.highlightMat.dispose();
  }
}
