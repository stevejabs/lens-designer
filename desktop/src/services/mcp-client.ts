// mcp-client.ts — Lens Designer v2 direct MCP client for Lens Studio 5.22.
//
// Lens Designer holds its OWN connection to the LS MCP server and drives it
// directly for deterministic work (connection status, scene/asset reads,
// preview). Generative work goes through the agent channel (see agent-runner).
//
// Lifted and simplified from the v1 bridge (bridge/src/mcp.ts): the proven
// bearer discovery + JSON-RPC-over-HTTP transport, minus the v1 daemon,
// sandbox-marker scanning, and LS-5.15.4 tool wrappers. Discovery for 5.22
// probes the MCP `initialize` handshake rather than a sandbox marker, so it
// finds whatever SPECS project the user has open.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Port range LS allocates its MCP server within (Settings → API). */
const SCAN_RANGE = { start: 50000, end: 50100 } as const;
const PROBE_TIMEOUT_MS = 700;

export interface McpConfig {
  url: string;
  bearer: string;
  source: 'env-url' | 'env-port' | 'scan';
}

export interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  port: number;
}

interface ClaudeConfigShape {
  projects?: Record<
    string,
    { mcpServers?: Record<string, { headers?: Record<string, string> }> }
  >;
  mcpServers?: Record<string, { headers?: Record<string, string> }>;
}

/** Read the shared LS bearer from ~/.claude.json (LS keychain → Claude config). */
export async function resolveBearer(): Promise<string> {
  const envBearer = process.env['LS_MCP_BEARER'];
  if (envBearer) return envBearer;

  const configPath = resolve(homedir(), '.claude.json');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    throw new Error(
      `could not read ${configPath} for bearer discovery: ${(err as Error).message}. ` +
        `Set LS_MCP_BEARER to override.`,
    );
  }
  const parsed = JSON.parse(raw) as ClaudeConfigShape;
  const candidates: Array<{ headers?: Record<string, string> }> = [];
  if (parsed.mcpServers?.['lens-studio']) candidates.push(parsed.mcpServers['lens-studio']);
  for (const proj of Object.values(parsed.projects ?? {})) {
    const entry = proj.mcpServers?.['lens-studio'];
    if (entry) candidates.push(entry);
  }
  for (const entry of candidates) {
    const auth = entry.headers?.['Authorization'] ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (m && m[1]) return m[1];
  }
  throw new Error(
    `no lens-studio Bearer token in ${configPath}. Set LS_MCP_BEARER to override.`,
  );
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface InitializeResult {
  serverInfo: { name: string; version: string };
  protocolVersion: string;
}

interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Probe one port's MCP `initialize`. Returns server info or null if not LS MCP. */
async function probe(port: number, bearer: string): Promise<ServerInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'lens-designer', version: '2.0.0' },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as JsonRpcResponse<InitializeResult>;
    if (json.error || !json.result?.serverInfo) return null;
    return {
      name: json.result.serverInfo.name,
      version: json.result.serverInfo.version,
      protocolVersion: json.result.protocolVersion,
      port,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Discover the LS MCP config: env override, else scan the port range. */
export async function resolveConfig(): Promise<McpConfig> {
  const bearer = await resolveBearer();

  const envUrl = process.env['LS_MCP_URL'];
  if (envUrl) return { url: envUrl, bearer, source: 'env-url' };

  const envPort = process.env['LS_MCP_PORT'];
  if (envPort) {
    const n = Number.parseInt(envPort, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 65535) {
      throw new Error(`LS_MCP_PORT must be a valid TCP port, got ${envPort}`);
    }
    return { url: `http://localhost:${n}/mcp`, bearer, source: 'env-port' };
  }

  const port = await scanForInstance(bearer);
  if (port === null) {
    throw new Error(
      `no Lens Studio MCP server found on ports ${SCAN_RANGE.start}-${SCAN_RANGE.end}. ` +
        `Is Lens Studio 5.22 running with a project open and the MCP server enabled?`,
    );
  }
  return { url: `http://localhost:${port}/mcp`, bearer, source: 'scan' };
}

/** Parallel-scan the range; return the lowest responsive LS MCP port. */
export async function scanForInstance(bearer: string): Promise<number | null> {
  const ports: number[] = [];
  for (let p = SCAN_RANGE.start; p <= SCAN_RANGE.end; p++) ports.push(p);
  const results = await Promise.all(ports.map((p) => probe(p, bearer)));
  const found = results
    .filter((r): r is ServerInfo => r !== null)
    .sort((a, b) => a.port - b.port);
  return found[0]?.port ?? null;
}

/** JSON-RPC client over HTTP for the LS 5.22 MCP server. */
export class McpClient {
  private readonly url: string;
  private readonly bearer: string;
  private nextId = 1;
  private initialized = false;
  serverInfo: ServerInfo | null = null;

  constructor(config: McpConfig) {
    this.url = config.url;
    this.bearer = config.bearer;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`MCP ${method} HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(`MCP ${method} error ${json.error.code}: ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error(`MCP ${method} returned neither result nor error`);
    }
    return json.result;
  }

  async initialize(): Promise<ServerInfo> {
    const result = await this.rpc<InitializeResult>('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'lens-designer', version: '2.0.0' },
    });
    this.initialized = true;
    const portMatch = this.url.match(/:(\d+)\//);
    this.serverInfo = {
      name: result.serverInfo.name,
      version: result.serverInfo.version,
      protocolVersion: result.protocolVersion,
      port: portMatch?.[1] ? Number.parseInt(portMatch[1], 10) : 0,
    };
    return this.serverInfo;
  }

  /** List the tool names the server exposes (used to detect CLAD/5.22 surface). */
  async listTools(): Promise<string[]> {
    if (!this.initialized) await this.initialize();
    const result = await this.rpc<{ tools: Array<{ name: string }> }>('tools/list', {});
    return result.tools.map((t) => t.name);
  }

  /** Call a tool; parse the JSON payload from content[0].text when present. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.initialized) await this.initialize();
    const result = await this.rpc<CallToolResult>('tools/call', { name, arguments: args });
    if (result.isError) {
      throw new Error(`tool ${name} failed: ${result.content[0]?.text ?? '<no text>'}`);
    }
    const text = result.content[0]?.text;
    if (text === undefined) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** Call a tool and return the raw content blocks (for image/binary results). */
  async callToolRaw(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Array<{ type: string; text?: string; data?: string; mimeType?: string }>> {
    if (!this.initialized) await this.initialize();
    const result = await this.rpc<CallToolResult>('tools/call', { name, arguments: args });
    if (result.isError) {
      throw new Error(`tool ${name} failed: ${result.content[0]?.text ?? '<no text>'}`);
    }
    return result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  }
}
