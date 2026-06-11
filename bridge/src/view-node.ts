// View-node helpers — a LEAF module (imports only protocol types) so both
// publish.ts and instances.ts can use them without forming a cycle
// (instances.ts is imported by the applier, which connection.ts imports,
// which publish.ts imports — so publish/instances must not pull each other).

import type { DesignNode } from './protocol.ts';

/**
 * The FIRST view-bearing node in a tree — the node whose `view.name` is the
 * controller's CODE identity (drives the generated `<name>.ts` class + the
 * bay's controller component name + the `.prefab` name). Distinct from the
 * registry record's display name.
 */
export function findViewNode(tree: DesignNode[]): DesignNode | null {
  for (const n of tree) {
    if (n.view?.name) return n;
    const inner = findViewNode(n.children);
    if (inner) return inner;
  }
  return null;
}

/** The view node's `view.name`, or null when the tree has no marked component. */
export function viewNodeName(tree: DesignNode[]): string | null {
  return findViewNode(tree)?.view?.name ?? null;
}

/**
 * Immutably set the FIRST view-bearing node's `view.name` (the same node
 * `viewNodeName` reports) to `newName`. Used by true rename to retag the tree
 * so the regenerated controller, the bay component, and the registry record
 * all move to the new code identity together.
 */
export function retagViewNode(tree: DesignNode[], newName: string): DesignNode[] {
  let done = false;
  const walk = (nodes: DesignNode[]): DesignNode[] =>
    nodes.map((n) => {
      if (done) return n;
      if (n.view?.name) {
        done = true;
        return { ...n, view: { ...n.view, name: newName } };
      }
      return { ...n, children: walk(n.children) };
    });
  return walk(tree);
}
