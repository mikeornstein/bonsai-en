/**
 * Sumi silhouette shape practice — soft ink outline + faint fill.
 * Practice is the default play mode (see Game / localStorage `bonsai-en:mode`).
 * Toggle via UI (Free train ↔ Practice) or window.__bonsai.setSumiChallenge(on).
 *
 * Geometry comes from src/sim/practice/target.ts so scoring and ghost share one shape.
 *
 * Ink hierarchy (docs/refs/sumi/, issue #53): stem > outline > fill.
 * Ghost stays quiet so living wood and product lighting remain primary.
 */
import * as THREE from 'three';
import { PEDESTAL_HEIGHT, POT_SOIL_LOCAL_Y } from './pot';
import { PRACTICE_STEM, practiceTargetPolygon } from '../sim/practice/target';
import type { PracticeScore } from '../sim/practice/score';

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

  constructor() {
    this.group.name = 'sumiChallenge';
    this.group.visible = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
    if (on && !this.line) this.buildGhost();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Soft visual feedback from quantitative score (opacity nudge by grade).
   * Does not alter the target geometry. Keeps ink secondary to the tree.
   */
  applyScoreFeedback(score: PracticeScore): void {
    if (!this.enabled || !this.line || !this.fill) return;
    if (this.lastGrade === score.grade) return;
    this.lastGrade = score.grade;
    const lineMat = this.line.material as THREE.LineBasicMaterial;
    const fillMat = this.fill.material as THREE.MeshBasicMaterial;
    const stemMat = this.stemLine
      ? (this.stemLine.material as THREE.LineBasicMaterial)
      : null;
    // Slightly stronger ink as the player approaches the shape — still quiet
    switch (score.grade) {
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

  /** Quiet acknowledgment when canopy roughly matches. */
  acknowledge(score?: PracticeScore): string {
    if (score && score.grade === 'match') return score.label;
    if (score) return score.label;
    return 'Close enough · rest';
  }

  private buildGhost(): void {
    const soil = PEDESTAL_HEIGHT + POT_SOIL_LOCAL_Y;
    const poly = practiceTargetPolygon();
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

    // Stem alone slightly stronger — moyogi story is the trunk line
    const stemPts = PRACTICE_STEM.map(
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
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.line = null;
    this.fill = null;
    this.stemLine = null;
  }
}
