// preload.ts — sandboxed bridge between the renderer and main.
//
// Exposes `window.lensDesignerNative` to the renderer with a tiny,
// typed API. The renderer cannot import Node modules directly; this
// preload script is the only path from renderer → main for any
// privileged operation (file dialogs, shell.openExternal, settings
// reads/writes).

import { contextBridge, ipcRenderer } from 'electron';

export interface PublicSettings {
  sandboxPath: string | null;
  attachTarget: {
    esprojPath: string;
    assetsDir: string;
  } | null;
  bridge: {
    wsPort: number;
    httpPort: number;
  };
  windowState: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
    maximized: boolean;
  };
  hasBearerOverride: boolean;
}

export interface AppVersions {
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

export type DownloadPhase = 'downloading' | 'verifying' | 'extracting';

export interface ProgressUpdate {
  phase: DownloadPhase;
  bytesDone: number;
  bytesTotal: number;
}

export type SandboxValidateResult =
  | { kind: 'empty' }
  | { kind: 'non-empty'; entryCount: number }
  | { kind: 'missing' };

export type SandboxCreateResult =
  | { ok: true; sandboxPath: string; esprojPath: string }
  | {
      ok: false;
      kind: 'network-failed' | 'sha-mismatch' | 'write-failed' | 'cancelled' | 'busy';
      message: string;
    };

export interface LensDesignerNative {
  settings: {
    read(): Promise<PublicSettings>;
  };
  versions: {
    get(): Promise<AppVersions>;
  };
  sandbox: {
    suggestDefaultPath(): Promise<string>;
    chooseDirectory(): Promise<string | null>;
    validateDirectory(path: string): Promise<SandboxValidateResult>;
    create(targetDir: string): Promise<SandboxCreateResult>;
    cancel(): Promise<{ ok: boolean; message?: string }>;
    onProgress(handler: (update: ProgressUpdate) => void): () => void;
  };
  shell: {
    openPath(path: string): Promise<{ ok: boolean; message?: string }>;
    showItemInFolder(path: string): Promise<{ ok: boolean; message?: string }>;
    openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
  };
}

const api: LensDesignerNative = {
  settings: {
    read: () => ipcRenderer.invoke('settings:read') as Promise<PublicSettings>,
  },
  versions: {
    get: () => ipcRenderer.invoke('app:get-versions') as Promise<AppVersions>,
  },
  sandbox: {
    suggestDefaultPath: () =>
      ipcRenderer.invoke('sandbox:suggest-default-path') as Promise<string>,
    chooseDirectory: () =>
      ipcRenderer.invoke('sandbox:choose-directory') as Promise<string | null>,
    validateDirectory: (path) =>
      ipcRenderer.invoke('sandbox:validate-directory', path) as Promise<SandboxValidateResult>,
    create: (targetDir) =>
      ipcRenderer.invoke('sandbox:create', { targetDir }) as Promise<SandboxCreateResult>,
    cancel: () =>
      ipcRenderer.invoke('sandbox:cancel') as Promise<{ ok: boolean; message?: string }>,
    onProgress: (handler) => {
      const listener = (_e: Electron.IpcRendererEvent, update: ProgressUpdate): void => {
        handler(update);
      };
      ipcRenderer.on('sandbox:progress', listener);
      return () => ipcRenderer.removeListener('sandbox:progress', listener);
    },
  },
  shell: {
    openPath: (path) =>
      ipcRenderer.invoke('shell:open-path', path) as Promise<{ ok: boolean; message?: string }>,
    showItemInFolder: (path) =>
      ipcRenderer.invoke('shell:show-item', path) as Promise<{ ok: boolean; message?: string }>,
    openExternal: (url) =>
      ipcRenderer.invoke('shell:open-external', url) as Promise<{ ok: boolean; message?: string }>,
  },
};

contextBridge.exposeInMainWorld('lensDesignerNative', api);

// ── v2 cockpit API (window.ld) ──────────────────────────────────────────
// Connection status, agent turns (streamed), and direct MCP reads.

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
  project: {
    dir(): Promise<string | null>;
  };
  scene: {
    tools(): Promise<{ count: number; sample: string[]; server: unknown }>;
  };
  assets: {
    list(): Promise<LDScannedAsset[]>;
  };
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
  preview: {
    capture(): Promise<string | null>;
  };
  recompile(): Promise<LDRecompileResult>;
  context: {
    get(path: string): Promise<LDArtifactContext | null>;
  };
  file: {
    read(path: string): Promise<string | null>;
  };
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
    onEvent(handler: (e: LDAgentEvent) => void): () => void;
  };
}

const ld: LDApi = {
  connection: {
    get: () => ipcRenderer.invoke('ld:connection:get') as Promise<LDConnState>,
    reconnect: () => ipcRenderer.invoke('ld:connection:reconnect') as Promise<void>,
    onChange: (handler) => {
      const listener = (_e: Electron.IpcRendererEvent, s: LDConnState): void => handler(s);
      ipcRenderer.on('ld:connection', listener);
      return () => ipcRenderer.removeListener('ld:connection', listener);
    },
  },
  project: {
    dir: () => ipcRenderer.invoke('ld:project:dir') as Promise<string | null>,
  },
  scene: {
    tools: () =>
      ipcRenderer.invoke('ld:scene:tools') as Promise<{
        count: number;
        sample: string[];
        server: unknown;
      }>,
  },
  assets: {
    list: () => ipcRenderer.invoke('ld:assets:list') as Promise<LDScannedAsset[]>,
  },
  views: {
    list: () => ipcRenderer.invoke('ld:views:list') as Promise<LDScannedView[]>,
    fields: (path) => ipcRenderer.invoke('ld:views:fields', path) as Promise<LDViewField[]>,
    setField: (req) => ipcRenderer.invoke('ld:views:setField', req) as Promise<LDRecompileResult>,
  },
  preview: {
    capture: () => ipcRenderer.invoke('ld:preview:capture') as Promise<string | null>,
  },
  recompile: () => ipcRenderer.invoke('ld:recompile') as Promise<LDRecompileResult>,
  context: {
    get: (path) => ipcRenderer.invoke('ld:context:get', path) as Promise<LDArtifactContext | null>,
  },
  file: {
    read: (path) => ipcRenderer.invoke('ld:file:read', path) as Promise<string | null>,
  },
  agent: {
    run: (req) =>
      ipcRenderer.invoke('ld:agent:run', req) as Promise<{ sessionId: string | null; ok: boolean }>,
    cancel: () => ipcRenderer.invoke('ld:agent:cancel') as Promise<void>,
    onEvent: (handler) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: LDAgentEvent): void => handler(ev);
      ipcRenderer.on('ld:agent-event', listener);
      return () => ipcRenderer.removeListener('ld:agent-event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('ld', ld);
