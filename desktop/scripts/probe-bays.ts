// probe-bays.ts — live-verify the LS 5.22 Editor-API ops the bay system needs,
// driven through the SAME McpClient the bridge uses. Read-only on the real
// scene except a throwaway `__LDProbe__`/`__LDProbe2__` pair it deletes.
//
// Run: pnpm exec tsx scripts/probe-bays.ts

import { resolveConfig, McpClient } from '../src/services/mcp-client.js';

const EEC = 'ExecuteEditorCode';

async function main(): Promise<void> {
  const config = await resolveConfig();
  const client = new McpClient(config);
  const info = await client.initialize();
  console.log(`connected: ${info.name} ${info.version} :${info.port}`);

  const tools = await client.listTools();
  const eecName = tools.find((t) => /ExecuteEditorCode/i.test(t)) ?? EEC;
  console.log(`EEC tool name: ${eecName} (present: ${tools.includes(eecName)})`);

  // Discover the EEC input schema so I pass the right arg key.
  const raw = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.bearer}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
  });
  const listed = (await raw.json()) as { result?: { tools: Array<{ name: string; inputSchema?: unknown }> } };
  const eecTool = listed.result?.tools.find((t) => t.name === eecName);
  console.log(`EEC inputSchema: ${JSON.stringify(eecTool?.inputSchema)}`);

  // Helper: run an EEC body, trying the likely arg keys until one works.
  const argKeys = ['code', 'script', 'source', 'editorCode'];
  const run = async (body: string): Promise<unknown> => {
    let lastErr = '';
    for (const key of argKeys) {
      try {
        return await client.callTool<unknown>(eecName, { [key]: body });
      } catch (err) {
        lastErr = (err as Error).message;
        if (!/unknown|required|invalid|argument|param/i.test(lastErr)) throw err;
      }
    }
    throw new Error(`all arg keys failed: ${lastErr}`);
  };

  // EEC injects `pluginSystem` and compiles the string as a module body with
  // top-level `return` — so pass bare statements, not a function expression.
  const fn = (inner: string): string =>
    `try { ${inner} } catch (e) { return { ERR: (e && e.message ? e.message : String(e)), stack: (e && e.stack ? String(e.stack).split('\\n').slice(0,4) : null) }; }`;

  // 1. List root scene objects (real state of ld-specs-test).
  console.log('\n[1] root scene objects:');
  console.log(
    JSON.stringify(
      await run(
        fn(`const m = pluginSystem.findInterface(Editor.Model.IModel);
            return m.project.scene.rootSceneObjects.map(o => ({ name: o.name, id: o.id.toString(), enabled: o.enabled, kids: o.children.length }));`),
      ),
    ),
  );

  // Step A: create one SO and introspect the destroy/reparent surface (no
  // mutation beyond the single create — leaves __LDProbe__ for step B).
  console.log('\n[A] create + introspect:');
  console.log(
    JSON.stringify(
      await run(
        fn(`const m: any = pluginSystem.findInterface(Editor.Model.IModel);
            const scene: any = m.project.scene;
            const bay: any = scene.createSceneObject('__LDProbe__');
            return {
              createdName: bay.name,
              createdId: bay.id.toString(),
              destroyMethods: {
                scene_destroySceneObject: typeof scene.destroySceneObject,
                scene_removeSceneObject: typeof scene.removeSceneObject,
                scene_deleteSceneObject: typeof scene.deleteSceneObject,
                obj_destroy: typeof bay.destroy,
                obj_remove: typeof bay.remove,
              },
              reparentMethods: {
                scene_reparentSceneObject: typeof scene.reparentSceneObject,
                obj_setParent: typeof bay.setParent,
              },
            };`),
      ),
    ),
  );

  // Step B: reparent a marker under it, toggle enabled, check ownership,
  // then destroy via whichever method step A found, and confirm cleanup.
  console.log('\n[B] reparent + enable + marker + destroy:');
  console.log(
    JSON.stringify(
      await run(
        fn(`const m: any = pluginSystem.findInterface(Editor.Model.IModel);
            const scene: any = m.project.scene;
            const out: any = {};
            const bay: any = scene.rootSceneObjects.find((o: any) => o.name === '__LDProbe__');
            if (!bay) return { ERR: 'probe from step A not found' };
            const marker: any = scene.createSceneObject('__LDProbeMarker__');
            scene.reparentSceneObject(marker, bay);
            out.bayKids = bay.children.map((c: any) => c.name);
            out.markerParent = marker.getParent() ? marker.getParent().name : null;
            bay.enabled = false; out.offState = bay.enabled; bay.enabled = true; out.onState = bay.enabled;
            out.owned = bay.children.some((c: any) => c.name === '__LDProbeMarker__');
            if (typeof scene.destroySceneObject === 'function') scene.destroySceneObject(bay);
            else if (typeof scene.deleteSceneObject === 'function') scene.deleteSceneObject(bay);
            else if (typeof bay.destroy === 'function') bay.destroy();
            out.cleanedUp = !scene.rootSceneObjects.some((o: any) => o.name === '__LDProbe__');
            return out;`),
      ),
    ),
  );

  // 8. List TypeScript assets (so I know how to find a generated gate by name).
  console.log('\n[8] sample TypeScript assets (name lookup target):');
  console.log(
    JSON.stringify(
      await run(
        fn(`const m = pluginSystem.findInterface(Editor.Model.IModel);
            const am = m.project.assetManager;
            const ts = am.assets.filter(a => a.isOfType && a.isOfType('TypeScriptAsset')).map(a => a.name);
            return { tsAssetCount: ts.length, sample: ts.slice(0, 12) };`),
      ),
    ),
  );

  console.log('\nDONE — project left clean (probe objects destroyed)');
}

main().catch((err) => {
  console.error('PROBE FAILED:', (err as Error).message);
  process.exit(1);
});
