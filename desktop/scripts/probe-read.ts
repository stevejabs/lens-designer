import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
const c = new McpClient(await resolveConfig()); await c.initialize();
const q = async (gql:string):Promise<any> => c.callTool('QueryRuntimeSceneTool', { query: gql });
const header = "3430696089498839885:4192734858554906906"; // Header (Text) from the tree
// Approach A: property filter scoped to the object's name, with matchedProperty
const a:any = await q(`{ sceneObjects(filter: {property: {componentType: "Text", propertyName: "text", operator: EXISTS}}) { matches { summary { name uniqueId } matchedProperty { value } } } }`);
console.log('A (text readers):', JSON.stringify(a?.data?.sceneObjects?.matches?.slice(0,4)));
// Approach B: direct projection on sceneObject with component(type)/properties
for (const proj of ['component(type:"Text"){ properties }','components { type properties }','component(type:"Text"){ property(name:"text") }']) {
  try { const b:any = await q(`{ sceneObject(uniqueId:"${header}") { ${proj} } }`); console.log(`B [${proj.slice(0,30)}]:`, JSON.stringify(b).slice(0,300)); }
  catch(e:any){ console.log(`B [${proj.slice(0,30)}] err:`, e.message.slice(0,120)); }
}
