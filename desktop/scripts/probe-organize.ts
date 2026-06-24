import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { planSceneOrganization } from '../src/services/scene-organize.js';
const c = new McpClient(await resolveConfig());
await c.initialize();
console.log('plan:', JSON.stringify(await planSceneOrganization(c), null, 1));
