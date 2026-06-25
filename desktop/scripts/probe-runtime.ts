import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
// schema
const raw = await fetch((await resolveConfig()).url, { method:'POST', headers:{ Authorization:`Bearer ${(await resolveConfig()).bearer}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list',params:{}})});
const tools = (await raw.json() as any).result.tools;
const q = tools.find((t:any)=>t.name==='QueryRuntimeSceneTool');
console.log('QueryRuntimeSceneTool inputSchema:', JSON.stringify(q?.inputSchema));
// try a roots query
for (const key of ['query','graphql','gql']) {
  try {
    const r:any = await c.callTool('QueryRuntimeSceneTool', { [key]: '{ sceneRoots { summary } }' });
    console.log(`\n[key=${key}] result:`, JSON.stringify(r).slice(0,800));
    break;
  } catch (e:any) { console.log(`[key=${key}] err:`, e.message.slice(0,120)); }
}
