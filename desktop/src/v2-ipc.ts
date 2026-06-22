// v2-ipc.ts — IPC surface for the v2 cockpit.
//
// Bridges the renderer (sandboxed) to the Orchestrator in main: connection
// status, agent turns (streamed), and direct MCP reads. Events are pushed to
// the focused window; request/response goes through ipcMain.handle.

import { ipcMain, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, resolve as resolvePath } from 'node:path';
import { Orchestrator } from './services/orchestrator.js';
import { resolveProjectDir } from './services/project.js';
import { scanAssets } from './services/assets.js';
import { scanViews } from './services/views.js';
import { capturePreview, readViewSource, saveViewSource, recompile } from './services/scene-ops.js';
import { parseViewFields, setViewField, type FieldKind } from './services/view-parse.js';
import { readContext, appendTurn } from './services/context-store.js';
import type { ConnState } from './services/ls-connection.js';

export interface V2IpcDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function registerV2Ipc(deps: V2IpcDeps): { orchestrator: Orchestrator; dispose: () => void } {
  const orchestrator = new Orchestrator();

  const send = (channel: string, payload: unknown): void => {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // Push orchestrator events to the renderer.
  orchestrator.on('connection', (s: ConnState) => send('ld:connection', s));
  orchestrator.on('agent-event', (e) => send('ld:agent-event', e));

  // ── Connection ──
  ipcMain.handle('ld:connection:get', () => orchestrator.getConnection());
  ipcMain.handle('ld:connection:reconnect', () => {
    orchestrator.reconnect();
  });
  ipcMain.handle('ld:agent:cli', () => orchestrator.getAgentCli());

  // ── Project ──
  ipcMain.handle('ld:project:dir', async () => {
    const conn = orchestrator.getConnection();
    if (conn.kind !== 'connected') return null;
    return resolveProjectDir(conn.port);
  });

  // ── Direct channel proof: report the live LS tool surface ──
  ipcMain.handle('ld:scene:tools', async () => {
    return orchestrator.runDirect(async (client) => {
      const tools = await client.listTools();
      return { count: tools.length, sample: tools.slice(0, 12), server: client.serverInfo };
    });
  });

  // ── Assets ──
  ipcMain.handle('ld:assets:list', async () => {
    const conn = orchestrator.getConnection();
    if (conn.kind !== 'connected') return [];
    const dir = await resolveProjectDir(conn.port);
    if (!dir) return [];
    return scanAssets(dir);
  });

  // ── Views ──
  ipcMain.handle('ld:views:list', async () => {
    const conn = orchestrator.getConnection();
    if (conn.kind !== 'connected') return [];
    const dir = await resolveProjectDir(conn.port);
    if (!dir) return [];
    return scanViews(dir);
  });

  ipcMain.handle('ld:views:fields', async (_e, path: string) => {
    const src = await readViewSource(path);
    return parseViewFields(src);
  });

  ipcMain.handle(
    'ld:views:setField',
    async (
      _e,
      req: { path: string; name: string; kind: FieldKind; value: number | number[] | string | boolean },
    ) => {
      const src = await readViewSource(req.path);
      const next = setViewField(src, req.name, req.kind, req.value);
      return orchestrator.runDirect((client) => saveViewSource(client, req.path, next));
    },
  );

  // ── Live preview (the real LS render) ──
  ipcMain.handle('ld:preview:capture', async () => {
    return orchestrator.runDirect((client) => capturePreview(client));
  });
  ipcMain.handle('ld:recompile', async () => {
    return orchestrator.runDirect((client) => recompile(client));
  });

  // ── Per-artifact context ──
  ipcMain.handle('ld:context:get', async (_e, path: string) => readContext(path));

  // ── Scoped media read (audio/glb → data URL) for the cockpit viewers ──
  const MIME: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };
  ipcMain.handle('ld:file:read', async (_e, path: string): Promise<string | null> => {
    const conn = orchestrator.getConnection();
    if (conn.kind !== 'connected') return null;
    const dir = await resolveProjectDir(conn.port);
    if (!dir) return null;
    const abs = resolvePath(path);
    // Scope guard: only serve files under the open project directory.
    if (abs !== dir && !abs.startsWith(resolvePath(dir) + '/')) return null;
    try {
      const buf = await readFile(abs);
      const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  });

  // ── Agent ──
  ipcMain.handle(
    'ld:agent:run',
    async (
      _e,
      req: {
        prompt: string;
        resumeSessionId?: string;
        cwd?: string;
        artifactPath?: string;
        artifactId?: string;
      },
    ) => {
      const conn = orchestrator.getConnection();
      const cwd =
        req.cwd ??
        (conn.kind === 'connected' ? await resolveProjectDir(conn.port) : null) ??
        process.cwd();

      // Capture the run's final assistant text to distill into the sidecar.
      let summary = '';
      const onEvent = (e: { kind: string; text?: string }): void => {
        if (e.kind === 'result' && e.text) summary = e.text;
        else if (e.kind === 'assistant' && e.text) summary = e.text;
      };
      orchestrator.on('agent-event', onEvent);
      try {
        const result = await orchestrator.runAgentTurn({
          prompt: req.prompt,
          cwd,
          ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}),
        });
        if (req.artifactPath && req.artifactId) {
          await appendTurn(
            req.artifactPath,
            req.artifactId,
            req.prompt,
            summary.slice(0, 2000),
            result.sessionId,
            new Date().toISOString(),
          );
        }
        return result;
      } finally {
        orchestrator.off('agent-event', onEvent);
      }
    },
  );
  ipcMain.handle('ld:agent:cancel', () => {
    orchestrator.cancelAgent();
  });

  orchestrator.start();

  return {
    orchestrator,
    dispose: () => orchestrator.stop(),
  };
}
