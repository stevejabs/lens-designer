import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const t = await c.listTools();
console.log(t.filter(x=>/preview|inspect|scene|graphql|runtime|capture|describe|query/i.test(x)).join('\n'));
