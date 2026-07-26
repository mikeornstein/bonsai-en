import { describeNode, tickDays } from '../sim/growth';
import {
  SPEED_PLANT_DAYS_PER_SECOND,
  environmentAt,
  formatAge,
  seasonLabel,
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

export type ToolMode = 'inspect' | 'prune' | 'pinch' | 'wire' | 'unwire';

export class Game {
  tree: TreeState;
  scene: BonsaiScene;
  tool: ToolMode = 'inspect';
  speed: SpeedMode = 'live';
  selected: NodeId | null = null;

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
    this.refreshHud();
    this.scene.markDirty();
    // Defer mesh build so HUD/buttons paint immediately
    requestAnimationFrame(() => {
      try {
        this.scene.syncTree(this.tree);
        this.scene.frameTree(this.tree);
      } catch (err) {
        console.error('[bonsai-en] initial tree sync failed', err);
        this.setStatus(`Tree render failed: ${(err as Error).message}`);
      }
    });
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

    document.getElementById('btn-new')?.addEventListener('click', () => {
      if (confirm('Start a new juniper sapling? Unsaved changes may be lost.')) {
        this.tree = createSapling();
        this.selected = null;
        clearLocal();
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this.scene.setSelected(null);
        this.scene.markDirty();
        this.scene.syncTree(this.tree);
        this.scene.frameTree(this.tree);
        this.setStatus('New juniper sapling');
        this.refreshHud();
      }
    });

    document.getElementById('btn-save')?.addEventListener('click', () => {
      saveLocal(this.tree);
      this.setStatus('Saved to this browser');
    });

    document.getElementById('btn-export')?.addEventListener('click', () => {
      downloadTree(this.tree);
      this.setStatus('Exported JSON');
    });

    const fileInput = document.getElementById('import-file') as HTMLInputElement;
    document.getElementById('btn-import')?.addEventListener('click', () => {
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
        this.scene.markDirty();
        saveLocal(this.tree);
        this.setStatus(`Imported ${file.name}`);
        this.refreshHud();
      } catch (e) {
        this.setStatus(`Import failed: ${(e as Error).message}`);
      }
      fileInput.value = '';
    });

    document.getElementById('btn-share')?.addEventListener('click', async () => {
      const ok = await copyShareLink(this.tree);
      if (ok) {
        this.setStatus('Share link copied to clipboard');
      } else {
        downloadTree(this.tree);
        this.setStatus('Tree too large for URL — downloaded file instead');
      }
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
      this.setStatus(`Selected ${id}`);
    } else if (this.tool === 'prune') {
      const r = pruneAt(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) {
        this.selected = null;
        this.scene.setSelected(null);
        this.scene.markDirty();
      }
    } else if (this.tool === 'pinch') {
      const r = pinchAt(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) this.scene.markDirty();
    } else if (this.tool === 'wire') {
      const r = applyWire(this.tree, id);
      this.setStatus(r.message);
      this.scene.markDirty();
    } else if (this.tool === 'unwire') {
      const r = removeWire(this.tree, id);
      this.setStatus(r.message);
      if (r.ok) this.scene.markDirty();
    }

    this.refreshHud();
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    const hints: Record<ToolMode, string> = {
      inspect: 'Tap a branch to inspect · Drag to orbit',
      prune: 'Tap a branch to prune it and everything beyond',
      pinch: 'Tap a tip to soft-pinch and encourage back-budding',
      wire: 'Tap to wire, then drag to bend · Leave wire on while wood sets',
      unwire: 'Tap a wired branch to remove wire (partial spring-back if unset)',
    };
    this.hintEl.textContent = hints[tool];
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
  }

  refreshHud(): void {
    const env = environmentAt(this.tree.agePlantDays);
    const species = getSpecies(this.tree.speciesId);
    document.getElementById('info-age')!.textContent = formatAge(
      this.tree.agePlantDays,
    );
    document.getElementById('info-season')!.textContent = seasonLabel(env.season);
    document.getElementById('info-reserves')!.textContent =
      this.tree.reserves.toFixed(1);
    document.getElementById('info-nodes')!.textContent = String(
      Object.keys(this.tree.nodes).length,
    );
    const sel = document.getElementById('info-selection')!;
    if (this.selected && this.tree.nodes[this.selected]) {
      sel.textContent = describeNode(this.tree, this.selected);
    } else {
      sel.textContent = `${species.commonName} · select a branch`;
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
        this.refreshHud();
      }
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

    this.scene.syncTree(this.tree);
    this.scene.render();
  }
}
