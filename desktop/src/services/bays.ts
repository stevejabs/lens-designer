// bays.ts — the edit-bay / app-bay posture system, driven through the live LS
// 5.22 Editor API (ExecuteEditorCode). All scene ops here were verified live
// against the project (scripts/probe-bays.ts).
//
// The pair:
//   __LensDesignerEditBay__  — the authoring surface; the selected view's
//                              content is loaded under it for the preview.
//   __LensDesignerAppBay__   — the app's runtime content root.
// Exactly one is enabled at a time: design posture shows the edit bay, runtime
// posture shows the app bay. On device the generated LDRuntimeGate enforces
// runtime posture via isEditor() so the bridge stays the editor-side authority.
//
// Ownership is verified by a `__LensDesignerOwned__` child marker — a bay that
// exists but lacks the marker is a FOREIGN object that happens to share the
// reserved name; we refuse to touch it rather than corrupt user content.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpClient } from './mcp-client.js';
import {
  generateRuntimeGate,
  LD_RUNTIME_GATE_NAME,
  LD_RUNTIME_GATE_FILENAME,
  EDIT_BAY_NAME,
  APP_BAY_NAME,
  OWNED_MARKER_NAME,
} from './codegen-gate.js';

export type BayPosture = 'design' | 'runtime';

interface EecEnvelope<T> {
  returnValue?: T;
  status?: string;
  errors?: string[];
}

/** Run an ExecuteEditorCode body and return its `returnValue`, throwing on a
 *  compile/exec failure. The body receives `pluginSystem` and should `return`. */
async function eec<T>(client: McpClient, code: string): Promise<T> {
  const res = await client.callTool<EecEnvelope<T>>('ExecuteEditorCode', { code });
  if (!res || res.status !== 'Execution Succeeded') {
    const detail = res?.errors?.join('; ') ?? res?.status ?? 'unknown error';
    throw new Error(`ExecuteEditorCode failed: ${detail}`);
  }
  return res.returnValue as T;
}

// Shared EEC preamble. `scene`/`am` are `any` because EEC compiles strict TS
// and the Editor model members are easier to drive untyped.
const PREAMBLE =
  'const m: any = pluginSystem.findInterface(Editor.Model.IModel);' +
  'const scene: any = m.project.scene;' +
  'const am: any = m.project.assetManager;';

export interface BayState {
  edit: { status: 'created' | 'adopted' | 'refused'; id: string | null };
  app: { status: 'created' | 'adopted' | 'refused'; id: string | null };
}

/** Find-or-create both bays with ownership markers, atomically. Refuses to
 *  adopt a same-named SO that lacks the marker. */
export async function ensureBays(client: McpClient): Promise<BayState> {
  const code =
    PREAMBLE +
    'const MARKER = ' + JSON.stringify(OWNED_MARKER_NAME) + ';' +
    'function ensure(name: string): any {' +
    '  const existing: any = scene.rootSceneObjects.find((o: any) => o.name === name);' +
    '  if (existing) {' +
    '    const owned = existing.children.some((c: any) => c.name === MARKER);' +
    '    if (!owned) return { status: "refused", id: null };' +
    '    return { status: "adopted", id: existing.id.toString() };' +
    '  }' +
    '  const bay: any = scene.createSceneObject(name);' +
    '  const marker: any = scene.createSceneObject(MARKER);' +
    '  scene.reparentSceneObject(marker, bay);' +
    '  return { status: "created", id: bay.id.toString() };' +
    '}' +
    'return { edit: ensure(' + JSON.stringify(EDIT_BAY_NAME) + '), app: ensure(' + JSON.stringify(APP_BAY_NAME) + ') };';
  const state = await eec<BayState>(client, code);
  if (state.edit.status === 'refused' || state.app.status === 'refused') {
    const which = state.edit.status === 'refused' ? EDIT_BAY_NAME : APP_BAY_NAME;
    throw new Error(
      `bay "${which}" already exists in this project without the ${OWNED_MARKER_NAME} marker ` +
        `Lens Designer writes when it owns a bay. Refusing to adopt a foreign object — ` +
        `rename or remove it in Lens Studio, then reconnect.`,
    );
  }
  return state;
}

