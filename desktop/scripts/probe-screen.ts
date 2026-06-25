import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
const h="3430696089498839885:4192734858554906906";
// full digest, look for transform/bounds/screen fields
const caps:any = await q('{ capabilities { digest } }');
const dig=JSON.stringify(caps?.data?.capabilities?.digest??caps);
console.log('digest has worldPosition?', dig.includes('worldPosition'), '| screenPosition?', dig.includes('screen'), '| bounds?', dig.includes('ounds'), '| transform?', dig.includes('ransform'));
// try transform projections
for (const p of ['transform { worldPosition { x y z } }','transform { position { x y z } worldPosition { x y z } }','worldAabb { min { x y z } max { x y z } }','screenRect { x y width height }','transform']) {
  try { const r:any = await q(`{ sceneObject(uniqueId:"${h}") { ${p} } }`); console.log(`[${p.slice(0,22)}]`, r?.data?JSON.stringify(r.data).slice(0,160):r?.errors?.[0]?.message?.slice(0,70)); } catch(e:any){ console.log('[err]',e.message.slice(0,60)); }
}
