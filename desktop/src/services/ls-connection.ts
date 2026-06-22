// ls-connection.ts — manages Lens Designer's direct MCP connection to LS 5.22.
//
// Owns connect/retry/status and exposes a ready McpClient. Emits 'status' on
// every transition so the renderer's connection chip reflects live state.

import { EventEmitter } from 'node:events';
import { McpClient, resolveConfig } from './mcp-client.js';

export type ConnState =
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'connecting' }
  | { kind: 'connected'; server: string; version: string; port: number; clad: boolean };

export interface LsConnectionEvents {
  status: (s: ConnState) => void;
}

const RETRY_MS = 4000;

export class LsConnection extends EventEmitter {
  private state: ConnState = { kind: 'disconnected' };
  private client: McpClient | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  getState(): ConnState {
    return this.state;
  }

  getClient(): McpClient | null {
    return this.state.kind === 'connected' ? this.client : null;
  }

  private setState(s: ConnState): void {
    this.state = s;
    this.emit('status', s);
  }

  /** Begin connecting; retries on the interval until connected or stopped. */
  start(): void {
    this.stopped = false;
    void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.client = null;
    this.setState({ kind: 'disconnected' });
  }

  /** Force an immediate reconnect attempt (e.g. user clicked the chip). */
  reconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.attempt();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, RETRY_MS);
  }

  private async attempt(): Promise<void> {
    if (this.stopped) return;
    this.setState({ kind: 'connecting' });
    try {
      const config = await resolveConfig();
      const client = new McpClient(config);
      const info = await client.initialize();
      // Detect the CLAD/5.22 surface by sniffing for graphql tools.
      let clad = false;
      try {
        const tools = await client.listTools();
        clad = tools.some((t) => /scene-graphql|ExecuteEditorCode|VirtualScene/.test(t));
      } catch {
        clad = false;
      }
      this.client = client;
      this.setState({
        kind: 'connected',
        server: info.name,
        version: info.version,
        port: info.port,
        clad,
      });
    } catch (err) {
      this.client = null;
      this.setState({ kind: 'disconnected', reason: (err as Error).message });
      this.scheduleRetry();
    }
  }
}
