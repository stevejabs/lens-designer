import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
for (const [name,id] of [['Header','3430696089498839885:4192734858554906906'],['host','1162030065204874979:-7477183781898876057']]) {
  for (const proj of ['transform { worldPosition }','transform { worldPosition worldScale }','transform { worldPosition size }']) {
    try { const r:any = await q(`{ sceneObject(uniqueId:"${id}") { ${proj} } }`); if(r?.data){ console.log(name, '|', proj.slice(0,30), '=>', JSON.stringify(r.data.sceneObject)); break; } else console.log(name, proj.slice(0,30), 'ERR', r?.errors?.[0]?.message?.slice(0,50)); }
    catch(e:any){ console.log(name,'err',e.message.slice(0,50)); }
  }
}
