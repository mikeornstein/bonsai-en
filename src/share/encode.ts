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
 * classic ~2k GET limit. 24k stays well under common browser URL caps
 * (~32k–2M depending on engine) while covering ~1-year grown trees.
 */
export const MAX_SHARE_URL_LENGTH = 24_000;

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

export function copyShareLink(tree: TreeState): Promise<boolean> {
  const url = `${window.location.origin}${window.location.pathname}${treeToShareHash(tree)}`;
  if (url.length > MAX_SHARE_URL_LENGTH) {
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(url).then(
    () => true,
    () => false,
  );
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
