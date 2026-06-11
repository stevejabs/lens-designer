// Text — atomic primitive backed by the LS-native Text component.
//
// Box model (Phase 1.5 text overhaul): a Text node is a BOX. `position` is
// the box center (the SceneObject origin); `size` is the box in cm and maps to
// the Text component's `worldSpaceRect`. LS lays text out INSIDE that box and
// h/v alignment positions it within the box — so the designer renders the same
// box + alignment and the two match. `fontSize` (cm) is the glyph size,
// separate from the box. Resize handles operate on `size`, like any shape.

import type { PrimitiveManifest } from './types.ts';

// Built-in fonts — values map 1:1 to LS preset names so the applier can
// instantiate the font asset via CreateAssetFromPresetTool. Custom uploaded
// fonts are appended to the picker at runtime (see web font ingest).
const SAFE_FONTS = ['LibreBaskerville', 'CutiveMono', 'Merriweather'] as const;

/** Map built-in font name → LS preset name. Custom fonts (uploaded .ttf/.otf)
 *  are referenced by sandbox asset path instead, not through this table. */
export const FONT_PRESETS: Record<string, string> = {
  LibreBaskerville: 'LibreBaskervilleFontPreset',
  CutiveMono: 'CutiveMonoFontPreset',
  Merriweather: 'MerriweatherFontPreset',
};

/**
 * Horizontal overflow modes — match LS `Editor.Components.HorizontalOverflow`.
 * Order is the enum's int order; applier resolves the string to int.
 */
export const HORIZONTAL_OVERFLOW_MODES = [
  'Overflow', 'Truncate', 'TruncateFront', 'Wrap', 'Ellipsis', 'EllipsisFront', 'Shrink',
] as const;

/** Vertical overflow modes — match LS `Editor.Components.VerticalOverflow`. */
export const VERTICAL_OVERFLOW_MODES = ['Overflow', 'Truncate', 'Shrink'] as const;

