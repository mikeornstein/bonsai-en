import { Game } from './app/game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas #c not found');
}

const game = new Game(canvas);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
