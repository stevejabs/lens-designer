// Mutation applier — turns a design tree into a sequence of MCP calls
// that converge the sandbox scene to match.
//
// Phase 1 implementation is teardown-and-rebuild: every apply clears
// the children of `ActiveComponent` and rebuilds from the tree. Cheap
// diffing arrives in Phase 2. For Phase 1 trees (<20 nodes) the
// rebuild cost is negligible compared to the 100 ms debounce + 144 ms
// screencap that follow.

import {
  McpClient,
  attachScriptComponent,
  createAssetFromPreset,
  createComponent,
  createSceneObject,
  deleteComponent,
  deleteSceneObject,
  duplicateMaterialAssetOnDisk,
  getAssetByPath,
  getAssetIdByName,
  getSceneObjectById,
  getSceneObjectByName,
  getTextureInfo,
  setProperty,
  type LSSceneObject,
  type MaterialOverrides,
  type ValueType,
} from './mcp.ts';
import { getActiveScope } from './scope.ts';
import { computeHugLayout, type HugItem } from './layout.ts';
import { expandInstances, treeHasInstances } from './instances.ts';
import { loadRegistry } from './registry.ts';
import type { DesignNode, InteractionRole, Rgba } from './protocol.ts';
import {
  isVec2,
  isVec3,
  isRgba,
  DEG_TO_RAD,
  resolveMappingValue,
  type ResolveValueContext,
} from './resolve-writes.ts';
import {
  getManifest,
  type PrimitiveManifest,
  type PropertyMapping,
  type PropertyTransform,
} from './manifests/index.ts';
import { FONT_PRESETS } from './manifests/text.ts';
import { ALIGN_9, computeTexTransform, type FitMode } from './image-fit.ts';

/**
 * z-axis offset between adjacent layers, in cm. 1 mm.
 * Small enough to be imperceptible on a card placed ~52 cm from the camera
 * (the design still reads as flat 2D), but large enough that LS's depth
 * buffer reliably resolves the ordering. The previous 0.001 cm (0.01 mm)
 * was below depth-buffer precision at AR distance, so adjacent layers
 * z-fought and flipped visibility with head angle (front layers vanished
 * when viewed off-axis, leaving only the backmost fill). 0.05 cm fixed the
 * image but text (alpha-blended, more depth-sensitive) still flickered at a
 * 0.05 cm gap; 0.1 cm clears it on device.
 */
export const LAYER_DZ = 0.1;

/**
 * Base renderOrder for Text components. Text renders with depthTest=false, so
 * its draw order is decided purely by renderOrder — not the depth buffer. Tied
 * with the fill behind it (both default 0), the transparent sort flips with
 * head angle and the opaque fill paints over the glyphs (text vanished when
 * the wearer looked off-axis). Bumping text above the fills makes it always
 * draw last. Opaque visuals (Image, Rectangle) DO depth-test, so they order
 * correctly at the default 0 — and explicitly bumping THEM was observed to
 * drop them from the render entirely (on-device), so they're intentionally
 * left alone.
 *
 * Text-vs-text ordering (backlog 5, 2026-06-08): each Text node now gets
 * `TEXT_RENDER_ORDER + its back-to-front rank` from the layers list (see
 * computeTextRenderOrders), so overlapping text draws in layer order instead
 * of arbitrarily. Remaining limitation: text-behind-IMAGE still isn't
 * expressible — that needs a renderOrder on the image, which is exactly the
 * write that dropped meshes from the render on device. Revisit only with an
 * on-device experiment.
 */
export const TEXT_RENDER_ORDER = 1;

/**
 * Per-node renderOrder for every Text node in the tree, derived from the
 * layers-list stacking: front-most text (tree order index 0, top of the
 * layers panel) gets the HIGHEST renderOrder so it draws last. Values start
 * at TEXT_RENDER_ORDER so all text stays above the opaque fills (the
 * original z-fight fix). Pure — unit-testable.
 */
export function computeTextRenderOrders(tree: DesignNode[]): Map<string, number> {
  const textIds: string[] = [];
  const walk = (nodes: DesignNode[]): void => {
    for (const n of nodes) {
      if (getManifest(n.type)?.sceneShape.componentKind === 'Text') textIds.push(n.id);
      walk(n.children);
    }
  };
  walk(tree);
  // Document order visits front-most first → rank back-to-front by reversing.
  const orders = new Map<string, number>();
  for (let i = 0; i < textIds.length; i++) {
    orders.set(textIds[i]!, TEXT_RENDER_ORDER + (textIds.length - 1 - i));
  }
  return orders;
}

/**
 * Default world-space distance (cm, positive) from the Spectacles
 * camera at origin to the ActiveComponent root. Camera looks down -Z,
 * so the actual SO Z is negated. The renderer overrides this per
 * project via `preview.set-distance`; the constant only seeds the
 * first apply if no client has set anything yet.
 *
 * Why 52 cm: at ~60° horizontal camera FOV this yields ~60 cm of
 * visible width in the LS Spectacles render, roughly matching the
 * designer's typical ~44 cm wide SVG canvas viewport (10 px/cm ×
 * ~440 px). Spectacles UX guidance recommends 40–60 cm for
 * interactive UI; the renderer's Distance input lets the user tune.
 */
export const DEFAULT_PREVIEW_DISTANCE_CM = 52;

/** Mutable distance — set by daemon on `preview.set-distance`. */
let currentDistanceCm = DEFAULT_PREVIEW_DISTANCE_CM;

export function setActiveComponentDistance(cm: number): void {
  currentDistanceCm = cm;
}

export function getActiveComponentWorldZ(): number {
  return -currentDistanceCm;
}

/** @deprecated use `getActiveComponentWorldZ()`. Kept for older callers. */
export const ACTIVE_COMPONENT_WORLD_Z = -DEFAULT_PREVIEW_DISTANCE_CM;

/** Thrown when a single node's apply fails — preserves context for design.error. */
export class ApplyNodeError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string | null,
    public readonly propertyPath: string | null,
    public readonly lsError: string,
  ) {
    super(message);
    this.name = 'ApplyNodeError';
  }
}

// Value-resolution core (isVec2/isRgba/resolveMappingValue/…) lives in
// resolve-writes.ts so the codegen shares it (TD-8). Imported above.

// Match LS `Editor.Alignment.Horizontal` / `Editor.Alignment.Vertical`.
// Vertical order is BOTTOM (0), CENTER (1), TOP (2) — easy to flip;
// confirmed against the LS 5.15.4 API definition.
const TEXT_H_ALIGN: Record<string, number> = { left: 0, center: 1, right: 2 };
const TEXT_V_ALIGN: Record<string, number> = { bottom: 0, middle: 1, top: 2 };

// LS `Editor.Components.HorizontalOverflow` int order.
const H_OVERFLOW: Record<string, number> = {
  Overflow: 0,
  Truncate: 1,
  TruncateFront: 2,
  Wrap: 3,
  Ellipsis: 4,
  EllipsisFront: 5,
  Shrink: 6,
};
// LS `Editor.Components.VerticalOverflow` int order.
const V_OVERFLOW: Record<string, number> = {
  Overflow: 0,
  Truncate: 1,
  Shrink: 2,
};

/** Resolve `LAYER_INDEX` (top of list = 0 = front) into a z coordinate. */
export function layerIndexToZ(index: number): number {
  // Guard against -0 for index 0 (cosmetic; LS doesn't care but tests do).
  if (index === 0) return 0;
  return -index * LAYER_DZ;
}

// ResolveValueContext + resolveMappingValue now live in resolve-writes.ts
// (shared with the codegen — TD-8). Imported at the top of this file.

/**
 * Read the edit-surface root UUID from the active scope. The
 * ConnectionManager resolves it on attach (ActiveComponent in sandbox mode,
 * __LensDesignerEditBay__ in attached mode) and seeds the scope's
 * permittedSOs with the existing subtree.
 *
 * Throws if no scope is active — the applier can only run while attached.
 */
function editSurfaceRoot(): string {
  const scope = getActiveScope();
  if (!scope) {
    throw new Error(
      'applier: no active scope — bridge has not attached to a Lens Studio target',
    );
  }
  return scope.root;
}

/**
 * Reset the applier's per-session caches (font UUIDs + material pool).
 * Called by daemon on re-attach — LS may have reassigned asset UUIDs
 * across a project restart.
 */
export function resetApplierCaches(): void {
  fontUUIDCache.clear();
  materialPool.clear();
}

/** Back-compat alias for the daemon's existing call site. */
export const resetActiveComponentCache = resetApplierCaches;

