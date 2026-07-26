/**
 * Optional sumi silhouette shape practice — soft ink outline, not neon ghost.
 * Off by default; enable via window.__bonsai.setSumiChallenge(true).
 */
import * as THREE from 'three';
import { PEDESTAL_HEIGHT, POT_SOIL_LOCAL_Y } from './pot';

export class SumiChallenge {
  readonly group = new THREE.Group();
  private enabled = false;
  private mesh: THREE.Line | null = null;

  constructor() {
    this.group.name = 'sumiChallenge';
    this.group.visible = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
    if (on && !this.mesh) this.buildGhost();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Quiet acknowledgment when canopy roughly matches (called by game if desired). */
  acknowledge(): string {
    return 'Close enough · rest';
  }

  private buildGhost(): void {
    // Soft sumi ink outline of a classic informal upright silhouette
    const soil = PEDESTAL_HEIGHT + POT_SOIL_LOCAL_Y;
    const pts: THREE.Vector3[] = [];
    const outline: Array<[number, number]> = [
      [0, 0],
      [-0.01, 0.02],
      [0.015, 0.05],
      [-0.02, 0.09],
      [0.025, 0.13],
      [-0.015, 0.17],
      [0.01, 0.2],
      [0.0, 0.22],
    ];
    for (const [x, y] of outline) {
      pts.push(new THREE.Vector3(x, soil + y, 0));
    }
    // Mirror for closed pad suggestion (right side)
    for (let i = outline.length - 2; i >= 0; i--) {
      const [x, y] = outline[i];
      pts.push(new THREE.Vector3(-x * 0.6 + 0.03, soil + y * 0.95, 0));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#2a2824'),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.mesh = new THREE.Line(geo, mat);
    this.group.add(this.mesh);
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }
  }
}
