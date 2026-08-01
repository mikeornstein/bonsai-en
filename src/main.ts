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
  /**
   * Perspective close-up on a soil-local point (same space as listNodes tips).
   * Freezes physics. Prefer for detail plates 10–15.
   */
  setCloseUp(opts: {
    x: number;
    y: number;
    z: number;
    distance?: number;
    azimuth?: number;
    elevation?: number;
    fov?: number;
  }): void;
  setUiVisible(visible: boolean): void;
  setPhysicsFrozen(frozen: boolean): void;
  /** Product-GPU DOF A/B. No-op when soft GL skipped the post stack. */
  setDofEnabled(on: boolean): void;
  getDofEnabled(): boolean;
  newSapling(): void;
  /**
   * Fit whole tree in view and release user-owned framing until the next orbit/zoom.
   * Growth ticks alone never reframe after the player moves the camera (#60).
   */
  frameTree(): void;
  /** True after player orbit/zoom this session (auto-fit gated). */
  isCameraUserOwned(): boolean;
  /** Practice (sumi + grade) on/off. Default on; persists as bonsai-en:mode. */
  setSumiChallenge(on: boolean): void;
  /**
   * Practice front lock (#66): disable orbit rotate + snap to viewing face.
   * No-op / forced off while Free train.
   */
  setFrontLock(on: boolean): void;
  isFrontLock(): boolean;
  /** Soft-snap play camera to front face (perspective; not ortho audit). */
  snapToFrontFace(): void;
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
  /** Undo last structural edit (prune / pinch / wire / unwire / bend). */
  undo(): boolean;
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

  // Product DOF A/B: `?dof=0` disables BokehPass (grade/SMAA still run on real GPUs).
  // Soft GL / SwiftShader never builds the post stack — this is a no-op there.
  const dofParam = new URLSearchParams(window.location.search).get('dof');
  if (dofParam === '0' || dofParam === 'false' || dofParam === 'off') {
    // Post is deferred one rAF on real GPUs — re-apply after it exists
    const applyDofOff = () => game.scene.setDofEnabled(false);
    applyDofOff();
    requestAnimationFrame(() => requestAnimationFrame(applyDofOff));
  }

  window.__bonsai = {
    setView(view: CameraViewName) {
      // Ortho audits freeze dynamics for stable geometry screenshots
      game.setPhysicsFrozen(view !== 'default');
      game.scene.setView(view);
    },
    getView() {
      return game.scene.getView();
    },
    setCloseUp(opts) {
      game.setPhysicsFrozen(true);
      game.scene.setCloseUp(opts);
    },
    setUiVisible(visible: boolean) {
      document.body.classList.toggle('screenshot-hide-ui', !visible);
    },
    setPhysicsFrozen(frozen: boolean) {
      game.setPhysicsFrozen(frozen);
    },
    setDofEnabled(on: boolean) {
      game.scene.setDofEnabled(on);
    },
    getDofEnabled() {
      return game.scene.getDofEnabled();
    },
    newSapling() {
      game.newSapling();
    },
    frameTree() {
      game.frameCamera();
    },
    isCameraUserOwned() {
      return game.scene.isCameraUserOwned();
    },
    setSumiChallenge(on: boolean) {
      // Shared path with menu: updates ghost, status, button, localStorage
      game.setPracticeMode(on);
    },
    setFrontLock(on: boolean) {
      game.setFrontLock(on);
    },
    isFrontLock() {
      return game.isFrontLock();
    },
    snapToFrontFace() {
      game.scene.snapToFrontFace();
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
    undo() {
      return game.undoLast();
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
