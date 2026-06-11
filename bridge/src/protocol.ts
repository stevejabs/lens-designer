// WebSocket protocol between the bridge daemon and the web designer.
//
// Wire format: JSON text frames, one message per frame. Each message
// has a discriminated `type` field; the schemas below are the source
// of truth for what each carries.
//
// See PROTOCOL.md (sibling file) for prose, examples, and the rationale
// behind each shape.

import { z } from 'zod';

// ---- Shared shapes ----

export const WindowRegionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type WindowRegion = z.infer<typeof WindowRegionSchema>;

export const Vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2Schema>;

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3Schema>;

export const Vec4Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});
export type Vec4 = z.infer<typeof Vec4Schema>;

// ---- Interaction metadata (v1a) ----
// Marks a node/group as interactive. The applier realizes this by attaching
// SIK components (Interactable + a role component + feedback). Behavior is
// wired at runtime by action key, not from the designer.

export const RgbaSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(), // 0–100 (percent), matching the designer's color format
});
export type Rgba = z.infer<typeof RgbaSchema>;

export const InteractionRoleSchema = z.enum(['button', 'toggle', 'draggable']);
export type InteractionRole = z.infer<typeof InteractionRoleSchema>;

/** The interaction states a node can react to. */
export const InteractionStateSchema = z.enum(['default', 'hover', 'pinched', 'disabled']);
export type InteractionState = z.infer<typeof InteractionStateSchema>;

/** Per-state fill colors realized via SIK InteractableColorFeedback. */
export const ColorStatesSchema = z.object({
  default: RgbaSchema.optional(),
  hover: RgbaSchema.optional(),
  pinched: RgbaSchema.optional(),
  disabled: RgbaSchema.optional(),
});
export type ColorStates = z.infer<typeof ColorStatesSchema>;

export const InteractionSchema = z.object({
  role: InteractionRoleSchema,
  /** Stable id the runtime subscribes to (onAction(actionKey, cb)). */
  actionKey: z.string().optional(),
  /** Declarative color feedback per interaction state. */
  colorStates: ColorStatesSchema.optional(),
});
export type Interaction = z.infer<typeof InteractionSchema>;

// ---- Bindings / codegen (B1) ----
// A View marks a (group) node as an exported, code-bindable component: codegen
// emits a controller class for it. A Binding tags any element inside a View as
// a named, code-controllable slot (the controller exposes a typed handle).

export const ViewSchema = z.object({
  /** Controller class name, e.g. "PoiCardView". */
  name: z.string().min(1),
});
export type View = z.infer<typeof ViewSchema>;

export const BindingSchema = z.object({
  /** Handle name on the generated controller, e.g. "title", "hero". */
  key: z.string().min(1),
});
export type Binding = z.infer<typeof BindingSchema>;

// ---- Shared components (composition) ----
// An Instance node references another saved view (the DEFINITION) by id. It is
// a leaf in the authored tree (children: []); the bridge expands it into the
// definition's subtree at apply time (instances.ts), so editing the definition
// propagates to every instance with no re-wiring. Per-instance overrides are
// deliberately narrow in v1: bound slot values (text / image source) + the
// interaction actionKey. See docs/plans/2026-06-09-lens-designer-shared-
// components-scope.md.

export const InstanceRefSchema = z.object({
  /** The definition view's registry id. */
  of: z.string().min(1),
  overrides: z
    .object({
      /** Bound-slot value overrides keyed by the definition's binding keys.
       *  Text slots take a string (text); Image slots take a string
       *  (project-relative image source). */
      slots: z.record(z.unknown()).optional(),
      /** Replaces the definition root's interaction actionKey. */
      actionKey: z.string().optional(),
    })
    .optional(),
});
export type InstanceRef = z.infer<typeof InstanceRefSchema>;

