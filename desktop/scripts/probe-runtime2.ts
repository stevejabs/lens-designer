import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
// find the loaded view host
const found:any = await q('{ sceneObjects(filter: {nameContains: "__LDView__"}) { matches { summary } } }');
const matches = found?.data?.sceneObjects?.matches ?? [];
console.log('view hosts:', matches.map((m:any)=>m.summary.name+' '+m.summary.uniqueId));
const host = matches[0]?.summary?.uniqueId;
if (host) {
  const tree:any = await q(`{ sceneObject(uniqueId: "${host}") { summary descendantsTree(maxDepth: 5, enabledOnly: true) } }`);
  const root = tree?.data?.sceneObject;
  console.log('host summary:', JSON.stringify(root?.summary));
  const walk = (n:any, d=0):void => {
    if(!n) return;
    const s = n.summary ?? n;
    console.log('  '.repeat(d) + `${s.name}  <${(s.componentTypes||[]).join(',')}>`);
    for (const ch of (n.children ?? n.descendantsTree?.children ?? [])) walk(ch, d+1);
  };
  console.log('descendantsTree raw keys:', Object.keys(root?.descendantsTree ?? root ?? {}));
  console.log(JSON.stringify(root?.descendantsTree).slice(0, 1500));
}
