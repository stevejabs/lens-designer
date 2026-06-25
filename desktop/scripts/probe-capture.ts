import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
// schema
const raw = await fetch((await resolveConfig()).url,{method:'POST',headers:{Authorization:`Bearer ${(await resolveConfig()).bearer}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list',params:{}})});
const tool=(await raw.json() as any).result.tools.find((t:any)=>t.name==='CaptureRuntimeViewTool');
console.log('schema:', JSON.stringify(tool?.inputSchema).slice(0,700));
const host="1162030065204874979:-7477183781898876057";
const blocks = await c.callToolRaw('CaptureRuntimeViewTool', { uniqueIds:[host], isolate:true });
const img = blocks.find((b:any)=>b.type==='image');
console.log('got image:', !!img, 'mime:', img?.mimeType, 'bytes(b64 len):', img?.data?.length);
