// Stack-lite hug layout (TD-10, WB-L) — the ONE shared layout solver that the
// canvas preview, the bridge applier, and the generated controller's runtime
// re-layout all call, so a hug pill is positioned identically everywhere
// (parity, like resolve-writes.ts). Pure: callers supply measured child sizes
// (canvas: measureText; applier: authored size; runtime: Text.getBoundingBox);
// this returns the group's hugged size + each child's center position + size.
//
// Model: a Group with `layout {mode:row|column, spacing, padding, hug}` flows its
// CONTENT children (everything not `fillParent`) along the axis, centered as a
// block about the group origin; the group hugs them + padding. `fillParent`
// children (the pill background) get the full hugged size, centered. NOT full
// autolayout — single axis, no inter-node constraints (see TD-10).

export interface HugItem {
  /** Measured width in cm (content child) — ignored for fill items. */
  w: number;
  /** Measured height in cm — ignored for fill items. */
  h: number;
  /** True = stretches to the hugged bounds (background); false = flowed content. */
  fill: boolean;
}

export interface HugLayoutSpec {
  mode: 'row' | 'column';
  spacing: number;
  padding: { x: number; y: number };
}

export interface HugBox {
  /** Center position relative to the group origin (cm). */
  x: number;
  y: number;
  /** Resolved size (cm): content keeps its own; fill gets the group size. */
  w: number;
  h: number;
}

export interface HugResult {
  /** The group's hugged size (cm) = content bounds + 2×padding. */
  group: { w: number; h: number };
  /** Per-input box, parallel to the `items` array. */
  boxes: HugBox[];
}

/**
 * Solve the hug layout. `items` is parallel to the group's children (in order).
 * Content items flow on the axis (centered block); fill items take the hugged
 * size. Returns the group size + each child's center + size, all in cm relative
 * to the group origin.
 */
export function computeHugLayout(items: HugItem[], layout: HugLayoutSpec): HugResult {
  const content = items.filter((it) => !it.fill);
  const isRow = layout.mode === 'row';

  // Content bounds: sum along the axis (+ spacing between), max on the cross-axis.
  let along = 0;
  let cross = 0;
  for (let i = 0; i < content.length; i++) {
    const it = content[i]!;
    const a = isRow ? it.w : it.h;
    const c = isRow ? it.h : it.w;
    along += a;
    if (i > 0) along += layout.spacing;
    if (c > cross) cross = c;
  }

  const contentW = isRow ? along : cross;
  const contentH = isRow ? cross : along;
  const groupW = contentW + 2 * layout.padding.x;
  const groupH = contentH + 2 * layout.padding.y;

  // Flow the content items, centered as a block about the origin.
  const boxes: HugBox[] = new Array(items.length);
  let cursor = -along / 2; // leading edge of the centered block, along the axis
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.fill) {
      boxes[i] = { x: 0, y: 0, w: groupW, h: groupH };
      continue;
    }
    const a = isRow ? it.w : it.h;
    const centerAlong = cursor + a / 2;
    cursor += a + layout.spacing;
    boxes[i] = isRow
      ? { x: centerAlong, y: 0, w: it.w, h: it.h }
      : { x: 0, y: -centerAlong, w: it.w, h: it.h }; // column flows top→down (−y)
  }

  return { group: { w: groupW, h: groupH }, boxes };
}
