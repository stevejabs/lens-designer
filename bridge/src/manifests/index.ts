// Manifest registry — the single source of truth for which atomic
// primitives ship in Phase 1.
//
// The web app imports MANIFESTS to populate its Palette and Inspector
// forms. The mutation applier looks up manifests by `type` to know
// how to materialize a DesignNode into LS.

import { RectangleManifest } from './rectangle.ts';
import { EllipseManifest } from './ellipse.ts';
import { PolygonManifest } from './polygon.ts';
import { ImageManifest } from './image.ts';
import { TextManifest } from './text.ts';
import { GroupManifest } from './group.ts';
import type { PrimitiveManifest } from './types.ts';

export const MANIFESTS: Record<string, PrimitiveManifest> = {
  [RectangleManifest.type]: RectangleManifest,
  [EllipseManifest.type]: EllipseManifest,
  [PolygonManifest.type]: PolygonManifest,
  [ImageManifest.type]: ImageManifest,
  [TextManifest.type]: TextManifest,
  [GroupManifest.type]: GroupManifest,
};

export const ALL_MANIFESTS: readonly PrimitiveManifest[] = Object.values(MANIFESTS);

export function getManifest(type: string): PrimitiveManifest | undefined {
  return MANIFESTS[type];
}

// Re-export the schema + types so consumers can validate / type-check.
export * from './types.ts';
export { RectangleManifest } from './rectangle.ts';
export { EllipseManifest } from './ellipse.ts';
export { PolygonManifest } from './polygon.ts';
export { ImageManifest } from './image.ts';
export { TextManifest } from './text.ts';
export { GroupManifest } from './group.ts';
