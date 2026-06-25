// catalog.ts — a data-driven inventory of every SpectaclesUIKit component and
// its user-editable properties, distilled from the UIKit source
// (Cache/.../SpectaclesUIKit.lspkg/Scripts). The WYSIWYG inspector renders its
// controls from this catalog, so adding a component or property is data, not
// code. Property `path` is the runtime setter/getter or material uniform used
// to apply it (documented for the live-edit + codegen layers).

export type PropType = 'number' | 'boolean' | 'string' | 'color' | 'vec2' | 'vec3' | 'enum';
export type PropCategory = 'size' | 'color' | 'corner' | 'border' | 'text' | 'layout' | 'state' | 'behavior' | 'visual';

export interface PropSpec {
  key: string;
  label: string;
  type: PropType;
  category: PropCategory;
  /** Runtime setter / material uniform that applies it (for live edit + codegen). */
  path?: string;
  options?: string[]; // enum
  min?: number;
  max?: number;
  default?: number | boolean | string;
}

export interface ComponentSpec {
  /** UIKit type — matches a ScriptComponent's scriptAsset name in the scene. */
  type: string;
  label: string;
  /** Higher-level grouping for the palette/tree. */
  group: 'container' | 'control' | 'display' | 'layout' | 'input' | 'visual';
  /** Whether children are expected (containers/layouts). */
  container?: boolean;
  props: PropSpec[];
}

// Shared props every visual element carries (Element → VisualElement → Visual).
const ELEMENT_PROPS: PropSpec[] = [
  { key: 'size', label: 'Size', type: 'vec3', category: 'size', path: 'size' },
  { key: 'inactive', label: 'Inactive', type: 'boolean', category: 'state', path: 'inactive', default: false },
];
const VISUAL_PROPS: PropSpec[] = [
  { key: 'baseColor', label: 'Color', type: 'color', category: 'color', path: 'visual.baseDefaultColor' },
  { key: 'cornerRadius', label: 'Corner radius', type: 'number', category: 'corner', path: 'visual.cornerRadius', min: 0, max: 20 },
  { key: 'hasBorder', label: 'Border', type: 'boolean', category: 'border', path: 'visual.border', default: false },
  { key: 'borderSize', label: 'Border width', type: 'number', category: 'border', path: 'visual.borderSize', min: 0, max: 5 },
  { key: 'borderColor', label: 'Border color', type: 'color', category: 'border', path: 'visual.borderColor' },
  { key: 'opacity', label: 'Opacity', type: 'number', category: 'color', path: 'visual.opacity', min: 0, max: 1, default: 1 },
  { key: 'hasShadow', label: 'Drop shadow', type: 'boolean', category: 'visual', path: 'hasShadow', default: false },
];