/**
 * Material pool keyed by NODE ID (e.g. `LD_Rectangle_<idShort>`), so a
 * given DesignNode always owns the same .mat asset across applies.
 *
 * Why per-nodeId, not per-type-slot: diff-apply needs KEPT subtrees to
 * leave their materials alone (no slot drift when siblings get added or
 * removed). Per-type-slot would shift material assignments around on
 * structural changes — a Rectangle that was at slot 1 might end up at
 * slot 2 in the next walk, and its SO's stale slot-1 reference would
 * now point at a sibling's material content.
 *
 * Trade-off: LS 5.15.4 can't delete .mat assets, so materials accumulate
 * by total unique nodeIds in the session (vs. peak simultaneous count
 * under the old slot scheme). Acceptable — sessions don't churn through
 * thousands of distinct nodeIds.
 *
 * The disk-clone of a ShaderGraph material is expensive (~1.9s for LS's
 * first import, ~0.5s for the file-watcher pickup). We pay it once per
 * nodeId. Later applies reuse the cached material asset and push changed
 * values via fast SetLensStudioProperty calls — no disk write, no import
 * poll, no re-import race. `hash` is the JSON of the resolved overrides;
 * an unchanged hash skips the property writes (e.g. a move-only edit).
 * Cleared on sandbox reset.
 */
const materialPool = new Map<string, { uuid: string; hash: string }>();

/** Compute a stable per-node material name. */
export function materialSlotName(node: DesignNode): string {
  const idShort = node.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'anon';
  return `LD_${node.type}_${idShort}`;
}

/** Prefix for per-node materials the applier creates. */
export const NODE_MATERIAL_PREFIX = 'LD_';

/** Ownership marker the bridge parents under the attached-mode edit bay. A
 *  persistent bay-level child the applier must never treat as a view node
 *  (clear preserves it; reconcile excludes it). Mirrors connection.ts. */
export const EDIT_BAY_MARKER_NAME = '__LensDesignerOwned__';

/** Prefix for font assets the applier creates. Shared across all Text nodes. */
export const FONT_ASSET_PREFIX = 'LDFont_';

/**
 * Font UUID cache. Fonts are shared across every Text node so we only
 * create each preset once per daemon lifetime. Reset whenever the
 * ActiveComponent UUID resets (sandbox restart / project switch).
 */
const fontUUIDCache = new Map<string, string>();


/**
 * Resolve the manifest's `mainMaterial.passInfos.0.*` mappings into a
 * MaterialOverrides bag the disk-duplicate can bake into the .mat YAML.
 * Records the targets it consumes in `bakedTargets` so the caller can
 * skip those in the post-import setProperty loop.
 *
 * Targets the custom LensDesignerRoundedRect shader: solid opaque fill,
 * independent stroke (never tints the fill), and four per-corner radii.
 * No corner-radius floor / stroke coupling — the hand-written SDF treats
 * stroke thickness and corner radius as independent.
 */
function computeMaterialOverrides(
  manifest: PrimitiveManifest,
  node: DesignNode,
  ctx: ResolveValueContext,
  bakedTargets: Set<string>,
): MaterialOverrides {
  const PREFIX = 'mainMaterial.passInfos.0.';
  // Force premultiplied-alpha blend so the shader's computed alpha drives
  // transparency (the saved graph defaults to BlendMode: Disabled, which
  // ignores alpha).
  const overrides: MaterialOverrides = { blendMode: 'PremultipliedAlphaAuto' };
  const vec4Props = new Set(['baseColor', 'strokeColor']);
  const floatProps = new Set(['strokeThickness', 'cornerTL', 'cornerTR', 'cornerBR', 'cornerBL', 'sides']);
  for (const mapping of manifest.sceneShape.componentMappings) {
    if (!mapping.target.startsWith(PREFIX)) continue;
    const sourceValue = node.properties[mapping.source];
    if (sourceValue === undefined) continue;
    const shaderProp = mapping.target.slice(PREFIX.length) as keyof MaterialOverrides;
    try {
      const resolved = resolveMappingValue(mapping, sourceValue, ctx);
      if (vec4Props.has(shaderProp)) {
        (overrides as Record<string, unknown>)[shaderProp] = resolved as {
          x: number; y: number; z: number; w: number;
        };
      } else if (floatProps.has(shaderProp)) {
        (overrides as Record<string, unknown>)[shaderProp] = resolved as number;
      }
      bakedTargets.add(mapping.target);
    } catch {
      // If a single mapping fails to resolve we leave it baked-out and
      // let the post-import loop log a real error from setProperty.
    }
  }
  // Feed the box's cm dimensions to the RoundedRectCore SDF so corners
  // stay circular at any aspect (no-op on materials without a boxSize
  // param, e.g. Ellipse).
  const sizeRaw = node.properties['size'];
  if (isVec2(sizeRaw)) {
    overrides.boxSize = { x: sizeRaw.x, y: sizeRaw.y };
  }
  return overrides;
}

/**
 * Compute the texture-fill overrides for an Image node: resolve its
 * imageSource → texture asset (UUID + pixel size), then derive the UV fit
 * transform from fitMode + alignment + image aspect + box aspect. Returns
 * a partial MaterialOverrides to merge onto the base overrides, or an
 * empty object when the node has no image yet (useTexture stays 0 → the
 * shared shader falls back to baseColor, so an empty Image renders blank).
 */
async function computeImageOverrides(
  client: McpClient,
  node: DesignNode,
): Promise<Partial<MaterialOverrides>> {
  const src = node.properties['imageSource'];
  if (typeof src !== 'string' || src.length === 0) return {};

  let tex;
  try {
    tex = await getTextureInfo(client, src);
  } catch {
    // Image asset not imported / missing — leave useTexture unset so the
    // shape renders as a blank fill rather than a broken texture.
    return {};
  }
  if (tex.width <= 0 || tex.height <= 0) return {};

  const sizeRaw = node.properties['size'];
  const boxAspect = isVec2(sizeRaw) && sizeRaw.y > 0 ? sizeRaw.x / sizeRaw.y : 1;
  const imgAspect = tex.width / tex.height;

  const fit = (node.properties['fitMode'] as FitMode) ?? 'fill';
  const alignName = typeof node.properties['alignment'] === 'string'
    ? (node.properties['alignment'] as string)
    : 'center';
  const align = ALIGN_9[alignName] ?? ALIGN_9['center']!;

  // LS's getSurfaceUVCoord0() has V=0 at the BOTTOM of the quad (OpenGL
  // convention), opposite the inspector's 9-point grid where Y=0 is the TOP.
  // Without this flip, "top" alignment crops to the bottom of the image and
  // vice-versa — verified on-device 2026-05-24 with the colored-quad texture
  // (designer top → red/green top band; LS top → blue/yellow bottom band).
  // The X axis matches, so only Y is flipped. See image-fit.ts header.
  const t = computeTexTransform(fit, align.x, 1 - align.y, imgAspect, boxAspect);
  return {
    baseTexUUID: tex.id,
    texScale: t.scale,
    texOffset: t.offset,
  };
}

/**
 * Push a MaterialOverrides bag onto an EXISTING material asset via
 * SetLensStudioProperty (the fast path — no disk write, no import poll).
 * Used when a node's material is already cached from a prior apply.
 * blendMode is omitted: it's baked once at clone time and never changes.
 */
async function applyOverridesViaSetProperty(
  client: McpClient,
  matUUID: string,
  overrides: MaterialOverrides,
): Promise<void> {
  const vec4s: Array<[string, { x: number; y: number; z: number; w: number } | undefined]> = [
    ['baseColor', overrides.baseColor],
    ['strokeColor', overrides.strokeColor],
  ];
  const floats: Array<[string, number | undefined]> = [
    ['strokeThickness', overrides.strokeThickness],
    ['cornerTL', overrides.cornerTL],
    ['cornerTR', overrides.cornerTR],
    ['cornerBR', overrides.cornerBR],
    ['cornerBL', overrides.cornerBL],
    ['sides', overrides.sides],
  ];
  const vec2s: Array<[string, { x: number; y: number } | undefined]> = [
    ['boxSize', overrides.boxSize],
    ['texScale', overrides.texScale],
    ['texOffset', overrides.texOffset],
  ];
  // All these target the SAME material asset but DIFFERENT property paths,
  // so they're independent — fan out via Promise.all. Sequential was
  // dominating warm-path applies (11 × 30–80 ms × N materials with a hash
  // change). Parallel collapses each material's overrides to ~one RPC of
  // wall-clock.
  const tasks: Promise<unknown>[] = [];
  for (const [name, v] of vec4s) {
    if (!v) continue;
    tasks.push(setProperty(client, {
      objectUUID: matUUID,
      propertyPath: `passInfos.0.${name}`,
      valueType: 'vec4',
      value: v,
    }));
  }
  for (const [name, n] of floats) {
    if (typeof n !== 'number') continue;
    tasks.push(setProperty(client, {
      objectUUID: matUUID,
      propertyPath: `passInfos.0.${name}`,
      valueType: 'number',
      value: n,
    }));
  }
  for (const [name, v] of vec2s) {
    if (!v) continue;
    tasks.push(setProperty(client, {
      objectUUID: matUUID,
      propertyPath: `passInfos.0.${name}`,
      valueType: 'vec2',
      value: v,
    }));
  }
  // baseTex is set separately by the caller (reference type), gated on
  // cold-clone / hash-change, so it's intentionally not handled here.
  await Promise.all(tasks);
}

