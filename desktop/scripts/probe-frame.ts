import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { loadViewIntoEditBay } from '../src/services/bays.js';
import { writeFile } from 'node:fs/promises';
const c = new McpClient(await resolveConfig()); await c.initialize();
await loadViewIntoEditBay(c, 'SettingsViewUI');
await new Promise(r=>setTimeout(r,1500));
const blocks = await c.callToolRaw('CapturePanelScreenshotTool', { pluginId:'Snap.Plugin.Gui.PreviewPanel', maxDimension:900 });
const img:any = blocks.find((b:any)=>b.type==='image');
if(img){ await writeFile('/tmp/ld-preview-framed.png', Buffer.from(img.data,'base64')); console.log('saved /tmp/ld-preview-framed.png'); }
else console.log('no image');
