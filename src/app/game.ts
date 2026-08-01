import { describeNode, tickDays } from '../sim/growth';
import {
  SPEED_PLANT_DAYS_PER_SECOND,
  environmentAt,
  formatAge,
  seasonLabel,
  vitalityBarColor,
  vitalityLevel,
  vitalityWord,
  type SpeedMode,
} from '../sim/time';
import { createSapling, ensurePlayableTree } from '../sim/tree';
import { pinchAt, pruneAt } from '../sim/tools/prune';
import {
  applyWire,
  bendWiredNode,
  removeWire,
  wireSetLabel,
} from '../sim/tools/wire';
import { downloadTree, parseTree, serializeTree } from '../sim/serialize';
import { StructuralHistory } from '../sim/history';
import type { NodeId, TreeState, Vec3 } from '../sim/types';
import { BonsaiScene } from '../render/scene';
import {
  clearLocal,
  copyShareLink,
  loadLocal,
  saveLocal,
  treeFromShareHash,
  treeToShareHash,
} from '../share/encode';
import { getSpecies } from '../sim/species/juniper';
import {
  scorePracticeMatch,
  type PracticeScore,
} from '../sim/practice/score';
import {
  computeLiveWorldFrames,
  createPhysicsWorld,
  freezePhysics,
  measureTelemetry,
  resetJointElastic,
  stepPhysics,
  syncPhysicsWorld,
  wakeAllJoints,
  type PhysicsTelemetry,
  type PhysicsWorld,
} from '../sim/physics';

export type ToolMode = 'inspect' | 'prune' | 'pinch' | 'wire' | 'unwire';

/** Playtest / harness snapshot of live game state. */
export interface GameSnapshot {
  agePlantDays: number;
  ageLabel: string;
  season: string;
  vitalityWord: string;
  reserves: number;
  nodeCount: number;
  livingCount: number;
  wiredCount: number;
  tool: ToolMode;
  speed: SpeedMode;
  selected: string | null;
  status: string;
  physics: PhysicsTelemetry;
}

export interface NodeSummary {
  id: string;
  parentId: string | null;
  living: boolean;
  isLeaf: boolean;
  hasWire: boolean;
  length: number;
  radius: number;
  lignification: number;
  wireSetAmount: number | null;
  childCount: number;
  /** Soil-local tip position (for practice targeting / automation). */
  tipX: number;
  tipY: number;
  tipZ: number;
  /** Soil-local base (joint) position. */
  baseX: number;
  baseY: number;
  baseZ: number;
}

export interface PerfSample {
  lastFrameMs: number;
  avgFrameMs: number;
  nodeCount: number;
  freeJoints: number;
  /**
   * True when this frame skipped elastic dynamics (pure growth fast-forward
   * with a still camera). Useful for harness / debug only.
   */
  physicsCulled: boolean;
}

export class Game {
  tree: TreeState;
  scene: BonsaiScene;
  tool: ToolMode = 'inspect';
  speed: SpeedMode = 'live';
  selected: NodeId | null = null;
  physics: PhysicsWorld;

  private accum = 0;
  /** True while actively bending a wired branch (orbit disabled). */
  private wiring = false;
  /** Node under pointer on wire-tool down; bend starts after drag threshold. */
  private wireTarget: NodeId | null = null;
  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  private lastBendX = 0;
  private lastBendY = 0;
  private moved = false;
  /** Session/local flag: first deliberate bend completed (hint can fade). */
  private hasBentOnce = readHasBentOnce();
  private statusEl: HTMLElement;
  private hintEl: HTMLElement;
  private autosaveTimer = 0;
  /** Touch: slightly larger drag threshold so taps don't start bends. */
  private readonly dragThresholdPx = 8;
  /** Throttle expensive mesh rebuilds during time acceleration. */
  private visualCooldownTimer = 0;
  private pendingVisual = false;
  private physicsNeedsSync = true;
  /**
   * When true, next physics rebind also wakes all joints (prune / mass shock).
   * Pure growth rebinds keep sleep so Years FF does not thrash collisions.
   */
  private physicsNeedsWake = false;
  private lastSeason: string | null = null;
  private idleTimer = 0;
  private statusUnfadeTimer = 0;
  /** Last full frame cost (ms) for harness perf sampling. */
  private lastFrameMs = 0;
  private avgFrameMs = 0;
  /** Whether the last frame culled elastic dynamics (see PerfSample). */
  private lastPhysicsCulled = false;
  /** Throttle practice score HUD updates. */
  private practiceHudTimer = 0;
  private lastPracticeLabel = '';
  /** Throttle HUD refresh under year/month acceleration. */
  private hudCooldownTimer = 0;
  /**
   * Structural undo stack (prune / pinch / wire / unwire / bend).
   * Pure time passage is never snapshotted (issue #67).
   */
  private structuralHistory = new StructuralHistory();

