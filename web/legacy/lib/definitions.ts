'use client';

// Shared-component definition cache. The canvas renders an Instance node by
// drawing its DEFINITION's tree read-only, and the Inspector enumerates the
// definition's bound slots for per-instance overrides — both need other
// views' trees, which the registry holds bridge-side. use-attach-mode fetches
// them via `view.get` (on attach, list refreshes, and saves) and writes them
// here. NOT persisted — refetched per session, so it never goes stale across
// projects.

import { create } from 'zustand';
import type { DesignNode } from '@lens-designer/bridge/client';

export interface DefinitionEntry {
  codeName: string;
  tree: DesignNode[];
}

interface DefinitionsState {
  defs: Record<string, DefinitionEntry>;
  setDef: (id: string, entry: DefinitionEntry) => void;
  removeDef: (id: string) => void;
  clear: () => void;
}

export const useDefinitions = create<DefinitionsState>((set) => ({
  defs: {},
  setDef: (id, entry) => set((s) => ({ defs: { ...s.defs, [id]: entry } })),
  removeDef: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.defs;
      return { defs: rest };
    }),
  clear: () => set({ defs: {} }),
}));

/** The definition's view-root node (the marked component group), or null. */
export function defRootNode(entry: DefinitionEntry | undefined): DesignNode | null {
  if (!entry) return null;
  const find = (nodes: DesignNode[]): DesignNode | null => {
    for (const n of nodes) {
      if (n.view?.name) return n;
      const inner = find(n.children);
      if (inner) return inner;
    }
    return null;
  };
  return find(entry.tree);
}

/** Definition view-ids that `viewId`'s tree references (directly). */
function directRefs(defs: Record<string, DefinitionEntry>, viewId: string): Set<string> {
  const out = new Set<string>();
  const entry = defs[viewId];
  if (!entry) return out;
  const walk = (nodes: DesignNode[]): void => {
    for (const n of nodes) {
      if (n.instance) out.add(n.instance.of);
      walk(n.children);
    }
  };
  walk(entry.tree);
  return out;
}

/**
 * True when making `candidateId` a component inside `hostId` would create a
 * cycle — i.e. candidate (transitively) instances host. Used by the palette to
 * exclude self + ancestors. Conservative on missing data (unknown trees → no
 * cycle claimed; the bridge expansion still guards at apply time).
 */
export function wouldCycle(
  defs: Record<string, DefinitionEntry>,
  hostId: string,
  candidateId: string,
): boolean {
  if (hostId === candidateId) return true;
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const ref of directRefs(defs, cur)) {
      if (ref === hostId) return true;
      stack.push(ref);
    }
  }
  return false;
}

/** Bounding box (cm, centered) of a definition's content — seeds the instance
 *  node's `size` so canvas hit-testing/selection matches what's drawn. */
export function defBoundsCm(entry: DefinitionEntry | undefined): { w: number; h: number } {
  const root = defRootNode(entry);
  if (!root || root.children.length === 0) return { w: 8, h: 4 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const sizeOf = (n: DesignNode): { w: number; h: number } => {
    const s = n.properties['size'] as { x?: number; y?: number } | undefined;
    return { w: typeof s?.x === 'number' ? s.x : 8, h: typeof s?.y === 'number' ? s.y : 4 };
  };
  for (const c of root.children) {
    const p = c.properties['position'] as { x?: number; y?: number } | undefined;
    const px = typeof p?.x === 'number' ? p.x : 0;
    const py = typeof p?.y === 'number' ? p.y : 0;
    const { w, h } = sizeOf(c);
    xMin = Math.min(xMin, px - w / 2);
    xMax = Math.max(xMax, px + w / 2);
    yMin = Math.min(yMin, py - h / 2);
    yMax = Math.max(yMax, py + h / 2);
  }
  return { w: Math.max(1, xMax - xMin), h: Math.max(1, yMax - yMin) };
}
