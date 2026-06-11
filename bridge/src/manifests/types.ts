// Manifest type system — how a designer-facing primitive maps to a
// Lens Studio scene shape and the property forms in the Inspector.
//
// Architecture doc §6.2 is the canonical reference. Manifests are
// data: each primitive ships as a single TS file under this directory
// and the registry at index.ts pulls them all together.
//
// A manifest carries three things:
//   1. The primitive's identity (type, displayName, category).
//   2. The Inspector contract (properties[]): name, kind, defaults,
//      min/max, enum options.
//   3. The LS scene contract (sceneShape): how to materialize the
//      primitive into Lens Studio components, and how each designer
//      property maps to a specific LS property.

import { z } from 'zod';

// ---- Property descriptor (Inspector form) ----

export const PropertyKindSchema = z.enum([
  'number',
  'string',
  'boolean',
  'color',
  'enum',
  'vec2',
  'vec3',
  'asset',
  'font',
  'image', // image source: upload-from-disk or URL; Inspector shows a picker
]);
export type PropertyKind = z.infer<typeof PropertyKindSchema>;

export const PropertyDescriptorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: PropertyKindSchema,
  default: z.unknown(),
  // Optional Inspector hints.
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(), // enum values
  unit: z.string().optional(), // "cm", "deg", "%", etc.
  /**
   * Visual style hint for the Inspector. Default behavior per kind:
   * - 'enum' → dropdown (when options.length > 4) or 'toggle' (≤4 options).
   * Explicit 'toggle' forces a row of toggle buttons (one per option).
   * Explicit 'dropdown' forces a dropdown.
   */
  style: z.enum(['toggle', 'dropdown']).optional(),
  // For 'string' kind: render a multi-line textarea instead of a single-line
  // input (the value may contain newlines).
  multiline: z.boolean().optional(),
  // Optional Inspector grouping ("Position", "Transform", "Content", ...).
  section: z.string().optional(),
});
export type PropertyDescriptor = z.infer<typeof PropertyDescriptorSchema>;

// ---- Scene shape (LS materialization) ----

export const ValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'vec2',
  'vec3',
  'vec4',
  'rect', // {left, right, bottom, top} — LS Editor.Rect
  'enum',
]);
export type ValueType = z.infer<typeof ValueTypeSchema>;

export const PropertyTransformSchema = z.enum([
  'identity',
  'cm-to-units', // designer cm → LS world units (1:1 for Spectacles, but keep the seam)
  'cm-to-text-size', // designer cm → LS Text.size units. Empirically ~40× cm.
  'cm-to-unit-norm', // designer cm → normalized 0–1 shader unit (divides by node `size`)
  'cm-to-world-rect', // {x,y} cm bounds (centered at origin) → {left,right,bottom,top}
  'deg-to-rad', // degrees in designer → radians in LS
  'rgb-to-vec4', // {r,g,b,a} hex+alpha → {x,y,z,w} vec4
  'percent-to-01', // 0–100 percent → 0–1 normalized
]);
export type PropertyTransform = z.infer<typeof PropertyTransformSchema>;

export const PropertyMappingSchema = z.object({
  // Source designer property key (e.g. "fillColor").
  source: z.string().min(1),
  // Target LS property path on the component (e.g. "mainPass.baseColor").
  target: z.string().min(1),
  // Required ValueType for SetLensStudioProperty.
  valueType: ValueTypeSchema,
  // Required when valueType='enum'. Bridge passes this through to MCP.
  enumType: z.string().optional(),
  // Optional value transform applied before the MCP call.
  transform: PropertyTransformSchema.optional(),
});
export type PropertyMapping = z.infer<typeof PropertyMappingSchema>;

export const ComponentKindSchema = z.enum([
  'SceneObject', // no rendered component — bare SO (used for Group / parent)
  'Image', // LS Image component (with optional material)
  'Text', // LS Text component
  'RenderMeshVisual', // LS RenderMeshVisual (Plane mesh + material)
]);
export type ComponentKind = z.infer<typeof ComponentKindSchema>;

// SceneShapeNode is recursive (composite primitives expand into a tree).
// zod needs z.lazy for the children array.
export interface SceneShapeNode {
  componentKind: ComponentKind;
  /**
   * Reference to an existing material asset (for Phase 2+'s shared
   * material library). Null in Phase 1 — we instantiate per-node via
   * `materialPreset` instead.
   */
  materialRef: string | null;
  /**
   * LS preset name (from GetPresetRegistryTool) to instantiate as a
   * fresh per-node material when the component is created. Null when
   * the primitive doesn't need a material (Text uses textFill.color
   * directly; bare SceneObjects have no material).
   */
  materialPreset: string | null;
  /**
   * Path to a project material that the applier disk-clones per-node
   * (e.g. "LensDesigner/LensDesignerRoundedRect.mat"). Used when the
   * primitive needs a custom ShaderGraph — stroke, corner radius, etc.
   * Takes precedence
   * over `materialPreset` when both are set.
   */
  materialTemplatePath: string | null;
  // Per-node SO transform mappings (position, rotation, scale).
  transformMappings: PropertyMapping[];
  // Per-component property mappings (color, text, font, etc.).
  componentMappings: PropertyMapping[];
  children: SceneShapeNode[];
}

export const SceneShapeNodeSchema: z.ZodType<SceneShapeNode> = z.lazy(() =>
  z.object({
    componentKind: ComponentKindSchema,
    materialRef: z.string().nullable(),
    materialPreset: z.string().nullable(),
    materialTemplatePath: z.string().nullable(),
    transformMappings: z.array(PropertyMappingSchema),
    componentMappings: z.array(PropertyMappingSchema),
    children: z.array(SceneShapeNodeSchema),
  }),
);

// ---- Top-level manifest ----

export const PrimitiveCategorySchema = z.enum(['atomic', 'composite', 'container']);
export type PrimitiveCategory = z.infer<typeof PrimitiveCategorySchema>;

export const PrimitiveManifestSchema = z.object({
  type: z.string().min(1),
  category: PrimitiveCategorySchema,
  displayName: z.string().min(1),
  /** Optional glyph the palette renders alongside the name. */
  glyph: z.string().optional(),
  defaultProperties: z.record(z.unknown()),
  properties: z.array(PropertyDescriptorSchema),
  sceneShape: SceneShapeNodeSchema,
});
export type PrimitiveManifest = z.infer<typeof PrimitiveManifestSchema>;
