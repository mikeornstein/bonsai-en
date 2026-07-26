import { Game } from './app/game';
import type { CameraViewName } from './render/scene';

const canvas = document.getElementById('c') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas #c not found');
}

function showBootError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[bonsai-en] boot failed', err);
  const status = document.getElementById('status');
  if (status) status.textContent = `Boot failed: ${msg}`;
  const age = document.getElementById('info-age');
  if (age) age.textContent = '—';
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent =
      'Reload the page. If this persists, open the browser console for details.';
  }
}

/** Screenshot / geometry-audit harness used by scripts/screenshot.mjs */
export interface BonsaiHarness {
  setView(view: CameraViewName): void;
  getView(): CameraViewName;
  setUiVisible(visible: boolean): void;
  setPhysicsFrozen(frozen: boolean): void;
  newSapling(): void;
  getPhysicsTelemetry(): {
    maxOmega: number;
    rmsOmega: number;
    maxTheta: number;
    kineticEnergy: number;
    freeJoints: number;
    sleeping: number;
    contacts: number;
    simTime: number;
  };
}

declare global {
  interface Window {
    __bonsai?: BonsaiHarness;
  }
}

try {
  const game = new Game(canvas);

  window.__bonsai = {
    setView(view: CameraViewName) {
      // Ortho audits freeze dynamics for stable geometry screenshots
      game.setPhysicsFrozen(view !== 'default');
      game.scene.setView(view);
    },
    getView() {
      return game.scene.getView();
    },
    setUiVisible(visible: boolean) {
      document.body.classList.toggle('screenshot-hide-ui', !visible);
    },
    setPhysicsFrozen(frozen: boolean) {
      game.setPhysicsFrozen(frozen);
    },
    newSapling() {
      game.newSapling();
    },
    getPhysicsTelemetry() {
      return game.getPhysicsTelemetry();
    },
  };

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      game.update(dt);
    } catch (err) {
      console.error('[bonsai-en] frame error', err);
      // Keep loop alive so UI stays interactive after a render glitch
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (err) {
  showBootError(err);
}
