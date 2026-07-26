import type { TreeState } from './types';

export const SCHEMA_VERSION = 1 as const;

export function serializeTree(tree: TreeState): string {
  return JSON.stringify(tree);
}

export function parseTree(json: string): TreeState {
  const data = JSON.parse(json) as TreeState;
  if (!data || data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported save version: ${String((data as TreeState)?.schemaVersion)}`,
    );
  }
  if (!data.nodes || !data.rootId || !data.speciesId) {
    throw new Error('Invalid tree save data');
  }
  return data;
}

export function downloadTree(tree: TreeState, filename?: string): void {
  const blob = new Blob([serializeTree(tree)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `bonsai-${tree.speciesId}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
