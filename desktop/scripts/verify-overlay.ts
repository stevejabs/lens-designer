import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { readViewLayout } from '../src/services/ui-tree.js';
import { writeFile } from 'node:fs/promises';
const c = new McpClient(await resolveConfig()); await c.initialize();
const blocks = await c.callToolRaw('CapturePanelScreenshotTool', { pluginId:'Snap.Plugin.Gui.PreviewPanel', maxDimension:900 });
const img:any = blocks.find((b:any)=>b.type==='image');
const dataUrl = `data:${img.mimeType||'image/png'};base64,${img.data}`;
const L = await readViewLayout(c);
const BOX = ['Text','Switch','Toggle','Slider','Button','Image','ProgressBar','BackPlate'];
const els = L.elements.map(e=>({ name:e.name, type:(e.componentTypes.find(t=>['Switch','Slider','Button','ProgressBar'].includes(t))||e.componentTypes.find(t=>t==='BackPlate')||(e.componentTypes.includes('Text')?'Text':e.componentTypes.includes('Image')?'Image':null)), x:e.x, y:e.y, z:e.z }))
  .filter(e=>e.type && BOX.includes(e.type));
const html = `<body style="margin:0;background:#111"><div id="wrap" style="position:relative;display:inline-block">
<img id="im" src="${dataUrl}" style="display:block;width:760px"/></div>
<script>
const els=${JSON.stringify(els)}, fov=${L.fovDeg};
const im=document.getElementById('im'), wrap=document.getElementById('wrap');
function draw(){ const aspect=im.naturalWidth/im.naturalHeight;
 for(const e of els){ const d=Math.abs(e.z)||100, hV=d*Math.tan((fov/2)*Math.PI/180), hH=hV*aspect;
  const xf=0.5+(e.x/hH)*0.5, yf=0.5-(e.y/hV)*0.5;
  const div=document.createElement('div'); div.textContent=e.name;
  div.style.cssText='position:absolute;left:'+(xf*100)+'%;top:'+(yf*100)+'%;transform:translate(-50%,-50%);outline:2px solid #22d3ee;color:#22d3ee;font:9px sans-serif;padding:0 2px;white-space:nowrap;background:rgba(34,211,238,0.08)';
  wrap.appendChild(div); } }
if(im.complete) draw(); else im.onload=draw;
</script></body>`;
await writeFile('/tmp/ld-overlay.html', html);
console.log('fov:', L.fovDeg.toFixed(1), 'boxes:', els.length, '→ /tmp/ld-overlay.html');
