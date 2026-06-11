// native.ts — typed accessor for the Electron preload surface.
//
// The preload (desktop/src/preload.ts) exposes
// window.lensDesignerNative. This module is the single import point
// for the renderer; types mirror preload.ts.

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

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    lensDesignerNative?: LensDesignerNative;
  }
}

/**
 * True when running inside the Electron shell. False when running in
 * a regular browser tab via `pnpm web dev` — the preload bridge
 * isn't there to expose `lensDesignerNative`.
 */
export function isElectronHost(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.lensDesignerNative !== 'undefined';
}

/**
 * Get the native API or throw. Use only on code paths that assume
 * the Electron host (the empty-state and Create-sandbox flows).
 */
export function requireNative(): LensDesignerNative {
  if (typeof window === 'undefined' || !window.lensDesignerNative) {
    throw new Error(
      'lensDesignerNative not available — this code path requires the Electron shell.',
    );
  }
  return window.lensDesignerNative;
}

export {};
