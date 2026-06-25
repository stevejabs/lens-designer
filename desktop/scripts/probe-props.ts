import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
// capabilities digest — what can I project per component?
const caps:any = await q('{ capabilities { digest } }');
console.log('CAPS:', JSON.stringify(caps?.data?.capabilities?.digest ?? caps).slice(0, 1200));
