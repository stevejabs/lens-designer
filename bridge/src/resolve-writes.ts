// resolve-writes — the single source of truth for "designer property → Lens
// Studio write". Both the live applier and the controller codegen call this, so
// the WYSIWYG preview and the exported runtime can't drift (architecture TD-8).
//
// Browser-safe: no node:* imports. The web canvas does its own lightweight
// merge for preview (resolveForState), but the LS-target resolution lives here.

import type { DesignNode, Rgba, StateProps, StatePropKey } from './protocol.ts';
import { getManifest, type PropertyMapping, type PropertyTransform } from './manifests/index.ts';

export interface Vec2Like {
  x: number;
  y: number;
}
export interface Vec3Like extends Vec2Like {
  z: number;
}
export interface RgbaColor {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
  a: number; // 0–100 (percent)
}

export function isVec2(v: unknown): v is Vec2Like {
  return (
    typeof v === 'object' && v !== null
    && typeof (v as Vec2Like).x === 'number'
    && typeof (v as Vec2Like).y === 'number'
  );
}
export function isVec3(v: unknown): v is Vec3Like {
  return isVec2(v) && typeof (v as Vec3Like).z === 'number';
}
export function isRgba(v: unknown): v is RgbaColor {
  return (
    typeof v === 'object' && v !== null
    && typeof (v as RgbaColor).r === 'number'
    && typeof (v as RgbaColor).g === 'number'
    && typeof (v as RgbaColor).b === 'number'
    && typeof (v as RgbaColor).a === 'number'
  );
}

export const DEG_TO_RAD = Math.PI / 180;

export interface ResolveValueContext {
  layerZ: number;
  /** 0–1, blended into color writes (the opacity-into-alpha fold). */
  opacity: number;
  /** Node's size (vec2 cm). Used by cm-to-unit-norm to normalize stroke/radius. */
  sizeCm: { x: number; y: number } | null;
}

/**
 * Compute the final value to write to LS for a single PropertyMapping.
 * Knows how to:
 *   - pad vec2 → vec3 (inject layerZ for position; force z=1 for scale)
 *   - splat a number rotation into a vec3 Euler around Z
 *   - convert RGBA → vec4 (blends opacity into alpha)
 *   - normalize percent → 0–1
 *   - convert degrees → radians
 */
export function resolveMappingValue(
  mapping: PropertyMapping,
  sourceValue: unknown,
  ctx: ResolveValueContext,
): unknown {
  const t: PropertyTransform = mapping.transform ?? 'identity';

  // Special-case the SO transform targets that don't share a shape with
  // their designer property:
  if (mapping.target === 'localTransform.position') {
    if (!isVec2(sourceValue)) {
      throw new TypeError(`position source must be {x,y} (got ${JSON.stringify(sourceValue)})`);
    }
    return { x: sourceValue.x, y: sourceValue.y, z: ctx.layerZ };
  }
  if (mapping.target === 'localTransform.rotation') {
    if (typeof sourceValue !== 'number') {
      throw new TypeError(`rotation source must be number (got ${typeof sourceValue})`);
    }
    // LS's editor localTransform.rotation Euler is in DEGREES (verified
    // on-device 2026-05-24). Pass the designer's degrees straight through.
    return { x: 0, y: 0, z: sourceValue };
  }
  if (mapping.target === 'localTransform.scale') {
    if (!isVec2(sourceValue)) {
      throw new TypeError(`scale source must be {x,y} (got ${JSON.stringify(sourceValue)})`);
    }
    return { x: sourceValue.x, y: sourceValue.y, z: 1 };
  }

  switch (t) {
    case 'identity':
      return sourceValue;

    case 'cm-to-units':
      // 1 cm = 1 LS world unit on Spectacles. Pass through; the seam is here.
      return sourceValue;

    case 'cm-to-text-size':
      // LS Text's `size` is correlated with screen height, not cm. Empirically
      // LS size=40 ≈ 1 cm cap height at the Spectacles design distance.
      if (typeof sourceValue !== 'number') {
        throw new TypeError(`cm-to-text-size expects number (got ${typeof sourceValue})`);
      }
      return sourceValue * 40;

    case 'cm-to-unit-norm':
      // designer cm → 0–1 shader unit (quad half-extent space; basis = min(W,H)).
      if (typeof sourceValue !== 'number') {
        throw new TypeError(`cm-to-unit-norm expects number (got ${typeof sourceValue})`);
      }
      if (!ctx.sizeCm) return sourceValue;
      {
        const basis = Math.min(ctx.sizeCm.x, ctx.sizeCm.y);
        return basis > 0 ? sourceValue / basis : 0;
      }

    case 'cm-to-world-rect':
      // {x,y} cm bounds centered at origin → LS Editor.Rect {left,right,bottom,top}.
      if (!isVec2(sourceValue)) {
        throw new TypeError(`cm-to-world-rect expects {x,y} (got ${JSON.stringify(sourceValue)})`);
      }
      {
        const halfW = sourceValue.x / 2;
        const halfH = sourceValue.y / 2;
        return { left: -halfW, right: halfW, bottom: -halfH, top: halfH };
      }

    case 'deg-to-rad':
      if (typeof sourceValue !== 'number') {
        throw new TypeError(`deg-to-rad expects number (got ${typeof sourceValue})`);
      }
      return sourceValue * DEG_TO_RAD;

    case 'percent-to-01':
      if (typeof sourceValue !== 'number') {
        throw new TypeError(`percent-to-01 expects number (got ${typeof sourceValue})`);
      }
      return sourceValue / 100;

    case 'rgb-to-vec4': {
      if (!isRgba(sourceValue)) {
        throw new TypeError(`rgb-to-vec4 expects RGBA (got ${JSON.stringify(sourceValue)})`);
      }
      // Channels normalize 0–255 → 0–1. Alpha: blend the node's opacity into
      // the color's alpha channel (the opacity-into-alpha fold).
      const a01 = (sourceValue.a / 100) * ctx.opacity;
      return {
        x: sourceValue.r / 255,
        y: sourceValue.g / 255,
        z: sourceValue.b / 255,
        w: a01,
      };
    }
  }
}