// ---- Per-element per-state overrides (v1b — supersedes colorStates +
// visibleInStates). Any element inside (or on) an interactive ancestor may carry
// optional per-state overrides; only the changed props are stored, the rest
// inherit the element's base (default-state) properties. See the 2026-05-28
// code-driven-views architecture, §2.1 + TD-1.

/** The properties an element can override per interaction state. The final v1
 *  set: visible, fill, stroke, strokeWidth, opacity, position, scale, +textColor
 *  (Text). Rotation is intentionally excluded. Resolution to LS write targets
 *  (incl. the opacity→alpha fold) is centralized in `resolveLSWrites` (TD-8). */
export const STATE_PROP_KEYS = [
  'visible',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'opacity',
  'position',
  'scale',
  'textColor',
] as const;
export type StatePropKey = (typeof STATE_PROP_KEYS)[number];

export const StatePropsSchema = z.object({
  visible: z.boolean().optional(), // → SceneObject.enabled
  fillColor: RgbaSchema.optional(), // shapes → mainPass(Overrides).baseColor
  strokeColor: RgbaSchema.optional(), // shapes → mainPass(Overrides).strokeColor
  strokeWidth: z.number().optional(), // shapes → strokeThickness (cm)
  opacity: z.number().optional(), // 0–100 → fill/text alpha (via resolveLSWrites)
  position: Vec2Schema.optional(), // cm, local — delta from base
  scale: Vec2Schema.optional(), // multiplier on base scale
  textColor: RgbaSchema.optional(), // Text → textFill.color
});
export type StateProps = z.infer<typeof StatePropsSchema>;

/** Per-element overrides keyed by state. `default` is the node's base props, so
 *  only the three non-default states carry overrides. */
export const StateOverridesSchema = z.object({
  hover: StatePropsSchema.optional(),
  pinched: StatePropsSchema.optional(),
  disabled: StatePropsSchema.optional(),
});
export type StateOverrides = z.infer<typeof StateOverridesSchema>;

// ---- Layout (TD-10, reserved in WB1; behavior built in WB-L) ----
// A "stack-lite" hug container: a Group lays children out on one axis with
// spacing + padding and (when `hug`) sizes itself to its content. NOT full
// autolayout — no inter-node constraints. Consumed by WB-L; defined now so the
// model field is stable.
export const LayoutSpecSchema = z.object({
  mode: z.enum(['row', 'column']),
  spacing: z.number(),
  padding: Vec2Schema,
  hug: z.boolean(),
});
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

// The DesignNode TS type matches arch §6.1. zod can't express the
// recursive children array cleanly without z.lazy, so we use lazy here.
// type vs. inferred shape are kept in sync by the manifest layer in C.
export interface DesignNode {
  id: string;
  type: string;
  name: string;
  transform: { position: Vec3; rotation: Vec3; scale: Vec3 };
  properties: Record<string, unknown>;
  /** Optional interaction metadata (absent = non-interactive). */
  interaction?: Interaction | undefined;
  /** Per-element per-state overrides (v1b). Supersedes `visibleInStates` and
   *  `interaction.colorStates`. Only meaningful inside/on an interactive node. */
  stateOverrides?: StateOverrides | undefined;
  /** Stack-lite layout (TD-10, WB-L). Group-only semantics. When set + `hug`,
   *  the group sizes to its CONTENT children + padding. */
  layout?: LayoutSpec | undefined;
  /** WB-L: this child stretches to its parent group's hugged bounds (the
   *  "background" of a content-sized pill) instead of being flowed/measured as
   *  content. Ignored unless the parent group has a hug `layout`. */
  fillParent?: boolean | undefined;
  /** @deprecated v1b — superseded by `stateOverrides.{state}.visible`. Kept
   *  transiently so consumers compile until they migrate; removed in cleanup. */
  visibleInStates?: InteractionState[] | undefined;
  /** Marks this (group) node as an exported, code-bindable component/View. */
  view?: View | undefined;
  /** Tags this node as a named, code-controllable slot inside its View. */
  binding?: Binding | undefined;
  /** Marks this node as an INSTANCE of another saved view (shared component).
   *  Leaf in the authored tree; expanded to the definition's subtree at apply
   *  time. type is 'Instance' for these nodes. */
  instance?: InstanceRef | undefined;
  children: DesignNode[];
}

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().min(1),
    transform: z.object({
      position: Vec3Schema,
      rotation: Vec3Schema,
      scale: Vec3Schema,
    }),
    properties: z.record(z.unknown()),
    interaction: InteractionSchema.optional(),
    stateOverrides: StateOverridesSchema.optional(),
    layout: LayoutSpecSchema.optional(),
    fillParent: z.boolean().optional(),
    visibleInStates: z.array(InteractionStateSchema).optional(),
    view: ViewSchema.optional(),
    binding: BindingSchema.optional(),
    instance: InstanceRefSchema.optional(),
    children: z.array(DesignNodeSchema),
  }),
);