/** Swap which bay is enabled. design = edit on / app off; runtime = inverse. */
export async function setBayPosture(
  client: McpClient,
  posture: BayPosture,
): Promise<{ editEnabled: boolean; appEnabled: boolean }> {
  const design = posture === 'design';
  const code =
    PREAMBLE +
    'const design = ' + (design ? 'true' : 'false') + ';' +
    'let editEnabled: any = null; let appEnabled: any = null;' +
    'for (const o of scene.rootSceneObjects) {' +
    '  if (o.name === ' + JSON.stringify(EDIT_BAY_NAME) + ') { o.enabled = design; editEnabled = o.enabled; }' +
    '  else if (o.name === ' + JSON.stringify(APP_BAY_NAME) + ') { o.enabled = !design; appEnabled = o.enabled; }' +
    '}' +
    'return { editEnabled, appEnabled };';
  return eec(client, code);
}

/** Write the runtime gate source under Assets/LensDesigner/ (LS imports it). */
export async function writeRuntimeGate(projectDir: string): Promise<void> {
  const dir = join(projectDir, 'Assets', 'LensDesigner');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, LD_RUNTIME_GATE_FILENAME), generateRuntimeGate(), 'utf8');
}

/** Attach the LDRuntimeGate ScriptComponent to both bays (idempotent).
 *  Returns 'asset-not-imported' while LS is still importing the just-written
 *  source — the caller retries. */
export async function attachRuntimeGate(
  client: McpClient,
): Promise<{ status: 'attached' | 'asset-not-imported'; attached: number }> {
  const code =
    PREAMBLE +
    'const ts: any = am.assets.filter((a: any) => a.name === ' + JSON.stringify(LD_RUNTIME_GATE_NAME) +
    ' && a.isOfType && a.isOfType("TypeScriptAsset"));' +
    'if (ts.length === 0) return { status: "asset-not-imported", attached: 0 };' +
    'const bays: any = scene.rootSceneObjects.filter((o: any) => o.name === ' + JSON.stringify(EDIT_BAY_NAME) +
    ' || o.name === ' + JSON.stringify(APP_BAY_NAME) + ');' +
    'let attached = 0;' +
    'for (const bay of bays) {' +
    '  const has = bay.getComponents("ScriptComponent").some((c: any) => c.scriptAsset && c.scriptAsset.name === ' +
    JSON.stringify(LD_RUNTIME_GATE_NAME) + ');' +
    '  if (!has) { const sc: any = bay.addComponent("ScriptComponent"); sc.scriptAsset = ts[0]; attached++; }' +
    '}' +
    'return { status: "attached", attached };';
  return eec(client, code);
}

/** Load a view's content into the edit bay so the preview shows it. Each view
 *  gets an owned host SO `__LDView__<name>` under the edit bay carrying the
 *  view's ScriptComponent; the selected one is enabled, the rest disabled. */
export async function loadViewIntoEditBay(
  client: McpClient,
  viewAssetName: string,
): Promise<{ status: 'loaded' | 'no-edit-bay' | 'asset-not-imported'; host?: string }> {
  const code =
    PREAMBLE +
    'const VIEW = ' + JSON.stringify(viewAssetName) + ';' +
    'const editBay: any = scene.rootSceneObjects.find((o: any) => o.name === ' + JSON.stringify(EDIT_BAY_NAME) + ');' +
    'if (!editBay) return { status: "no-edit-bay" };' +
    'const ts: any = am.assets.filter((a: any) => a.name === VIEW && a.isOfType && a.isOfType("TypeScriptAsset"));' +
    'if (ts.length === 0) return { status: "asset-not-imported" };' +
    'const HOST = "__LDView__" + VIEW;' +
    'for (const c of editBay.children) { if (c.name.indexOf("__LDView__") === 0) c.enabled = false; }' +
    'let host: any = editBay.children.find((c: any) => c.name === HOST);' +
    'if (!host) {' +
    '  host = scene.createSceneObject(HOST);' +
    '  scene.reparentSceneObject(host, editBay);' +
    '  const sc: any = host.addComponent("ScriptComponent");' +
    '  sc.scriptAsset = ts[0];' +
    '}' +
    'host.enabled = true;' +
    'editBay.enabled = true;' +
    'return { status: "loaded", host: HOST };';
  return eec(client, code);
}

/** Disable every loaded view host in the edit bay (e.g. nothing selected). */
export async function clearEditBay(client: McpClient): Promise<void> {
  const code =
    PREAMBLE +
    'const editBay: any = scene.rootSceneObjects.find((o: any) => o.name === ' + JSON.stringify(EDIT_BAY_NAME) + ');' +
    'if (!editBay) return { ok: false };' +
    'for (const c of editBay.children) { if (c.name.indexOf("__LDView__") === 0) c.enabled = false; }' +
    'return { ok: true };';
  await eec(client, code);
}
