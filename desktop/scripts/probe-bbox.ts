import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const cfg = await resolveConfig();
const raw = await fetch(cfg.url,{method:'POST',headers:{Authorization:`Bearer ${cfg.bearer}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list',params:{}})});
const tools=(await raw.json() as any).result.tools;
const bb=tools.find((t:any)=>t.name==='GetBoundingBox');
console.log('GetBoundingBox schema:', JSON.stringify(bb?.inputSchema)?.slice(0,500));
// try it on the Header
const header="3430696089498839885:4192734858554906906";
for (const args of [{uniqueIds:[header]},{uniqueId:header},{objectId:header}]) {
  try { const r:any = await c.callTool('GetBoundingBox', args); console.log('result:', JSON.stringify(r).slice(0,400)); break; }
  catch(e:any){ console.log('err', JSON.stringify(args).slice(0,30), e.message.slice(0,80)); }
}