  constructor(canvas: HTMLCanvasElement) {
    this.statusEl = document.getElementById('status')!;
    this.hintEl = document.getElementById('hint')!;
    // Scene first (WebGL + meshes). UI binds even if later tree work is slow.
    this.scene = new BonsaiScene(canvas);
    this.bindUi();
    this.bindPointer(canvas);

    const boot = ensurePlayableTree(this.bootstrapTree());
    this.tree = boot.tree;
    if (boot.recovered) {
      console.warn('[bonsai-en] invalid tree state, creating new sapling');
      clearLocal();
      this.setStatus('Started a new sapling (previous save was invalid)');
    }
    const species = getSpecies(this.tree.speciesId);
    this.physics = createPhysicsWorld(this.tree, { ...species.physics });
    this.bindIdleChrome();
    // Practice default + localStorage preference (after tree exists for scoring)
    this.applyBootPracticeMode();
    this.refreshHud();
    this.applySeasonVisuals();
    this.scene.markDirty();
    // Defer mesh build so HUD/buttons paint immediately
    requestAnimationFrame(() => {
      try {
        this.syncPhysics();
        this.scene.syncTree(this.tree, computeLiveWorldFrames(this.tree, this.physics));
        // Boot: always frame once; subsequent growth respects user orbit/zoom (#60)
        this.scene.frameTree(this.tree, { force: true });
      } catch (err) {
        console.error('[bonsai-en] initial tree sync failed', err);
        this.setStatus(`Tree render failed: ${(err as Error).message}`);
      }
    });
  }

  /**
   * Rebuild physics graph from structural tree (after tools / growth).
   * Wakes joints only when `physicsNeedsWake` is set (prune / load shocks) —
   * pure growth rebind preserves sleep so Years fast-forward stays cheap.
   */
  private syncPhysics(): void {
    syncPhysicsWorld(this.physics, this.tree);
    if (this.physicsNeedsWake) {
      wakeAllJoints(this.physics);
      this.physicsNeedsWake = false;
    }
    this.physicsNeedsSync = false;
  }

  /** Mark physics graph dirty; optional full wake for structural shocks. */
  private markPhysicsDirty(wake = false): void {
    this.physicsNeedsSync = true;
    if (wake) this.physicsNeedsWake = true;
  }

  /**
   * Cap plant-day substeps per frame under acceleration.
   * Keeps 1-day growth rules exact; plant-time may lag wall clock under stress
   * instead of hitching harder as node count grows (issue #34).
   */
  private growthMaxSteps(nodeCount: number): number {
    if (this.speed === 'year') {
      if (nodeCount > 220) return 24;
      if (nodeCount > 140) return 36;
      if (nodeCount > 80) return 48;
      return 64;
    }
    if (this.speed === 'month') {
      if (nodeCount > 200) return 20;
      if (nodeCount > 100) return 28;
      return 40;
    }
    if (this.speed === 'week') return 24;
    return 16;
  }

  /**
   * Mesh rebuild interval (seconds of wall time) by speed mode.
   * Years/months need stronger throttle — rebuild is O(nodes + foliage).
   */
  private visualIntervalSec(): number {
    if (this.speed === 'year') return 0.45;
    if (this.speed === 'month') return 0.3;
    if (this.speed === 'week') return 0.16;
    return 0.05;
  }

  /** Freeze dynamics for stable screenshots / ortho audits. */
  setPhysicsFrozen(frozen: boolean): void {
    freezePhysics(this.physics, frozen);
  }

  /** Quantitative motion snapshot (max/rms ω, KE, sleep count). */
  getPhysicsTelemetry(): PhysicsTelemetry {
    return measureTelemetry(this.physics);
  }

  /** Full play-state snapshot for automated playtests. */
  getSnapshot(): GameSnapshot {
    const nodes = Object.values(this.tree.nodes);
    const env = environmentAt(this.tree.agePlantDays);
    return {
      agePlantDays: this.tree.agePlantDays,
      ageLabel: formatAge(this.tree.agePlantDays),
      season: seasonLabel(env.season),
      vitalityWord: vitalityWord(this.tree.reserves, env.season),
      reserves: this.tree.reserves,
      nodeCount: nodes.length,
      livingCount: nodes.filter((n) => n.living).length,
      wiredCount: nodes.filter((n) => Boolean(n.wire)).length,
      tool: this.tool,
      speed: this.speed,
      selected: this.selected,
      status: this.statusEl.textContent ?? '',
      physics: measureTelemetry(this.physics),
    };
  }