/**
 * Resolve a font reference to an LS Font asset UUID.
 *  - Built-in fonts map to a preset, instantiated once and cached.
 *  - Custom fonts carry a sandbox asset path (e.g.
 *    "LensDesigner/fonts/font_<hash>.ttf"), already imported by LS's file
 *    watcher during upload; we just look up the asset by path.
 */
async function resolveFontUUID(client: McpClient, fontName: string): Promise<string | null> {
  const cached = fontUUIDCache.get(fontName);
  if (cached) return cached;

  const preset = FONT_PRESETS[fontName];
  if (preset) {
    const assetName = `${FONT_ASSET_PREFIX}${fontName}`;

    // 1. Reuse an already-present `LDFont_<Name>` Font asset. In attached mode
    //    the LensDesigner .lspkg is LOCKED-installed, so its built-in fonts are
    //    already in the asset DB under this exact name — and the preset path
    //    below fails for locked installs (the preset's loose .ttf isn't on
    //    disk), which used to fall into a re-ingest that LS never imports
    //    within 10s → the whole apply threw "did not import the font". Looking
    //    the installed asset up by name avoids preset + re-ingest entirely.
    try {
      const existingId = await getAssetIdByName(client, assetName);
      if (existingId) {
        fontUUIDCache.set(fontName, existingId);
        return existingId;
      }
    } catch {
      // fall through to preset
    }

    // 2. Editable installs: instantiate the font from its LS preset.
    try {
      const asset = await createAssetFromPreset(client, preset, assetName, 'LensDesigner');
      fontUUIDCache.set(fontName, asset.assetUUID);
      return asset.assetUUID;
    } catch (presetErr) {
      // 3. Last resort: extract the .ttf bytes from the bundled .lspkg and
      //    ingest them. NON-FATAL — a built-in font that won't resolve must
      //    NOT kill the whole apply; degrade to LS's default font (the caller
      //    skips the font assignment on null).
      try {
        const { packedFontFilename, readPackedAssetBytes } = await import('./pack.ts');
        const { ingestFontBytes } = await import('./mcp.ts');
        const filename = packedFontFilename(fontName);
        if (filename) {
          const bytes = await readPackedAssetBytes(filename);
          const ext = filename.split('.').pop() ?? 'ttf';
          const ingested = await ingestFontBytes(client, bytes, ext);
          fontUUIDCache.set(fontName, ingested.uuid);
          return ingested.uuid;
        }
      } catch (ingestErr) {
        process.stderr.write(
          `[applier] built-in font "${fontName}" .lspkg fallback failed: ${(ingestErr as Error).message}\n`,
        );
      }
      process.stderr.write(
        `[applier] could not resolve built-in font "${fontName}" — using default. preset err: ${(presetErr as Error).message}\n`,
      );
      return null; // non-fatal: caller skips the font, LS renders its default
    }
  }

  // Custom uploaded font — fontName is a .ttf/.otf sandbox path.
  if (/\.(ttf|otf)$/i.test(fontName)) {
    try {
      const asset = await getAssetByPath(client, fontName);
      if (asset?.id) {
        fontUUIDCache.set(fontName, asset.id);
        return asset.id;
      }
    } catch {
      // not imported (deleted from sandbox?) — fall through
    }
    process.stderr.write(`[applier] custom font asset not found: ${fontName}\n`);
    return null;
  }

  process.stderr.write(`[applier] no LS preset mapped for font "${fontName}"\n`);
  return null;
}

/**
 * Delete every child SO under ActiveComponent. Idempotent.
 *
 * The orphan-material sweep that used to live here was removed:
 * LS 5.15.4's DeleteLensStudioAsset is broken for Material assets, so
 * the sweep fired N failed delete calls per apply (60+ when stale
 * entries from prior sessions accumulated) and choked LS's MCP queue
 * without ever cleaning anything up. Materials now leak in-memory in
 * LS until the user closes and reopens the sandbox project. The disk
 * files reuse stable filenames per node id, so disk leak is bounded.
 */
/**
 * Delete every child SO under the active edit surface. Idempotent.
 *
 * Preserves the `__LensDesignerOwned__` marker SO (see
 * connection.ts:EDIT_BAY_MARKER_NAME) — that's the bridge's bay-ownership
 * proof; clearing it on apply would lock the user out of their own bay on
 * the next attach.
 *
 * Children we delete must already be in scope (seeded by the connection
 * manager on attach). If a delete tries to remove an unknown child, the
 * scoped-apply guard will refuse it — that's intentional safety, not a
 * regression: it means our descendants set drifted from LS reality.
 */
export async function clearEditSurface(client: McpClient): Promise<void> {
  const editUUID = editSurfaceRoot();
  const res = await getSceneObjectById(client, editUUID);
  const allChildren = res.object?.children ?? [];
  const children = allChildren.filter(
    (c) => (c as { name?: string }).name !== EDIT_BAY_MARKER_NAME,
  );
  if (children.length === 0) return;
  // Parallelize deletes — they're independent and each is a 30–80 ms RPC.
  // For 10+ children, sequential adds ~500 ms before the rebuild can start.
  // `allSettled` lets us tolerate individual "not found" races (a second
  // editor tab clearing the same children) without aborting the whole apply.
  const results = await Promise.allSettled(
    children.map((child) => deleteSceneObject(client, child.id)),
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      const msg = (r.reason as Error).message ?? '';
      if (!/not found/i.test(msg)) throw r.reason;
    }
  }
}

/** Back-compat alias for the daemon/export legacy callsite. */
export const clearActiveComponent = clearEditSurface;

interface AppliedNode {
  nodeId: string;
  soUUID: string;
  /** The rendered component (Image/Text/RenderMeshVisual) UUID, if any. Used
   *  by the interaction post-pass to target color feedback at mesh visuals. */
  visualUUID?: string;
}

/**
 * The material / font / component-mappings half of `applyDesignNode`. Runs
 * after the component has been created; all three sub-branches (material
 * assign, font reference, component-level setProperty calls) target
 * independent properties on the component or its material asset and so
 * fan out in parallel.
 */
