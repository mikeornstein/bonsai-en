/**
 * Sumi silhouette shape practice — soft ink outline + faint fill.
 * Practice is the default play mode (see Game / localStorage `bonsai-en:mode`).
 * Toggle via UI (Free train ↔ Practice) or window.__bonsai.setSumiChallenge(on).
 *
 * Geometry comes from the active practice pack (src/sim/practice/target.ts)
 * so scoring and ghost share one shape. Packs: moyogi (default), cascade, literati (#72).
 *
 * Ink hierarchy (docs/refs/sumi/, issue #53): stem > outline > fill.
 * Ghost stays quiet so living wood and product lighting remain primary.
 */
import * as THREE from 'three';
import { PEDESTAL_HEIGHT, POT_SOIL_LOCAL_Y } from './pot';
import {
  getActivePracticePack,
  type PracticePack,
} from '../sim/practice/target';
import type { PracticeScore } from '../sim/practice/score';
import type { PracticeMilestoneKind } from '../sim/practice/milestones';
import { PRACTICE_MILESTONE_COPY } from '../sim/practice/milestones';

/** Warm sumi ink — slightly cooler than pure black so it sits in the cyclorama. */
const INK = new THREE.Color('#242220');
const INK_STEM = new THREE.Color('#1a1816');

/** Base opacities (far / default). Grade feedback only nudges upward. */
const FILL_BASE = 0.04;
const LINE_BASE = 0.18;
const STEM_BASE = 0.3;

export class SumiChallenge {
  readonly group = new THREE.Group();
  private enabled = false;
  private line: THREE.Line | null = null;
  private fill: THREE.Mesh | null = null;
  private stemLine: THREE.Line | null = null;
  private lastGrade: PracticeScore['grade'] | null = null;
  /** Timestamp (ms) until which milestone pulse opacities hold. */
  private pulseUntil = 0;
  private pulseKind: PracticeMilestoneKind | null = null;
  private builtPackId: string | null = null;

