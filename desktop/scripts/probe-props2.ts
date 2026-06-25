import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { readElementProperties } from '../src/services/ui-tree.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const header = "3430696089498839885:4192734858554906906";
console.log('Header live props:', JSON.stringify(await readElementProperties(c, header)));