  /** Lightweight node list for picking targets without raycasts. */
  listNodes(): NodeSummary[] {
    const frames = computeLiveWorldFrames(this.tree, this.physics);
    return Object.values(this.tree.nodes).map((n) => {
      const f = frames.get(n.id);
      const tip = f?.tip ?? [0, 0, 0];
      const base = f?.base ?? [0, 0, 0];
      return {
        id: n.id,
        parentId: n.parentId,
        living: n.living,
        isLeaf: n.children.length === 0,
        hasWire: Boolean(n.wire),
        length: n.length,
        radius: n.radius,
        lignification: n.lignification,
        wireSetAmount: n.wire ? n.wire.setAmount : null,
        childCount: n.children.length,
        tipX: tip[0],
        tipY: tip[1],
        tipZ: tip[2],
        baseX: base[0],
        baseY: base[1],
        baseZ: base[2],
      };
    });
  }

  getPerf(): PerfSample {
    const tel = measureTelemetry(this.physics);
    return {
      lastFrameMs: this.lastFrameMs,
      avgFrameMs: this.avgFrameMs,
      nodeCount: Object.keys(this.tree.nodes).length,
      freeJoints: tel.freeJoints,
      physicsCulled: this.lastPhysicsCulled,
    };
  }

  /** Quantitative match of living silhouette to sumi practice target. */
  getPracticeScore(): PracticeScore {
    return scorePracticeMatch(this.tree);
  }

  /**
   * Practice (sumi guide + live grade) vs Free train / sandbox.
   * Default is practice; preference persists in localStorage `bonsai-en:mode`.
   */
  setPracticeMode(on: boolean, opts?: { persist?: boolean }): void {
    const persist = opts?.persist !== false;
    this.scene.sumi.setEnabled(on);
    if (on) {
      const s = this.getPracticeScore();
      this.scene.sumi.applyScoreFeedback(s);
      this.setStatus(s.label);
      this.lastPracticeLabel = s.label;
    } else {
      this.setStatus('Free train');
      this.lastPracticeLabel = '';
    }
    this.syncPracticeButton(on);
    if (persist) writePlayMode(on ? 'practice' : 'sandbox');
  }

  /** Menu label: when practice is on, offer Free train; when off, offer Practice. */
  private syncPracticeButton(on: boolean): void {
    const btn = document.getElementById('btn-sumi');
    if (!btn) return;
    btn.textContent = on ? 'Free train' : 'Practice';
    btn.title = on
      ? 'Sandbox without the sumi silhouette guide'
      : 'Sumi silhouette guide + live grade';
  }

  /**
   * Apply stored mode at boot (default practice). Does not clobber bootstrap
   * status lines (shared tree / autosave / recovery).
   */
  private applyBootPracticeMode(): void {
    const on = readPlayMode() === 'practice';
    this.scene.sumi.setEnabled(on);
    this.syncPracticeButton(on);
    if (!on) return;
    const s = this.getPracticeScore();
    this.scene.sumi.applyScoreFeedback(s);
    this.lastPracticeLabel = s.label;
    const status = this.statusEl.textContent?.trim() ?? '';
    if (!status) this.setStatus(s.label);
    // First-run / practice-default hint (shokunin-aligned)
    this.hintEl.textContent =
      'Match the ink · prune outside · wire the trunk · grow into the pad';
    this.hintEl.style.opacity = '0.85';
  }

  /** Persist current tree via the same path as the Save menu item. */
  saveNow(): void {
    saveLocal(this.tree);
    this.setStatus('Saved to this browser');
  }

  /** Serialized tree JSON (export without triggering a download). */
  exportJson(): string {
    return serializeTree(this.tree);
  }

  /** Share hash fragment (`#s=...`) or null if encode fails. */
  getShareHash(): string | null {
    try {
      return treeToShareHash(this.tree);
    } catch {
      return null;
    }
  }