async function applyMaterialAndComponentMappings(
  client: McpClient,
  node: DesignNode,
  componentUUID: string,
  manifest: PrimitiveManifest,
  ctx: ResolveValueContext,
  textOrders?: Map<string, number>,
): Promise<void> {
  // Material assignment uses the manifest's materialTemplatePath (disk
  // clone) or materialPreset (built-in preset). Branch is also responsible
  // for tracking which targets were "baked" into the .mat YAML so the
  // component-mappings branch can skip those — `bakedTargets` is shared
  // between the two branches via this closure-scoped Set.
  const bakedTargets = new Set<string>();

  const materialBranch = async (): Promise<void> => {
    const matName = materialSlotName(node);
    try {
      let matUUID: string | null = null;
      if (manifest.sceneShape.materialTemplatePath) {
        const tplPath = manifest.sceneShape.materialTemplatePath;
        const overrides = computeMaterialOverrides(manifest, node, ctx, bakedTargets);
        if (node.type === 'Image') {
          Object.assign(overrides, await computeImageOverrides(client, node));
        }
        const hash = JSON.stringify(overrides);

        const cloneSlot = async (): Promise<string> => {
          const dup = await duplicateMaterialAssetOnDisk(client, tplPath, 'LensDesigner', matName, overrides);
          materialPool.set(matName, { uuid: dup.assetUUID, hash });
          await applyOverridesViaSetProperty(client, dup.assetUUID, overrides);
          if (overrides.baseTexUUID) {
            await setProperty(client, {
              objectUUID: dup.assetUUID,
              propertyPath: 'passInfos.0.baseTexture',
              valueType: 'reference',
              value: overrides.baseTexUUID,
            });
          }
          return dup.assetUUID;
        };

        // Reuse priority: in-memory pool → existing on-disk asset by name →
        // fresh disk clone. The by-name lookup is what makes reconcile work
        // across a restart (cold pool): the per-node material is named
        // deterministically (LD_<type>_<idShort>) and persists on disk, so we
        // update THAT asset's uniforms instead of duplicating it (a duplicate
        // would orphan the instance's current material + leak assets, since LS
        // 5.15.4 can't delete .mat files).
        let cached = materialPool.get(matName);
        if (!cached) {
          const existingId = await getAssetIdByName(client, matName);
          if (existingId) {
            // Reusing a material created in a prior session — permit it in the
            // scope (it's not in the seeded set) before we setProperty its
            // uniforms, or the guard refuses the write.
            getActiveScope()?.markCreated(existingId);
            cached = { uuid: existingId, hash: `${hash}~adopt` }; // force a uniform refresh
          }
        }
        if (cached) {
          matUUID = cached.uuid;
          if (cached.hash !== hash) {
            materialPool.set(matName, { uuid: cached.uuid, hash });
            await applyOverridesViaSetProperty(client, cached.uuid, overrides);
            if (overrides.baseTexUUID) {
              await setProperty(client, {
                objectUUID: cached.uuid,
                propertyPath: 'passInfos.0.baseTexture',
                valueType: 'reference',
                value: overrides.baseTexUUID,
              });
            }
          } else {
            materialPool.set(matName, cached);
          }
        } else {
          matUUID = await cloneSlot();
        }

        try {
          await setProperty(client, { objectUUID: componentUUID, propertyPath: 'mainMaterial', valueType: 'reference', value: matUUID });
        } catch (assignErr) {
          if (!cached) throw assignErr;
          matUUID = await cloneSlot();
          await setProperty(client, { objectUUID: componentUUID, propertyPath: 'mainMaterial', valueType: 'reference', value: matUUID });
        }
      } else if (manifest.sceneShape.materialPreset) {
        const mat = await createAssetFromPreset(client, manifest.sceneShape.materialPreset, matName, 'LensDesigner');
        matUUID = mat.assetUUID;
        await setProperty(client, {
          objectUUID: componentUUID,
          propertyPath: 'mainMaterial',
          valueType: 'reference',
          value: matUUID,
        });
      }
    } catch (err) {
      const source = manifest.sceneShape.materialTemplatePath
        ? `template=${manifest.sceneShape.materialTemplatePath}`
        : `preset=${manifest.sceneShape.materialPreset ?? 'none'}`;
      throw new ApplyNodeError(
        `material assignment failed (${source})`,
        node.id,
        'mainMaterial',
        (err as Error).message,
      );
    }
  };

  const fontBranch = async (): Promise<void> => {
    if (manifest.sceneShape.componentKind !== 'Text') return;
    const fontName = node.properties['font'];
    if (typeof fontName !== 'string') return;
    try {
      const fontUUID = await resolveFontUUID(client, fontName);
      if (fontUUID) {
        await setProperty(client, {
          objectUUID: componentUUID,
          propertyPath: 'font',
          valueType: 'reference',
          value: fontUUID,
        });
      }
    } catch (err) {
      throw new ApplyNodeError(
        `font assignment failed (font=${fontName})`,
        node.id,
        'font',
        (err as Error).message,
      );
    }
  };

  // Text doesn't depth-test, so without an explicit renderOrder it z-fights
  // the fill behind it and the opaque fill wins from some angles. Bump it —
  // and rank text-vs-text by layer order (computeTextRenderOrders) so
  // overlapping text draws front-most-last like the layers panel says.
  const renderOrderBranch = async (): Promise<void> => {
    if (manifest.sceneShape.componentKind !== 'Text') return;
    try {
      await setProperty(client, {
        objectUUID: componentUUID,
        propertyPath: 'renderOrder',
        valueType: 'number',
        value: textOrders?.get(node.id) ?? TEXT_RENDER_ORDER,
      });
    } catch (err) {
      throw new ApplyNodeError(
        'renderOrder assignment failed',
        node.id,
        'renderOrder',
        (err as Error).message,
      );
    }
  };

  // Component-level mappings: fan out the independent setProperty calls.
  // Note: this branch needs to know which targets the material branch baked
  // into the .mat YAML so it can skip them. That's why bakedTargets is a
  // shared Set populated by materialBranch — and why component-mapping
  // setters wait for material to finish before reading the Set.
  await materialBranch();
  await Promise.all([
    fontBranch(),
    renderOrderBranch(),
    ...manifest.sceneShape.componentMappings
      .filter((m) => m.source !== 'font')
      .filter((m) => !bakedTargets.has(m.target))
      .map((mapping) => (async (): Promise<void> => {
        const sourceValue = node.properties[mapping.source];
        if (sourceValue === undefined) return;
        try {
          let value: unknown;
          if (mapping.valueType === 'enum') {
            const tables: Record<string, Record<string, number>> = {
              horizontalAlignment: TEXT_H_ALIGN,
              verticalAlignment: TEXT_V_ALIGN,
              horizontalOverflow: H_OVERFLOW,
              verticalOverflow: V_OVERFLOW,
            };
            const table = tables[mapping.target];
            if (!table) {
              throw new TypeError(`unknown enum mapping target ${mapping.target}`);
            }
            const v = table[String(sourceValue)];
            if (v === undefined) {
              throw new TypeError(`unknown ${mapping.target} "${String(sourceValue)}"`);
            }
            value = v;
          } else {
            value = resolveMappingValue(mapping, sourceValue, ctx);
          }
          await setProperty(client, {
            objectUUID: componentUUID,
            propertyPath: mapping.target,
            valueType: mapping.valueType as ValueType,
            ...(mapping.enumType ? { enumType: mapping.enumType } : {}),
            value,
          });
        } catch (err) {
          throw new ApplyNodeError(
            `component property "${mapping.target}" failed on ${node.id}`,
            node.id,
            mapping.target,
            (err as Error).message,
          );
        }
      })()),
  ]);
}

/**
 * Materialize one DesignNode (and its descendants) into LS under `parentUUID`.
 * Groups create a bare SceneObject and recurse their children under it; leaf
 * primitives create their component + material.
 *
 * **Parallelism.** After the SceneObject is created, everything downstream of
 * it that has no internal dependency is fired with Promise.all:
 *   - all transform setProperty calls on the SO
 *   - the component-create branch (which itself parallelizes material assign +
 *     component-level setProperty after the component exists)
 *   - the children recursion (each child is itself a parallel subtree)
 *
 * Material slot names are derived per-nodeId via `materialSlotName(node)`,
 * so siblings can fan out in parallel without coordinating slot allocation.
 */
async function applyDesignNode(
  client: McpClient,
  node: DesignNode,
  parentUUID: string,
  layerIndex: number,
  applied: AppliedNode[],
  textOrders?: Map<string, number>,
): Promise<void> {
  const manifest = getManifest(node.type);
  if (!manifest) {
    throw new ApplyNodeError(
      `unknown primitive type "${node.type}"`,
      node.id,
      null,
      `no manifest registered for type "${node.type}"`,
    );
  }

  const opacityRaw = node.properties['opacity'];
  const opacity01 = typeof opacityRaw === 'number' ? opacityRaw / 100 : 1.0;
  const sizeRaw = node.properties['size'];
  const sizeCm = isVec2(sizeRaw) ? { x: sizeRaw.x, y: sizeRaw.y } : null;
  const ctx: ResolveValueContext = {
    layerZ: layerIndexToZ(layerIndex),
    opacity: opacity01,
    sizeCm,
  };

  // 1. Create the SceneObject (this MUST happen first — everything else
  // either targets the SO or depends on its existence).
  let so: { objectUUID: string };
  try {
    so = await createSceneObject(client, node.name, parentUUID);
  } catch (err) {
    throw new ApplyNodeError(
      `CreateLensStudioSceneObject failed for "${node.name}"`,
      node.id,
      null,
      (err as Error).message,
    );
  }

  // 2. After the SO exists, three independent branches can fire in parallel:
  //    (a) transform setProperty calls on the SO,
  //    (b) component creation + its dependents (material + component setters),
  //    (c) the children subtree recursion.
  // We track the per-node `componentUUID` here so `applied.push` at the end
  // sees the final value the component-branch resolved to.
  let componentUUID: string | null = null;

  // ---- Branch (a): transform setProperty in parallel ----
  const transformTasks: Promise<unknown>[] = [];
  for (const mapping of manifest.sceneShape.transformMappings) {
    const sourceValue = node.properties[mapping.source];
    if (sourceValue === undefined) continue;
    transformTasks.push(
      (async () => {
        try {
          const value = resolveMappingValue(mapping, sourceValue, ctx);
          await setProperty(client, {
            objectUUID: so.objectUUID,
            propertyPath: mapping.target,
            valueType: mapping.valueType as ValueType,
            value,
          });
        } catch (err) {
          throw new ApplyNodeError(
            `transform property "${mapping.target}" failed on ${node.id}`,
            node.id,
            mapping.target,
            (err as Error).message,
          );
        }
      })(),
    );
  }

  // ---- Branch (b): component create + material + component-level setters ----
  const componentBranch =
    manifest.sceneShape.componentKind === 'SceneObject'
      ? Promise.resolve()
      : (async () => {
          try {
            const comp = await createComponent(client, so.objectUUID, manifest.sceneShape.componentKind);
            componentUUID = comp.newComponent.id;
          } catch (err) {
            throw new ApplyNodeError(
              `CreateLensStudioComponent(${manifest.sceneShape.componentKind}) failed`,
              node.id,
              null,
              (err as Error).message,
            );
          }
          await applyMaterialAndComponentMappings(
            client,
            node,
            componentUUID,
            manifest,
            ctx,
            textOrders,
          );
        })();

  // ---- Branch (c): children subtree, created SEQUENTIALLY in array order ----
  // The codegen + the runtime controller target children by child-INDEX path
  // (getChildByPath → getChild(i)), which requires LS's child order to equal
  // the design-tree array order. Creating children with Promise.all raced the
  // createSceneObject calls, so LS's child indices came out in non-deterministic
  // order — `title` (tree[0]) would resolve to a sibling at runtime. Serialize
  // child creation so child[i] is always tree[i]. (Each child's own subtree work
  // still parallelizes inside applyDesignNode; only the sibling order is forced.)
  const childrenBranch = (async (): Promise<void> => {
    for (let ci = 0; ci < node.children.length; ci++) {
      await applyDesignNode(client, node.children[ci]!, so.objectUUID, ci, applied, textOrders);
    }
  })();

  // Wait for everything that depends on the SceneObject to finish before
  // recording this node as applied. Promise.all surfaces the FIRST error;
  // sibling branches keep running but their results don't matter once a
  // failure has aborted the apply. Same end-state as the sequential code.
  await Promise.all([...transformTasks, componentBranch, childrenBranch]);

  applied.push({
    nodeId: node.id,
    soUUID: so.objectUUID,
    ...(componentUUID ? { visualUUID: componentUUID } : {}),
  });
}

