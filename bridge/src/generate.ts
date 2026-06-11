// In-place controller generation. When `view.save` lands, write each View's
// typed controller into the connected project at `Assets/LensDesigner/<Name>.ts`.
//
// No-export model: the controller `.ts` is the ONLY generated artifact, and the
// live scene instance (reconciled in place) is the template the lens clones at
// runtime — so there's no prefab capture and no separate geometry re-apply (both
// of which churned the edit bay and only existed to feed the dead export path).
// Generation is cheap (a string build + a file write), so it runs on every save;
// a compare-then-write skips the LS re-import when the controller is unchanged
// (e.g. a pure color/size tweak doesn't alter the controller).
//
// Sources:
//   - docs/architecture/2026-05-28-lens-designer-code-driven-views-architecture.md (TD-3)

import {
  type McpClient,
  readProjectTextFile,
  writeProjectTextFile,
  clearScriptAssetIdCache,
} from './mcp.ts';
import { extractViews } from './codegen/extract.ts';
import { generateController, viewClassName } from './codegen/generate.ts';
import { viewNodeName } from './view-node.ts';
import type { DesignNode } from './protocol.ts';
import type { GeneratedRef, ViewRegistry } from './registry.ts';

export interface GenerateInPlaceResult {
  /** One GeneratedRef per View root in the tree, keyed by view name. */
  generations: Map<string, GeneratedRef>;
  /** Non-fatal issues from extract / codegen. */
  warnings: string[];
}

/**
 * Write the typed controller for every View root in `tree` into the connected
 * project's `Assets/LensDesigner/<Name>.ts`. Idempotent: re-reads the existing
 * file and only writes (triggering an LS re-import) when the generated source
 * changed. `prevRegistry` supplies the prior `atVersion` to bump.
 */
export async function generateInPlace(
  client: McpClient,
  tree: DesignNode[],
  prevRegistry: ViewRegistry,
): Promise<GenerateInPlaceResult> {
  // Shared components: definition view-id → controller class name, so an
  // Instance slot can emit a typed child-controller getter + import.
  const instanceClasses = new Map(
    prevRegistry.views.map((v) => [v.id, viewClassName(viewNodeName(v.tree) ?? v.name)]),
  );
  const views = extractViews(tree, instanceClasses);
  const warnings: string[] = [];
  const generations = new Map<string, GeneratedRef>();

  for (const v of views) {
    warnings.push(...v.warnings);

    const controllerRelPath = `LensDesigner/${v.name}.ts`;
    const source = generateController(v);

    // Compare-then-write: a no-op rewrite would re-trigger LS's TS compile on
    // every autosave (incl. pure visual edits, which don't change the
    // controller). Only write when the source actually differs or is absent.
    let existing: string | null = null;
    try {
      existing = await readProjectTextFile(client, controllerRelPath);
    } catch {
      existing = null; // absent (first save) — write below
    }
    if (existing !== source) {
      await writeProjectTextFile(client, controllerRelPath, source);
    }
    // A regenerated controller may have a NEW asset uuid (e.g. it was deleted +
    // recreated). Invalidate the cached id so the next attach re-queries LS and
    // doesn't bind the dead uuid (which produces a dangling ScriptComponent).
    clearScriptAssetIdCache(v.name);

    const prev = findPrevGenerated(prevRegistry, v.name);
    generations.set(v.name, {
      controller: controllerRelPath,
      atVersion: prev ? prev.atVersion + 1 : 1,
    });
  }

  return { generations, warnings };
}

/** Find an existing GeneratedRef for the named view in the prior registry.
 *  Case-insensitive to match the registry's `findViewByName` + the UI's
 *  collision detection. */
function findPrevGenerated(
  prevRegistry: ViewRegistry,
  name: string,
): GeneratedRef | null {
  const lower = name.toLowerCase();
  const v = prevRegistry.views.find((r) => r.name.toLowerCase() === lower);
  return v?.generated ?? null;
}