export const UIKIT_CATALOG: ComponentSpec[] = [
  {
    type: 'Frame',
    label: 'Frame',
    group: 'container',
    container: true,
    props: [
      { key: 'innerSize', label: 'Inner size', type: 'vec2', category: 'size', path: 'innerSize' },
      { key: 'margin', label: 'Margin', type: 'number', category: 'layout', path: 'margin' },
      { key: 'cornerRadius', label: 'Corner radius', type: 'number', category: 'corner', path: 'cornerRadius', min: 0, max: 20 },
      { key: 'appearance', label: 'Appearance', type: 'enum', category: 'layout', path: 'appearance', options: ['Large', 'Small'] },
    ],
  },
  {
    type: 'BackPlate',
    label: 'BackPlate',
    group: 'container',
    container: true,
    props: [
      { key: 'size', label: 'Size', type: 'vec2', category: 'size', path: 'size' },
      ...VISUAL_PROPS,
    ],
  },
  {
    type: 'Button',
    label: 'Button',
    group: 'control',
    props: [
      ...ELEMENT_PROPS,
      { key: 'toggleable', label: 'Toggleable', type: 'boolean', category: 'state', path: 'toggleable', default: false },
      { key: 'isOn', label: 'On', type: 'boolean', category: 'state', path: 'isOn', default: false },
      ...VISUAL_PROPS,
    ],
  },
  {
    type: 'Switch',
    label: 'Switch',
    group: 'control',
    props: [
      ...ELEMENT_PROPS,
      { key: 'isOn', label: 'On', type: 'boolean', category: 'state', path: 'isOn', default: false },
    ],
  },
  {
    type: 'Toggle',
    label: 'Toggle',
    group: 'control',
    props: [
      ...ELEMENT_PROPS,
      { key: 'isOn', label: 'On', type: 'boolean', category: 'state', path: 'isOn', default: false },
    ],
  },
  {
    type: 'Slider',
    label: 'Slider',
    group: 'control',
    props: [
      ...ELEMENT_PROPS,
      { key: 'value', label: 'Value', type: 'number', category: 'state', path: 'value', min: 0, max: 1, default: 0 },
      { key: 'defaultValue', label: 'Default value', type: 'number', category: 'state', path: 'defaultValue', min: 0, max: 1, default: 0 },
      { key: 'segmented', label: 'Segmented', type: 'boolean', category: 'behavior', path: 'segmented', default: false },
      { key: 'numberOfSegments', label: 'Segments', type: 'number', category: 'behavior', path: 'numberOfSegments', min: 2, max: 20, default: 5 },
      { key: 'knobSize', label: 'Knob size', type: 'vec2', category: 'size', path: 'knobSize' },
    ],
  },
  {
    type: 'ProgressBar',
    label: 'Progress bar',
    group: 'display',
    props: [
      { key: 'size', label: 'Size', type: 'vec3', category: 'size', path: 'size' },
      { key: 'currentValue', label: 'Value', type: 'number', category: 'state', path: 'currentValue', min: 0, max: 1, default: 0 },
      { key: 'defaultValue', label: 'Default value', type: 'number', category: 'state', path: 'defaultValue', min: 0, max: 1, default: 0 },
    ],
  },
  {
    type: 'Text',
    label: 'Text',
    group: 'display',
    props: [
      { key: 'text', label: 'Text', type: 'string', category: 'text', path: 'text' },
      { key: 'size', label: 'Font size', type: 'number', category: 'text', path: 'size', min: 4, max: 200 },
      { key: 'textFill', label: 'Color', type: 'color', category: 'color', path: 'textFill.color' },
      { key: 'horizontalAlignment', label: 'Align', type: 'enum', category: 'text', path: 'horizontalAlignment', options: ['Left', 'Center', 'Right'] },
    ],
  },
  {
    type: 'Image',
    label: 'Image',
    group: 'display',
    props: [
      { key: 'baseColor', label: 'Tint', type: 'color', category: 'color', path: 'mainPass.baseColor' },
    ],
  },
  {
    type: 'FlexLayout',
    label: 'Flex layout',
    group: 'layout',
    container: true,
    props: [
      { key: 'direction', label: 'Direction', type: 'enum', category: 'layout', path: 'direction', options: ['row', 'column'] },
      { key: 'justifyContent', label: 'Justify', type: 'enum', category: 'layout', path: 'justifyContent', options: ['flexStart', 'center', 'flexEnd', 'spaceBetween', 'spaceAround'] },
      { key: 'alignItems', label: 'Align', type: 'enum', category: 'layout', path: 'alignItems', options: ['flexStart', 'center', 'flexEnd', 'stretch'] },
      { key: 'gap', label: 'Gap', type: 'number', category: 'layout', path: 'gap', min: 0, max: 20 },
      { key: 'padding', label: 'Padding', type: 'number', category: 'layout', path: 'padding', min: 0, max: 20 },
    ],
  },
  {
    type: 'FlexItem',
    label: 'Flex item',
    group: 'layout',
    props: [
      { key: 'grow', label: 'Grow', type: 'number', category: 'layout', path: 'grow', min: 0, max: 10 },
      { key: 'alignSelf', label: 'Align self', type: 'enum', category: 'layout', path: 'alignSelf', options: ['auto', 'flexStart', 'center', 'flexEnd', 'stretch'] },
    ],
  },
  {
    type: 'GridLayout',
    label: 'Grid layout',
    group: 'layout',
    container: true,
    props: [
      { key: 'columns', label: 'Columns', type: 'number', category: 'layout', path: 'columns', min: 1, max: 12 },
      { key: 'rows', label: 'Rows', type: 'number', category: 'layout', path: 'rows', min: 1, max: 12 },
      { key: 'gap', label: 'Gap', type: 'number', category: 'layout', path: 'gap', min: 0, max: 20 },
      { key: 'padding', label: 'Padding', type: 'number', category: 'layout', path: 'padding', min: 0, max: 20 },
    ],
  },
  {
    type: 'TextInputField',
    label: 'Text input',
    group: 'input',
    props: [
      { key: 'text', label: 'Text', type: 'string', category: 'text', path: 'text' },
      { key: 'placeholderText', label: 'Placeholder', type: 'string', category: 'text', path: 'placeholderText' },
      { key: 'fontSize', label: 'Font size', type: 'number', category: 'text', path: 'fontSize', min: 0, max: 200 },
      { key: 'horizontalTextAlignment', label: 'Align', type: 'enum', category: 'text', path: 'horizontalTextAlignment', options: ['left', 'center', 'right'] },
      { key: 'opacity', label: 'Opacity', type: 'number', category: 'color', path: 'opacity', min: 0, max: 1, default: 1 },
    ],
  },
  {
    type: 'TextInputArea',
    label: 'Text area',
    group: 'input',
    props: [
      { key: 'text', label: 'Text', type: 'string', category: 'text', path: 'text' },
      { key: 'placeholderText', label: 'Placeholder', type: 'string', category: 'text', path: 'placeholderText' },
      { key: 'fontSize', label: 'Font size', type: 'number', category: 'text', path: 'fontSize', min: 0, max: 200 },
    ],
  },
  {
    type: 'Dropdown',
    label: 'Dropdown',
    group: 'input',
    props: [...ELEMENT_PROPS],
  },
  {
    type: 'ScrollBar',
    label: 'Scroll bar',
    group: 'control',
    props: [...ELEMENT_PROPS],
  },
  {
    // The underlying visual — what most components render through. Includes the
    // per-corner fork extension (see uikit/corners).
    type: 'RoundedRectangle',
    label: 'Rounded rectangle',
    group: 'visual',
    props: [
      { key: 'backgroundColor', label: 'Color', type: 'color', category: 'color', path: 'mainPass.backgroundColor' },
      { key: 'cornerRadius', label: 'Corner radius', type: 'number', category: 'corner', path: 'mainPass.cornerRadius', min: 0, max: 20, default: 1 },
      { key: 'border', label: 'Border', type: 'boolean', category: 'border', path: 'mainPass.border', default: false },
      { key: 'borderSize', label: 'Border width', type: 'number', category: 'border', path: 'mainPass.borderSize', min: 0, max: 5, default: 0.2 },
      { key: 'borderColor', label: 'Border color', type: 'color', category: 'border', path: 'mainPass.borderColor' },
      { key: 'opacity', label: 'Opacity', type: 'number', category: 'color', path: 'opacity', min: 0, max: 1, default: 1 },
    ],
  },
];

const BY_TYPE = new Map(UIKIT_CATALOG.map((c) => [c.type, c]));

/** Look up a component spec by its UIKit type name. */
export function specForType(type: string | null | undefined): ComponentSpec | null {
  if (!type) return null;
  return BY_TYPE.get(type) ?? null;
}

/** All known UIKit type names (for tree classification). */
export const UIKIT_TYPES: string[] = UIKIT_CATALOG.map((c) => c.type);

// Most-specific first: a Switch node also carries RoundedRectangle/Interactable,
// but it IS a Switch. Containers/controls win over the visuals they're built from.
const TYPE_PRIORITY = [
  'Frame', 'BackPlate', 'Switch', 'Slider', 'Button', 'Toggle', 'ProgressBar',
  'Dropdown', 'ScrollBar', 'TextInputField', 'TextInputArea',
  'GridLayout', 'FlexLayout', 'Text', 'Image', 'FlexItem', 'RoundedRectangle',
];

/** Pick the most-specific UIKit type from a node's runtime componentTypes. */
export function deriveType(componentTypes: string[]): string | null {
  for (const t of TYPE_PRIORITY) if (componentTypes.includes(t)) return t;
  return null;
}
