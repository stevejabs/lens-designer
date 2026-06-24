// scene-organize.ts — onboarding an EXISTING project: move the app's content
// under __LensDesignerAppBay__ so the bay posture system actually governs it,
// while leaving core SPECS infrastructure (Camera, Lighting, SIK, device
// tracking) at the scene root where it belongs.
//
// This rewrites the user's live scene, so it is gated behind an explicit
// confirmation in the UI (with a "commit your work first" reminder) and is
// offered as a dry-run plan before anything moves. Driven through the verified
// LS 5.22 Editor API (ExecuteEditorCode).

import type { McpClient } from './mcp-client.js';
import { EDIT_BAY_NAME, APP_BAY_NAME } from './codegen-gate.js';

interface EecEnvelope<T> {
  returnValue?: T;
  status?: string;
  errors?: string[];
}

async function eec<T>(client: McpClient, code: string): Promise<T> {
  const res = await client.callTool<EecEnvelope<T>>('ExecuteEditorCode', { code });
  if (!res || res.status !== 'Execution Succeeded') {
    throw new Error(`ExecuteEditorCode failed: ${res?.errors?.join('; ') ?? res?.status ?? 'unknown'}`);
  }
  return res.returnValue as T;
}

const PREAMBLE =
  'const m: any = pluginSystem.findInterface(Editor.Model.IModel);' +
  'const scene: any = m.project.scene;';

// Infrastructure that must stay at scene root. Matched by name OR by a
// component type that only makes sense at root (camera/light/tracking/SIK).
// AiPreviewAgent / AgentInspect is CLAD's own preview-inspection helper (the
// AgentInspectScript hook CLAD queries the live preview through) — tooling, not
// app content, so it stays at root.
const INFRA_CLASSIFIER =
  'const INFRA_NAME = /camera|lighting|^light$|spectaclesinteractionkit|interaction\\s*kit|device\\s*tracking|world\\s*query|main\\s*camera|aipreview|agentinspect|previewagent/i;' +
  'const INFRA_COMP = /^(Camera|LightSource|DeviceTracking|DeviceTrackingComponent)$/;' +
  'function isInfra(o: any): boolean {' +
  '  if (INFRA_NAME.test(o.name)) return true;' +
  '  const comps = (o.components || []);' +
  '  for (const c of comps) {' +
  '    const tn = (c.getTypeName ? c.getTypeName() : "");' +
  '    if (INFRA_COMP.test(tn)) return true;' +
  '  }' +
  '  return false;' +
  '}' +
  'function isOurs(o: any): boolean { return o.name.indexOf("__LensDesigner") === 0; }';

export interface OrganizePlan {
  moveToAppBay: string[];
  stayAtRoot: string[];
  hasAppBay: boolean;
}

/** Read-only: classify every root object as content (→ app bay) vs.
 *  infrastructure (stays at root). Shown to the user before anything moves. */
export async function planSceneOrganization(client: McpClient): Promise<OrganizePlan> {
  const code =
    PREAMBLE +
    INFRA_CLASSIFIER +
    'const move: string[] = []; const stay: string[] = [];' +
    'let hasAppBay = false;' +
    'for (const o of scene.rootSceneObjects) {' +
    '  if (o.name === ' + JSON.stringify(APP_BAY_NAME) + ') { hasAppBay = true; continue; }' +
    '  if (o.name === ' + JSON.stringify(EDIT_BAY_NAME) + ') continue;' +
    '  if (isOurs(o)) continue;' +
    '  if (isInfra(o)) stay.push(o.name); else move.push(o.name);' +
    '}' +
    'return { moveToAppBay: move, stayAtRoot: stay, hasAppBay };';
  return eec<OrganizePlan>(client, code);
}

/** Reparent content objects under the app bay (infrastructure stays at root).
 *  Destructive — only call after the user confirms. */
export async function organizeSceneIntoAppBay(
  client: McpClient,
): Promise<{ status: 'organized' | 'no-app-bay'; moved: string[] }> {
  const code =
    PREAMBLE +
    INFRA_CLASSIFIER +
    'const appBay: any = scene.rootSceneObjects.find((o: any) => o.name === ' + JSON.stringify(APP_BAY_NAME) + ');' +
    'if (!appBay) return { status: "no-app-bay", moved: [] };' +
    // Snapshot the root list first — reparenting mutates it as we go.
    'const roots: any[] = scene.rootSceneObjects.slice();' +
    'const moved: string[] = [];' +
    'for (const o of roots) {' +
    '  if (o.name === ' + JSON.stringify(APP_BAY_NAME) + ' || o.name === ' + JSON.stringify(EDIT_BAY_NAME) + ') continue;' +
    '  if (isOurs(o)) continue;' +
    '  if (isInfra(o)) continue;' +
    '  scene.reparentSceneObject(o, appBay);' +
    '  moved.push(o.name);' +
    '}' +
    'return { status: "organized", moved };';
  return eec(client, code);
}
