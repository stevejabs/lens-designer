import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { ensureBays, loadViewIntoEditBay } from '../src/services/bays.js';
import { readElementTree } from '../src/services/ui-tree.js';

const c = new McpClient(await resolveConfig());
await c.initialize();
await ensureBays(c);
// Load a real CLAD view into the edit bay (SettingsViewUI exists in ld-bookshelf-app).
console.log('load:', JSON.stringify(await loadViewIntoEditBay(c, 'SettingsViewUI')));
await new Promise((r) => setTimeout(r, 1500)); // let it build
const t = await readElementTree(c);
const summarize = (n: any, d = 0): void => {
  if (!n) return;
  console.log('  '.repeat(d) + (n.uikitType ? `[${n.uikitType}]` : '') + ' ' + n.name);
  for (const ch of n.children) summarize(ch, d + 1);
};
console.log('ok:', t.ok, 'host:', t.host, 'reason:', t.reason);
if (t.tree) summarize(t.tree);
