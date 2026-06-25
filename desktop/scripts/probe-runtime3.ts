import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
const id = "1162030065204874979:-7477183781898876057"; // SettingsViewUI host
const tree:any = await q(`{ sceneObject(uniqueId: "${id}") { summary descendantsTree(maxDepth: 5) } }`);
const root = tree?.data?.sceneObject;
console.log('summary:', JSON.stringify(root?.summary));
console.log('tree:', JSON.stringify(root?.descendantsTree).slice(0, 2500));