// ---- Server → client messages ----

export const HelloMsgSchema = z.object({
  type: z.literal('hello'),
  server: z.object({
    name: z.string(),
    version: z.string(),
  }),
  sandbox: z.object({
    url: z.string().url(),
    port: z.number().int().positive(),
  }),
});
export type HelloMsg = z.infer<typeof HelloMsgSchema>;

export const SandboxDownMsgSchema = z.object({
  type: z.literal('sandbox.down'),
  reason: z.string().min(1),
});
export type SandboxDownMsg = z.infer<typeof SandboxDownMsgSchema>;

export const DesignAppliedMsgSchema = z.object({
  type: z.literal('design.applied'),
  appliedAt: z.number().finite(),
  nodeIds: z.array(z.string().min(1)),
});
export type DesignAppliedMsg = z.infer<typeof DesignAppliedMsgSchema>;

export const DesignErrorMsgSchema = z.object({
  type: z.literal('design.error'),
  error: z.object({
    nodeId: z.string().min(1).nullable(),
    propertyPath: z.string().min(1).nullable(),
    lsError: z.string().min(1),
  }),
});
export type DesignErrorMsg = z.infer<typeof DesignErrorMsgSchema>;

export const PreviewReadyMsgSchema = z.object({
  type: z.literal('preview.ready'),
  url: z.string().regex(
    /^\/preview\/[0-9a-f-]+\.png$/i,
    'preview URL must match /preview/<uuid>.png',
  ),
  capturedAt: z.number().finite(),
  region: WindowRegionSchema,
});
export type PreviewReadyMsg = z.infer<typeof PreviewReadyMsgSchema>;


// ---- Attach-mode messages (Step 2) ----
// Layer on top of the legacy hello / sandbox.down protocol — the bridge
// emits both during the transition window. `attached` carries the richer
// session state; `hello` stays for the existing web client to keep working.

/** One LS instance the picker can offer. `hasMarker` flags the sandbox. */
export const TargetSummarySchema = z.object({
  port: z.number().int().positive(),
  hasMarker: z.boolean(),
  /** Best-effort project label; null when LS doesn't surface one. */
  projectName: z.string().nullable().optional(),
});
export type TargetSummary = z.infer<typeof TargetSummarySchema>;

/** One saved view's summary, as returned by view.list. */
export const ViewSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The controller's code identity (the tree's view.name). May differ from
   *  `name` (the display label) after a rename — the UI warns before letting a
   *  rename create that divergence. */
  codeName: z.string().min(1),
  updatedAt: z.number().finite(),
  /** Shared components: true when a definition this view instances was edited
   *  after this view's prefab was last published — re-publish to refresh. */
  stale: z.boolean().optional(),
});
export type ViewSummary = z.infer<typeof ViewSummarySchema>;

/** view.save → view.saved: the generation result. Under the no-export model the
 *  controller `.ts` is the only artifact; `prefab` is legacy/optional. */
