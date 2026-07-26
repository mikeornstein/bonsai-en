import LZString from 'lz-string';
import { parseTree, serializeTree } from '../sim/serialize';
import type { TreeState } from '../sim/types';

const HASH_PREFIX = 's=';

export function treeToShareHash(tree: TreeState): string {
  const compressed = LZString.compressToEncodedURIComponent(serializeTree(tree));
  return `#${HASH_PREFIX}${compressed}`;
}

export function treeFromShareHash(hash: string): TreeState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  const payload = raw.slice(HASH_PREFIX.length);
  if (!payload) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    return parseTree(json);
  } catch {
    return null;
  }
}

export function copyShareLink(tree: TreeState): Promise<boolean> {
  const url = `${window.location.origin}${window.location.pathname}${treeToShareHash(tree)}`;
  if (url.length > 8000) {
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