  constructor() {
    this.group.name = 'sumiChallenge';
    this.group.visible = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
    if (on) this.ensureGhost();
    if (!on) {
      this.pulseUntil = 0;
      this.pulseKind = null;
      this.lastGrade = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Rebuild ink geometry from a practice pack (or active pack).
   * Call when the player cycles shape packs.
   */
  setPack(pack: PracticePack = getActivePracticePack()): void {
    if (this.builtPackId === pack.id && this.line) return;
    this.disposeGeometry();
    this.buildGhost(pack);
    this.lastGrade = null;
  }

  /**
   * Soft visual feedback from quantitative score (opacity nudge by grade).
   * Does not alter the target geometry. Keeps ink secondary to the tree.
   * Milestone pulse briefly elevates ink, then settles to grade levels.
   */
  applyScoreFeedback(score: PracticeScore): void {
    if (!this.enabled || !this.line || !this.fill) return;
    const now = performance.now();
    if (now < this.pulseUntil && this.pulseKind) {
      this.applyPulseOpacities(this.pulseKind);
      return;
    }
    if (this.pulseKind && now >= this.pulseUntil) {
      this.pulseKind = null;
      // Force grade re-apply after pulse ends
      this.lastGrade = null;
    }
    if (this.lastGrade === score.grade) return;
    this.lastGrade = score.grade;
    this.applyGradeOpacities(score.grade);
  }

  /**
   * One soft ink breath when first reaching close / match.
   * Quiet — slightly brighter ink for ~1.6s, then back to grade opacity.
   */
  pulseMilestone(kind: PracticeMilestoneKind): void {
    if (!this.enabled || !this.line || !this.fill) return;
    this.pulseKind = kind;
    this.pulseUntil = performance.now() + 1600;
    this.applyPulseOpacities(kind);
  }

  /**
   * Quiet status copy for a grade milestone (zen room tone).
   * Prefer `PRACTICE_MILESTONE_COPY` from the pure helper when wiring HUD.
   */
  acknowledge(score?: PracticeScore): string {
    if (score?.grade === 'match') return PRACTICE_MILESTONE_COPY.match;
    if (score?.grade === 'close') return PRACTICE_MILESTONE_COPY.close;
    if (score) return score.label;
    return 'Close enough · rest';
  }

  private applyGradeOpacities(grade: PracticeScore['grade']): void {
    if (!this.line || !this.fill) return;
    const lineMat = this.line.material as THREE.LineBasicMaterial;
    const fillMat = this.fill.material as THREE.MeshBasicMaterial;
    const stemMat = this.stemLine
      ? (this.stemLine.material as THREE.LineBasicMaterial)
      : null;
    // Slightly stronger ink as the player approaches the shape — still quiet
    switch (grade) {
      case 'match':
        lineMat.opacity = 0.32;
        fillMat.opacity = 0.085;
        if (stemMat) stemMat.opacity = 0.4;
        break;
      case 'close':
        lineMat.opacity = 0.26;
        fillMat.opacity = 0.065;
        if (stemMat) stemMat.opacity = 0.36;
        break;
      case 'forming':
        lineMat.opacity = 0.22;
        fillMat.opacity = 0.05;
        if (stemMat) stemMat.opacity = 0.32;
        break;
      default:
        lineMat.opacity = LINE_BASE;
        fillMat.opacity = FILL_BASE;
        if (stemMat) stemMat.opacity = STEM_BASE;
    }
  }

  private applyPulseOpacities(kind: PracticeMilestoneKind): void {
    if (!this.line || !this.fill) return;
    const lineMat = this.line.material as THREE.LineBasicMaterial;
    const fillMat = this.fill.material as THREE.MeshBasicMaterial;
    const stemMat = this.stemLine
      ? (this.stemLine.material as THREE.LineBasicMaterial)
      : null;
    // Soft breath only — still secondary to living wood
    if (kind === 'match') {
      lineMat.opacity = 0.4;
      fillMat.opacity = 0.11;
      if (stemMat) stemMat.opacity = 0.48;
    } else {
      lineMat.opacity = 0.34;
      fillMat.opacity = 0.09;
      if (stemMat) stemMat.opacity = 0.42;
    }
  }

  private ensureGhost(): void {
    const pack = getActivePracticePack();
    if (!this.line || this.builtPackId !== pack.id) {
      this.disposeGeometry();
      this.buildGhost(pack);
    }
  }

  private disposeGeometry(): void {
    for (const obj of [this.fill, this.line, this.stemLine]) {
      if (!obj) continue;
      this.group.remove(obj);
      obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
    this.line = null;
    this.fill = null;
    this.stemLine = null;
    this.builtPackId = null;
  }

  private buildGhost(pack: PracticePack = getActivePracticePack()): void {
    const soil = PEDESTAL_HEIGHT + POT_SOIL_LOCAL_Y;
    const poly = pack.polygon();
    const shape = new THREE.Shape();
    poly.forEach(([x, y], i) => {
      const px = x;
      const py = soil + y;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
    shape.closePath();

    const fillGeo = new THREE.ShapeGeometry(shape);
    const fillMat = new THREE.MeshBasicMaterial({
      color: INK.clone(),
      transparent: true,
      opacity: FILL_BASE,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(fillGeo, fillMat);
    this.fill.position.z = -0.001;
    this.fill.renderOrder = 1;
    this.group.add(this.fill);

    // Closed pad outline — soft edge, secondary to stem
    const pts: THREE.Vector3[] = poly.map(
      ([x, y]) => new THREE.Vector3(x, soil + y, 0),
    );
    if (pts.length) {
      pts.push(pts[0].clone());
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({
      color: INK.clone(),
      transparent: true,
      opacity: LINE_BASE,
      depthWrite: false,
    });
    this.line = new THREE.Line(lineGeo, lineMat);
    this.line.renderOrder = 2;
    this.group.add(this.line);

    // Stem alone slightly stronger — silhouette story is the trunk line
    const stemPts = pack.stem.map(
      ([x, y]) => new THREE.Vector3(x, soil + y, 0.0005),
    );
    const stemGeo = new THREE.BufferGeometry().setFromPoints(stemPts);
    const stemMat = new THREE.LineBasicMaterial({
      color: INK_STEM.clone(),
      transparent: true,
      opacity: STEM_BASE,
      depthWrite: false,
    });
    this.stemLine = new THREE.Line(stemGeo, stemMat);
    this.stemLine.renderOrder = 3;
    this.group.add(this.stemLine);
    this.builtPackId = pack.id;
  }

  dispose(): void {
    this.disposeGeometry();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