export const GeneratedRefSchema = z.object({
  prefab: z.string().min(1).optional(),
  controller: z.string().min(1),
  atVersion: z.number().int().positive(),
  /** When the prefab was last (re)published — drives the stale-dependents
   *  badge for shared components (a definition edited after a dependent's
   *  publish means the dependent's prefab is stale). */
  publishedAt: z.number().finite().optional(),
});
export type GeneratedRef = z.infer<typeof GeneratedRefSchema>;

export const TargetListResultMsgSchema = z.object({
  type: z.literal('target.list.result'),
  targets: z.array(TargetSummarySchema),
});
export type TargetListResultMsg = z.infer<typeof TargetListResultMsgSchema>;

export const AttachedMsgSchema = z.object({
  type: z.literal('attached'),
  target: z.object({
    port: z.number().int().positive(),
    kind: z.enum(['sandbox', 'attached']),
    /** Project name when known, else null. */
    projectName: z.string().nullable(),
    /** Absolute path supplied via target.set-assets-dir (null until set in attached mode). */
    assetsDir: z.string().nullable(),
  }),
  views: z.array(ViewSummarySchema),
  /** True when binary ingest is unavailable because assetsDir is unset. */
  needsAssetsDir: z.boolean(),
});
export type AttachedMsg = z.infer<typeof AttachedMsgSchema>;

export const ViewSavedMsgSchema = z.object({
  type: z.literal('view.saved'),
  id: z.string().min(1),
  generated: GeneratedRefSchema.nullable(),
  warnings: z.array(z.string()),
});
export type ViewSavedMsg = z.infer<typeof ViewSavedMsgSchema>;

export const ViewRepublishedMsgSchema = z.object({
  type: z.literal('view.republished'),
  id: z.string().min(1),
  /** Project-relative `.prefab` path now backing the view. */
  prefab: z.string().min(1),
  /** `created` = new prefab written; `updated` = existing prefab updated in place
   *  (UUID preserved, so wired references survive). */
  mode: z.enum(['created', 'updated']),
});
export type ViewRepublishedMsg = z.infer<typeof ViewRepublishedMsgSchema>;

export const ViewLoadedMsgSchema = z.object({
  type: z.literal('view.loaded'),
  id: z.string().min(1),
  tree: z.array(DesignNodeSchema),
});
export type ViewLoadedMsg = z.infer<typeof ViewLoadedMsgSchema>;

/** Reply to `view.get` — the tree only, nothing applied. */
export const ViewTreeMsgSchema = z.object({
  type: z.literal('view.tree'),
  id: z.string().min(1),
  /** The view's code identity (class name source) — the web needs it to label
   *  instances without re-deriving. */
  codeName: z.string().min(1),
  tree: z.array(DesignNodeSchema),
});
export type ViewTreeMsg = z.infer<typeof ViewTreeMsgSchema>;

/** Reply to `view.rename` — a TRUE rename: label + code identity moved
 *  together (controller `.ts` + `.prefab` renamed with stable UUIDs). The
 *  client must adopt `tree` (its view node now carries the new view.name) or
 *  the next autosave would revert the rename. */
export const ViewRenamedMsgSchema = z.object({
  type: z.literal('view.renamed'),
  id: z.string().min(1),
  name: z.string().min(1),
  codeName: z.string().min(1),
  tree: z.array(DesignNodeSchema),
  /** Non-fatal cleanup notes (e.g. an orphaned old controller that couldn't
   *  be deleted). Empty on a clean rename. */
  warnings: z.array(z.string()),
});
export type ViewRenamedMsg = z.infer<typeof ViewRenamedMsgSchema>;

/** Designer mode broadcast: `designing=false` means the bridge has paused the
 *  reconcile loop and put the scene in runtime posture (edit bay hidden, app
 *  bay shown) WITHOUT detaching — the session, registry saves, and codegen
 *  stay live. On `designing=true` the client should re-send its current tree
 *  (`design.apply`) to converge the re-shown edit bay. */
