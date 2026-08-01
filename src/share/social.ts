/**
 * Outbound share helpers: draft copy, X intent, Web Share, image download.
 * No Three.js — pure strings and browser APIs.
 */

/** Short zen draft for Messages / X (URL passed separately when possible). */
export function shareDraftText(): string {
  return 'A juniper I’ve been training in bonsai-en';
}

/** Full share body when a platform wants text+url in one field. */
export function shareDraftWithUrl(url: string | null | undefined): string {
  const line = shareDraftText();
  if (!url) return line;
  return `${line}\n${url}`;
}

/**
 * X / Twitter web intent compose URL.
 * Image attach is not supported by intent — caller should download a portrait
 * and prompt the user to attach in the compose window.
 */
export function xIntentUrl(opts: {
  text: string;
  url?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set('text', opts.text);
  if (opts.url) params.set('url', opts.url);
  // x.com intent is the current surface; twitter.com still redirects.
  return `https://x.com/intent/post?${params.toString()}`;
}

export type SystemShareResult =
  | 'shared'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

export function canSystemShare(
  data: ShareData,
  nav: Navigator = typeof navigator !== 'undefined'
    ? navigator
    : ({} as Navigator),
): boolean {
  if (typeof nav.share !== 'function') return false;
  if (typeof nav.canShare === 'function') {
    try {
      return nav.canShare(data);
    } catch {
      return false;
    }
  }
  // No canShare — assume text/url share works when share exists.
  if (data.files && data.files.length > 0) return false;
  return true;
}

/** Prefer files+url when allowed; otherwise text/url only. */
export function pickShareData(opts: {
  title?: string;
  text: string;
  url?: string | null;
  file?: File | null;
  nav?: Navigator;
}): ShareData | null {
  const nav =
    opts.nav ??
    (typeof navigator !== 'undefined' ? navigator : ({} as Navigator));
  const base: ShareData = {
    title: opts.title ?? 'Bonsai-en',
    text: opts.text,
  };
  if (opts.url) base.url = opts.url;

  if (opts.file) {
    const withFile: ShareData = { ...base, files: [opts.file] };
    if (canSystemShare(withFile, nav)) return withFile;
  }
  if (canSystemShare(base, nav)) return base;
  return null;
}

export async function systemShare(
  data: ShareData,
  nav: Navigator = typeof navigator !== 'undefined'
    ? navigator
    : ({} as Navigator),
): Promise<SystemShareResult> {
  if (typeof nav.share !== 'function') return 'unavailable';
  try {
    await nav.share(data);
    return 'shared';
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  // Delay revoke so the download can start on slow devices
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function blobToShareFile(
  blob: Blob,
  filename = 'bonsai-en.png',
): File {
  return new File([blob], filename, {
    type: blob.type || 'image/png',
    lastModified: Date.now(),
  });
}

export function portraitFilename(speciesId = 'juniper'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `bonsai-en-${speciesId}-${stamp}.png`;
}
