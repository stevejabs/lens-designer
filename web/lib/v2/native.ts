// native.ts — typed access to the Electron-exposed `window.ld` API, with a
// graceful fallback when running in a plain browser (next dev), so the UI
// works (disconnected, mock data) outside the desktop shell.

export type LDConnState =
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'connecting' }
  | { kind: 'connected'; server: string; version: string; port: number; clad: boolean };

export type LDAgentEventBase =
  | { kind: 'session'; sessionId: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; tool: string; status: 'running' }
  | { kind: 'tool-result'; tool: string; ok: boolean }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null; sessionId: string | null }
  | { kind: 'error'; message: string };

export type LDAgentEvent = LDAgentEventBase & { jobId: string };

export type LDJobStatus = 'running' | 'done' | 'error' | 'cancelled';
export type LDJobKind = 'mesh' | 'music' | 'sfx' | 'ui' | 'code';
export type LDAssetGenKind = 'mesh' | 'music' | 'sfx';

export interface LDJobMeta {
  jobId: string;
  status: LDJobStatus;
  artifactPath: string | null;
  artifactId: string | null;
  note: string | null;
}

export interface LDJobRecord {
  id: string;
  kind: LDJobKind;
  mode: 'create' | 'refine' | 'chat';
  title: string;
  artifactPath: string | null;
  artifactId: string | null;
  sessionId: string | null;
  status: LDJobStatus;
  startedMs: number;
}

export interface LDVersionEntry {
  id: string;
  createdMs: number;
  sizeBytes: number;
}

export interface LDElementNode {
  id: string;
  name: string;
  componentTypes: string[];
  enabled: boolean;
  children: LDElementNode[];
}
export interface LDElementTree {
  ok: boolean;
  reason?: string;
  host?: string;
  tree?: LDElementNode;
}

export type LDBuildStepKind = 'mesh' | 'music' | 'sfx' | 'ui';
export interface LDBuildStep {
  kind: LDBuildStepKind;
  name: string;
  description: string;
}
export interface LDBuildManifest {
  summary: string;
  steps: LDBuildStep[];
}

export interface LDScannedAsset {
  id: string;
  name: string;
  kind: 'mesh' | 'music' | 'sfx';
  backend: 'glb' | 'script' | 'audio';
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
  project: {
    dir(): Promise<string | null>;
    organizePlan(): Promise<{ moveToAppBay: string[]; stayAtRoot: string[]; hasAppBay: boolean }>;
    organize(): Promise<{ status: string; moved: string[] }>;
  };
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
  versions: {
    list(path: string): Promise<LDVersionEntry[]>;
    restore(req: { path: string; versionId: string }): Promise<{ ok: boolean; message: string }>;
    read(req: { path: string; versionId: string }): Promise<string | null>;
  };
  jobs: {
    list(): Promise<LDJobRecord[]>;
    cancel(jobId: string): Promise<void>;
  };
  build: {
    plan(req: { prompt: string }): Promise<LDBuildManifest>;
  };
  posture: {
    set(posture: 'design' | 'runtime'): Promise<{ editEnabled: boolean; appEnabled: boolean }>;
  };
  view: {
    load(viewPath: string): Promise<{ status: string; host?: string }>;
    clear(): Promise<void>;
  };
  ui: {
    tree(): Promise<LDElementTree>;
  };
  onBays(handler: (r: { ok: boolean; message?: string }) => void): () => void;
  asset: {
    create(req: { kind: LDAssetGenKind; userText: string }): Promise<{ jobId: string; title: string }>;
    refine(req: { artifactPath: string; userText: string }): Promise<{ jobId: string }>;
  };
  agent: {
    run(req: {
      prompt: string;
      kind?: LDJobKind;
      mode?: 'create' | 'refine' | 'chat';
      title?: string;
      resumeSessionId?: string;
      artifactPath?: string;
      artifactId?: string;
    }): Promise<{ jobId: string }>;
    cancel(jobId?: string): Promise<void>;
    cli(): Promise<string>;
    onEvent(handler: (e: LDAgentEvent) => void): () => void;
    onJobMeta(handler: (m: LDJobMeta) => void): () => void;
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