export const DesignerModeMsgSchema = z.object({
  type: z.literal('designer.mode'),
  designing: z.boolean(),
});
export type DesignerModeMsg = z.infer<typeof DesignerModeMsgSchema>;

export const ViewListResultMsgSchema = z.object({
  type: z.literal('view.list.result'),
  views: z.array(ViewSummarySchema),
});
export type ViewListResultMsg = z.infer<typeof ViewListResultMsgSchema>;

/**
 * Confirms `design.clear` finished wiping the edit surface. Renderer
 * uses this to drop the local "clearing…" indicator. No payload — the
 * applier guarantees post-condition is "edit surface has zero designer
 * children".
 */
export const DesignClearedMsgSchema = z.object({
  type: z.literal('design.cleared'),
});
export type DesignClearedMsg = z.infer<typeof DesignClearedMsgSchema>;

/**
 * Result of a `design.gc` sweep. Counts are per-class; `errors` lists
 * per-file failures (typically permission issues — the sweep continues
 * past them). `triggeredBy` distinguishes a user-initiated sweep from
 * a periodic background one so the renderer can suppress toast spam.
 */
export const DesignGcResultMsgSchema = z.object({
  type: z.literal('design.gc.result'),
  triggeredBy: z.enum(['manual', 'auto']),
  deleted: z.object({
    materials: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    fonts: z.number().int().nonnegative(),
  }),
  kept: z.object({
    materials: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    fonts: z.number().int().nonnegative(),
  }),
  errors: z.array(z.string()),
  /**
   * Filenames of deleted font files (e.g. `font_abc.ttf`). Renderer
   * removes matching entries from its `customFonts` store so the font
   * picker doesn't list fonts whose files were just swept.
   */
  deletedFontFiles: z.array(z.string()),
});
export type DesignGcResultMsg = z.infer<typeof DesignGcResultMsgSchema>;

/** Reply to `fonts.list-system`. */
export const FontsSystemListMsgSchema = z.object({
  type: z.literal('fonts.system-list'),
  fonts: z.array(
    z.object({
      family: z.string().min(1),
      file: z.string().min(1),
      ext: z.enum(['ttf', 'otf']),
    }),
  ),
});
export type FontsSystemListMsg = z.infer<typeof FontsSystemListMsgSchema>;

/**
 * Reply to `fonts.list-project`. `files` is the set of font filenames
 * present in `<project>/Assets/LensDesigner/fonts/` (just basenames,
 * including the `LDFont_*` packaged fonts). Renderer uses this as the
 * source-of-truth to drop ghost customFonts entries.
 */
export const FontsProjectListMsgSchema = z.object({
  type: z.literal('fonts.project-list'),
  files: z.array(z.string().min(1)),
});
export type FontsProjectListMsg = z.infer<typeof FontsProjectListMsgSchema>;

/**
 * Reply to `fonts.add-from-system` on success. `path` is the
 * sandbox-relative path (`LensDesigner/fonts/font_<hash>.ttf`) ready
 * to feed into `addCustomFont`. `family` is the display name the
 * client requested — echoed so the client knows which add succeeded
 * when multiple are in flight.
 */
export const FontsAddedMsgSchema = z.object({
  type: z.literal('fonts.added'),
  family: z.string().min(1),
  path: z.string().min(1),
});
export type FontsAddedMsg = z.infer<typeof FontsAddedMsgSchema>;

/**
 * One-off full-window snapshot of the current LS window, sent in reply
 * to `preview.capture-full`. Dimensions are the LS window's bounds in
 * window pixels — the renderer uses them to translate a drag-rect (in
 * displayed-image pixels) back into a window-relative WindowRegion.
 */
export const PreviewFullSnapshotMsgSchema = z.object({
  type: z.literal('preview.full-snapshot'),
  url: z.string().min(1),
  windowWidth: z.number().int().positive(),
  windowHeight: z.number().int().positive(),
  capturedAt: z.number().finite(),
});
export type PreviewFullSnapshotMsg = z.infer<typeof PreviewFullSnapshotMsgSchema>;

