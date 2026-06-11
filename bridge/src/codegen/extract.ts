// Binding extraction — walks a design tree and produces, per View root, a
// structural manifest the codegen renders into a typed controller class.
//
// A View is a node tagged `view` (a group marked "Export as component"). Inside
// it, nodes tagged `binding` become named slots, nodes with `interaction` become
// interactives, and any element carrying `stateOverrides` becomes a per-state
// override target under its nearest interactive ancestor. Each is located by a
// child-index PATH from the View root, which the runtime controller resolves via
// getChild(i) — stable because the applier materializes children in tree order
// (one SceneObject per node). v1b: per-element per-state overrides replace the
// old uniform colorStates + visibleInStates. See architecture TD-1 / TD-8.

import type { DesignNode, InteractionRole } from '../protocol.ts';
import { resolveLSWrites, stateTransformDelta, type LSWrite, type Vec2Like } from '../resolve-writes.ts';

// Binding keys that collide with members already on the generated controller
// (LS BaseScriptComponent + the controller's own surface), so they can't be
// used verbatim as a `view.<key>` property without breaking the LS compile.
// Mirrors web/lib/design-model.ts RESERVED_BINDING_KEYS — keep in sync.
// Verified against LS 5.15.4 BaseScriptComponent.d.ts, 2026-06-05.
const RESERVED_BINDING_KEYS = new Set<string>([
  'api', 'enabled', 'isEnabledInHierarchy', 'name', 'uniqueIdentifier',
  'updatePriority', 'sceneObject', 'createEvent', 'destroy',
  'getReferencedEvents', 'getSceneObject', 'getTransform', 'getTypeName',
  'isOfType', 'isSame', 'removeEvent',
  'init', 'onAwake', 'onPinch', 'onPinchEnd', 'onPinchCancel',
  'onPinchEndOutside', 'onToggle',
]);

export interface SlotRef {
  /** Handle name on the controller (from binding.key). */
  key: string;
  /** Primitive type, e.g. 'Rectangle' | 'Text' | 'Image' — drives the handle
   *  kind. 'Instance' = a shared-component instance: the handle is a typed
   *  getter returning the child controller (`viewClass`). */
  nodeType: string;
  /** Child-index path from the View root ([] = the root itself). */
  path: number[];
  /** For 'Instance' slots: the definition's controller class name. Unresolved
   *  (unknown def) → the slot is dropped with a warning. */
  viewClass?: string;
}

/** Resolved writes for one element in one interaction state. */
export interface StateWrites {
  /** Color / stroke / strokeWidth / textColor / visible — resolved to LS values
   *  via the shared resolveLSWrites (parity with the applier). */
  writes: LSWrite[];
  /** Per-state transform delta (applied at runtime against captured base). */
  position?: Vec2Like;
  scale?: Vec2Like;
}

/** An element under an interactive that changes appearance per state. */
export interface OverrideTarget {
  /** Child-index path from the View root. */
  path: number[];
  nodeType: string;
  hover?: StateWrites;
  pinched?: StateWrites;
  disabled?: StateWrites;
}

/** A node that becomes interactive at runtime, plus its subtree's per-state
 *  override targets (applied by the controller on SIK state transitions). */
export interface InteractiveRef {
  path: number[];
  role: InteractionRole;
  actionKey?: string;
  overrideTargets: OverrideTarget[];
}

/** One child of a hug group, for the runtime re-layout (WB-L). */
export interface HugChildRef {
  path: number[];
  /** Stretches to the hugged bounds (background) vs flowed content. */
  fill: boolean;
  /** Text children are re-measured via getBoundingBox at runtime. */
  isText: boolean;
}

/** A group with a hug `layout` — the controller re-flows it when content changes. */
export interface HugGroupRef {
  path: number[];
  mode: 'row' | 'column';
  spacing: number;
  padding: { x: number; y: number };
  children: HugChildRef[];
}

export interface ViewManifest {
  /** Controller class name (from view.name). */
  name: string;
  /** Design-tree node id of the View root (for traceability). */
  rootNodeId: string;
  slots: SlotRef[];
  interactives: InteractiveRef[];
  /** Hug groups — re-flowed at runtime on content change (WB-L). */
  hugGroups: HugGroupRef[];
  /** Non-fatal issues (duplicate keys, empty View, …) surfaced to the user. */
  warnings: string[];
}

/** Extract a ViewManifest for every View root in the tree. */
/**
 * @param instanceClasses shared components: definition view-id → controller
 *   class name, so an Instance slot can emit a typed child-controller getter.
 */
export function extractViews(
  tree: DesignNode[],
  instanceClasses?: Map<string, string>,
): ViewManifest[] {
  const views: ViewManifest[] = [];
  const visit = (node: DesignNode): void => {
    if (node.view) views.push(extractOneView(node, instanceClasses));
    for (const c of node.children) visit(c);
  };
  for (const n of tree) visit(n);
  return views;
}

/** Build the per-state StateWrites for a node from its stateOverrides. Returns
 *  undefined when the node has no overrides. */
