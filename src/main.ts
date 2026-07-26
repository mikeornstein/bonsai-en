import { Game, type GameSnapshot, type NodeSummary, type PerfSample, type ToolMode } from './app/game';
import type { SpeedMode } from './sim/time';
import type { CameraViewName } from './render/scene';
import type { Vec3 } from './sim/types';
import type { PracticeScore } from './sim/practice/score';

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

/** Screenshot / playtest harness used by scripts/*.mjs */
export interface BonsaiHarness {
  setView(view: CameraViewName): void;
  getView(): CameraViewName;
  setUiVisible(visible: boolean): void;
  setPhysicsFrozen(frozen: boolean): void;
  newSapling(): void;
  setSumiChallenge(on: boolean): void;
  setMuted(on: boolean): void;
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
  getSnapshot(): GameSnapshot;
  listNodes(): NodeSummary[];
  setTool(tool: ToolMode): void;
  setSpeed(speed: SpeedMode): void;
  act(
    tool: ToolMode,
    nodeId: string,
  ): { ok: boolean; message: string };
  bend(nodeId: string, dir: Vec3): { ok: boolean; message: string };
  getPerf(): PerfSample;
  saveNow(): void;
  exportJson(): string;
  getShareHash(): string | null;
  getPracticeScore(): PracticeScore;
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
    setSumiChallenge(on: boolean) {
      game.scene.sumi.setEnabled(on);
      if (on) {
        const s = game.getPracticeScore();
        game.scene.sumi.applyScoreFeedback(s);
      }
    },
    getPracticeScore() {
      return game.getPracticeScore();
    },
    setMuted(on: boolean) {
      void import('./render/audio').then((a) => a.setMuted(on));
    },
    getPhysicsTelemetry() {
      return game.getPhysicsTelemetry();
    },
    getSnapshot() {
      return game.getSnapshot();
    },
    listNodes() {
      return game.listNodes();
    },
    setTool(tool: ToolMode) {
      game.setTool(tool);
    },
    setSpeed(speed: SpeedMode) {
      game.setSpeed(speed);
    },
    act(tool: ToolMode, nodeId: string) {
      return game.actOnNode(tool, nodeId);
    },
    bend(nodeId: string, dir: Vec3) {
      return game.bendNode(nodeId, dir);
    },
    getPerf() {
      return game.getPerf();
    },
    saveNow() {
      game.saveNow();
    },
    exportJson() {
      return game.exportJson();
    },
    getShareHash() {
      return game.getShareHash();
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
