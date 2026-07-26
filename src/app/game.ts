import { describeNode, tickDays } from '../sim/growth';
import {
  SPEED_PLANT_DAYS_PER_SECOND,
  environmentAt,
  formatAge,
  seasonLabel,
  vitalityLevel,
  vitalityWord,
  type SpeedMode,
} from '../sim/time';
import { createSapling, ensurePlayableTree } from '../sim/tree';
import { pinchAt, pruneAt } from '../sim/tools/prune';
import { applyWire, bendWiredNode, removeWire } from '../sim/tools/wire';
import { downloadTree, parseTree } from '../sim/serialize';
import type { NodeId, TreeState } from '../sim/types';
import { BonsaiScene } from '../render/scene';
import {
  clearLocal,
  copyShareLink,
  loadLocal,
  saveLocal,
  treeFromShareHash,
} from '../share/encode';
import { getSpecies } from '../sim/species/juniper';
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

export class Game {
  tree: TreeState;
  scene: BonsaiScene;
  tool: ToolMode = 'inspect';
  speed: SpeedMode = 'live';
  selected: NodeId | null = null;
  physics: PhysicsWorld;

  private accum = 0;
  private wiring = false;
  private pointerDown = false;
  private downX = 0;
  private downY = 0;
  private moved = false;
  private statusEl: HTMLElement;
  private hintEl: HTMLElement;
  private autosaveTimer = 0;
  /** Throttle expensive mesh rebuilds during time acceleration. */
  private visualCooldownTimer = 0;
  private pendingVisual = false;
  private physicsNeedsSync = true;
  private lastSeason: string | null = null;
  private idleTimer = 0;
  private statusUnfadeTimer = 0;

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
    this.refreshHud();
    this.applySeasonVisuals();
    this.scene.markDirty();
    // Defer mesh build so HUD/buttons paint immediately
    requestAnimationFrame(() => {
      try {
        this.syncPhysics();
        this.scene.syncTree(this.tree, computeLiveWorldFrames(this.tree, this.physics));
        this.scene.frameTree(this.tree);
      } catch (err) {
        console.error('[bonsai-en] initial tree sync failed', err);
        this.setStatus(`Tree render failed: ${(err as Error).message}`);
      }
    });
  }

  /** Rebuild physics graph from structural tree (after tools / growth). */
  private syncPhysics(): void {
    syncPhysicsWorld(this.physics, this.tree);
    wakeAllJoints(this.physics);
    this.physicsNeedsSync = false;
  }

  /** Freeze dynamics for stable screenshots / ortho audits. */
  setPhysicsFrozen(frozen: boolean): void {
    freezePhysics(this.physics, frozen);
  }

  /** Quantitative motion snapshot (max/rms ω, KE, sleep count). */
  getPhysicsTelemetry(): PhysicsTelemetry {
    return measureTelemetry(this.physics);
  }

  /** Reset to a fresh sapling (no confirm dialog — used by screenshot harness). */
  newSapling(): void {
    this.tree = createSapling();
    this.selected = null;
    clearLocal();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    this.scene.setSelected(null);
    this.physicsNeedsSync = true;
    this.syncPhysics();
    this.scene.markDirty();
    this.scene.syncTree(
      this.tree,
      computeLiveWorldFrames(this.tree, this.physics),
    );
    this.scene.frameTree(this.tree);
    this.setStatus('New juniper sapling');
    this.refreshHud();
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
        this.scene.setSelected(null);
        this.physicsNeedsSync = true;
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
        downloadTree(this.tree);
        this.setStatus('Tree too large for a link — file downloaded');
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
      const on = !this.scene.sumi.isEnabled();
      this.scene.sumi.setEnabled(on);
      this.setStatus(on ? 'Sumi practice · soft ink guide' : 'Free train');
      const btn = document.getElementById('btn-sumi');
      if (btn) btn.textContent = on ? 'Practice on' : 'Practice';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === 'i') this.setTool('inspect');
      if (key === 'p') this.setTool('prune');
      if (key === 'n') this.setTool('pinch');
      if (key === 'w') this.setTool('wire');
      if (key === 'u') this.setTool('unwire');
      if (key === ' ') {
        e.preventDefault();
        this.setSpeed(this.speed === 'pause' ? 'live' : 'pause');
      }
      if (key === 'escape') closeFiles();
    });
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = true;
      this.moved = false;
      this.downX = e.clientX;
      this.downY = e.clientY;
      if (this.tool === 'wire' && this.selected) {
        this.wiring = true;
        this.scene.controls.enabled = false;
        applyWire(this.tree, this.selected);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const dx = e.clientX - this.downX;
      const dy = e.clientY - this.downY;
      if (Math.hypot(dx, dy) > 6) this.moved = true;

      if (this.wiring && this.selected && this.tool === 'wire') {
        const dir = this.scene.bendDirectionFromPointer(
          this.tree,
          this.selected,
          e.clientX,
          e.clientY,
        );
        if (dir) {
          bendWiredNode(this.tree, this.selected, dir);
          resetJointElastic(this.physics, this.selected);
          this.physicsNeedsSync = true;
          this.scene.markDirty();
        }
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.wiring) {
        this.wiring = false;
        this.scene.controls.enabled = true;
        this.scene.markDirty();
        this.refreshHud();
        return;
      }
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

    this.selected = id;
    this.scene.setSelected(id);

    if (this.tool === 'inspect') {
      this.setStatus('This branch');
    } else if (this.tool === 'prune') {
      const r = pruneAt(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) {
        this.selected = null;
        this.scene.setSelected(null);
        this.physicsNeedsSync = true;
        this.scene.markDirty();
        this.scene.treeRenderer.pulseToolFeedback('prune');
        void import('../render/audio').then((a) => a.playToolSound('prune'));
      }
    } else if (this.tool === 'pinch') {
      const r = pinchAt(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) {
        this.physicsNeedsSync = true;
        this.scene.markDirty();
        this.scene.treeRenderer.pulseToolFeedback('pinch');
        void import('../render/audio').then((a) => a.playToolSound('pinch'));
      }
    } else if (this.tool === 'wire') {
      const r = applyWire(this.tree, id);
      this.setStatus(r.message);
      this.physicsNeedsSync = true;
      this.scene.markDirty();
      if (r.ok) void import('../render/audio').then((a) => a.playToolSound('wire'));
    } else if (this.tool === 'unwire') {
      const r = removeWire(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) {
        this.physicsNeedsSync = true;
        resetJointElastic(this.physics, id);
        this.scene.markDirty();
        void import('../render/audio').then((a) => a.playToolSound('unwire'));
      }
    }

    this.refreshHud();
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    const hints: Record<ToolMode, string> = {
      inspect: 'Tap a branch · Drag to orbit',
      prune: 'Tap a branch to cut clean',
      pinch: 'Tap a tip to pinch · laterals wake',
      wire: 'Tap to wire, drag to bend · wood holds over time',
      unwire: 'Tap wired wood to remove wire',
    };
    this.hintEl.textContent = hints[tool];
    // Soft fade tool hints after a few seconds
    window.setTimeout(() => {
      if (this.tool === tool && this.hintEl.textContent === hints[tool]) {
        this.hintEl.style.opacity = '0.35';
      }
    }, 4000);
    this.hintEl.style.opacity = '0.85';
  }

  setSpeed(speed: SpeedMode): void {
    this.speed = speed;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
      const raw = btn.dataset.speed!;
      const mode = raw === '0' ? 'pause' : raw;
      btn.classList.toggle('active', mode === speed);
    });
    // Flush pending mesh when pausing so player sees final structure
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
    if (wordEl) wordEl.textContent = vitalityWord(reserves);
    const bar = document.getElementById('info-vitality-bar');
    if (bar) {
      const level = vitalityLevel(reserves);
      bar.style.width = `${Math.round(level * 100)}%`;
      bar.style.background =
        level < 0.25 ? 'var(--danger)' : level < 0.45 ? '#a08a4a' : 'var(--accent)';
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
    const rate = SPEED_PLANT_DAYS_PER_SECOND[this.speed];
    if (rate > 0) {
      this.accum += dt * rate;
      // More substeps when accelerating so plant-time keeps up with wall clock
      const maxSteps =
        this.speed === 'year'
          ? 120
          : this.speed === 'month'
            ? 60
            : this.speed === 'week'
              ? 28
              : 16;
      if (this.accum >= 1) {
        const steps = tickDays(this.tree, this.accum, maxSteps);
        this.accum -= steps;
        if (this.accum < 0) this.accum = 0;
        if (this.accum > maxSteps) this.accum = this.accum % 1;
        this.pendingVisual = true;
        this.physicsNeedsSync = true;
        this.refreshHud();
        this.applySeasonVisuals();
      }
    }

    // Idle chrome fade (~30s) — screenshot harness hard-hides via CSS class on body
    this.idleTimer += dt;
    if (this.statusUnfadeTimer > 0) {
      this.statusUnfadeTimer -= dt;
    } else if (this.idleTimer > 30) {
      document.getElementById('hud')?.classList.add('idle-fade');
    }

    // Rebuild mesh at a capped rate during fast-forward (sim stays full-speed)
    this.visualCooldownTimer += dt;
    const visualInterval =
      this.speed === 'year' || this.speed === 'month'
        ? 0.2
        : this.speed === 'week'
          ? 0.12
          : 0.05;
    if (this.pendingVisual && this.visualCooldownTimer >= visualInterval) {
      this.visualCooldownTimer = 0;
      this.pendingVisual = false;
      this.scene.markDirty();
      this.scene.frameTree(this.tree);
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer > 15) {
      this.autosaveTimer = 0;
      saveLocal(this.tree);
    }

    // Freeze dynamics in ortho audit views so screenshots stay stable
    freezePhysics(this.physics, !this.scene.isPlayView());

    if (this.physicsNeedsSync) {
      this.syncPhysics();
    }

    // Orbit damping first so camera kinematics match what the user sees
    if (this.scene.isPlayView()) {
      this.scene.controls.update();
    }
    const cam = this.scene.sampleCameraMotion(dt);
    stepPhysics(this.physics, this.tree, dt, {
      gravity: true,
      cameraAccel: cam.accel,
      cameraAlpha: cam.alpha,
      enabled: cam.active,
    });

    const liveFrames = computeLiveWorldFrames(this.tree, this.physics);
    this.scene.syncTree(this.tree, liveFrames);
    this.scene.applyTreePose(this.tree, liveFrames);
    this.scene.render(true);
  }
}
