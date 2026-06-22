// agent-factory.ts — pick the generative-channel CLI adapter. Claude by
// default; Codex when LD_AGENT_CLI=codex. Both implement AgentAdapter so the
// orchestrator never depends on which CLI is in use.

import { AgentRunner, type AgentAdapter } from './agent-runner.js';
import { CodexRunner } from './codex-runner.js';

export function createAgentAdapter(): AgentAdapter {
  const choice = (process.env['LD_AGENT_CLI'] ?? 'claude').toLowerCase();
  if (choice === 'codex') return new CodexRunner();
  return new AgentRunner();
}