  /**
   * Apply a tool to a known node id (bypasses raycast).
   * Used by the playtest harness for deterministic branch actions.
   */
  actOnNode(
    tool: ToolMode,
    nodeId: NodeId,
  ): { ok: boolean; message: string } {
    const node = this.tree.nodes[nodeId];
    if (!node) {
      return { ok: false, message: 'No such branch' };
    }

    this.setTool(tool);
    this.selected = nodeId;
    this.scene.setSelected(nodeId);

    if (tool === 'inspect') {
      this.setStatus('This branch');
      this.refreshHud();
      return { ok: true, message: 'This branch' };
    }

    if (tool === 'prune') {
      this.pushStructural('Undid last cut');
      const r = pruneAt(this.tree, nodeId);
      this.setStatus(r.message);
      if (r.ok) {
        this.selected = null;
        this.scene.setSelected(null);
        this.markPhysicsDirty(true);
        this.scene.markDirty();
        this.scene.treeRenderer.pulseToolFeedback('prune');
      } else {
        this.structuralHistory.discardLast();
      }
      this.refreshHud();
      return r;
    }

    if (tool === 'pinch') {
      this.pushStructural('Undid last pinch');
      const r = pinchAt(this.tree, nodeId);
      this.setStatus(r.message);
      if (r.ok) {
        this.markPhysicsDirty(true);
        this.scene.markDirty();
        this.scene.treeRenderer.pulseToolFeedback('pinch');
      } else {
        this.structuralHistory.discardLast();
      }
      this.refreshHud();
      return r;
    }

    if (tool === 'wire') {
      this.pushStructural('Undid last wire');
      const r = applyWire(this.tree, nodeId);
      this.setStatus(r.message);
      if (r.ok) {
        this.markPhysicsDirty(false);
        this.scene.markDirty();
      } else {
        this.structuralHistory.discardLast();
      }
      this.refreshHud();
      return r;
    }

    // unwire
    this.pushStructural('Undid last unwire');
    const r = removeWire(this.tree, nodeId);
    this.setStatus(r.message);
    if (r.ok) {
      this.markPhysicsDirty(false);
      resetJointElastic(this.physics, nodeId);
      this.scene.markDirty();
    } else {
      this.structuralHistory.discardLast();
    }
    this.refreshHud();
    return r;
  }

  /** Bend a (wired) node toward a world-ish direction — harness path. */
  bendNode(nodeId: NodeId, dir: Vec3): { ok: boolean; message: string } {
    if (!this.tree.nodes[nodeId]) {
      return { ok: false, message: 'No such branch' };
    }
    this.pushStructural('Undid last shape');
    bendWiredNode(this.tree, nodeId, dir);
    resetJointElastic(this.physics, nodeId);
    this.markPhysicsDirty(false);
    this.scene.markDirty();
    this.refreshHud();
    return { ok: true, message: 'Bent' };
  }

  /**
   * Restore the last structural snapshot (prune / pinch / wire / unwire / bend).
   * Empty stack → quiet status only.
   */
  undoLast(): boolean {
    const snap = this.structuralHistory.pop();
    if (!snap) {
      this.setStatus('Nothing to undo');
      return false;
    }
    this.tree = snap.tree;
    const sel =
      snap.selected && this.tree.nodes[snap.selected] ? snap.selected : null;
    this.selected = sel;
    this.scene.setSelected(sel);
    this.markPhysicsDirty(true);
    this.syncPhysics();
    this.scene.markDirty();
    this.scene.syncTree(
      this.tree,
      computeLiveWorldFrames(this.tree, this.physics),
    );
    // Force practice HUD to recompute against restored canopy
    this.lastPracticeLabel = '';
    this.practiceHudTimer = 1.2;
    this.setStatus(snap.undoLabel);
    this.refreshHud();
    return true;
  }

  /** Whether at least one structural edit can be undone. */
  canUndo(): boolean {
    return this.structuralHistory.canUndo();
  }

  /** Snapshot tree + selection before a structural mutation. */
  private pushStructural(undoLabel: string): void {
    this.structuralHistory.push(this.tree, this.selected, undoLabel);
  }

  /** Reset to a fresh sapling (no confirm dialog — used by screenshot harness). */
  newSapling(): void {
    this.tree = createSapling();
    this.selected = null;
    this.structuralHistory.clear();
    clearLocal();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    this.scene.setSelected(null);
    this.markPhysicsDirty(true);
    this.syncPhysics();
    this.scene.markDirty();
    this.scene.syncTree(
      this.tree,
      computeLiveWorldFrames(this.tree, this.physics),
    );
    // New plant: clear owned framing and fit the sapling (#60)
    this.scene.releaseCameraOwnership();
    this.scene.frameTree(this.tree, { force: true });
    this.setStatus('New juniper sapling');
    this.refreshHud();
  }

  /**
   * Explicit full-tree framing — reclaims auto-fit until the player moves again.
   * Growth ticks alone never force this.
   */
  frameCamera(): void {
    this.scene.releaseCameraOwnership();
    this.scene.frameTree(this.tree, { force: true });
  }

  private bootstrapTree(): TreeState {
    const fromHash = treeFromShareHash(window.location.hash);
    if (fromHash) {
      this.setStatus('Loaded shared tree');
      return fromHash;
    }
    const local = loadLocal();
    if (local) {
      this.setStatus('Restored autosave');
      return local;
    }
    return createSapling();
  }

