// orchestrator.ts — the heart of the two-channel architecture.
//
// Holds the direct LS MCP connection and the agent runner, and serializes all
// scene-mutating work through ONE command queue (single-writer discipline):
// a direct write never overlaps an agent turn, and after each agent turn the
// orchestrator can re-sync its model from the scene. Reads can run anytime.

import { EventEmitter } from 'node:events';
import { LsConnection, type ConnState } from './ls-connection.js';
import { AgentRunner, type AgentEvent } from './agent-runner.js';

export interface AgentTurnRequest {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
}

export interface OrchestratorEvents {
  'connection': (s: ConnState) => void;
  'agent-event': (e: AgentEvent) => void;
}

export class Orchestrator extends EventEmitter {
  readonly connection = new LsConnection();
  private readonly agent = new AgentRunner();
  /** Promise chain enforcing single-writer ordering across the two channels. */
  private queue: Promise<unknown> = Promise.resolve();
  private agentBusy = false;
  private activeCancel: (() => void) | null = null;

  constructor() {
    super();
    this.connection.on('status', (s) => this.emit('connection', s));
    this.agent.on('event', (e: AgentEvent) => this.emit('agent-event', e));
  }

  start(): void {
    this.connection.start();
  }

  stop(): void {
    this.activeCancel?.();
    this.connection.stop();
  }

  getConnection(): ConnState {
    return this.connection.getState();
  }

  reconnect(): void {
    this.connection.reconnect();
  }

  /** Enqueue an exclusive agent turn. Streams 'agent-event's as it runs. */
  runAgentTurn(req: AgentTurnRequest): Promise<{ sessionId: string | null; ok: boolean }> {
    return this.enqueue(async () => {
      this.agentBusy = true;
      try {
        const handle = this.agent.run({
          prompt: req.prompt,
          cwd: req.cwd,
          ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}),
        });
        this.activeCancel = handle.cancel;
        const result = await handle.done;
        // Post-turn re-sync hook: the agent may have changed the scene.
        // (Designer model re-sync lands with the WYSIWYG phase.)
        return result;
      } finally {
        this.agentBusy = false;
        this.activeCancel = null;
      }
    });
  }

  cancelAgent(): void {
    this.activeCancel?.();
  }

  /** Run a deterministic MCP op, serialized behind any in-flight agent turn. */
  runDirect<T>(fn: (client: import('./mcp-client.js').McpClient) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const client = this.connection.getClient();
      if (!client) throw new Error('not connected to Lens Studio');
      return fn(client);
    });
  }

  get isAgentBusy(): boolean {
    return this.agentBusy;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    // Keep the chain alive even if a task throws.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
