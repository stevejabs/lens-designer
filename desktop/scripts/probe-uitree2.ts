import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { readElementTree } from '../src/services/ui-tree.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const t = await readElementTree(c);
console.log('ok:', t.ok, 'host:', t.host, 'reason:', t.reason);
const walk = (n:any, d=0):void => { if(!n)return; console.log('  '.repeat(d)+`${n.name} <${n.componentTypes.join(',')}>`); for(const ch of n.children) walk(ch,d+1); };
if (t.tree) walk(t.tree);
