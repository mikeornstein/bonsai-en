/**
 * Quiet optional audio — mute-by-default room tone + soft tool ticks.
 * Respects autoplay policies; never spams console if blocked.
 */

let ctx: AudioContext | null = null;
let muted = true; // quiet by default
let roomGain: GainNode | null = null;
let roomStarted = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        /* autoplay blocked — stay silent */
      });
    }
    return ctx;
  } catch {
    return null;
  }
}

export function setMuted(on: boolean): void {
  muted = on;
  if (roomGain) roomGain.gain.value = muted ? 0 : 0.012;
}

export function isMuted(): boolean {
  return muted;
}

/** Toggle mute; returns new muted state. */
export function toggleMute(): boolean {
  setMuted(!muted);
  if (!muted) startRoomTone();
  return muted;
}

/** Very low room tone (optional). Off until unmute. */
export function startRoomTone(): void {
  if (muted || roomStarted) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    roomGain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 68;
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    roomGain.gain.value = 0.012;
    osc.connect(filter);
    filter.connect(roomGain);
    roomGain.connect(c.destination);
    osc.start();
    roomStarted = true;
  } catch {
    /* ignore */
  }
}

export type ToolSound = 'prune' | 'pinch' | 'wire' | 'unwire';

/** Soft one-shot tool feedback — low volume, no music. */
export function playToolSound(kind: ToolSound): void {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.connect(g);
    g.connect(c.destination);

    if (kind === 'prune') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, t0);
      osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.start(t0);
      osc.stop(t0 + 0.13);
    } else if (kind === 'pinch') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    } else {
      // wire / unwire — soft metallic tick
      osc.type = 'square';
      osc.frequency.setValueAtTime(kind === 'wire' ? 880 : 640, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      osc.start(t0);
      osc.stop(t0 + 0.06);
    }
  } catch {
    /* ignore blocked / missing audio */
  }
}
