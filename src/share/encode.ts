import LZString from 'lz-string';
import { parseTree, serializeTree } from '../sim/serialize';
import type { TreeState } from '../sim/types';
import {
  isCompactPayload,
  packTreeCompact,
  unpackTreeCompact,
} from './compact';

const HASH_PREFIX = 's=';

/**
 * Max full share URL length before falling back to file download.
 * Hash fragments are not sent to servers, so this can be higher than the
 * classic ~2k GET limit. 32k stays within common browser URL caps while
 * covering ~1-year trees at 2× internode resolution (#83; was 24k).
 */
export const MAX_SHARE_URL_LENGTH = 32_000;

/** Serialize tree to the compact JSON string used inside the share hash. */
export function serializeTreeForShare(tree: TreeState): string {
  return JSON.stringify(packTreeCompact(tree));
}

export function treeToShareHash(tree: TreeState): string {
  const compressed = LZString.compressToEncodedURIComponent(
    serializeTreeForShare(tree),
  );
  return `#${HASH_PREFIX}${compressed}`;
}

/**
 * Decode a share hash. Accepts:
 * - compact transport (current): LZ(JSON array with COMPACT_VERSION)
 * - legacy full TreeState JSON: LZ(serializeTree(...))
 */
export function treeFromShareHash(hash: string): TreeState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  const payload = raw.slice(HASH_PREFIX.length);
  if (!payload) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    const data: unknown = JSON.parse(json);
    if (isCompactPayload(data)) {
      return unpackTreeCompact(data);
    }
    // Legacy full JSON TreeState
    return parseTree(json);
  } catch {
    return null;
  }
}

/**
 * Approximate full share URL length for a tree (origin + path + hash).
 * Used by tests; production uses the real window location when available.
 */
export function estimateShareUrlLength(
  tree: TreeState,
  originPath = 'https://example.com/bonsai-en/',
): number {
  return originPath.length + treeToShareHash(tree).length;
}

/** Origin + pathname for share URLs (no hash). */
export function shareOriginPath(
  loc: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  return `${loc.origin}${loc.pathname}`;
}

export type BuildShareUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'too_large'; length: number };

/**
 * Build an absolute share URL, or report that the tree exceeds the URL budget.
 * Pure given `originPath` (defaults to current location).
 */
export function buildShareUrl(
  tree: TreeState,
  originPath?: string,
): BuildShareUrlResult {
  const base =
    originPath ??
    (typeof window !== 'undefined'
      ? shareOriginPath()
      : 'https://example.com/bonsai-en/');
  const url = `${base}${treeToShareHash(tree)}`;
  if (url.length > MAX_SHARE_URL_LENGTH) {
    return { ok: false, reason: 'too_large', length: url.length };
  }
  return { ok: true, url };
}

export type CopyShareResult =
  | { status: 'copied'; url: string }
  | { status: 'too_large'; length: number }
  | { status: 'clipboard_denied'; url: string };

/** Copy plain text with Clipboard API, falling back to a hidden textarea. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  return copyTextViaExecCommand(text);
}

function copyTextViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build + copy a share link. Distinguishes size limit from clipboard denial
 * so the UI never misreports a permission failure as “tree too large.”
 */
export async function copyShareLink(tree: TreeState): Promise<CopyShareResult> {
  const built = buildShareUrl(tree);
  if (!built.ok) {
    return { status: 'too_large', length: built.length };
  }
  const copied = await copyTextToClipboard(built.url);
  if (copied) {
    return { status: 'copied', url: built.url };
  }
  return { status: 'clipboard_denied', url: built.url };
}

const STORAGE_KEY = 'bonsai-en-autosave';

export function saveLocal(tree: TreeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeTree(tree));
  } catch {
    // quota
  }
}

export function loadLocal(): TreeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseTree(raw);
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  localStorage.removeItem(STORAGE_KEY);
}