// ---- Interaction post-pass (v1a) ----
// Runs after the whole tree is materialized, so color feedback can target the
// mesh visuals of an interactable's entire subtree (children exist by now).

/** SIK role component attached alongside the base Interactable, by role. */
const ROLE_COMPONENT: Record<InteractionRole, string | null> = {
  button: 'PinchButton',
  toggle: 'ToggleButton',
  draggable: 'InteractableManipulation',
};

/** Designer Rgba ({r,g,b 0–255, a 0–100}) → LS color vec4 (0–1). */
function rgbaToVec401(c: Rgba): { x: number; y: number; z: number; w: number } {
  return { x: c.r / 255, y: c.g / 255, z: c.b / 255, w: c.a / 100 };
}

/** Attach Interactable + role + (optionally) the LDStateController for state
 *  feedback (color + layer-swap). The controller, not SIK ColorFeedback, drives
 *  appearance so it works with our custom-shader Image visuals. */
async function attachInteraction(
  client: McpClient,
  node: DesignNode,
  byNodeId: Map<string, AppliedNode>,
): Promise<void> {
  const it = node.interaction;
  const self = byNodeId.get(node.id);
  if (!it || !self) return;
  const soUUID = self.soUUID;

  // 1. Base Interactable (every role needs it).
  const inter = await attachScriptComponent(client, soUUID, 'Interactable');
  if (!inter) {
    throw new ApplyNodeError(
      'SIK Interactable asset not found in project — is SpectaclesInteractionKit installed?',
      node.id,
      null,
      'attach Interactable',
    );
  }

  // 2. Role component (button → PinchButton, toggle → ToggleButton, …).
  const roleComp = ROLE_COMPONENT[it.role];
  if (roleComp) {
    const rc = await attachScriptComponent(client, soUUID, roleComp);
    if (!rc) {
      throw new ApplyNodeError(
        `SIK ${roleComp} asset not found in project`,
        node.id,
        null,
        `attach ${roleComp}`,
      );
    }
  }

  // 3. Collect color targets (subtree SOs with a visual; the controller only
  // recolors Image visuals, so Text labels are skipped automatically) and
  // layer-swap children (descendants with visibleInStates).
  const colorTargets: string[] = [];
  const stateChildren: string[] = [];
  const masks: string[][] = [];
  const collect = (n: DesignNode, isRoot: boolean): void => {
    const an = byNodeId.get(n.id);
    if (an?.visualUUID) colorTargets.push(an.soUUID);
    if (!isRoot && n.visibleInStates && n.visibleInStates.length > 0 && an) {
      stateChildren.push(an.soUUID);
      masks.push(n.visibleInStates);
    }
    for (const c of n.children) collect(c, false);
  };
  collect(node, true);

  const needsController = !!it.colorStates || stateChildren.length > 0;
  if (!needsController) return;

  const ctrl = await attachScriptComponent(client, soUUID, 'LDStateController');
  if (!ctrl) {
    throw new ApplyNodeError('LDStateController asset not found in project', node.id, null, 'attach LDStateController');
  }
  const setProp = (path: string, valueType: ValueType, value: unknown): Promise<unknown> =>
    setProperty(client, { objectUUID: ctrl, propertyPath: path, valueType, value });

  if (it.colorStates) {
    const cs = it.colorStates;
    const fallback: Rgba = cs.default ?? { r: 255, g: 255, b: 255, a: 100 };
    await setProp('enableColor', 'boolean', true);
    await setProp('defaultColor', 'vec4', rgbaToVec401(cs.default ?? fallback));
    await setProp('hoverColor', 'vec4', rgbaToVec401(cs.hover ?? cs.default ?? fallback));
    await setProp('pinchedColor', 'vec4', rgbaToVec401(cs.pinched ?? cs.default ?? fallback));
    await setProp('disabledColor', 'vec4', rgbaToVec401(cs.disabled ?? cs.default ?? fallback));
    if (colorTargets.length > 0) await setProp('colorTargets', 'reference', colorTargets);
  }
  if (stateChildren.length > 0) {
    await setProp('stateChildren', 'reference', stateChildren);
    await setProp('stateChildMasksJson', 'string', JSON.stringify(masks));
  }
}

/** A child's authored size for the static (apply-time) hug. Runtime re-measures
 *  text via getBoundingBox; at apply time we use the authored box. */
function hugItemFromDesign(node: DesignNode): HugItem {
  if (node.fillParent) return { w: 0, h: 0, fill: true };
  const sz = node.properties['size'];
  const w = isVec2(sz) ? sz.x : 4;
  const h = isVec2(sz) ? sz.y : 4;
  return { w, h, fill: false };
}

/**
 * Static hug post-pass: for every group with a `hug` layout, flow its content
 * children to the solver positions + stretch its `fillParent` child to the
 * hugged bounds. Uses authored sizes (the generated controller re-measures via
 * Text.getBoundingBox + re-flows at runtime when data changes — WB-L layer 5).
 * NOTE: a fillParent rect is scaled to the hugged size; its rounded-corner
 * radius isn't yet re-derived from the new box (cosmetic — refinement).
 */
async function applyHugLayout(
  client: McpClient,
  tree: DesignNode[],
  applied: AppliedNode[],
): Promise<void> {
  const byNodeId = new Map(applied.map((a) => [a.nodeId, a]));
  const walk = async (node: DesignNode): Promise<void> => {
    const layout = node.layout;
    if (layout?.hug) {
      const items = node.children.map(hugItemFromDesign);
      const res = computeHugLayout(items, {
        mode: layout.mode,
        spacing: layout.spacing,
        padding: layout.padding,
      });
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        const an = byNodeId.get(child.id);
        if (!an) continue;
        const b = res.boxes[i]!;
        await setProperty(client, {
          objectUUID: an.soUUID,
          propertyPath: 'localTransform.position',
          valueType: 'vec3',
          value: { x: b.x, y: b.y, z: layerIndexToZ(i) },
        });
        if (child.fillParent) {
          await setProperty(client, {
            objectUUID: an.soUUID,
            propertyPath: 'localTransform.scale',
            valueType: 'vec3',
            value: { x: b.w, y: b.h, z: 1 },
          });
          // Keep rounded corners correct at the hugged size: feed the box dims
          // to the RoundedRect SDF. Scaling the mesh alone stretches the corners.
          const matUUID = await getAssetIdByName(client, materialSlotName(child));
          if (matUUID) {
            getActiveScope()?.markCreated(matUUID);
            await setProperty(client, {
              objectUUID: matUUID,
              propertyPath: 'passInfos.0.boxSize',
              valueType: 'vec2',
              value: { x: b.w, y: b.h },
            });
          }
        }
      }
    }
    for (const c of node.children) await walk(c);
  };
  for (const n of tree) await walk(n);
}

