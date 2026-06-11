// Image — Phase 1.5 atomic. A textured RoundedRect: inherits stroke +
// per-corner radii from the Rectangle and replaces the solid fill with a
// sampled image. Fit/fill/stretch + 9-point alignment control how the
// image maps into the box.
//
// SHARED CORE via SUBGRAPH: Image is its own material (LensDesignerImage)
// that samples baseTex and feeds the result as the fill into the shared
// `RoundedRectCore` subgraph — the same subgraph LensDesignerRoundedRect
// uses. So stroke + rounded corners come from the one shared subgraph;
// any future addition to it lands on every primitive that composes it
// (Rectangle, Image, and later ScrollView / TextView panels).
//
// The texture binding (baseTex UUID, texScale, texOffset) is NOT a generic
// property mapping — the applier special-cases the Image type: it resolves
// imageSource → texture asset, reads the image aspect, and computes the UV
// transform via image-fit.ts. So imageSource/fitMode/alignment are
// Inspector-only properties with no componentMapping entry.

import type { PrimitiveManifest } from './types.ts';

/** Image's own material — samples baseTex, composes the RoundedRectCore subgraph. */
export const IMAGE_MATERIAL_PATH = 'LensDesigner/LensDesignerImage.mat';

export const ImageManifest: PrimitiveManifest = {
  type: 'Image',
  category: 'atomic',
  displayName: 'Image',
  glyph: '🖼',
  defaultProperties: {
    position: { x: 0, y: 0 },
    size: { x: 16, y: 12 },
    rotation: 0,
    opacity: 100,
    imageSource: '', // texture asset path in the sandbox, or '' for none yet
    fitMode: 'fill',
    alignment: 'center',
    strokeColor: { r: 0x00, g: 0x1a, b: 0x3b, a: 0 }, // alpha=0 → no stroke by default
    strokeWidth: 0,
    cornerTL: 0,
    cornerTR: 0,
    cornerBR: 0,
    cornerBL: 0,
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'size', label: 'w, h', kind: 'vec2', default: { x: 16, y: 12 }, unit: 'cm', section: 'Size', min: 0.1 },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
    { key: 'opacity', label: 'opacity', kind: 'number', default: 100, unit: '%', min: 0, max: 100, step: 1, section: 'Transform' },
    { key: 'imageSource', label: 'image', kind: 'image', default: '', section: 'Image' },
    {
      key: 'fitMode',
      label: 'fit',
      kind: 'enum',
      default: 'fill',
      options: ['stretch', 'fit', 'fill'],
      style: 'toggle',
      section: 'Image',
    },
    {
      key: 'alignment',
      label: 'align',
      kind: 'enum',
      default: 'center',
      options: [
        'top-left', 'top-center', 'top-right',
        'center-left', 'center', 'center-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ],
      section: 'Image',
    },
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
    materialTemplatePath: IMAGE_MATERIAL_PATH,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
      { source: 'size', target: 'localTransform.scale', valueType: 'vec3', transform: 'cm-to-units' },
    ],
    componentMappings: [
      // Stroke + corners ride the shared shader, same as Rectangle. The
      // texture binding (baseTex/useTexture/texScale/texOffset) is computed
      // by the applier from imageSource + fitMode + alignment, NOT mapped
      // here — see applyDesignNode's Image special-case.
      { source: 'strokeColor', target: 'mainMaterial.passInfos.0.strokeColor', valueType: 'vec4', transform: 'rgb-to-vec4' },
      // cm-to-units (1:1) — RoundedRectCore SDF works in cm space (boxSize).
      { source: 'strokeWidth', target: 'mainMaterial.passInfos.0.strokeThickness', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerTL', target: 'mainMaterial.passInfos.0.cornerTL', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerTR', target: 'mainMaterial.passInfos.0.cornerTR', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerBR', target: 'mainMaterial.passInfos.0.cornerBR', valueType: 'number', transform: 'cm-to-units' },
      { source: 'cornerBL', target: 'mainMaterial.passInfos.0.cornerBL', valueType: 'number', transform: 'cm-to-units' },
    ],
    children: [],
  },
};