function statesFor(node: DesignNode): Pick<OverrideTarget, 'hover' | 'pinched' | 'disabled'> | undefined {
  const so = node.stateOverrides;
  if (!so) return undefined;
  const build = (state: 'hover' | 'pinched' | 'disabled'): StateWrites | undefined => {
    const props = so[state];
    if (!props) return undefined;
    const writes = resolveLSWrites(node, props);
    const delta = stateTransformDelta(props);
    const out: StateWrites = { writes };
    if (delta.position) out.position = delta.position;
    if (delta.scale) out.scale = delta.scale;
    // Skip a target that produced no writes and no transform (e.g. only props
    // the element type doesn't support).
    if (writes.length === 0 && !out.position && !out.scale) return undefined;
    return out;
  };
  const hover = build('hover');
  const pinched = build('pinched');
  const disabled = build('disabled');
  if (!hover && !pinched && !disabled) return undefined;
  return {
    ...(hover ? { hover } : {}),
    ...(pinched ? { pinched } : {}),
    ...(disabled ? { disabled } : {}),
  };
}

/** Collect override targets in `root`'s subtree, NOT descending into a nested
 *  interactive (it owns its own) or a nested View. */
function collectOverrideTargets(root: DesignNode, basePath: number[]): OverrideTarget[] {
  const targets: OverrideTarget[] = [];
  const walk = (n: DesignNode, path: number[], isRoot: boolean): void => {
    if (!isRoot && (n.interaction || n.view)) return; // boundary: nested interactive/View owns its own
    const states = statesFor(n);
    if (states) targets.push({ path, nodeType: n.type, ...states });
    for (let i = 0; i < n.children.length; i++) walk(n.children[i]!, [...path, i], false);
  };
  walk(root, basePath, true);
  return targets;
}

function extractOneView(root: DesignNode, instanceClasses?: Map<string, string>): ViewManifest {
  const slots: SlotRef[] = [];
  const interactives: InteractiveRef[] = [];
  const hugGroups: HugGroupRef[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();
  const seenActions = new Set<string>();

  const walk = (node: DesignNode, path: number[], isRoot: boolean): void => {
    // A shared-component instance is a boundary: its own controller attaches
    // at runtime (the expansion carries the definition's view marker). When
    // bound, it becomes a typed child-controller slot on THIS view.
    if (node.instance) {
      if (node.binding) {
        const key = node.binding.key;
        if (RESERVED_BINDING_KEYS.has(key.trim())) {
          warnings.push(
            `binding key "${key}" is reserved by Lens Studio (a controller member) — ` +
              `rename it or the generated controller won't compile`,
          );
        } else if (seenKeys.has(key)) {
          warnings.push(`duplicate binding key "${key}" — only the first is used`);
        } else {
          const viewClass = instanceClasses?.get(node.instance.of);
          if (!viewClass) {
            warnings.push(
              `instance slot "${key}" references an unknown component — slot dropped`,
            );
          } else {
            seenKeys.add(key);
            slots.push({ key, nodeType: 'Instance', path, viewClass });
          }
        }
      }
      return; // never descend — the instance is a leaf reference
    }
    // A nested View root ends this View's scope — it gets its own controller.
    if (!isRoot && node.view) {
      warnings.push(`nested View "${node.view.name}" inside "${root.view?.name}" — it gets its own controller and is not part of this one`);
      return;
    }
    if (node.binding) {
      if (RESERVED_BINDING_KEYS.has(node.binding.key.trim())) {
        warnings.push(
          `binding key "${node.binding.key}" is reserved by Lens Studio (a controller member) — ` +
            `rename it or the generated controller won't compile`,
        );
      } else if (seenKeys.has(node.binding.key)) {
        warnings.push(`duplicate binding key "${node.binding.key}" — only the first is used`);
      } else {
        seenKeys.add(node.binding.key);
        slots.push({ key: node.binding.key, nodeType: node.type, path });
      }
    }
    if (node.interaction) {
      const it = node.interaction;
      if (it.actionKey && seenActions.has(it.actionKey)) {
        warnings.push(`duplicate action key "${it.actionKey}" — only the first is used`);
      } else {
        if (it.actionKey) seenActions.add(it.actionKey);
        interactives.push({
          path,
          role: it.role,
          ...(it.actionKey ? { actionKey: it.actionKey } : {}),
          overrideTargets: collectOverrideTargets(node, path),
        });
      }
    }
    if (node.layout?.hug) {
      hugGroups.push({
        path,
        mode: node.layout.mode,
        spacing: node.layout.spacing,
        padding: node.layout.padding,
        children: node.children.map((c, i) => ({
          path: [...path, i],
          fill: !!c.fillParent,
          isText: c.type === 'Text',
        })),
      });
    }
    for (let i = 0; i < node.children.length; i++) walk(node.children[i]!, [...path, i], false);
  };
  walk(root, [], true);

  if (slots.length === 0 && interactives.length === 0) {
    warnings.push(`View "${root.view?.name}" has no bound slots or interactions`);
  }

  return { name: root.view?.name ?? 'View', rootNodeId: root.id, slots, interactives, hugGroups, warnings };
}
