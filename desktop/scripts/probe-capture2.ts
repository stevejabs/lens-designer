import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { writeFile } from 'node:fs/promises';
const c = new McpClient(await resolveConfig()); await c.initialize();
const host="1162030065204874979:-7477183781898876057";
const blocks = await c.callToolRaw('CaptureRuntimeViewTool', { uniqueIds:[host], isolate:true, detail:'high' });
const img:any = blocks.find((b:any)=>b.type==='image');
await writeFile('/tmp/ld-view-isolated.jpg', Buffer.from(img.data,'base64'));
console.log('saved /tmp/ld-view-isolated.jpg');