// ---- Per-state override resolution (TD-8) ----
//
// `resolveLSWrites` turns a node's per-state override `StateProps` into a list
// of resolved writes, reusing the manifest mappings + `resolveMappingValue` so
// the values match exactly what the applier bakes. It returns a SEMANTIC channel
// (not a literal LS property path) so the caller decides the component target —
// notably `mainPass` vs `mainPassOverrides` for per-instance recolor, which the
// WB0 material spike settles (TD-9). Transform deltas (`position`/`scale`) are
// NOT resolved here — they're applied by the runtime state controller against the
// base transform it captures (TD-1 / WB5).

export type WriteChannel =
  | 'fill' // shape Image baseColor (vec4)
  | 'stroke' // shape Image strokeColor (vec4)
  | 'strokeThickness' // shape Image strokeThickness (number, cm)
  | 'textColor' // Text textFill.color (vec4)
  | 'visible'; // SceneObject.enabled (boolean)

export interface LSWrite {
  channel: WriteChannel;
  valueType: 'vec4' | 'number' | 'boolean';
  value: unknown;
}

/** Look up a node-type's manifest mapping for a designer source prop. */
function mappingFor(nodeType: string, source: string): PropertyMapping | undefined {
  const m = getManifest(nodeType);
  return m?.sceneShape.componentMappings.find((cm) => cm.source === source);
}

/**
 * Resolve the statically-resolvable props in a per-state override to LS writes.
 * `base` is the node's base properties (needed when a state overrides `opacity`
 * alone — the alpha fold then re-emits the element's base fill/text color at the
 * new opacity). `opacity` in `props` (0–100) feeds the fold for that state.
 */
export function resolveLSWrites(node: DesignNode, props: StateProps): LSWrite[] {
  const out: LSWrite[] = [];
  const base = node.properties;
  // The state's opacity (or the node's base opacity) drives the alpha fold.
  const opacityPct =
    typeof props.opacity === 'number'
      ? props.opacity
      : typeof base['opacity'] === 'number'
        ? (base['opacity'] as number)
        : 100;
  const ctx: ResolveValueContext = {
    layerZ: 0,
    opacity: opacityPct / 100,
    sizeCm: isVec2(base['size']) ? { x: base['size'].x, y: base['size'].y } : null,
  };

  const colorWrite = (source: string, channel: WriteChannel, color: Rgba): void => {
    const mapping = mappingFor(node.type, source);
    if (!mapping) return;
    out.push({ channel, valueType: 'vec4', value: resolveMappingValue(mapping, color, ctx) });
  };

  // Whether this state touches a color (so an opacity-only override knows to
  // re-emit the base color at the new alpha).
  const opacityOnly = props.opacity !== undefined
    && props.fillColor === undefined
    && props.textColor === undefined
    && props.strokeColor === undefined;

  if (props.fillColor !== undefined) colorWrite('fillColor', 'fill', props.fillColor);
  if (props.strokeColor !== undefined) colorWrite('strokeColor', 'stroke', props.strokeColor);
  if (props.textColor !== undefined) colorWrite('fillColor', 'textColor', props.textColor); // Text maps fillColor→textFill.color

  if (opacityOnly) {
    // Re-emit whichever base color the element has, at the new alpha.
    if (isRgba(base['fillColor'])) {
      const channel: WriteChannel = node.type === 'Text' ? 'textColor' : 'fill';
      colorWrite('fillColor', channel, base['fillColor']);
    }
  }

  if (typeof props.strokeWidth === 'number') {
    const mapping = mappingFor(node.type, 'strokeWidth');
    if (mapping) {
      out.push({
        channel: 'strokeThickness',
        valueType: 'number',
        value: resolveMappingValue(mapping, props.strokeWidth, ctx),
      });
    }
  }

  if (typeof props.visible === 'boolean') {
    out.push({ channel: 'visible', valueType: 'boolean', value: props.visible });
  }

  return out;
}

/** Designer per-state transform deltas the RUNTIME applies against captured
 *  base transform (not pre-resolved here). Exposed so codegen can bake them. */
export function stateTransformDelta(props: StateProps): { position?: Vec2Like; scale?: Vec2Like } {
  const out: { position?: Vec2Like; scale?: Vec2Like } = {};
  if (props.position) out.position = { x: props.position.x, y: props.position.y };
  if (props.scale) out.scale = { x: props.scale.x, y: props.scale.y };
  return out;
}

/** The per-state override prop keys this module resolves statically (the rest —
 *  position/scale — are runtime transform deltas). */
export const STATICALLY_RESOLVED: readonly StatePropKey[] = [
  'visible',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'opacity',
  'textColor',
];
