// verify-services.ts — standalone harness to exercise the v2 Node services
// against the live Lens Studio MCP (:50040) and the real `claude` CLI, without
// launching Electron. Run: pnpm exec tsx scripts/verify-services.ts [--agent]

import { resolveConfig, McpClient } from '../src/services/mcp-client.js';
import { resolveProjectDir } from '../src/services/project.js';
import { AgentRunner } from '../src/services/agent-runner.js';

async function main(): Promise<void> {
  const runAgent = process.argv.includes('--agent');

  console.log('— Direct MCP channel —');
  const config = await resolveConfig();
  console.log(`  resolved: ${config.url} (source: ${config.source})`);
  const client = new McpClient(config);
  const info = await client.initialize();
  console.log(`  connected: ${info.name} ${info.version} on :${info.port} (proto ${info.protocolVersion})`);
  const tools = await client.listTools();
  const clad = tools.some((t) => /scene-graphql|ExecuteEditorCode|VirtualScene/.test(t));
  console.log(`  tools: ${tools.length} exposed; CLAD/5.22 surface: ${clad ? 'yes' : 'no'}`);
  console.log(`  sample: ${tools.slice(0, 10).join(', ')}`);

  console.log('\n— Project resolution —');
  const dir = await resolveProjectDir(info.port);
  console.log(`  project dir: ${dir ?? '(could not resolve)'}`);

  if (runAgent) {
    console.log('\n— Agent channel (live claude) —');
    const runner = new AgentRunner();
    runner.on('event', (e) => console.log(`  [agent] ${JSON.stringify(e).slice(0, 160)}`));
    const handle = runner.run({
      prompt: 'Respond with the single word READY and take no other action.',
      cwd: dir ?? process.cwd(),
      maxTurns: 1,
    });
    const res = await handle.done;
    console.log(`  done: ok=${res.ok} sessionId=${res.sessionId}`);
  } else {
    console.log('\n(skip agent test; pass --agent to exercise the live claude CLI)');
  }
}

main().catch((err) => {
  console.error('VERIFY FAILED:', (err as Error).message);
  process.exit(1);
});