  private bindUi(): void {
    // Debug meta (Nodes count) only with ?debug=1
    const debug =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debug');
    document.getElementById('info-nodes-row')?.classList.toggle('hidden', !debug);

    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool as ToolMode;
        this.setTool(tool);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.speed!;
        const speed = (raw === '0' ? 'pause' : raw) as SpeedMode;
        this.setSpeed(speed);
      });
    });

    const filesMenu = document.getElementById('files-menu');
    const filesToggle = document.getElementById('btn-files');
    const closeFiles = () => {
      if (!filesMenu || !filesToggle) return;
      filesMenu.hidden = true;
      filesToggle.setAttribute('aria-expanded', 'false');
    };
    filesToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!filesMenu || !filesToggle) return;
      const open = filesMenu.hidden;
      filesMenu.hidden = !open;
      filesToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!(e.target instanceof Node)) return;
      if (filesMenu && !filesMenu.contains(e.target) && e.target !== filesToggle) {
        closeFiles();
      }
    });

    document.getElementById('btn-new')?.addEventListener('click', () => {
      closeFiles();
      if (confirm('Start a new juniper sapling? Unsaved changes may be lost.')) {
        this.newSapling();
      }
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => {
      closeFiles();
      this.undoLast();
    });

    document.getElementById('btn-frame')?.addEventListener('click', () => {
      closeFiles();
      this.frameCamera();
      this.setStatus('Framed whole tree · orbit anytime to lock framing');
    });

    document.getElementById('btn-save')?.addEventListener('click', () => {
      closeFiles();
      saveLocal(this.tree);
      this.setStatus('Saved to this browser');
    });

    document.getElementById('btn-export')?.addEventListener('click', () => {
      closeFiles();
      downloadTree(this.tree);
      this.setStatus('Exported');
    });

    const fileInput = document.getElementById('import-file') as HTMLInputElement;
    document.getElementById('btn-import')?.addEventListener('click', () => {
      closeFiles();
      fileInput?.click();
    });
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        this.tree = parseTree(text);
        this.selected = null;
        this.structuralHistory.clear();
        this.scene.setSelected(null);
        this.markPhysicsDirty(true);
        this.syncPhysics();
        this.scene.markDirty();
        saveLocal(this.tree);
        this.setStatus('Tree imported');
        this.refreshHud();
      } catch (e) {
        this.setStatus(`Import failed: ${(e as Error).message}`);
      }
      fileInput.value = '';
    });

    document.getElementById('btn-share')?.addEventListener('click', async () => {
      closeFiles();
      const ok = await copyShareLink(this.tree);
      if (ok) {
        this.setStatus('Share link copied');
      } else {
        // Link capacity exceeded — fall back to full JSON (same as Export)
        downloadTree(this.tree);
        this.setStatus(
          'Tree too large for a share link — file exported (use Export for full saves anytime)',
        );
      }
    });

    document.getElementById('btn-mute')?.addEventListener('click', async () => {
      closeFiles();
      const audio = await import('../render/audio');
      const muted = audio.toggleMute();
      const btn = document.getElementById('btn-mute');
      if (btn) btn.textContent = muted ? 'Sound off' : 'Sound on';
      this.setStatus(muted ? 'Quiet' : 'Room tone on');
    });

    document.getElementById('btn-sumi')?.addEventListener('click', () => {
      closeFiles();
      // Invert: practice on → Free train; sandbox → Practice
      this.setPracticeMode(!this.scene.sumi.isEnabled());
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      // Z / Cmd+Z / Ctrl+Z — structural undo (issue #67)
      if (key === 'z' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        this.undoLast();
        return;
      }
      if (key === 'i') this.setTool('inspect');
      if (key === 'p') this.setTool('prune');
      if (key === 'n') this.setTool('pinch');
      if (key === 'w') this.setTool('wire');
      if (key === 'u') this.setTool('unwire');
      if (key === 'f' && !e.metaKey && !e.ctrlKey) {
        this.frameCamera();
        this.setStatus('Framed whole tree · orbit anytime to lock framing');
      }
      if (key === ' ') {
        e.preventDefault();
        this.setSpeed(this.speed === 'pause' ? 'live' : 'pause');
      }
      if (key === 'escape') closeFiles();
    });
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    /**
     * Wire UX model:
     * - Pointer down on wood → candidate for wire/bend; orbit disabled for that gesture
     * - Drag past threshold on wood → install wire if needed, bend in viewing plane
     * - Empty canvas drag → orbit (controls never stolen)
     * - Tap on unwired wood → install wire; tap on wired → select + set %
     * - Unwire tool remains for removal
     *
     * Touch: 8px drag threshold so taps don't start bends; multi-touch orbit/zoom
     * via OrbitControls still works on empty canvas. Known limit: one-finger
     * bend on wood; use second finger / empty space to reframe.
     */
    // Capture phase so we can disable OrbitControls before it starts orbiting
    // when the pointer hits wood under the wire tool.
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.pointerDown = true;
        this.moved = false;
        this.wiring = false;
        this.wireTarget = null;
        this.downX = e.clientX;
        this.downY = e.clientY;
        this.lastBendX = e.clientX;
        this.lastBendY = e.clientY;

        if (this.tool === 'wire') {
          const id = this.scene.pickNode(e.clientX, e.clientY);
          if (id) {
            this.wireTarget = id;
            // Steal orbit only while interacting with wood
            this.scene.controls.enabled = false;
          }
        }
      },
      { capture: true },
    );

    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const dxFromDown = e.clientX - this.downX;
      const dyFromDown = e.clientY - this.downY;
      if (Math.hypot(dxFromDown, dyFromDown) > this.dragThresholdPx) {
        this.moved = true;
      }

      if (this.tool !== 'wire' || !this.wireTarget) return;

      // Begin bend only after a real drag on wood (orbit already off from down)
      if (!this.wiring && this.moved) {
        this.wiring = true;
        this.selected = this.wireTarget;
        this.scene.setSelected(this.wireTarget);
        // One snapshot for the whole shape gesture (wire install + bends)
        this.pushStructural('Undid last shape');
        const node = this.tree.nodes[this.wireTarget];
        if (node && !node.wire) {
          const r = applyWire(this.tree, this.wireTarget);
          this.setStatus(r.message);
          void import('../render/audio').then((a) => a.playToolSound('wire'));
        }
        // Reset sample origin so the threshold travel doesn't jump the bend
        this.lastBendX = e.clientX;
        this.lastBendY = e.clientY;
        this.markPhysicsDirty(false);
        this.scene.markDirty();
      }

      if (!this.wiring || !this.wireTarget) return;

      const dx = e.clientX - this.lastBendX;
      const dy = e.clientY - this.lastBendY;
      this.lastBendX = e.clientX;
      this.lastBendY = e.clientY;
      if (dx === 0 && dy === 0) return;

      const dir = this.scene.bendDirectionFromDrag(
        this.tree,
        this.wireTarget,
        dx,
        dy,
      );
      if (dir) {
        bendWiredNode(this.tree, this.wireTarget, dir);
        resetJointElastic(this.physics, this.wireTarget);
        this.markPhysicsDirty(false);
        this.scene.markDirty();
        if (!this.hasBentOnce) {
          this.hasBentOnce = true;
          writeHasBentOnce();
          this.setStatus('Shaping · empty drag orbits · Unwire tool removes');
        }
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;

      const wasWiring = this.wiring;
      const hadWoodTarget = Boolean(this.wireTarget);
      this.wiring = false;
      this.wireTarget = null;

      // Always restore orbit after a wood-hit gesture under wire tool
      if (hadWoodTarget || wasWiring) {
        this.scene.controls.enabled = true;
      }

      if (wasWiring) {
        this.scene.markDirty();
        this.refreshHud();
        // Keep first-run wire hint until a bend has happened
        if (this.tool === 'wire' && this.hasBentOnce) {
          this.hintEl.style.opacity = '0.35';
        }
        return;
      }

      // Dragged on empty canvas (or short miss) → orbit already handled by controls
      if (this.moved) return;
      this.onTap(e.clientX, e.clientY);
    };

    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private onTap(x: number, y: number): void {
    const id = this.scene.pickNode(x, y);
    if (!id) {
      this.selected = null;
      this.scene.setSelected(null);
      this.refreshHud();
      return;
    }

    // Wire tool: tap installs on unwired wood; re-tap wired shows set progress
    if (this.tool === 'wire') {
      this.selected = id;
      this.scene.setSelected(id);
      const node = this.tree.nodes[id];
      if (node?.wire) {
        this.setStatus(
          `${wireSetLabel(node.wire.setAmount)} · drag wood to shape · empty drag orbits`,
        );
        this.refreshHud();
        return;
      }
      this.pushStructural('Undid last wire');
      const r = applyWire(this.tree, id);
      this.setStatus(
        this.hasBentOnce
          ? r.message
          : 'Wire on · drag this branch to bend · empty drag orbits',
      );
      if (r.ok) {
        void import('../render/audio').then((a) => a.playToolSound('wire'));
        this.markPhysicsDirty(false);
        this.scene.markDirty();
      } else {
        this.structuralHistory.discardLast();
      }
      this.refreshHud();
      return;
    }

    const r = this.actOnNode(this.tool, id);
    if (r.ok && this.tool !== 'inspect') {
      const sound =
        this.tool === 'prune' || this.tool === 'pinch' || this.tool === 'unwire'
          ? this.tool
          : null;
      if (sound) {
        void import('../render/audio').then((a) => a.playToolSound(sound));
      }
    }
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    const wireHint = this.hasBentOnce
      ? 'Drag wood to wire + bend · empty drag orbits · Unwire removes'
      : 'Drag a branch to wire and shape · empty space orbits the camera';
    const hints: Record<ToolMode, string> = {
      inspect: 'Tap a branch · Drag to orbit',
      prune: 'Tap a branch to cut clean',
      pinch: 'Tap a tip to pinch · laterals wake',
      wire: wireHint,
      unwire: 'Tap wired wood to remove wire',
    };
    this.hintEl.textContent = hints[tool];
    this.hintEl.style.opacity = '0.85';
    // First-run wire hint stays bright until the player has bent once
    if (tool === 'wire' && !this.hasBentOnce) {
      return;
    }
    // Soft fade other tool hints after a few seconds
    window.setTimeout(() => {
      if (this.tool === tool && this.hintEl.textContent === hints[tool]) {
        if (tool === 'wire' && !this.hasBentOnce) return;
        this.hintEl.style.opacity = '0.35';
      }
    }, 4000);
  }

  setSpeed(speed: SpeedMode): void {
    const prev = this.speed;
    this.speed = speed;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
      const raw = btn.dataset.speed!;
      const mode = raw === '0' ? 'pause' : raw;
      btn.classList.toggle('active', mode === speed);
    });
    // Leaving pure growth FF: rebind + wake so canopy re-settles with new mass.
    const wasFF = prev === 'year' || prev === 'month';
    const nowFF = speed === 'year' || speed === 'month';
    if (wasFF && !nowFF) {
      this.markPhysicsDirty(true);
      this.refreshHud();
    }
    // Flush pending mesh when pausing so player sees final structure.
    // Do not force reframe — user may be mid close-up work (#60).
    if (speed === 'pause' && this.pendingVisual) {
      this.pendingVisual = false;
      this.visualCooldownTimer = 0;
      this.scene.markDirty();
      this.scene.frameTree(this.tree);
    }
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    // Brief unfade when status fires during idle chrome
    this.statusUnfadeTimer = 4;
    document.getElementById('hud')?.classList.remove('idle-fade');
  }

  /** After ~30s idle, fade HUD; any input restores. */
  private bindIdleChrome(): void {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const poke = () => {
      this.idleTimer = 0;
      hud.classList.remove('idle-fade');
    };
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, poke, { passive: true });
    }
  }

  private applySeasonVisuals(): void {
    const env = environmentAt(this.tree.agePlantDays);
    if (env.season === this.lastSeason) return;
    this.lastSeason = env.season;
    this.scene.applySeasonLook(env.season);
  }

  refreshHud(): void {
    const env = environmentAt(this.tree.agePlantDays);
    const species = getSpecies(this.tree.speciesId);
    document.getElementById('info-age')!.textContent = formatAge(
      this.tree.agePlantDays,
    );
    document.getElementById('info-season')!.textContent = seasonLabel(env.season);

    const reserves = this.tree.reserves;
    const wordEl = document.getElementById('info-reserves');
    if (wordEl) wordEl.textContent = vitalityWord(reserves, env.season);
    const bar = document.getElementById('info-vitality-bar');
    if (bar) {
      const level = vitalityLevel(reserves);
      bar.style.width = `${Math.round(level * 100)}%`;
      bar.style.background = vitalityBarColor(reserves, env.season);
    }

    const nodesEl = document.getElementById('info-nodes');
    if (nodesEl) {
      nodesEl.textContent = String(Object.keys(this.tree.nodes).length);
    }

    const sel = document.getElementById('info-selection')!;
    if (this.selected && this.tree.nodes[this.selected]) {
      sel.textContent = describeNode(this.tree, this.selected);
    } else {
      sel.textContent = `${species.commonName}`;
    }
  }

  update(dt: number): void {
    const frameStart = performance.now();
    const nodeCount = Object.keys(this.tree.nodes).length;
    const rate = SPEED_PLANT_DAYS_PER_SECOND[this.speed];
    if (rate > 0) {
      this.accum += dt * rate;
      // Adaptive substep cap — see growthMaxSteps (#34)
      const maxSteps = this.growthMaxSteps(nodeCount);
      if (this.accum >= 1) {
        const steps = tickDays(this.tree, this.accum, maxSteps);
        this.accum -= steps;
        if (this.accum < 0) this.accum = 0;
        if (this.accum > maxSteps) this.accum = this.accum % 1;
        this.pendingVisual = true;
        // Growth changes mass/topology; rebind without wake (sleep preserved).
        this.markPhysicsDirty(false);
        this.applySeasonVisuals();
        // HUD is DOM-heavy; throttle under year/month acceleration.
        if (this.speed === 'year' || this.speed === 'month') {
          this.hudCooldownTimer += dt;
          if (this.hudCooldownTimer >= 0.28) {
            this.hudCooldownTimer = 0;
            this.refreshHud();
          }
        } else {
          this.refreshHud();
        }
      }
    }

    // Idle chrome fade (~30s) — screenshot harness hard-hides via CSS class on body
    this.idleTimer += dt;
    if (this.statusUnfadeTimer > 0) {
      this.statusUnfadeTimer -= dt;
    } else if (this.idleTimer > 30) {
      document.getElementById('hud')?.classList.add('idle-fade');
    }

    // Rebuild mesh at a capped rate during fast-forward (sim still advances)
    this.visualCooldownTimer += dt;
    const visualInterval = this.visualIntervalSec();
    let visualThisFrame = false;
    if (this.pendingVisual && this.visualCooldownTimer >= visualInterval) {
      this.visualCooldownTimer = 0;
      this.pendingVisual = false;
      visualThisFrame = true;
      this.scene.markDirty();
      // Auto-fit only if the player has not taken camera control (#60)
      this.scene.frameTree(this.tree);
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer > 15) {
      this.autosaveTimer = 0;
      saveLocal(this.tree);
    }

    // Practice mode: quiet score in status + ink feedback (throttled)
    if (this.scene.sumi.isEnabled()) {
      this.practiceHudTimer += dt;
      if (this.practiceHudTimer > 1.2) {
        this.practiceHudTimer = 0;
        const s = this.getPracticeScore();
        this.scene.sumi.applyScoreFeedback(s);
        if (s.label !== this.lastPracticeLabel) {
          this.lastPracticeLabel = s.label;
          this.setStatus(s.label);
        }
      }
    }

    // Freeze dynamics in ortho audit views so screenshots stay stable
    freezePhysics(this.physics, !this.scene.isPlayView());

    // Orbit damping first so camera kinematics match what the user sees
    if (this.scene.isPlayView()) {
      this.scene.controls.update();
    }
    const cam = this.scene.sampleCameraMotion(dt);

    // Pure growth FF (Years/Months + still camera): skip elastic integrate,
    // collision, and per-frame foliage re-pose. Structure still advances via
    // tickDays; mesh rebuilds on visualInterval; leaving FF wakes joints.
    const pureGrowthFF =
      (this.speed === 'year' || this.speed === 'month') &&
      !cam.active &&
      this.scene.isPlayView();

    this.lastPhysicsCulled = pureGrowthFF;

    // During pureGrowthFF only rebind joints when we need live frames (rebuild).
    // Otherwise defer sync until dynamics resume or a visual rebuild lands.
    if (this.physicsNeedsSync && (!pureGrowthFF || visualThisFrame)) {
      this.syncPhysics();
    }

    if (!pureGrowthFF) {
      stepPhysics(this.physics, this.tree, dt, {
        gravity: true,
        cameraAccel: cam.accel,
        cameraAlpha: cam.alpha,
        enabled: cam.active,
      });
    }

    if (pureGrowthFF) {
      // Structural rebuild only (growth throttle or selection dirty). No pose stream.
      if (visualThisFrame || this.scene.isTreeDirty()) {
        if (this.physicsNeedsSync) this.syncPhysics();
        const liveFrames = computeLiveWorldFrames(this.tree, this.physics);
        this.scene.syncTree(this.tree, liveFrames);
      }
      // Clean non-rebuild frames: leave last mesh as-is while plant-time advances.
    } else {
      const liveFrames = computeLiveWorldFrames(this.tree, this.physics);
      this.scene.syncTree(this.tree, liveFrames);
      this.scene.applyTreePose(this.tree, liveFrames);
    }
    this.scene.render(true);

    this.lastFrameMs = performance.now() - frameStart;
    // Exponential moving average (~0.5s at 60fps)
    this.avgFrameMs =
      this.avgFrameMs === 0
        ? this.lastFrameMs
        : this.avgFrameMs * 0.9 + this.lastFrameMs * 0.1;
  }
}

const WIRE_BENT_ONCE_KEY = 'bonsai-en:wire-bent-once';
/** Play mode preference: practice (default) | sandbox (free train). */
const MODE_KEY = 'bonsai-en:mode';

type PlayMode = 'practice' | 'sandbox';

function readHasBentOnce(): boolean {
  try {
    return localStorage.getItem(WIRE_BENT_ONCE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHasBentOnce(): void {
  try {
    localStorage.setItem(WIRE_BENT_ONCE_KEY, '1');
  } catch {
    // private mode / quota — session-only flag still works via instance field
  }
}

/** First visit and unknown values default to practice. */
function readPlayMode(): PlayMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'sandbox') return 'sandbox';
    return 'practice';
  } catch {
    return 'practice';
  }
}

function writePlayMode(mode: PlayMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // private mode / quota
  }
}
