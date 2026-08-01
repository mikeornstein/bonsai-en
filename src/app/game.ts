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
  rankOverflowPruneTargets,
  type OverflowRanked,
} from '../sim/practice/shokunin';
import {
  createPracticeMilestoneState,
  observePracticeScore,
  resetPracticeMilestones,
  seedPracticeScore,
  type PracticeMilestoneState,
} from '../sim/practice/milestones';
import {
  CHECKLIST_STEPS,
  checklistDoneCount,
  checklistHint,
  evaluateChecklistProgress,
  mergeChecklistDone,
  treeWireSignals,
  type ChecklistDone,
  type ChecklistStepId,
} from '../sim/practice/checklist';
import {
  cyclePracticePack,
  getActivePracticePack,
  isPracticePackId,
  setActivePracticePack,
  type PracticePack,
  type PracticePackId,
} from '../sim/practice/target';
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
  /** Last off-axis practice note state (avoid thrashing hint every tick). */
  private lastFrontOffAxis = false;
  /** Session close/match celebrations (best-so-far; no boundary spam). */
  private practiceMilestones: PracticeMilestoneState =
    createPracticeMilestoneState();
  /** Hold milestone status briefly so regular grade labels don't clobber it. */
  private milestoneHoldUntil = 0;
  /** Throttle HUD refresh under year/month acceleration. */
  private hudCooldownTimer = 0;
  /**
   * Structural undo stack (prune / pinch / wire / unwire / bend).
   * Pure time passage is never snapshotted (issue #67).
   */
  private structuralHistory = new StructuralHistory();
  /** Last Practice+Inspect overflow ranking (for status / prune preselect). */
  private coachRanked: OverflowRanked[] = [];
  /** Session soft-progress for optional shokunin checklist. */
  private hasPrunedSession = false;
  private usedSeasonPaceSession = false;
  private hasPausedSession = false;
  /** Manual checklist overrides (advisory; does not lock tools). */
  private checklistOverride = new Map<ChecklistStepId, boolean>();
  private checklistEl: HTMLDetailsElement | null = null;
  private checklistListEl: HTMLElement | null = null;
  private checklistCountEl: HTMLElement | null = null;
  private lastChecklistDone: ChecklistDone | null = null;
  private checklistCollapsedForProgress = false;
  /** Last continuous wire status key (`nodeId:pct`) so % updates without re-tap (#68). */
  private lastWireHudKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.statusEl = document.getElementById('status')!;
    this.hintEl = document.getElementById('hint')!;
    this.checklistEl = document.getElementById(
      'checklist',
    ) as HTMLDetailsElement | null;
    this.checklistListEl = document.getElementById('checklist-list');
    this.checklistCountEl = document.getElementById('checklist-count');
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
        // Practice default: soft-snap to front viewing face so ink + score agree (#66)
        if (this.scene.sumi.isEnabled() && this.scene.isPlayView()) {
          this.scene.snapToFrontFace();
        }
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

  /** Quantitative match of living silhouette to active sumi practice pack. */
  getPracticeScore(): PracticeScore {
    return scorePracticeMatch(this.tree, getActivePracticePack());
  }

  /** Active practice silhouette pack (moyogi default). */
  getPracticePack(): PracticePack {
    return getActivePracticePack();
  }

  /**
   * Set or cycle practice shape pack. Rebuilds sumi ghost + rescores.
   * Preference persists in localStorage `bonsai-en:practice-pack`.
   */
  setPracticePack(
    idOrCycle: PracticePackId | 'cycle' | string,
    opts?: { persist?: boolean },
  ): PracticePack {
    const persist = opts?.persist !== false;
    const pack =
      idOrCycle === 'cycle'
        ? cyclePracticePack()
        : setActivePracticePack(idOrCycle);
    this.scene.sumi.setPack(pack);
    this.syncPackButton(pack);
    if (persist) writePracticePackId(pack.id);
    if (this.scene.sumi.isEnabled()) {
      const s = this.getPracticeScore();
      this.scene.sumi.applyScoreFeedback(s);
      this.setStatus(s.label);
      this.lastPracticeLabel = s.label;
      if (pack.hint) {
        this.hintEl.textContent = pack.hint;
        this.hintEl.style.opacity = '0.85';
      }
    } else {
      this.setStatus(`Shape: ${pack.name} (Practice off)`);
    }
    return pack;
  }

  /**
   * Practice (sumi guide + live grade) vs Free train / sandbox.
   * Default is practice; preference persists in localStorage `bonsai-en:mode`.
   * Enabling practice soft-snaps the play camera to the front viewing face (#66).
   */
  setPracticeMode(on: boolean, opts?: { persist?: boolean }): void {
    const persist = opts?.persist !== false;
    this.scene.sumi.setEnabled(on);
    if (on) {
      this.scene.sumi.setPack(getActivePracticePack());
      // Soft snap so ink, score, and eyes share the front plane
      if (this.scene.isPlayView()) {
        this.scene.snapToFrontFace();
      }
      const s = this.getPracticeScore();
      this.scene.sumi.applyScoreFeedback(s);
      this.updatePracticeMeta(s);
      this.setPracticeMetaVisible(true);
      // Seed without celebrating on toggle — only live score rises celebrate.
      seedPracticeScore(this.practiceMilestones, s.score);
      // Front snap note; ongoing grade lives in meta (#65 / #66)
      this.setStatus('Viewing face');
      this.lastPracticeLabel = this.formatPracticeMeta(s);
      this.lastFrontOffAxis = false;
      this.syncPracticeBestMeta(true);
      this.hintEl.textContent =
        'Match the ink · prune outside · wire the trunk · grow into the pad';
      this.hintEl.style.opacity = '0.85';
    } else {
      this.setPracticeMetaVisible(false);
      // Free train: drop front lock and off-axis notes
      this.scene.setFrontLock(false);
      this.setStatus('Free train');
      this.lastPracticeLabel = '';
      this.lastFrontOffAxis = false;
      this.milestoneHoldUntil = 0;
      this.syncPracticeBestMeta(false);
      this.hintEl.textContent = 'Free train · tools unchanged';
      this.hintEl.style.opacity = '0.55';
    }
    this.syncPracticeButton(on);
    this.syncFrontLockButton(on);
    this.syncChecklistVisibility(on);
    if (on) this.refreshChecklist();
    if (persist) writePlayMode(on ? 'practice' : 'sandbox');
    // Coach overflow tips only in Practice; clear in Free train
    this.updateCoachHighlights();
  }

  /**
   * Optional front lock while scoring (#66). Orbit rotate disabled when on;
   * re-snaps to front. Free train leaves lock off.
   */
  setFrontLock(on: boolean): void {
    if (!this.scene.sumi.isEnabled()) {
      // Lock is practice-only — ignore while sandbox
      this.scene.setFrontLock(false);
      this.syncFrontLockButton(false);
      return;
    }
    this.scene.setFrontLock(on);
    this.syncFrontLockButton(true);
    if (on) {
      this.setStatus('Front locked · score matches view');
      this.lastFrontOffAxis = false;
      this.hintEl.textContent =
        'Front locked · zoom ok · unlock in ⋯ to orbit';
      this.hintEl.style.opacity = '0.75';
    } else {
      this.setStatus('Orbit free · score is front silhouette');
    }
  }

  isFrontLock(): boolean {
    return this.scene.isFrontLock();
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

  /** Show Lock front only in Practice; label reflects current lock state. */
  private syncFrontLockButton(practiceOn: boolean): void {
    const btn = document.getElementById('btn-front-lock');
    if (!btn) return;
    btn.hidden = !practiceOn;
    if (!practiceOn) return;
    const locked = this.scene.isFrontLock();
    btn.textContent = locked ? 'Unlock front' : 'Lock front';
    btn.title = locked
      ? 'Allow free orbit (score stays front-plane only)'
      : 'Keep camera on the viewing face while scoring';
  }

  /**
   * Quiet hint when Practice is on, camera is off the front face, and front
   * is not locked — so score vs eyes mismatch is labeled, not silent.
   */
  private refreshFrontAxisHint(): void {
    if (!this.scene.sumi.isEnabled()) return;
    if (this.scene.isFrontLock()) {
      if (this.lastFrontOffAxis) {
        this.lastFrontOffAxis = false;
        this.hintEl.textContent =
          'Front locked · zoom ok · unlock in ⋯ to orbit';
        this.hintEl.style.opacity = '0.75';
      }
      return;
    }
    const offAxis = !this.scene.isFrontFaceAligned();
    if (offAxis === this.lastFrontOffAxis) return;
    this.lastFrontOffAxis = offAxis;
    if (offAxis) {
      this.hintEl.textContent =
        'Score is front silhouette · Lock front in ⋯';
      this.hintEl.style.opacity = '0.8';
    } else {
      const pack = getActivePracticePack();
      this.hintEl.textContent =
        pack.hint ??
        'Match the ink · prune outside · wire the trunk · grow into the pad';
      this.hintEl.style.opacity = '0.85';
    }
  }

  private syncPackButton(pack: PracticePack = getActivePracticePack()): void {
    const btn = document.getElementById('btn-practice-pack');
    if (!btn) return;
    btn.textContent = `Shape: ${pack.name}`;
    btn.title = `Cycle practice silhouette (current: ${pack.name}). Affects sumi ghost + grade when Practice is on.`;
  }

  /**
   * Apply stored mode at boot (default practice). Does not clobber bootstrap
   * status lines (shared tree / autosave / recovery).
   * Front snap runs after first frameTree (see constructor rAF).
   */
  private applyBootPracticeMode(): void {
    const packId = readPracticePackId();
    const pack = setActivePracticePack(packId);
    this.syncPackButton(pack);

    const on = readPlayMode() === 'practice';
    this.scene.sumi.setEnabled(on);
    if (on) this.scene.sumi.setPack(pack);
    this.syncPracticeButton(on);
    this.setPracticeMetaVisible(on);
    this.syncFrontLockButton(on);
    this.syncChecklistVisibility(on);
    if (!on) {
      this.updateCoachHighlights();
      this.syncPracticeBestMeta(false);
      return;
    }
    const s = this.getPracticeScore();
    this.scene.sumi.applyScoreFeedback(s);
    this.updatePracticeMeta(s);
    // Seed best quietly; do not celebrate boot (restored trees may already be close).
    seedPracticeScore(this.practiceMilestones, s.score);
    this.lastPracticeLabel = this.formatPracticeMeta(s);
    const status = this.statusEl.textContent?.trim() ?? '';
    if (!status) this.setStatus(s.label);
    this.syncPracticeBestMeta(true);
    // First-run / practice-default hint (pack-specific when available)
    this.hintEl.textContent =
      pack.hint ??
      'Match the ink · prune outside · wire the trunk · grow into the pad';
    this.hintEl.style.opacity = '0.85';
    // Default tool is Inspect — show overflow coach when practice is on
    this.updateCoachHighlights();
    this.refreshChecklist();
  }

  /** Practice: show quiet path checklist. Free train: hide entirely. */
  private syncChecklistVisibility(practiceOn: boolean): void {
    if (!this.checklistEl) return;
    this.checklistEl.hidden = !practiceOn;
    if (!practiceOn) {
      this.checklistEl.open = false;
      return;
    }
    // Mobile: start collapsed so HUD stays light
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 719px)').matches) {
      this.checklistEl.open = false;
    } else if (!this.checklistCollapsedForProgress) {
      this.checklistEl.open = true;
    }
  }

  private buildChecklistDom(): void {
    const list = this.checklistListEl;
    if (!list || list.childElementCount > 0) return;
    for (const step of CHECKLIST_STEPS) {
      const li = document.createElement('li');
      li.className = 'checklist-row';
      li.dataset.step = step.id;

      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'checklist-mark';
      mark.title = 'Mark done (advisory)';
      mark.setAttribute('aria-label', `Toggle ${step.label}`);
      mark.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleChecklistStep(step.id);
      });

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'checklist-item';
      btn.textContent = step.label;
      btn.title = step.hint;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.setStatus(checklistHint(step.id));
      });

      li.appendChild(mark);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  private toggleChecklistStep(id: ChecklistStepId): void {
    const done = this.computeChecklistDone();
    const next = !done[id];
    this.checklistOverride.set(id, next);
    this.setStatus(checklistHint(id));
    this.refreshChecklist();
  }

  private computeChecklistDone(practiceScore?: number): ChecklistDone {
    const wire = treeWireSignals(this.tree);
    const score =
      practiceScore ??
      (this.scene.sumi.isEnabled() ? this.getPracticeScore().score : 0);
    const auto = evaluateChecklistProgress({
      cameraOwned: this.scene.isCameraUserOwned(),
      hasPruned: this.hasPrunedSession,
      hasTrunkWire: wire.hasTrunkWire,
      maxWireSet: wire.maxWireSet,
      usedSeasonPace: this.usedSeasonPaceSession,
      hasPaused: this.hasPausedSession,
      practiceScore: score,
    });
    return mergeChecklistDone(auto, this.checklistOverride);
  }

  private refreshChecklist(practiceScore?: number): void {
    if (!this.checklistEl || this.checklistEl.hidden) return;
    this.buildChecklistDom();
    const done = this.computeChecklistDone(practiceScore);
    const count = checklistDoneCount(done);
    if (this.checklistCountEl) {
      this.checklistCountEl.textContent =
        count > 0 ? `${count}/${CHECKLIST_STEPS.length}` : '';
    }
    this.checklistListEl
      ?.querySelectorAll<HTMLElement>('.checklist-row')
      .forEach((row) => {
        const id = row.dataset.step as ChecklistStepId | undefined;
        if (!id) return;
        row.classList.toggle('done', Boolean(done[id]));
      });

    // Soft collapse once several steps land (especially mobile) — advisory only
    const prev = this.lastChecklistDone
      ? checklistDoneCount(this.lastChecklistDone)
      : 0;
    this.lastChecklistDone = done;
    if (count >= 3 && count > prev) {
      const mobile =
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 719px)').matches;
      if (mobile || count >= CHECKLIST_STEPS.length) {
        this.checklistEl.open = false;
        this.checklistCollapsedForProgress = true;
      }
    }
  }

  private resetChecklistSession(): void {
    this.hasPrunedSession = false;
    this.usedSeasonPaceSession = false;
    this.hasPausedSession = false;
    this.checklistOverride.clear();
    this.lastChecklistDone = null;
    this.checklistCollapsedForProgress = false;
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
      const coach = this.coachRanked.find((r) => r.id === nodeId);
      // Wired wood: surface set progress immediately (no re-tap needed) (#68)
      const msg = coach
        ? coach.reason
        : node.wire
          ? wireSetLabel(node.wire.setAmount)
          : 'This branch';
      this.setStatus(msg);
      this.refreshHud();
      return { ok: true, message: msg };
    }

    if (tool === 'prune') {
      this.pushStructural('Undid last cut');
      const r = pruneAt(this.tree, nodeId);
      this.setStatus(r.message);
      if (r.ok) {
        this.hasPrunedSession = true;
        this.selected = null;
        this.scene.setSelected(null);
        this.markPhysicsDirty(true);
        this.scene.markDirty();
        this.scene.treeRenderer.pulseToolFeedback('prune');
        this.updateCoachHighlights();
        if (this.scene.sumi.isEnabled()) this.refreshChecklist();
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
        this.updateCoachHighlights();
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
    // Fresh session milestones so close/match can celebrate again
    resetPracticeMilestones(this.practiceMilestones);
    this.milestoneHoldUntil = 0;
    this.lastPracticeLabel = '';
    this.resetChecklistSession();
    this.setStatus('New juniper sapling');
    this.updateCoachHighlights();
    this.refreshHud();
    if (this.scene.sumi.isEnabled()) {
      const s = this.getPracticeScore();
      seedPracticeScore(this.practiceMilestones, s.score);
      this.scene.sumi.applyScoreFeedback(s);
      this.syncPracticeBestMeta(true);
      this.syncChecklistVisibility(true);
      this.refreshChecklist();
    } else {
      this.syncPracticeBestMeta(false);
      this.syncChecklistVisibility(false);
    }
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
        // New tree → fresh milestones; seed so restored close/match does not flash
        resetPracticeMilestones(this.practiceMilestones);
        this.milestoneHoldUntil = 0;
        this.lastPracticeLabel = '';
        if (this.scene.sumi.isEnabled()) {
          seedPracticeScore(this.practiceMilestones, this.getPracticeScore().score);
          this.syncPracticeBestMeta(true);
        } else {
          this.syncPracticeBestMeta(false);
        }
        this.setStatus('Tree imported');
        this.updateCoachHighlights();
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

    document.getElementById('btn-front-lock')?.addEventListener('click', () => {
      closeFiles();
      this.setFrontLock(!this.scene.isFrontLock());
    });

    document.getElementById('btn-practice-pack')?.addEventListener('click', () => {
      closeFiles();
      this.setPracticePack('cycle');
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
      // (respects practice front lock — rotate may stay disabled)
      if (hadWoodTarget || wasWiring) {
        this.scene.restorePlayControls();
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

    // Wire tool: tap installs on unwired wood; wired selection keeps set % live via refreshHud
    if (this.tool === 'wire') {
      this.selected = id;
      this.scene.setSelected(id);
      const node = this.tree.nodes[id];
      if (node?.wire) {
        this.setStatus(
          `${wireSetLabel(node.wire.setAmount)} · drag wood to shape · empty drag orbits`,
        );
        this.lastWireHudKey = ''; // force continuous status resync
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
    const prev = this.tool;
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    // Prune from Inspect: preselect top overflow tip if nothing selected
    if (
      tool === 'prune' &&
      prev === 'inspect' &&
      !this.selected &&
      this.scene.sumi.isEnabled() &&
      this.coachRanked.length > 0
    ) {
      const topId = this.coachRanked[0].id;
      if (this.tree.nodes[topId]) {
        this.selected = topId;
        this.scene.setSelected(topId);
        this.setStatus(this.coachRanked[0].reason);
      }
    }
    const practiceInspect =
      tool === 'inspect' && this.scene.sumi.isEnabled();
    const wireHint = this.hasBentOnce
      ? 'Drag wood to wire + bend · empty drag orbits · Unwire removes'
      : 'Drag a branch to wire and shape · empty space orbits the camera';
    const hints: Record<ToolMode, string> = {
      inspect: practiceInspect
        ? 'Warm tips sit outside the pad · tap for why'
        : 'Tap a branch · Drag to orbit',
      prune: 'Tap a branch to cut clean',
      pinch: 'Tap a tip to pinch · laterals wake',
      wire: wireHint,
      unwire: 'Tap wired wood to remove wire',
    };
    this.hintEl.textContent = hints[tool];
    this.hintEl.style.opacity = '0.85';
    this.updateCoachHighlights();
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

  /**
   * Practice + Inspect: highlight worst overflow tips via rankOverflowPruneTargets.
   * Cleared in Free train or when leaving Inspect.
   */
  private updateCoachHighlights(): void {
    const practiceOn = this.scene.sumi.isEnabled();
    if (!practiceOn || this.tool !== 'inspect') {
      if (this.coachRanked.length > 0) {
        this.coachRanked = [];
      }
      this.scene.setCoachHighlights([]);
      return;
    }
    this.coachRanked = rankOverflowPruneTargets(this.tree, { max: 3 });
    this.scene.setCoachHighlights(this.coachRanked.map((r) => r.id));
  }

  setSpeed(speed: SpeedMode): void {
    const prev = this.speed;
    this.speed = speed;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
      const raw = btn.dataset.speed!;
      const mode = raw === '0' ? 'pause' : raw;
      btn.classList.toggle('active', mode === speed);
    });
    // Checklist soft signals: Season/Mo for pads; Still for rest
    if (speed === 'week' || speed === 'month') {
      this.usedSeasonPaceSession = true;
    }
    if (speed === 'pause') {
      this.hasPausedSession = true;
    }
    if (
      this.scene.sumi.isEnabled() &&
      (speed === 'week' || speed === 'month' || speed === 'pause')
    ) {
      this.refreshChecklist();
    }
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

  private setStatus(msg: string, opts?: { milestone?: boolean }): void {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('milestone-soft', Boolean(opts?.milestone));
    // Brief unfade when status fires during idle chrome
    this.statusUnfadeTimer = 4;
    document.getElementById('hud')?.classList.remove('idle-fade');
  }

  /** Sparse meta chip text: `forming · 0.68` (grade lives outside status). */
  private formatPracticeMeta(s: PracticeScore): string {
    return `${s.grade} · ${s.score.toFixed(2)}`;
  }

  private updatePracticeMeta(s: PracticeScore): void {
    const el = document.getElementById('info-practice');
    if (el) el.textContent = this.formatPracticeMeta(s);
  }

  private setPracticeMetaVisible(on: boolean): void {
    document
      .getElementById('info-practice-row')
      ?.classList.toggle('hidden', !on);
  }

  /**
   * Quiet session-best practice score in meta while Practice is on.
   * Free train hides the row entirely (no celebration chrome).
   */
  private syncPracticeBestMeta(practiceOn: boolean): void {
    const row = document.getElementById('info-practice-best');
    const val = document.getElementById('info-practice-best-val');
    if (!row || !val) return;
    if (!practiceOn) {
      row.classList.add('hidden');
      return;
    }
    row.classList.remove('hidden');
    const best = this.practiceMilestones.bestScore;
    val.textContent = best > 0 ? best.toFixed(2) : '—';
  }

  /**
   * Practice HUD tick: grade meta + session best + one-time close/match
   * acknowledgments (zen tone; no free-train chrome). Status free for tools (#65).
   */
  private updatePracticeHud(): void {
    const s = this.getPracticeScore();
    this.scene.sumi.applyScoreFeedback(s);
    this.updatePracticeMeta(s);

    const now = performance.now();
    const event = observePracticeScore(this.practiceMilestones, s.score);
    this.syncPracticeBestMeta(true);

    if (event) {
      this.setStatus(event.message, { milestone: true });
      this.scene.sumi.pulseMilestone(event.kind);
      this.lastPracticeLabel = this.formatPracticeMeta(s);
      // Hold long enough that the next 1–2 throttled ticks don't bury it
      this.milestoneHoldUntil = now + 4200;
      return;
    }

    if (now < this.milestoneHoldUntil) return;

    const meta = this.formatPracticeMeta(s);
    if (meta !== this.lastPracticeLabel) {
      this.lastPracticeLabel = meta;
    }
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

  /**
   * Month/Year wall-clock boost for wire set only (#68).
   * Live/Day stay botanical (mult = 1); Mo/Years make short waits readable
   * even when plant-day substeps lag under heavy trees.
   */
  private wireSetMultForSpeed(): number {
    if (this.speed === 'year') return 2;
    if (this.speed === 'month') return 1.6;
    return 1;
  }

  /**
   * Keep status + selection set % in sync while a wired node stays selected.
   * Does not require re-tap; quiet coach when set is still low (#68).
   */
  private syncWiredSelectionHud(): void {
    const selId = this.selected;
    if (!selId) {
      this.lastWireHudKey = '';
      return;
    }
    const node = this.tree.nodes[selId];
    if (!node?.wire) {
      this.lastWireHudKey = '';
      return;
    }

    const set = node.wire.setAmount;
    const pct = Math.round(Math.max(0, Math.min(1, set)) * 100);
    const key = `${selId}:${pct}`;
    if (key === this.lastWireHudKey) return;
    this.lastWireHudKey = key;

    // Selection panel always carries set progress via describeNode.
    // Also refresh status so players watching the header see % climb.
    if (this.wiring) return;

    const label = wireSetLabel(set);
    const status = this.statusEl.textContent ?? '';
    const wireish =
      this.tool === 'wire' ||
      this.tool === 'unwire' ||
      this.tool === 'inspect' ||
      /wire|wiring|set/i.test(status);

    if (!wireish) return;

    // Sparse present-tense copy; coach only while set is low and clock is slow
    const slowClock =
      this.speed === 'pause' ||
      this.speed === 'live' ||
      this.speed === 'day';
    let msg: string;
    if (set < 0.3 && slowClock) {
      // Quiet coach while set is low; % key already throttles spam
      msg = `${label} · leave wire · advance to Mo`;
    } else if (this.tool === 'wire') {
      msg = `${label} · drag wood to shape`;
    } else {
      msg = label;
    }

    // Soft write — avoid unfading HUD on every plant-day under acceleration
    this.statusEl.textContent = msg;
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
      // Always includes live wire set % while wired (#68) via describeNode
      const base = describeNode(this.tree, this.selected);
      const coach = this.coachRanked.find((r) => r.id === this.selected);
      sel.textContent = coach ? `${coach.reason} · ${base}` : base;
      this.syncWiredSelectionHud();
    } else if (
      this.tool === 'inspect' &&
      this.scene.sumi.isEnabled() &&
      this.coachRanked.length > 0
    ) {
      const top = this.coachRanked[0];
      sel.textContent = `${top.reason} · coach tip`;
    } else {
      sel.textContent = `${species.commonName}`;
      this.lastWireHudKey = '';
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
        const steps = tickDays(this.tree, this.accum, maxSteps, {
          wireSetMult: this.wireSetMultForSpeed(),
        });
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

    // Practice mode: quiet grade in meta + session milestones (throttled ~1.2s).
    // Status stays free for tool/event messages except one-time milestones (#65/#69).
    if (this.scene.sumi.isEnabled()) {
      this.practiceHudTimer += dt;
      if (this.practiceHudTimer > 1.2) {
        this.practiceHudTimer = 0;
        this.updatePracticeHud();
        // Refresh overflow coach highlights with tree growth (same throttle)
        if (this.tool === 'inspect') {
          this.updateCoachHighlights();
          this.refreshHud();
        }
        // Soft checklist progress (camera / wire set / score)
        this.refreshChecklist();
        // Off-axis note when unlocked: score is still front-plane only (#66)
        this.refreshFrontAxisHint();
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
/** Practice silhouette pack: moyogi (default) | cascade | literati. */
const PACK_KEY = 'bonsai-en:practice-pack';

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

/** First visit and unknown values default to moyogi. */
function readPracticePackId(): PracticePackId {
  try {
    const v = localStorage.getItem(PACK_KEY);
    if (v && isPracticePackId(v)) return v;
    return 'moyogi';
  } catch {
    return 'moyogi';
  }
}

function writePracticePackId(id: PracticePackId): void {
  try {
    localStorage.setItem(PACK_KEY, id);
  } catch {
    // private mode / quota
  }
}