/**
 * Auto-attach the generated controller (`LensDesigner/<View>.ts`) to each
 * view-root instance, idempotently. The designer OWNS this attachment, so a
 * structural rebuild that drops the component re-attaches it on the next apply —
 * the user never manually re-wires the controller. The controller reuses any
 * SIK already present (getComponent-or-create), so it doesn't duplicate the
 * preview Interactable. Skipped silently when the controller asset isn't
 * generated yet (a save writes it; the next apply attaches it).
 */
async function applyControllers(
  client: McpClient,
  tree: DesignNode[],
  applied: AppliedNode[],
): Promise<void> {
  const byNodeId = new Map(applied.map((a) => [a.nodeId, a]));
  const walk = async (node: DesignNode): Promise<void> => {
    if (node.view) {
      const an = byNodeId.get(node.id);
      if (an) {
        const name = node.view.name;
        try {
          const so = await getSceneObjectById(client, an.soUUID);
          const comps = so.object.components ?? [];

          // Dangling-component sweep (backlog 10). A ScriptComponent whose
          // script asset is missing/unassigned reads back with the generic
          // name "Script" (healthy ones carry their class name — verified
          // against LS 5.15.4 MCP 2026-06-08). They're left behind when a
          // generated controller is deleted/recreated out from under the bay,
          // and they break LS ("scriptInputInfo of null") + publish. Delete
          // them instead of stacking a fresh controller next to the corpse.
          for (const c of comps) {
            if (c.name !== 'Script') continue;
            getActiveScope()?.markCreated(an.soUUID);
            try {
              await deleteComponent(client, c.id, an.soUUID);
              process.stdout.write(
                `bridge: swept dangling ScriptComponent off view root "${node.name}"\n`,
              );
            } catch {
              // best-effort — a failed sweep leaves us no worse than before
            }
          }

          const present = comps.some((c) => c.name === name);
          if (!present) {
            getActiveScope()?.markCreated(an.soUUID);
            const cid = await attachScriptComponent(client, an.soUUID, name);
            if (cid) getActiveScope()?.markCreated(cid);
          }
        } catch {
          // asset missing / read failed — a later apply (post-save) attaches it.
        }
      }
    }
    for (const c of node.children) await walk(c);
  };
  for (const n of tree) await walk(n);
}

/** Walk the tree and attach interaction components to every tagged node. */
async function applyInteractions(
  client: McpClient,
  tree: DesignNode[],
  applied: AppliedNode[],
): Promise<void> {
  const byNodeId = new Map(applied.map((a) => [a.nodeId, a]));
  const walk = async (node: DesignNode): Promise<void> => {
    if (node.interaction) await attachInteraction(client, node, byNodeId);
    for (const c of node.children) await walk(c);
  };
  for (const n of tree) await walk(n);
}

export interface ApplyTreeResult {
  appliedAt: number;
  nodeIds: string[];
  soUUIDs: string[];
}

/**
 * End-to-end design.apply pipeline. Clears the previous scene, then
 * materializes each node in the tree with its layer index.
 */
export interface ApplyOptions {
  /** Skip the SIK interaction/state attach pass. The export uses this to
   *  capture a geometry-only prefab — interactivity is re-attached at runtime
   *  by the generated controller, so the prefab carries no SIK UUID refs. */
  skipInteractions?: boolean;
}

/**
 * Per-pipeline state preserved across applies for diff-apply (TD-3 Phase 2).
 * Records the most-recently-applied top-level subtree hashes and their SO
 * UUIDs, so the next apply can SKIP any top-level subtree that's byte-
 * identical to last time and only delete+rebuild the ones that changed.
 *
 * Bound to the edit-surface root the state was captured against — cleared
 * when the scope changes (LS restart, project switch, attach to another
 * instance).
 */
export interface IncrementalApplyState {
  scopeRoot: string | null;
  /**
   * For each top-level node currently materialized in LS: its SO UUID +
   * a hash of its entire subtree (JSON of the DesignNode incl. children).
   */
  topLevel: Map<string, { soUUID: string; subtreeHash: string }>;
}

export function emptyIncrementalState(): IncrementalApplyState {
  return { scopeRoot: null, topLevel: new Map() };
}

/** Hash a top-level subtree for the diff-apply cache. Includes layer
 *  index so a reordered (but otherwise-unchanged) node is treated as
 *  changed — its SO's baked z position has to update. Also folds in the
 *  GLOBAL text renderOrder ranks of any Text nodes inside this subtree:
 *  adding/removing text in a sibling shifts every text's rank, and a "kept"
 *  subtree would otherwise hold stale renderOrders. */
function topLevelSubtreeHash(
  node: DesignNode,
  layerIndex: number,
  textOrders?: Map<string, number>,
): string {
  const t: number[] = [];
  if (textOrders) {
    const walk = (n: DesignNode): void => {
      const o = textOrders.get(n.id);
      if (o !== undefined) t.push(o);
      for (const c of n.children) walk(c);
    };
    walk(node);
  }
  return JSON.stringify({ i: layerIndex, t, n: node });
}

/** The LS component kind a node materializes as (Image/Text/SceneObject). */
function componentKindFor(node: DesignNode): string | null {
  const m = getManifest(node.type);
  return m ? m.sceneShape.componentKind : null;
}

/**
 * Does the design tree match the live scene subtree in SHAPE — identical child
 * count at every level, and each node's expected visual component already
 * present? When true, this apply is a property-only edit and can RECONCILE IN
 * PLACE (update values on the existing SceneObjects), which preserves their
 * UUIDs and any foreign components — the user's generated controller + data
 * wiring — so editing colors/sizes/states never tears the wiring off. When
 * false, the structure changed (node added/removed/retyped) and the caller
 * falls back to the rebuild path. Pure (no MCP calls) — unit-tested.
 */
export function structurallyMatches(designNodes: DesignNode[], existing: LSSceneObject[]): boolean {
  if (designNodes.length !== existing.length) return false;
  for (let i = 0; i < designNodes.length; i++) {
    const node = designNodes[i]!;
    const child = existing[i]!;
    const kind = componentKindFor(node);
    if (kind === null) return false; // unknown type — don't risk an in-place write
    if (kind !== 'SceneObject' && !child.components.some((c) => c.name === kind)) return false;
    if (!structurallyMatches(node.children, child.children)) return false;
  }
  return true;
}

/**
 * Reconcile the design tree onto the matching live scene subtree IN PLACE:
 * re-apply each node's transform + visual-component/material values to the
 * EXISTING SceneObject (matched by child index — the same tree-order invariant
 * the codegen relies on). Never creates/deletes/renames objects and never
 * touches interaction components, so the user's controller + wiring survive.
 * Caller must have verified `structurallyMatches` first.
 */
async function reconcileInPlace(
  client: McpClient,
  designNodes: DesignNode[],
  existing: LSSceneObject[],
  applied: AppliedNode[],
  textOrders?: Map<string, number>,
): Promise<void> {
  for (let i = 0; i < designNodes.length; i++) {
    const node = designNodes[i]!;
    const child = existing[i]!;
    const manifest = getManifest(node.type);
    if (!manifest) continue; // structurallyMatches verified types; defensive skip

    // Permit this existing SO + its component in the scope. The scope seeds SO
    // UUIDs from the live subtree on attach but NOT component UUIDs, so a write
    // to a pre-existing component/material we own would otherwise be refused.
    const scope = getActiveScope();
    scope?.markCreated(child.id);
    const kind = manifest.sceneShape.componentKind;
    const comp = kind !== 'SceneObject' ? child.components.find((c) => c.name === kind) : undefined;
    if (comp) scope?.markCreated(comp.id);

    // Record the node FIRST so it's mapped even if a value-write below fails —
    // the SO + its components (the user's wiring) are what matter and they're
    // already intact.
    applied.push({ nodeId: node.id, soUUID: child.id, ...(comp ? { visualUUID: comp.id } : {}) });

    // Apply this node's values, resiliently. A failed value-write is logged and
    // skipped — it must NOT abort the reconcile or escalate to a destructive
    // rebuild (which would drop wiring). The objects + wiring stay put; at worst
    // a single property is stale until the next edit.
    try {
      const opacityRaw = node.properties['opacity'];
      const opacity01 = typeof opacityRaw === 'number' ? opacityRaw / 100 : 1.0;
      const sizeRaw = node.properties['size'];
      const sizeCm = isVec2(sizeRaw) ? { x: sizeRaw.x, y: sizeRaw.y } : null;
      const ctx: ResolveValueContext = { layerZ: layerIndexToZ(i), opacity: opacity01, sizeCm };

      const tasks: Promise<unknown>[] = [];
      for (const mapping of manifest.sceneShape.transformMappings) {
        const sourceValue = node.properties[mapping.source];
        if (sourceValue === undefined) continue;
        const value = resolveMappingValue(mapping, sourceValue, ctx);
        tasks.push(setProperty(client, {
          objectUUID: child.id,
          propertyPath: mapping.target,
          valueType: mapping.valueType as ValueType,
          value,
        }));
      }
      if (comp) tasks.push(applyMaterialAndComponentMappings(client, node, comp.id, manifest, ctx, textOrders));
      await Promise.all(tasks);
    } catch (err) {
      if (process.env['BRIDGE_DEBUG']) {
        const lsErr = (err as { lsError?: string }).lsError;
        process.stderr.write(
          `bridge:   reconcile: "${node.name}" value-apply failed, kept wiring: ` +
            `${(err as Error).message}${lsErr ? ` — ${lsErr}` : ''}\n`,
        );
      }
    }

    // Recurse into children. Each level is independently resilient (its own
    // per-node try/catch), so a deep failure never aborts the whole reconcile.
    await reconcileInPlace(client, node.children, child.children, applied, textOrders);
  }
}

