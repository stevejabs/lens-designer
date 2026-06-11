// Ellipse — Phase 1.5 atomic. Solid fill + stroke. Fills its W×H bounding
// box as an ellipse; a square box gives a perfect circle.
//
// Same material strategy as Rectangle: a per-node disk-clone of a custom
// ShaderGraph material (LensDesignerEllipse) authored in LS. Its Custom
// Code GLSL node is a cm-space ellipse SDF (gradient approximation, fed by
// the boxSize param the applier supplies from `size`), so the stroke stays a
// uniform cm width at any aspect. Exposes:
//   baseColor       (vec4)  — fill, alpha included
//   strokeColor     (vec4)  — stroke, alpha included
//   strokeThickness (float) — CM
//   boxSize         (vec2)  — CM dimensions (fed by the applier)
//
// No corner radii (an ellipse has no corners). Solid opaque fill, stroke
// on its own pixels — identical behavior to Rectangle's stroke.

import type { PrimitiveManifest } from './types.ts';

/** Path to the custom Ellipse material authored in LS. */
export const ELLIPSE_MATERIAL_PATH = 'LensDesigner/LensDesignerEllipse.mat';

export const EllipseManifest: PrimitiveManifest = {
  type: 'Ellipse',
  category: 'atomic',
  displayName: 'Ellipse',
  glyph: '◯',
  defaultProperties: {
    position: { x: 0, y: 0 },
    size: { x: 8, y: 8 }, // square default → a circle
    rotation: 0,
    opacity: 100,
    fillColor: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 },
    strokeColor: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, // alpha=0 → no stroke by default
    strokeWidth: 0,
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'size', label: 'w, h', kind: 'vec2', default: { x: 8, y: 8 }, unit: 'cm', section: 'Size', min: 0.1 },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
    { key: 'opacity', label: 'opacity', kind: 'number', default: 100, unit: '%', min: 0, max: 100, step: 1, section: 'Transform' },
    { key: 'fillColor', label: 'fill', kind: 'color', default: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 }, section: 'Fill' },
    { key: 'strokeColor', label: 'stroke', kind: 'color', default: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, section: 'Stroke' },
    { key: 'strokeWidth', label: 'width', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.05, section: 'Stroke' },
  ],
  sceneShape: {
    componentKind: 'Image',
    materialRef: null,
    materialPreset: null,
    materialTemplatePath: ELLIPSE_MATERIAL_PATH,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
      { source: 'size', target: 'localTransform.scale', valueType: 'vec3', transform: 'cm-to-units' },
    ],
    componentMappings: [
      // Fill, stroke, stroke thickness ride on the per-node material's
      // passInfos. The cm-space SDF measures in cm (fed boxSize by the
      // applier), so stroke width passes through as cm.
      { source: 'fillColor', target: 'mainMaterial.passInfos.0.baseColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      { source: 'strokeColor', target: 'mainMaterial.passInfos.0.strokeColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      { source: 'strokeWidth', target: 'mainMaterial.passInfos.0.strokeThickness', valueType: 'number', transform: 'cm-to-units' },
    ],
    children: [],
  },
};
