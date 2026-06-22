// native.ts — typed access to the Electron-exposed `window.ld` API, with a
// graceful fallback when running in a plain browser (next dev), so the UI
// works (disconnected, mock data) outside the desktop shell.

export type LDConnState =
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'connecting' }
  | { kind: 'connected'; server: string; version: string; port: number; clad: boolean };

export type LDAgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; tool: string; status: 'running' }
  | { kind: 'tool-result'; tool: string; ok: boolean }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null; sessionId: string | null }
  | { kind: 'error'; message: string };

export interface LDApi {
  connection: {
    get(): Promise<LDConnState>;
    reconnect(): Promise<void>;
    onChange(handler: (s: LDConnState) => void): () => void;
  };
  project: { dir(): Promise<string | null> };
  scene: { tools(): Promise<{ count: number; sample: string[]; server: unknown }> };
  agent: {
    run(req: { prompt: string; resumeSessionId?: string; cwd?: string }): Promise<{
      sessionId: string | null;
      ok: boolean;
    }>;
    cancel(): Promise<void>;
    onEvent(handler: (e: LDAgentEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    ld?: LDApi;
  }
}

export function getLd(): LDApi | null {
  return typeof window !== 'undefined' && window.ld ? window.ld : null;
}

export const isElectron = (): boolean => getLd() !== null;
