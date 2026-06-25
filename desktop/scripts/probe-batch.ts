import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { readElementTree, readElementPropertiesBatch } from '../src/services/ui-tree.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const t = await readElementTree(c);
const ids:string[]=[]; const walk=(n:any)=>{ if(!n)return; ids.push(n.id); n.children.forEach(walk); }; walk(t.tree);
const props = await readElementPropertiesBatch(c, ids);
const texts = Object.entries(props).filter(([_,p]:any)=>p.text).map(([_,p]:any)=>p.text);
console.log('nodes:', ids.length, '| text values found:', JSON.stringify(texts.slice(0,8)));
