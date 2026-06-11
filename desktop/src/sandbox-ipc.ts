// sandbox-ipc.ts — IPC handlers for the Create-sandbox flow.
//
// Surface (consumed by preload):
//   sandbox:choose-directory   → dialog.showOpenDialog, returns picked path | null
//   sandbox:validate-directory → empty/non-empty/missing classification
//   sandbox:create             → kicks off download+verify+extract; replies with result
//   sandbox:cancel             → aborts an in-flight sandbox:create
//   shell:open-path            → shell.openPath (opens .esproj in LS)
//   shell:show-item            → shell.showItemInFolder (reveals in Finder)
//   shell:open-external        → shell.openExternal (URLs in default browser)
//
// Progress events flow main→renderer via webContents.send('sandbox:progress', ...)

import { app, ipcMain, dialog, shell, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  downloadAndExtractSandbox,
  validateTargetDirectory,
  SandboxDownloadError,
  type ProgressUpdate,
} from './sandbox-download.js';
import { SettingsStore } from './settings.js';

export interface SandboxIpcDeps {
  /** Returns the current focused/main BrowserWindow for showOpenDialog parent. */
  getMainWindow: () => BrowserWindow | null;
  settings: SettingsStore;
}

/** Active create-sandbox controller. At most one runs at a time. */
let activeAbort: AbortController | null = null;

export function registerSandboxIpc(deps: SandboxIpcDeps): void {
  ipcMain.handle('sandbox:suggest-default-path', () => {
    // The renderer's default-placeholder for the picked directory.
    // Expanded to an absolute path so the UI never shows the literal
    // tilde — the user sees exactly where the sandbox will land.
    return join(app.getPath('documents'), 'spectacles-sandbox');
  });

  ipcMain.handle('sandbox:choose-directory', async () => {
    process.stdout.write('[ipc] sandbox:choose-directory invoked\n');
    const win = deps.getMainWindow();
    process.stdout.write(`[ipc] mainWindow present? ${win !== null}\n`);
    const dialogOpts: Electron.OpenDialogOptions = {
      title: 'Choose where to put the sandbox',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
    };
    try {
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);
      process.stdout.write(
        `[ipc] dialog result: canceled=${result.canceled}, paths=${JSON.stringify(result.filePaths)}\n`,
      );
      if (result.canceled) return null;
      return result.filePaths[0] ?? null;
    } catch (err) {
      process.stderr.write(`[ipc] dialog threw: ${(err as Error).message}\n`);
      throw err;
    }
  });

  ipcMain.handle('sandbox:validate-directory', async (_e, path: string) => {
    if (typeof path !== 'string' || path.length === 0) {
      return { kind: 'missing' as const };
    }
    return await validateTargetDirectory(path);
  });

  ipcMain.handle('sandbox:create', async (e, args: { targetDir: string }) => {
    if (activeAbort) {
      return {
        ok: false as const,
        kind: 'busy' as const,
        message: 'A sandbox create is already in progress.',
      };
    }
    const controller = new AbortController();
    activeAbort = controller;
    const sender = e.sender;

    const onProgress = (update: ProgressUpdate): void => {
      if (sender.isDestroyed()) return;
      sender.send('sandbox:progress', update);
    };

    try {
      const result = await downloadAndExtractSandbox({
        targetDir: args.targetDir,
        onProgress,
        abortSignal: controller.signal,
      });
      deps.settings.update({ sandboxPath: result.sandboxDir });
      return {
        ok: true as const,
        sandboxPath: result.sandboxDir,
        esprojPath: result.esprojPath,
      };
    } catch (err) {
      if (err instanceof SandboxDownloadError) {
        return {
          ok: false as const,
          kind: err.kind,
          message: err.message,
        };
      }
      return {
        ok: false as const,
        kind: 'write-failed' as const,
        message: (err as Error)?.message ?? 'unknown error',
      };
    } finally {
      activeAbort = null;
    }
  });

  ipcMain.handle('sandbox:cancel', () => {
    if (activeAbort) {
      activeAbort.abort();
      return { ok: true as const };
    }
    return { ok: false as const, message: 'no active download' };
  });

  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    if (typeof path !== 'string' || path.length === 0) {
      return { ok: false as const, message: 'invalid path' };
    }
    const result = await shell.openPath(path);
    if (result === '') return { ok: true as const };
    return { ok: false as const, message: result };
  });

  ipcMain.handle('shell:show-item', (_e, path: string) => {
    if (typeof path === 'string' && path.length > 0) {
      shell.showItemInFolder(path);
      return { ok: true as const };
    }
    return { ok: false as const, message: 'invalid path' };
  });

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return { ok: false as const, message: 'only http(s) URLs are allowed' };
    }
    await shell.openExternal(url);
    return { ok: true as const };
  });
}

// Exported for tests.
export const _internals = {
  hasActiveAbort: () => activeAbort !== null,
};
