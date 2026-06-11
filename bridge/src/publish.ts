// publish.ts — publish a view's bay instance as a consumable `.prefab`.
//
// Route B (owner-approved 2026-06-02): a view auto-gets a prefab the first time
// it's painted in the bay, and re-publish updates it IN PLACE with a stable UUID
// (the intended TD-3 behavior) so the consumer's wired reference survives and a
// design change flows straight through — no re-wire. CreatePrefabFromSceneObject
// only makes new assets, so re-publish captures a fresh prefab to a temp, splices
// its body into the existing `.prefab` (keeping the existing ObjectPrefab UUID),
// then deletes the temp with DeleteLensStudioAsset. Cleanup MUST go through
// DeleteLensStudioAsset (works for prefabs — verified 2026-06-03), NOT fs.unlink:
// unlink leaves LS's in-memory asset entry, which leaked the temp + dup'd
// component ids and corrupted the asset DB (the 2026-06-03 regression).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type McpClient,
  createPrefabFromSceneObject,
  deleteAsset,
  getSceneObjectByName,
} from './mcp.ts';
import { splicePrefabBody } from './prefab.ts';
import { getActiveScope } from './scope.ts';
import { EDIT_BAY_SO_NAME } from './connection.ts';

/** Assets-relative folder the prefab lands in (co-located with controllers). */
const PREFAB_DIR = 'LensDesigner';

// viewNodeName/retagViewNode moved to view-node.ts (a leaf module) so the
// instance-expansion path can use them without an import cycle. Re-exported
// here for existing callers (daemon, tests).
export { viewNodeName, retagViewNode } from './view-node.ts';

export interface PublishResult {
  /** Project-relative `.prefab` path. */
  prefab: string;
  mode: 'created' | 'updated';
}

/**
 * Find the bay SceneObject hosting a view's controller. The controller is
 * attached (applyControllers) with the view name as its component name, so the
 * view-root is the bay child carrying a component named `viewName`. Returns
 * null when the view hasn't been painted into the bay yet (apply hasn't run).
 */
export async function findViewBaySO(
  client: McpClient,
  viewName: string,
): Promise<string | null> {
  let bay;
  try {
    bay = await getSceneObjectByName(client, EDIT_BAY_SO_NAME);
  } catch {
    return null;
  }
  const hit = (bay.children ?? []).find((c) =>
    (c.components ?? []).some((comp) => comp.name === viewName),
  );
  return hit?.id ?? null;
}

/**
 * Capture/refresh the prefab for a view from its bay instance.
 *  - No existing prefab → straight create (`created`).
 *  - Existing prefab → capture fresh to a temp asset, splice its body into the
 *    existing file (preserving the prefab UUID so wired references + placed
 *    instances survive + update), then delete the temp via DeleteLensStudioAsset
 *    (`updated`).
 */
export async function publishViewPrefab(
  client: McpClient,
  viewName: string,
  baySoUUID: string,
  existingPrefabPath: string | null,
): Promise<PublishResult> {
  // Stable-UUID update (the intended TD-3 behavior). CreatePrefabFromSceneObject
  // only ever makes a NEW asset and can't overwrite in place, so to update a
  // prefab WITHOUT changing its UUID (which would break a consumer's wired
  // reference), capture a fresh prefab to a temp, splice its body into the
  // existing `.prefab` while preserving the existing ObjectPrefab/<UUID> header,
  // then DELETE the temp. The temp cleanup MUST use DeleteLensStudioAsset (works
  // for prefabs — verified 2026-06-03), NOT fs.unlink: unlink removes the disk
  // file but leaves LS's in-memory asset entry, which leaked the temp + dup'd
  // component ids and corrupted the asset DB (the 2026-06-03 bug).
  const scope = getActiveScope();
  const onDisk = !!existingPrefabPath && !!scope
    && existsSync(join(scope.lensDesignerDir, `${viewName}.prefab`));

  if (!onDisk) {
    // First publish, or the prefab was deleted — create fresh.
    const { prefabPath } = await createPrefabFromSceneObject(client, baySoUUID, PREFAB_DIR, viewName);
    return { prefab: prefabPath, mode: 'created' };
  }

  const tempName = `__republish_${viewName}`;
  const tmp = await createPrefabFromSceneObject(client, baySoUUID, PREFAB_DIR, tempName);
  try {
    await splicePrefabBody(client, existingPrefabPath!, tmp.prefabPath);
  } finally {
    // Proper cleanup — clears the temp from LS's asset DB, not just disk.
    try { await deleteAsset(client, tmp.prefabAssetUUID); } catch { /* best-effort */ }
  }
  return { prefab: existingPrefabPath!, mode: 'updated' };
}
