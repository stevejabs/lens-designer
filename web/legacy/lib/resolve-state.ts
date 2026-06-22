// resolveForState — the web canvas's per-state merge for in-editor preview
// (WB2). Given a node and the active edit-state, returns a node whose
// `properties` reflect that state's overrides, so the existing NodeView renderer
// shows hover/pinch/disabled without any renderer changes.
//
// This is the PREVIEW merge (web/SVG). The on-device truth is resolveLSWrites
// (bridge, TD-8) + the runtime state controller; the two are kept consistent by
// using the same override semantics: colors/strokeWidth/textColor REPLACE,
// `position` is a DELTA from base, `scale` a MULTIPLIER, `visible:false` hides.

import type { DesignNode, InteractionState, StateProps } from '@lens-designer/bridge/client';

type OverrideState = 'hover' | 'pinched' | 'disabled';

function readVec2(v: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  if (typeof v === 'object' && v !== null && 'x' in v && 'y' in v) {
    const o = v as Record<string, unknown>;
    return {
      x: typeof o['x'] === 'number' ? o['x'] : fallback.x,
      y: typeof o['y'] === 'number' ? o['y'] : fallback.y,
    };
  }
  return fallback;
}

/**
 * Merge a node's base properties with its overrides for `state`. Returns the
 * node unchanged for `default` or when there's no override for the state, so the
 * common path allocates nothing.
 */
export function resolveForState(node: DesignNode, state: InteractionState): DesignNode {
  if (state === 'default' || !node.stateOverrides) return node;
  const ov: StateProps | undefined = node.stateOverrides[state as OverrideState];
  if (!ov) return node;

  const props = { ...node.properties };

  // Replace-semantics props.
  if (ov.fillColor !== undefined) props['fillColor'] = ov.fillColor;
  if (ov.strokeColor !== undefined) props['strokeColor'] = ov.strokeColor;
  if (ov.strokeWidth !== undefined) props['strokeWidth'] = ov.strokeWidth;
  if (ov.opacity !== undefined) props['opacity'] = ov.opacity;
  // Text color is stored under `fillColor` in a Text node's properties.
  if (ov.textColor !== undefined) props['fillColor'] = ov.textColor;

  // position: delta from base.
  if (ov.position) {
    const base = readVec2(props['position'], { x: 0, y: 0 });
    props['position'] = { x: base.x + ov.position.x, y: base.y + ov.position.y };
  }
  // scale: multiplier on the element's visual size (preview-equivalent to the
  // runtime's SO-scale multiply).
  if (ov.scale) {
    const size = readVec2(props['size'], { x: 0, y: 0 });
    props['size'] = { x: size.x * ov.scale.x, y: size.y * ov.scale.y };
  }
  // visible:false → collapse to opacity 0 (the renderer already hides at 0),
  // so no NodeView change is needed for show/hide.
  if (ov.visible === false) props['opacity'] = 0;

  return { ...node, properties: props };
}

/** Resolve a whole tree for a state (children recurse). Identity for `default`. */
export function resolveTreeForState(nodes: DesignNode[], state: InteractionState): DesignNode[] {
  if (state === 'default') return nodes;
  return nodes.map((n) => {
    const r = resolveForState(n, state);
    const children = resolveTreeForState(n.children, state);
    return children === n.children ? r : { ...r, children };
  });
}