export async function applyDesignTree(
  client: McpClient,
  tree: DesignNode[],
  opts: ApplyOptions = {},
  state?: IncrementalApplyState,
): Promise<ApplyTreeResult> {
  const activeUUID = editSurfaceRoot();
  const currentScope = getActiveScope()?.root ?? null;

  // Shared components: expand Instance references into their definitions'
  // subtrees before ANY apply path runs. Expansion re-reads the registry every
  // apply, so a definition edit propagates to every instance — the expanded
  // content flows into the diff hashes below and exactly the affected
  // instances rebuild. Instance-free trees skip the registry read.
  if (treeHasInstances(tree)) {
    try {
      const reg = await loadRegistry(client);
      const exp = expandInstances(tree, reg);
      tree = exp.tree;
      for (const w of exp.warnings) process.stderr.write(`bridge: instances: ${w}\n`);
    } catch (err) {
      // Registry unreadable — apply the tree as-is; unknown Instance nodes
      // fail per-node with a clear ApplyNodeError instead of a silent wipe.
      process.stderr.write(`bridge: instance expansion failed: ${(err as Error).message}\n`);
    }
  }

  // Text renderOrder ranks are GLOBAL across the tree (layer order), so they
  // are computed once here and threaded through every apply path — including
  // partial diff rebuilds, which must rank against the full tree. Computed on
  // the EXPANDED tree so text inside instances ranks too.
  const textOrders = computeTextRenderOrders(tree);

  // Guard: an empty-tree apply must NEVER wipe a populated bay. On reconnect the
  // renderer can transiently ship an empty design (before its real tree
  // rehydrates/loads); clearing here would delete the user's view + everything
  // wired to it. A genuine "deleted every node" is rare and self-heals on the
  // next non-empty apply. Only runs the extra read when the tree is empty.
  if (tree.length === 0 && !opts.skipInteractions) {
    try {
      const root = await getSceneObjectById(client, activeUUID);
      const kids = (root.object.children ?? []).filter((c) => c.name !== EDIT_BAY_MARKER_NAME);
      if (kids.length > 0) {
        if (process.env['BRIDGE_DEBUG']) {
          process.stderr.write(`bridge:   skipped empty apply (would have wiped ${kids.length} node(s) + wiring)\n`);
        }
        return { appliedAt: Date.now(), nodeIds: [], soUUIDs: [] };
      }
    } catch {
      // Read failed — fall through; the rebuild path on an empty tree is a
      // cheap no-op (clearEditSurface deletes nothing if the read also fails).
    }
  }

  // Park the edit surface at the canonical UI distance every apply.
  // LS occasionally resets the transform on save/restore, and pinning
  // it here removes one more thing the user has to remember about the
  // sandbox setup. (In attached mode the edit bay is parented here too.)
  await setProperty(client, {
    objectUUID: activeUUID,
    propertyPath: 'localTransform.position',
    valueType: 'vec3',
    value: { x: 0, y: 0, z: getActiveComponentWorldZ() },
  });

  // ---- Reconcile-in-place path (project-document model) ----
  // If the live scene already matches the tree's SHAPE, this apply is a
  // property-only edit: update values on the existing SceneObjects instead of
  // rebuilding. This preserves their UUIDs and any foreign components — the
  // user's generated controller + data wiring — so tweaking colors/sizes/states
  // never tears the wiring off (the whole point of "edit in place, no export").
  // Any structural change (add/remove/retype a node) or read error falls through
  // to the diff/rebuild path below. Skipped for export captures, which want a
  // fresh geometry build.
  if (!opts.skipInteractions) {
    // Step 1 — DECIDE (read + pure structural check). A read failure or a
    // structure mismatch safely falls through to the rebuild path below.
    let matchedKids: LSSceneObject[] | null = null;
    try {
      const root = await getSceneObjectById(client, activeUUID);
      // Exclude the attached-mode ownership marker — it's a persistent bay-level
      // sibling of the view nodes (never nested in a view), so the design tree's
      // top level lines up with the remaining children.
      const kids = (root.object.children ?? []).filter(
        (c) => c.name !== EDIT_BAY_MARKER_NAME,
      );
      if (kids.length > 0 && structurallyMatches(tree, kids)) matchedKids = kids;
    } catch (err) {
      if (process.env['BRIDGE_DEBUG']) {
        process.stderr.write(`bridge:   reconcile read failed, will rebuild: ${(err as Error).message}\n`);
      }
    }

    // Step 2 — COMMIT. Structure matches, so the user is editing an existing
    // wired view. We MUST NOT fall back to the destructive rebuild on a write
    // error — that would drop their controller. A failed write PROPAGATES (the
    // daemon surfaces it as a design.error); the scene + wiring stay intact and
    // the user can retry. Destructive rebuild only happens for a genuine
    // structure mismatch (matchedKids === null).
    if (matchedKids) {
      const applied: AppliedNode[] = [];
      await reconcileInPlace(client, tree, matchedKids, applied, textOrders);
      // Re-flow hug groups after a property edit (e.g. a text change resizes the
      // pill) — wiring is untouched; only transforms/sizes move.
      await applyHugLayout(client, tree, applied);
      // Idempotent: the controller is already present on a reconcile (preserved),
      // so this is a no-op here, but keeps the invariant in one place.
      await applyControllers(client, tree, applied);
      if (state) {
        state.scopeRoot = currentScope;
        state.topLevel.clear();
        const soByNodeId = new Map(applied.map((a) => [a.nodeId, a.soUUID]));
        for (let i = 0; i < tree.length; i++) {
          const n = tree[i]!;
          const so = soByNodeId.get(n.id);
          if (so) state.topLevel.set(n.id, { soUUID: so, subtreeHash: topLevelSubtreeHash(n, i, textOrders) });
        }
      }
      if (process.env['BRIDGE_DEBUG']) {
        process.stderr.write(`bridge:   reconciled-in-place ${applied.length} nodes (UUIDs + wiring preserved)\n`);
      }
      return {
        appliedAt: Date.now(),
        nodeIds: applied.map((a) => a.nodeId),
        soUUIDs: applied.map((a) => a.soUUID),
      };
    }
  }

  // ---- Diff path ----
  // When the caller hands us state from a previous apply against the SAME
  // edit-surface scope, take the top-level subtree diff fast-path. Each
  // top-level node is either KEPT (no work — its SO + descendants are
  // untouched), DELETED (was in state but isn't in the new tree), or
  // REPLACED (changed content or moved layer index — old SO deleted, new
  // subtree built from scratch). Replacements run in parallel.
  const canDiff =
    state !== undefined &&
    state.scopeRoot === currentScope &&
    state.topLevel.size > 0;

  if (canDiff) {
    const result = await diffApplyTopLevel(client, tree, activeUUID, state, opts, textOrders);
    return result;
  }

  // ---- Full teardown-rebuild path ----
  const tClear = Date.now();
  await clearEditSurface(client);
  const clearMs = Date.now() - tClear;

  const applied: AppliedNode[] = [];

  // Top-level siblings are independent (each rooted under the edit surface).
  // Promise.all collapses N sequential ~1s applies into ~one apply's worth
  // of wall-clock time, modulo whatever serialization LS's MCP server does
  // internally on the receiving end. Material slot names are derived
  // per-nodeId so this doesn't need a slot-allocation pre-walk.
  const tRebuild = Date.now();
  await Promise.all(
    tree.map((node, i) =>
      applyDesignNode(client, node, activeUUID, i, applied, textOrders),
    ),
  );
  const rebuildMs = Date.now() - tRebuild;
  let interactionMs = 0;
  // Second pass: attach interaction components now that the whole subtree
  // (and its mesh visuals) exists for color-feedback targeting. Skipped for
  // export captures — the generated controller re-attaches at runtime.
  if (!opts.skipInteractions) {
    const tInteract = Date.now();
    await applyInteractions(client, tree, applied);
    interactionMs = Date.now() - tInteract;
  }
  // Static hug pass — flow children + size fillParent backgrounds (runtime
  // re-flows on data change). Layout is geometry, so it runs even for exports.
  await applyHugLayout(client, tree, applied);
  // Auto-attach the generated controller to view roots (skip on export captures —
  // the exported prefab stays SIK/controller-free; the consumer attaches it).
  if (!opts.skipInteractions) await applyControllers(client, tree, applied);
  // Per-phase breakdown so a slow apply tells us WHERE the time went.
  // Gate behind BRIDGE_DEBUG=1 — fires every apply, spammy under live edits.
  if (process.env['BRIDGE_DEBUG']) {
    process.stderr.write(
      `bridge:   clear=${clearMs}ms  rebuild=${rebuildMs}ms  interactions=${interactionMs}ms  nodes=${applied.length}\n`,
    );
  }

  // Populate the diff-apply state from this fresh build, so the NEXT apply
  // can take the diff fast-path. Each top-level node maps to its captured
  // SO UUID + a subtree hash that includes its layer index.
  if (state) {
    state.scopeRoot = currentScope;
    state.topLevel.clear();
    const soByNodeId = new Map(applied.map((a) => [a.nodeId, a.soUUID]));
    for (let i = 0; i < tree.length; i++) {
      const node = tree[i]!;
      const soUUID = soByNodeId.get(node.id);
      if (!soUUID) continue;
      state.topLevel.set(node.id, {
        soUUID,
        subtreeHash: topLevelSubtreeHash(node, i, textOrders),
      });
    }
  }

  return {
    appliedAt: Date.now(),
    nodeIds: applied.map((a) => a.nodeId),
    soUUIDs: applied.map((a) => a.soUUID),
  };
}

