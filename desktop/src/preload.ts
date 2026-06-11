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
