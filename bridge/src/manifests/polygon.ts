// Polygon — Phase 1.5 atomic. A regular N-sided polygon (triangle, pentagon,
// hexagon, …) that fills its W×H bounding box. Solid fill + independent
// stroke, same per-node disk-clone material strategy as Rectangle/Ellipse.
//
// Backed by a custom ShaderGraph material (LensDesignerPolygon) authored in
// LS. Its Custom Code GLSL is a regular-polygon SDF measured in CM (via the
// boxSize param, like RoundedRectCore), so the stroke stays uniform at any
// aspect. Exposes:
//   baseColor       (vec4)  — fill, alpha included
//   strokeColor     (vec4)  — stroke, alpha included
//   strokeThickness (float) — CM
//   boxSize         (vec2)  — CM dimensions (fed by the applier)
//   sides           (float) — number of sides (3+); cast to int in the shader

import type { PrimitiveManifest } from './types.ts';

/** Path to the custom Polygon material authored in LS. */
export const POLYGON_MATERIAL_PATH = 'LensDesigner/LensDesignerPolygon.mat';

export const PolygonManifest: PrimitiveManifest = {
  type: 'Polygon',
  category: 'atomic',
  displayName: 'Polygon',
  glyph: '⬡',
  defaultProperties: {
    position: { x: 0, y: 0 },
    size: { x: 8, y: 8 }, // square default → a regular polygon
    rotation: 0,
    opacity: 100,
    sides: 6,
    fillColor: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 },
    strokeColor: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, // alpha=0 → no stroke by default
    strokeWidth: 0,
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'size', label: 'w, h', kind: 'vec2', default: { x: 8, y: 8 }, unit: 'cm', section: 'Size', min: 0.1 },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
    { key: 'opacity', label: 'opacity', kind: 'number', default: 100, unit: '%', min: 0, max: 100, step: 1, section: 'Transform' },
    { key: 'sides', label: 'sides', kind: 'number', default: 6, min: 3, max: 20, step: 1, section: 'Shape' },
    { key: 'fillColor', label: 'fill', kind: 'color', default: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 }, section: 'Fill' },
    { key: 'strokeColor', label: 'stroke', kind: 'color', default: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, section: 'Stroke' },
    { key: 'strokeWidth', label: 'width', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.05, section: 'Stroke' },
  ],
  sceneShape: {
    componentKind: 'Image',
    materialRef: null,
    materialPreset: null,
    materialTemplatePath: POLYGON_MATERIAL_PATH,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
      { source: 'size', target: 'localTransform.scale', valueType: 'vec3', transform: 'cm-to-units' },
    ],
    componentMappings: [
      // Fill / stroke / thickness / sides ride on the per-node material's
      // passInfos (baked at clone time, re-set warm). Stroke + the SDF are
      // measured in cm via the boxSize param the applier feeds from `size`.
      { source: 'fillColor', target: 'mainMaterial.passInfos.0.baseColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      { source: 'strokeColor', target: 'mainMaterial.passInfos.0.strokeColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      { source: 'strokeWidth', target: 'mainMaterial.passInfos.0.strokeThickness', valueType: 'number', transform: 'cm-to-units' },
      { source: 'sides', target: 'mainMaterial.passInfos.0.sides', valueType: 'number' },
    ],
    children: [],
  },
};
