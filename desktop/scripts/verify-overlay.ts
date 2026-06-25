import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { readViewLayout } from '../src/services/ui-tree.js';
import { writeFile } from 'node:fs/promises';
const K = parseFloat(process.argv[2] ?? '1');   // vertical NDC correction
const KX = parseFloat(process.argv[3] ?? '1');  // horizontal NDC correction
const c = new McpClient(await resolveConfig()); await c.initialize();
const blocks = await c.callToolRaw('CapturePanelScreenshotTool', { pluginId:'Snap.Plugin.Gui.PreviewPanel', maxDimension:900 });
const img:any = blocks.find((b:any)=>b.type==='image');
const dataUrl = `data:${img.mimeType||'image/png'};base64,${img.data}`;
const L = await readViewLayout(c);
const BOX = ['Switch','Slider','Button','ProgressBar','BackPlate','Text','Image'];
const els = L.elements.map(e=>({ name:e.name, type:(e.componentTypes.find(t=>['Switch','Slider','Button','ProgressBar'].includes(t))||(e.componentTypes.includes('BackPlate')?'BackPlate':e.componentTypes.includes('Text')?'Text':e.componentTypes.includes('Image')?'Image':null)), x:e.x, y:e.y, z:e.z })).filter(e=>e.type&&BOX.includes(e.type));
const html=`<body style="margin:0;background:#111"><div id="w" style="position:relative;display:inline-block"><img id="im" src="${dataUrl}" style="display:block;width:760px"/></div>
<script>const els=${JSON.stringify(els)},fov=${L.fovDeg},K=${K},KX=${KX};const im=document.getElementById('im'),w=document.getElementById('w');
function draw(){const a=im.naturalWidth/im.naturalHeight;for(const e of els){const d=Math.abs(e.z)||100,hV=d*Math.tan((fov/2)*Math.PI/180),hH=hV*a;const xf=0.5+((e.x/hH)*KX)*0.5,yf=0.5-((e.y/hV)*K)*0.5;const v=document.createElement('div');v.textContent=e.name;v.style.cssText='position:absolute;left:'+(xf*100)+'%;top:'+(yf*100)+'%;transform:translate(-50%,-50%);outline:2px solid #22d3ee;color:#22d3ee;font:9px sans-serif;background:rgba(34,211,238,.1)';w.appendChild(v);}}
if(im.complete)draw();else im.onload=draw;</script></body>`;
await writeFile('/tmp/ld-overlay.html', html);
console.log('K='+K+' KX='+KX+' fov='+L.fovDeg.toFixed(1)+' boxes='+els.length);
