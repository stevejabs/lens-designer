// verify-bays.ts — exercise the real bays.ts service against live LS 5.22.
// Creates the edit/app bays in the open project (the intended on-connect
// behavior), flips posture, writes + attaches the runtime gate, and loads a
// view into the edit bay. Prints a scene read-back at the end.
//
// Run: pnpm exec tsx scripts/verify-bays.ts

import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { resolveProjectDir } from '../src/services/project.js';
import {
  ensureBays,
  setBayPosture,
  writeRuntimeGate,
  attachRuntimeGate,
  loadViewIntoEditBay,
} from '../src/services/bays.js';
import { scanViews } from '../src/services/views.js';

async function main(): Promise<void> {
  const client = new McpClient(await resolveConfig());
  const info = await client.initialize();
  console.log(`connected: ${info.name} ${info.version} :${info.port}`);
  const dir = await resolveProjectDir(info.port);
  console.log(`project: ${dir}`);

  console.log('\n[ensureBays]', JSON.stringify(await ensureBays(client)));

  if (dir) {
    await writeRuntimeGate(dir);
    console.log('[writeRuntimeGate] wrote Assets/LensDesigner/LDRuntimeGate.ts');
  }
  let attach = await attachRuntimeGate(client);
  for (let i = 0; i < 20 && attach.status === 'asset-not-imported'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    attach = await attachRuntimeGate(client);
  }
  console.log('[attachRuntimeGate]', JSON.stringify(attach));

  console.log('[posture design]', JSON.stringify(await setBayPosture(client, 'design')));
  console.log('[posture runtime]', JSON.stringify(await setBayPosture(client, 'runtime')));
  console.log('[posture design]', JSON.stringify(await setBayPosture(client, 'design')));

  if (dir) {
    const views = await scanViews(dir);
    console.log(`\nviews found: ${views.map((v) => v.name).join(', ') || '(none)'}`);
    if (views[0]) {
      const name = views[0].name;
      console.log(`[loadViewIntoEditBay ${name}]`, JSON.stringify(await loadViewIntoEditBay(client, name)));
    }
  }

  // Read back the bay state.
  const readback = await client.callTool<{ returnValue?: unknown }>('ExecuteEditorCode', {
    code:
      'const m: any = pluginSystem.findInterface(Editor.Model.IModel);' +
      'const scene: any = m.project.scene;' +
      'const bays = scene.rootSceneObjects.filter((o: any) => o.name.indexOf("__LensDesigner") === 0);' +
      'return bays.map((b: any) => ({ name: b.name, enabled: b.enabled, ' +
      'children: b.children.map((c: any) => c.name), ' +
      'gate: b.getComponents("ScriptComponent").some((c: any) => c.scriptAsset && c.scriptAsset.name === "LDRuntimeGate") }));',
  });
  console.log('\n[read-back]', JSON.stringify(readback.returnValue));
  console.log('\nDONE');
}

main().catch((err) => {
  console.error('VERIFY-BAYS FAILED:', (err as Error).message);
  process.exit(1);
});
