// Rectangle — Phase 1.5 atomic. Solid fill + stroke + per-corner radius.
//
// Materializes as a SceneObject + Image component + a per-node duplicate
// of LensDesignerRoundedRect — a custom ShaderGraph material authored in
// LS (Custom Code node, hand-written GLSL SDF). It exposes:
//   baseColor       (vec4)  — fill, alpha included
//   strokeColor     (vec4)  — stroke, alpha included
//   strokeThickness (float) — UV-normalized 0–0.5
//   cornerTL/TR/BR/BL (float each) — UV-normalized per-corner radii
//
// The procedural shader renders solid, fully-opaque fills (no texture),
// and stroke/fill occupy distinct pixels so a stroke never tints the
// fill. The applier disk-clones the template per node and bakes the
// values straight into the .mat YAML (avoids the file-watcher re-import
// race; see duplicateMaterialAssetOnDisk).
//
// stroke + corner radii are authored in CM. The applier converts them to
// the shader's UV-normalized space using the rect's `size` as the basis.

import type { PrimitiveManifest } from './types.ts';

/** Path to the custom RoundedRect material authored in LS. */
export const RECTANGLE_MATERIAL_PATH = 'LensDesigner/LensDesignerRoundedRect.mat';

export const RectangleManifest: PrimitiveManifest = {
  type: 'Rectangle',
  category: 'atomic',
  displayName: 'Rectangle',
  glyph: '▭',
  defaultProperties: {
    position: { x: 0, y: 0 },
    size: { x: 8, y: 4 },
    rotation: 0,
    opacity: 100,
    fillColor: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 },
    strokeColor: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, // alpha=0 → no stroke by default
    strokeWidth: 0,
    cornerTL: 0,
    cornerTR: 0,
    cornerBR: 0,
    cornerBL: 0,
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'size', label: 'w, h', kind: 'vec2', default: { x: 8, y: 4 }, unit: 'cm', section: 'Size', min: 0.1 },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
    { key: 'opacity', label: 'opacity', kind: 'number', default: 100, unit: '%', min: 0, max: 100, step: 1, section: 'Transform' },
    { key: 'fillColor', label: 'fill', kind: 'color', default: { r: 0xc2, g: 0xd4, b: 0xff, a: 100 }, section: 'Fill' },
    { key: 'strokeColor', label: 'stroke', kind: 'color', default: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, section: 'Stroke' },
    { key: 'strokeWidth', label: 'width', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.05, section: 'Stroke' },
    { key: 'cornerTL', label: 'top-left', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.1, section: 'Corners' },
    { key: 'cornerTR', label: 'top-right', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.1, section: 'Corners' },
    { key: 'cornerBR', label: 'bottom-right', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.1, section: 'Corners' },
    { key: 'cornerBL', label: 'bottom-left', kind: 'number', default: 0, unit: 'cm', min: 0, step: 0.1, section: 'Corners' },
  ],
  sceneShape: {
    componentKind: 'Image',
    materialRef: null,
    materialPreset: null,
    materialTemplatePath: RECTANGLE_MATERIAL_PATH,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
      { source: 'size', target: 'localTransform.scale', valueType: 'vec3', transform: 'cm-to-units' },
    ],
    componentMappings: [
      // Fill, stroke, stroke thickness, and the four corner radii all
      // ride on the per-node material's passInfos. Stroke and corners
      // are converted from cm → shader-normalized units by the applier
      // (it has the rect's `size` to compute the basis).
      { source: 'fillColor', target: 'mainMaterial.passInfos.0.baseColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      { source: 'strokeColor', target: 'mainMaterial.passInfos.0.strokeColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      // cm-to-units (1:1) — the RoundedRectCore SDF now works in cm space
      // (fed boxSize), so stroke + corner radii pass through as cm.
      { source: 'strokeWidth', target: 'mainMaterial.passInfos.0.strokeThickness', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerTL', target: 'mainMaterial.passInfos.0.cornerTL', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerTR', target: 'mainMaterial.passInfos.0.cornerTR', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerBR', target: 'mainMaterial.passInfos.0.cornerBR', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerBL', target: 'mainMaterial.passInfos.0.cornerBL', valueType: 'number', transform: 'cm-to-units' },
    ],
    children: [],
  },
};
