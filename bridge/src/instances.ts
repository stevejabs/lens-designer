// Shared-component instance expansion (scope doc 2026-06-09, backlog 13).
//
// An Instance node is a LEAF reference to another saved view (the DEFINITION).
// The authored tree keeps the reference (registry stores it unexpanded; the
// canvas renders it from its own definition cache); the BRIDGE expands it into
// the definition's real subtree right before any scene apply. Because
// expansion re-reads the definition from the registry every apply, editing a
// definition propagates to every instance with zero re-wiring — the diff
// applier sees changed content (the expansion is folded into subtree hashes)
// and rebuilds exactly the affected instances.
//
// Expansion rules:
//   - The expanded node KEEPS the instance node's id (diff/reconcile
//     stability) and its placement (position/rotation), but takes everything
//     else — type, properties, view marker, interaction, states, layout,
//     children — from the definition's view root. The view marker is what
//     makes applyControllers attach the definition's generated controller to
//     the instance at runtime (that's the typed child controller).
//   - Definition children get derived ids `<instanceId>::<defChildId>` so two
//     instances of the same definition never collide in per-node material
//     names or diff state.
//   - Slot overrides: a def child carrying `binding.key` listed in
//     `overrides.slots` gets its text (Text) or imageSource (Image) replaced.
//     `overrides.actionKey` replaces the def root's interaction actionKey.
//   - Cycles (A instancing B instancing A, or self-reference) collapse to an
//     empty placeholder Group + a warning — never infinite recursion.
//   - A missing definition collapses to a placeholder too (the view was
//     deleted out from under its instances; delete-protection in the daemon
//     makes this rare).

import type { DesignNode } from './protocol.ts';
import type { ViewRegistry } from './registry.ts';
import { findViewNode } from './view-node.ts';

export interface ExpandResult {
  tree: DesignNode[];
  warnings: string[];
}

/** True when any node in the tree is an instance reference (cheap pre-check
 *  so instance-free applies skip the registry read entirely). */
export function treeHasInstances(tree: DesignNode[]): boolean {
  for (const n of tree) {
    if (n.instance) return true;
    if (treeHasInstances(n.children)) return true;
  }
  return false;
}

/** Every definition view-id referenced by instances in the tree (deduped).
 *  Used for delete-protection and the stale-dependents computation. */
export function collectInstanceRefs(tree: DesignNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: DesignNode[]): void => {
    for (const n of nodes) {
      if (n.instance) out.add(n.instance.of);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Expand every Instance node into its definition's subtree. Pure given the
 *  registry snapshot. */
export function expandInstances(tree: DesignNode[], reg: ViewRegistry): ExpandResult {
  const warnings: string[] = [];
  const expanded = expandLevel(tree, reg, warnings, []);
  return { tree: expanded, warnings };
}

function expandLevel(
  nodes: DesignNode[],
  reg: ViewRegistry,
  warnings: string[],
  seenDefIds: string[],
): DesignNode[] {
  return nodes.map((n) => {
    if (!n.instance) {
      return n.children.length > 0
        ? { ...n, children: expandLevel(n.children, reg, warnings, seenDefIds) }
        : n;
    }
    return expandOne(n, reg, warnings, seenDefIds);
  });
}

function expandOne(
  node: DesignNode,
  reg: ViewRegistry,
  warnings: string[],
  seenDefIds: string[],
): DesignNode {
  const ref = node.instance!;
  const rec = reg.views.find((v) => v.id === ref.of);
  if (!rec) {
    warnings.push(`instance "${node.name}" references a deleted view (${ref.of}) — placeholder`);
    return placeholder(node);
  }
  if (seenDefIds.includes(rec.id)) {
    warnings.push(
      `instance cycle: "${rec.name}" (${seenDefIds.length} deep) references itself — placeholder`,
    );
    return placeholder(node);
  }
  const defRoot = findViewNode(rec.tree);
  if (!defRoot) {
    warnings.push(`instance "${node.name}": view "${rec.name}" has no marked component — placeholder`);
    return placeholder(node);
  }

  const slots = ref.overrides?.slots ?? {};
  const children = expandLevel(
    cloneWithOverrides(defRoot.children, node.id, slots),
    reg,
    warnings,
    [...seenDefIds, rec.id],
  );

  const interaction = defRoot.interaction
    ? {
        ...defRoot.interaction,
        ...(ref.overrides?.actionKey !== undefined ? { actionKey: ref.overrides.actionKey } : {}),
      }
    : undefined;

  return {
    id: node.id, // stable — diff/reconcile + material slot names key off it
    type: defRoot.type,
    name: node.name,
    transform: node.transform,
    properties: {
      ...defRoot.properties,
      // Placement comes from the instance; content geometry from the def.
      position: node.properties['position'] ?? { x: 0, y: 0 },
      rotation: node.properties['rotation'] ?? 0,
    },
    ...(defRoot.view ? { view: defRoot.view } : {}),
    ...(interaction ? { interaction } : {}),
    ...(defRoot.stateOverrides ? { stateOverrides: defRoot.stateOverrides } : {}),
    ...(defRoot.layout ? { layout: defRoot.layout } : {}),
    children,
  };
}

/** Deep-clone def children with instance-derived ids + slot overrides. */
function cloneWithOverrides(
  nodes: DesignNode[],
  instanceId: string,
  slots: Record<string, unknown>,
): DesignNode[] {
  return nodes.map((n) => {
    let properties = n.properties;
    if (n.binding && Object.prototype.hasOwnProperty.call(slots, n.binding.key)) {
      const v = slots[n.binding.key];
      if (n.type === 'Text' && typeof v === 'string') {
        properties = { ...properties, text: v };
      } else if (n.type === 'Image' && typeof v === 'string') {
        properties = { ...properties, imageSource: v };
      }
    }
    return {
      ...n,
      id: `${instanceId}::${n.id}`,
      properties,
      children: cloneWithOverrides(n.children, instanceId, slots),
    };
  });
}

/** An empty stand-in that keeps the instance's id + placement so the apply
 *  succeeds and the layer slot stays occupied. */
function placeholder(node: DesignNode): DesignNode {
  return {
    id: node.id,
    type: 'Group',
    name: node.name,
    transform: node.transform,
    properties: {
      position: node.properties['position'] ?? { x: 0, y: 0 },
      rotation: node.properties['rotation'] ?? 0,
    },
    children: [],
  };
}