export const TextManifest: PrimitiveManifest = {
  type: 'Text',
  category: 'atomic',
  displayName: 'Text',
  glyph: '𝐓',
  defaultProperties: {
    position: { x: 0, y: 0 },
    size: { x: 20, y: 4 }, // cm — the text box (worldSpaceRect)
    rotation: 0,
    opacity: 100,
    text: 'Text',
    font: 'LibreBaskerville',
    fontSize: 1.0, // cm — glyph size
    fillColor: { r: 0x00, g: 0x1a, b: 0x3b, a: 100 }, // dark navy, readable on a soft-blue panel
    horizontalAlignment: 'center',
    verticalAlignment: 'middle',
    horizontalOverflow: 'Overflow',
    verticalOverflow: 'Overflow',
    letterSpacing: 0,
    lineSpacing: 1,
    outlineEnabled: false,
    outlineColor: { r: 0x0e, g: 0x17, b: 0x33, a: 80 }, // --qb-night 80% (sun-readable stroke)
    outlineSize: 0.25, // LS outlineSettings.size native units (0–1)
  },
  properties: [
    { key: 'position', label: 'x, y', kind: 'vec2', default: { x: 0, y: 0 }, unit: 'cm', section: 'Position' },
    { key: 'size', label: 'box w, h', kind: 'vec2', default: { x: 20, y: 4 }, unit: 'cm', section: 'Size', min: 0.1 },
    { key: 'rotation', label: 'rotation', kind: 'number', default: 0, unit: 'deg', step: 1, section: 'Transform' },
    { key: 'opacity', label: 'opacity', kind: 'number', default: 100, unit: '%', min: 0, max: 100, step: 1, section: 'Transform' },
    { key: 'text', label: 'text', kind: 'string', multiline: true, default: 'Text', section: 'Content' },
    { key: 'font', label: 'font', kind: 'font', default: 'LibreBaskerville', options: [...SAFE_FONTS], section: 'Type' },
    { key: 'fontSize', label: 'size', kind: 'number', default: 1.0, unit: 'cm', min: 0.1, step: 0.1, section: 'Type' },
    { key: 'fillColor', label: 'color', kind: 'color', default: { r: 0x00, g: 0x1a, b: 0x3b, a: 100 }, section: 'Fill' },
    {
      key: 'horizontalAlignment',
      label: 'horizontal',
      kind: 'enum',
      default: 'center',
      options: ['left', 'center', 'right'],
      style: 'toggle',
      section: 'Alignment',
    },
    {
      key: 'verticalAlignment',
      label: 'vertical',
      kind: 'enum',
      default: 'middle',
      options: ['top', 'middle', 'bottom'],
      style: 'toggle',
      section: 'Alignment',
    },
    {
      key: 'horizontalOverflow',
      label: 'h overflow',
      kind: 'enum',
      default: 'Overflow',
      options: [...HORIZONTAL_OVERFLOW_MODES],
      section: 'Overflow',
    },
    {
      key: 'verticalOverflow',
      label: 'v overflow',
      kind: 'enum',
      default: 'Overflow',
      options: [...VERTICAL_OVERFLOW_MODES],
      section: 'Overflow',
    },
    { key: 'letterSpacing', label: 'letterSpacing', kind: 'number', default: 0, step: 0.01, section: 'Type' },
    { key: 'lineSpacing', label: 'lineSpacing', kind: 'number', default: 1, step: 0.05, section: 'Type' },
    { key: 'outlineEnabled', label: 'outline', kind: 'boolean', default: false, section: 'Outline' },
    { key: 'outlineColor', label: 'color', kind: 'color', default: { r: 0x0e, g: 0x17, b: 0x33, a: 80 }, section: 'Outline' },
    { key: 'outlineSize', label: 'thickness', kind: 'number', default: 0.25, min: 0, max: 1, step: 0.05, section: 'Outline' },
  ],
  sceneShape: {
    componentKind: 'Text',
    materialRef: null,
    materialPreset: null,
    materialTemplatePath: null,
    transformMappings: [
      { source: 'position', target: 'localTransform.position', valueType: 'vec3', transform: 'cm-to-units' },
      { source: 'rotation', target: 'localTransform.rotation', valueType: 'vec3', transform: 'deg-to-rad' },
      // The text box is the Text component's worldSpaceRect, NOT the SO scale.
    ],
    componentMappings: [
      { source: 'text', target: 'text', valueType: 'string' },
      { source: 'fontSize', target: 'size', valueType: 'number', transform: 'cm-to-text-size' },
      { source: 'letterSpacing', target: 'letterSpacing', valueType: 'number' },
      { source: 'lineSpacing', target: 'lineSpacing', valueType: 'number' },
      { source: 'fillColor', target: 'textFill.color', valueType: 'vec4', transform: 'rgb-to-vec4' },
      // LS alignment lives on BaseMeshVisual:
      //   horizontalAlignment (Editor.Alignment.Horizontal): 0=Left, 1=Center, 2=Right
      //   verticalAlignment   (Editor.Alignment.Vertical):   0=Bottom, 1=Center, 2=Top
      { source: 'horizontalAlignment', target: 'horizontalAlignment', valueType: 'enum', enumType: 'Editor.Alignment.Horizontal' },
      { source: 'verticalAlignment', target: 'verticalAlignment', valueType: 'enum', enumType: 'Editor.Alignment.Vertical' },
      // Overflow modes drive wrap/truncate/ellipsis/shrink within the box.
      { source: 'horizontalOverflow', target: 'horizontalOverflow', valueType: 'enum', enumType: 'Editor.Components.HorizontalOverflow' },
      { source: 'verticalOverflow', target: 'verticalOverflow', valueType: 'enum', enumType: 'Editor.Components.VerticalOverflow' },
      // The box → worldSpaceRect (always set; this is the text layout box).
      { source: 'size', target: 'worldSpaceRect', valueType: 'rect', transform: 'cm-to-world-rect' },
      // Outline (sun-readable stroke). Nested OutlineSettings: enabled + size
      // (0–1 native units) + fill.color (a TextFill.color vec4).
      { source: 'outlineEnabled', target: 'outlineSettings.enabled', valueType: 'boolean' },
      { source: 'outlineSize', target: 'outlineSettings.size', valueType: 'number' },
      { source: 'outlineColor', target: 'outlineSettings.fill.color', valueType: 'vec4', transform: 'rgb-to-vec4' },
    ],
    children: [],
  },
};
