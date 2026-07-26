import { Game } from './app/game';

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

try {
  const game = new Game(canvas);

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