// Generic LS MCP passthrough. Lets a WS client (incl. tooling) invoke ANY Lens
// Studio MCP tool against whatever instance the bridge can reach — the active
// attached target by default, or any `port` (the bridge auto-discovers LS and
// holds the shared bearer). The multi-port escape hatch: no dependency on a
// statically-configured MCP URL, no reconnect when LS reassigns its port.
export const McpCallMsgSchema = z.object({
  type: z.literal('mcp.call'),
  requestId: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  /** Target a specific LS MCP port; omitted → the active attached target. */
  port: z.number().int().positive().optional(),
});
export type McpCallMsg = z.infer<typeof McpCallMsgSchema>;

export const McpResultMsgSchema = z.object({
  type: z.literal('mcp.result'),
  requestId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type McpResultMsg = z.infer<typeof McpResultMsgSchema>;

export const ServerToClientMsgSchema = z.discriminatedUnion('type', [
  HelloMsgSchema,
  SandboxDownMsgSchema,
  DesignAppliedMsgSchema,
  DesignErrorMsgSchema,
  PreviewReadyMsgSchema,
  DesignClearedMsgSchema,
  DesignGcResultMsgSchema,
  FontsSystemListMsgSchema,
  FontsProjectListMsgSchema,
  FontsAddedMsgSchema,
  PreviewFullSnapshotMsgSchema,
  // attach-mode additions:
  TargetListResultMsgSchema,
  AttachedMsgSchema,
  ViewSavedMsgSchema,
  ViewRepublishedMsgSchema,
  ViewRenamedMsgSchema,
  ViewLoadedMsgSchema,
  ViewTreeMsgSchema,
  ViewListResultMsgSchema,
  DesignerModeMsgSchema,
  McpResultMsgSchema,
]);
export type ServerToClientMsg = z.infer<typeof ServerToClientMsgSchema>;

// ---- Client → server messages ----

export const DesignApplyMsgSchema = z.object({
  type: z.literal('design.apply'),
  tree: z.array(DesignNodeSchema),
});
export type DesignApplyMsg = z.infer<typeof DesignApplyMsgSchema>;

export const PreviewConfigureRegionMsgSchema = z.object({
  type: z.literal('preview.configure-region'),
  region: WindowRegionSchema,
});
export type PreviewConfigureRegionMsg = z.infer<typeof PreviewConfigureRegionMsgSchema>;

/**
 * Request a one-off snapshot of the entire LS window (no region crop),
 * for the drag-to-pick region picker. Bridge replies with
 * `preview.full-snapshot` containing url + window dims. Does NOT change
 * the persistent capture region — the picker only commits via
 * `preview.configure-region`.
 */
export const PreviewCaptureFullMsgSchema = z.object({
  type: z.literal('preview.capture-full'),
});
export type PreviewCaptureFullMsg = z.infer<typeof PreviewCaptureFullMsgSchema>;

/**
 * Set the world-space distance (cm) from the Spectacles camera to the
 * ActiveComponent root. Bridge updates its module-level default and
 * immediately repositions the SO via setProperty so the change is
 * visible on the next live-preview tick without needing an apply.
 */
export const PreviewSetDistanceMsgSchema = z.object({
  type: z.literal('preview.set-distance'),
  cm: z.number().finite().min(10).max(500),
});
export type PreviewSetDistanceMsg = z.infer<typeof PreviewSetDistanceMsgSchema>;

/**
 * Wipe every designer-placed scene object out of the attached project's
 * edit surface. Preserves the edit-surface SceneObject itself (we don't
 * own it in attached mode) and preserves owned assets under
 * Assets/LensDesigner/. Bridge replies with `design.cleared`.
 */
export const DesignClearMsgSchema = z.object({
  type: z.literal('design.clear'),
});
export type DesignClearMsg = z.infer<typeof DesignClearMsgSchema>;

/** Enumerate fonts installed on the host OS (filtered to .ttf/.otf). */
export const FontsListSystemMsgSchema = z.object({
  type: z.literal('fonts.list-system'),
});
export type FontsListSystemMsg = z.infer<typeof FontsListSystemMsgSchema>;

/** Enumerate fonts currently present in `<project>/Assets/LensDesigner/fonts/`. */
export const FontsListProjectMsgSchema = z.object({
  type: z.literal('fonts.list-project'),
});
export type FontsListProjectMsg = z.infer<typeof FontsListProjectMsgSchema>;

/**
 * Add a system font to the project. Bridge reads the file (after
 * validating the path is under a known OS font dir) and ingests it
 * via the existing font-bytes pipeline.
 */
export const FontsAddFromSystemMsgSchema = z.object({
  type: z.literal('fonts.add-from-system'),
  systemPath: z.string().min(1),
  family: z.string().min(1),
});
export type FontsAddFromSystemMsg = z.infer<typeof FontsAddFromSystemMsgSchema>;

/**
 * Sweep orphaned per-node materials, ingested images, and ingested
 * fonts out of `Assets/LensDesigner/`. Caller supplies its in-memory
 * working tree (covers unsaved work) + customFonts mapping (lets the
 * bridge resolve font-name → file). Saved-view trees are read by the
 * bridge from the registry.
 */
export const DesignGcMsgSchema = z.object({
  type: z.literal('design.gc'),
  currentTree: z.array(DesignNodeSchema),
  customFonts: z.array(
    z.object({
      family: z.string().min(1),
      path: z.string().min(1),
    }),
  ),
});
export type DesignGcMsg = z.infer<typeof DesignGcMsgSchema>;

// ---- Attach-mode client → server messages (Step 2) ----

export const TargetListMsgSchema = z.object({
  type: z.literal('target.list'),
});
export type TargetListMsg = z.infer<typeof TargetListMsgSchema>;

export const TargetAttachMsgSchema = z.object({
  type: z.literal('target.attach'),
  port: z.number().int().positive(),
  mode: z.enum(['sandbox', 'attached']),
  /** Required for attached mode; ignored for sandbox. Absolute filesystem path. */
  assetsDir: z.string().min(1).optional(),
  /** Optional user-supplied display name for an attached target (shown in the
   *  chip/picker instead of "port N"). Ignored for sandbox. */
  label: z.string().optional(),
});
export type TargetAttachMsg = z.infer<typeof TargetAttachMsgSchema>;

export const TargetDetachMsgSchema = z.object({
  type: z.literal('target.detach'),
});
export type TargetDetachMsg = z.infer<typeof TargetDetachMsgSchema>;

export const TargetSetAssetsDirMsgSchema = z.object({
  type: z.literal('target.set-assets-dir'),
  assetsDir: z.string().min(1),
});
export type TargetSetAssetsDirMsg = z.infer<typeof TargetSetAssetsDirMsgSchema>;

/** Name regex enforced server-side too — must be a valid TS class name. */
// Dashes are allowed in view names — the prefab folder + controller
// filename get the raw name (filesystem-safe) while the TS class
// identifier inside the controller is PascalCased by `generateController`.
const VIEW_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const ViewListMsgSchema = z.object({
  type: z.literal('view.list'),
});
export type ViewListMsg = z.infer<typeof ViewListMsgSchema>;

export const ViewLoadMsgSchema = z.object({
  type: z.literal('view.load'),
  id: z.string().min(1),
});
export type ViewLoadMsg = z.infer<typeof ViewLoadMsgSchema>;

export const ViewSaveMsgSchema = z.object({
  type: z.literal('view.save'),
  /** Optional view id — when omitted the registry creates a new view. */
  id: z.string().min(1).optional(),
  name: z.string().regex(VIEW_NAME_RE, 'view name must start with a letter and contain only letters, digits, dashes, or underscores'),
  tree: z.array(DesignNodeSchema),
  /**
   * Skip prefab + controller codegen — bridge just writes the registry
   * entry. Autosave passes this so the 800ms-debounced persist doesn't
   * race the live-preview applier on every keystroke. Explicit Save
   * (and the export flow) leave it false so the codegen runs.
   */
  skipGenerate: z.boolean().optional(),
  /** When true (auto-publish toggle on), also re-publish the view's prefab in
   *  place after saving, so design changes flow to wired consumers live. */
  republish: z.boolean().optional(),
});
export type ViewSaveMsg = z.infer<typeof ViewSaveMsgSchema>;

export const ViewDeleteMsgSchema = z.object({
  type: z.literal('view.delete'),
  id: z.string().min(1),
});
export type ViewDeleteMsg = z.infer<typeof ViewDeleteMsgSchema>;

/** Explicit "Re-publish prefab" — recapture the view's bay instance into its
 *  `.prefab` (splice-in-place so placed instances survive). */
export const ViewRepublishMsgSchema = z.object({
  type: z.literal('view.republish'),
  id: z.string().min(1),
});
export type ViewRepublishMsg = z.infer<typeof ViewRepublishMsgSchema>;

/** Fetch a view's tree WITHOUT loading it into the edit surface. Used by the
 *  web to render shared-component instances on the canvas (the definition's
 *  tree drawn read-only inside the consuming view). */
export const ViewGetMsgSchema = z.object({
  type: z.literal('view.get'),
  id: z.string().min(1),
});
export type ViewGetMsg = z.infer<typeof ViewGetMsgSchema>;

/** TRUE rename: moves the label AND the code identity together. The bridge
 *  renames the controller `.ts` + `.prefab` assets in place (stable UUIDs, so
 *  the bay component + wired prefab references survive), rewrites the
 *  controller with the new class name, retags the tree's view node, and
 *  replies `view.renamed` with the updated tree. `tree` is the client's
 *  CURRENT tree (like view.save) so no local WIP is lost. */
export const ViewRenameMsgSchema = z.object({
  type: z.literal('view.rename'),
  id: z.string().min(1),
  newName: z.string().regex(VIEW_NAME_RE, 'view name must start with a letter and contain only letters, digits, dashes, or underscores'),
  tree: z.array(DesignNodeSchema),
});
export type ViewRenameMsg = z.infer<typeof ViewRenameMsgSchema>;

/** Toggle the designer's reconcile loop without detaching. `designing=false`
 *  puts the scene in runtime posture and drops incoming design.apply traffic;
 *  `designing=true` restores design posture (client re-sends its tree). */
export const DesignerSetModeMsgSchema = z.object({
  type: z.literal('designer.set-mode'),
  designing: z.boolean(),
});
export type DesignerSetModeMsg = z.infer<typeof DesignerSetModeMsgSchema>;

export const ClientToServerMsgSchema = z.discriminatedUnion('type', [
  DesignApplyMsgSchema,
  McpCallMsgSchema,
  DesignClearMsgSchema,
  DesignGcMsgSchema,
  FontsListSystemMsgSchema,
  FontsListProjectMsgSchema,
  FontsAddFromSystemMsgSchema,
  PreviewConfigureRegionMsgSchema,
  PreviewCaptureFullMsgSchema,
  PreviewSetDistanceMsgSchema,
  // attach-mode additions:
  TargetListMsgSchema,
  TargetAttachMsgSchema,
  TargetDetachMsgSchema,
  TargetSetAssetsDirMsgSchema,
  ViewListMsgSchema,
  ViewLoadMsgSchema,
  ViewSaveMsgSchema,
  ViewDeleteMsgSchema,
  ViewRepublishMsgSchema,
  ViewRenameMsgSchema,
  ViewGetMsgSchema,
  DesignerSetModeMsgSchema,
]);
export type ClientToServerMsg = z.infer<typeof ClientToServerMsgSchema>;
