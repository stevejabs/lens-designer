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

export interface LDScannedAsset {
  id: string;
  name: string;
  kind: 'mesh' | 'music' | 'sfx';
  path: string;
  origin: 'prompt' | 'import';
  updatedMs: number;
  sizeBytes: number;
  hasContext: boolean;
  prompt?: string;
}

export interface LDScannedView {
  id: string;
  name: string;
  module: string;
  path: string;
  origin: 'prompt' | 'wysiwyg';
  updatedMs: number;
}

export type LDFieldKind = 'number' | 'color' | 'string' | 'boolean';
export interface LDViewField {
  name: string;
  kind: LDFieldKind;
  value: number | number[] | string | boolean;
}
export interface LDRecompileResult {
  ok: boolean;
  message: string;
}
export interface LDArtifactContext {
  artifactId: string;
  sessionId: string | null;
  promptHistory: string[];
  distilledSummary: string;
  genParams?: Record<string, string>;
  updatedAt: string;
}

export interface LDApi {
  connection: {
    get(): Promise<LDConnState>;
    reconnect(): Promise<void>;
    onChange(handler: (s: LDConnState) => void): () => void;
  };
  project: { dir(): Promise<string | null> };
  scene: { tools(): Promise<{ count: number; sample: string[]; server: unknown }> };
  assets: { list(): Promise<LDScannedAsset[]> };
  views: {
    list(): Promise<LDScannedView[]>;
    fields(path: string): Promise<LDViewField[]>;
    setField(req: {
      path: string;
      name: string;
      kind: LDFieldKind;
      value: number | number[] | string | boolean;
    }): Promise<LDRecompileResult>;
  };
  preview: { capture(): Promise<string | null> };
  recompile(): Promise<LDRecompileResult>;
  context: { get(path: string): Promise<LDArtifactContext | null> };
  file: { read(path: string): Promise<string | null> };
  agent: {
    run(req: {
      prompt: string;
      resumeSessionId?: string;
      cwd?: string;
      artifactPath?: string;
      artifactId?: string;
    }): Promise<{
      sessionId: string | null;
      ok: boolean;
    }>;
    cancel(): Promise<void>;
    cli(): Promise<string>;
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