/**
 * Diff fast-path: top-level subtree compare against the previous apply's
 * state. KEPT subtrees are untouched (zero LS work). REPLACED subtrees
 * (content or layer-index change) get their old SO deleted and a fresh
 * subtree built. REMOVED subtrees (in state but not in new tree) get
 * their old SO deleted. Replacements + new builds + deletes all run in
 * parallel via Promise.all.
 *
 * The classifier guarantees that for the single-property-edit case (one
 * top-level node's content changes, others untouched), 9 of 10 nodes do
 * ZERO LS work and just one subtree gets rebuilt.
 */
async function diffApplyTopLevel(
  client: McpClient,
  tree: DesignNode[],
  editSurfaceUUID: string,
  state: IncrementalApplyState,
  opts: ApplyOptions,
  textOrders?: Map<string, number>,
): Promise<ApplyTreeResult> {
  const tDiff = Date.now();
  // Classify each top-level node in the new tree vs. state.
  type Action =
    | { kind: 'keep'; id: string; soUUID: string; hash: string }
    | { kind: 'replace'; id: string; oldSoUUID: string; node: DesignNode; layerIndex: number; hash: string }
    | { kind: 'new'; id: string; node: DesignNode; layerIndex: number; hash: string };

  // Defensive: drop any cached entry whose SO UUID is no longer in
  // scope. The pipeline already invalidates the whole `topLevel` map
  // when it sees a fresh ApplyScope instance, so this only ever fires
  // if `markDeleted` ran out-of-band (a stray delete from another
  // path) or if a future refactor introduces a new scope-mutation
  // surface. Treating the entry as "missing" pushes the node down the
  // 'new' branch — full rebuild for that subtree, no doomed delete.
  const scope = getActiveScope();
  if (scope) {
    for (const [id, snap] of [...state.topLevel.entries()]) {
      if (!scope.permits(snap.soUUID)) state.topLevel.delete(id);
    }
  }

  const actions: Action[] = [];
  const newIds = new Set<string>();
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]!;
    newIds.add(node.id);
    const hash = topLevelSubtreeHash(node, i, textOrders);
    const prev = state.topLevel.get(node.id);
    if (!prev) {
      actions.push({ kind: 'new', id: node.id, node, layerIndex: i, hash });
    } else if (prev.subtreeHash === hash) {
      actions.push({ kind: 'keep', id: node.id, soUUID: prev.soUUID, hash });
    } else {
      actions.push({ kind: 'replace', id: node.id, oldSoUUID: prev.soUUID, node, layerIndex: i, hash });
    }
  }
  // REMOVED: in state but not in new tree.
  const removed: Array<{ id: string; soUUID: string }> = [];
  for (const [id, snap] of state.topLevel) {
    if (!newIds.has(id)) removed.push({ id, soUUID: snap.soUUID });
  }

  const keepCount = actions.filter((a) => a.kind === 'keep').length;
  const replaceCount = actions.filter((a) => a.kind === 'replace').length;
  const newCount = actions.filter((a) => a.kind === 'new').length;

  // Phase A: delete (parallel) — both REMOVED and REPLACE-old.
  // `allSettled` so a single "not found" race doesn't abort the wave; we
  // re-throw on any other failure so a real error (auth, network, refused
  // by the scope guard) surfaces as design.error instead of producing a
  // ghost SO in LS that's no longer tracked in state.topLevel.
  const tDel = Date.now();
  const delResults = await Promise.allSettled([
    ...removed.map((r) => deleteSceneObject(client, r.soUUID)),
    ...actions
      .filter((a): a is Extract<Action, { kind: 'replace' }> => a.kind === 'replace')
      .map((a) => deleteSceneObject(client, a.oldSoUUID)),
  ]);
  for (const r of delResults) {
    if (r.status === 'rejected') {
      const msg = (r.reason as Error).message ?? '';
      if (!/not found/i.test(msg)) throw r.reason;
    }
  }
  const delMs = Date.now() - tDel;

  // Phase B: build (parallel) — both NEW and REPLACE-new go through
  // applyDesignNode. KEEP contributes its existing SO straight to applied[].
  const applied: AppliedNode[] = [];
  const builtNodes: DesignNode[] = [];
  const tBuild = Date.now();
  await Promise.all(
    actions.map(async (a) => {
      if (a.kind === 'keep') {
        // No LS work — the SO + its descendants are already correct.
        applied.push({ nodeId: a.id, soUUID: a.soUUID });
        return;
      }
      builtNodes.push(a.node);
      await applyDesignNode(client, a.node, editSurfaceUUID, a.layerIndex, applied, textOrders);
    }),
  );
  const buildMs = Date.now() - tBuild;

  // Phase C: interactions — only on the subtrees we (re)built. KEPT
  // subtrees still have their existing interaction components attached.
  let interactionMs = 0;
  if (!opts.skipInteractions && builtNodes.length > 0) {
    const tInter = Date.now();
    await applyInteractions(client, builtNodes, applied);
    interactionMs = Date.now() - tInter;
  }
  // Hug + re-attach controllers on any (re)built subtree.
  if (builtNodes.length > 0) {
    await applyHugLayout(client, builtNodes, applied);
    if (!opts.skipInteractions) await applyControllers(client, builtNodes, applied);
  }

  // Update state for the next apply.
  state.scopeRoot = getActiveScope()?.root ?? null;
  const newState = new Map<string, { soUUID: string; subtreeHash: string }>();
  for (const a of actions) {
    if (a.kind === 'keep') {
      newState.set(a.id, { soUUID: a.soUUID, subtreeHash: a.hash });
    } else {
      const built = applied.find((ap) => ap.nodeId === a.id);
      if (built) {
        newState.set(a.id, { soUUID: built.soUUID, subtreeHash: a.hash });
      }
    }
  }
  state.topLevel = newState;

  if (process.env['BRIDGE_DEBUG']) {
    process.stderr.write(
      `bridge:   diff: kept=${keepCount} replaced=${replaceCount} new=${newCount} removed=${removed.length} ` +
        `(del=${delMs}ms build=${buildMs}ms interactions=${interactionMs}ms total=${Date.now() - tDiff}ms)\n`,
    );
  }

  return {
    appliedAt: Date.now(),
    nodeIds: applied.map((a) => a.nodeId),
    soUUIDs: applied.map((a) => a.soUUID),
  };
}

// Exported for tests
export const _internals = {
  resolveMappingValue,
  isVec2,
  isVec3,
  isRgba,
  DEG_TO_RAD,
  TEXT_H_ALIGN,
  TEXT_V_ALIGN,
  structurallyMatches,
};
