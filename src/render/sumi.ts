/**
 * Sumi silhouette shape practice — soft ink outline + faint fill.
 * Practice is the default play mode (see Game / localStorage `bonsai-en:mode`).
 * Toggle via UI (Free train ↔ Practice) or window.__bonsai.setSumiChallenge(on).
 *
 * Geometry comes from src/sim/practice/target.ts so scoring and ghost share one shape.
 */
import * as THREE from 'three';
import { PEDESTAL_HEIGHT, POT_SOIL_LOCAL_Y } from './pot';
import { PRACTICE_STEM, practiceTargetPolygon } from '../sim/practice/target';
import type { PracticeScore } from '../sim/practice/score';

export class SumiChallenge {
  readonly group = new THREE.Group();
  private enabled = false;
  private line: THREE.Line | null = null;
  private fill: THREE.Mesh | null = null;
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
   * Does not alter the target geometry.
   */
  applyScoreFeedback(score: PracticeScore): void {
    if (!this.enabled || !this.line || !this.fill) return;
    if (this.lastGrade === score.grade) return;
    this.lastGrade = score.grade;
    const lineMat = this.line.material as THREE.LineBasicMaterial;
    const fillMat = this.fill.material as THREE.MeshBasicMaterial;
    // Slightly stronger ink as the player approaches the shape
    switch (score.grade) {
      case 'match':
        lineMat.opacity = 0.42;
        fillMat.opacity = 0.12;
        break;
      case 'close':
        lineMat.opacity = 0.34;
        fillMat.opacity = 0.09;
        break;
      case 'forming':
        lineMat.opacity = 0.28;
        fillMat.opacity = 0.07;
        break;
      default:
        lineMat.opacity = 0.24;
        fillMat.opacity = 0.055;
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
      color: new THREE.Color('#2a2824'),
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(fillGeo, fillMat);
    this.fill.position.z = -0.001;
    this.fill.renderOrder = 1;
    this.group.add(this.fill);

    // Stem + closed pad outline as a single line loop
    const pts: THREE.Vector3[] = poly.map(
      ([x, y]) => new THREE.Vector3(x, soil + y, 0),
    );
    // Close the loop for a readable ink edge
    if (pts.length) {
      pts.push(pts[0].clone());
    }
    // Also draw stem alone slightly stronger for trunk read
    const stemPts = PRACTICE_STEM.map(
      ([x, y]) => new THREE.Vector3(x, soil + y, 0.0005),
    );

    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#2a2824'),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.line = new THREE.Line(lineGeo, lineMat);
    this.line.renderOrder = 2;
    this.group.add(this.line);

    const stemGeo = new THREE.BufferGeometry().setFromPoints(stemPts);
    const stemMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#1f1d1a'),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const stemLine = new THREE.Line(stemGeo, stemMat);
    stemLine.renderOrder = 3;
    this.group.add(stemLine);
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
  }
}
