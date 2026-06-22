// v2-ipc.ts — IPC surface for the v2 cockpit.
//
// Bridges the renderer (sandboxed) to the Orchestrator in main: connection
// status, agent turns (streamed), and direct MCP reads. Events are pushed to
// the focused window; request/response goes through ipcMain.handle.

import { ipcMain, type BrowserWindow } from 'electron';
import { Orchestrator } from './services/orchestrator.js';
import { resolveProjectDir } from './services/project.js';
import { scanAssets } from './services/assets.js';
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

  // ── Agent ──
  ipcMain.handle(
    'ld:agent:run',
    async (_e, req: { prompt: string; resumeSessionId?: string; cwd?: string }) => {
      const conn = orchestrator.getConnection();
      const cwd =
        req.cwd ??
        (conn.kind === 'connected' ? await resolveProjectDir(conn.port) : null) ??
        process.cwd();
      return orchestrator.runAgentTurn({
        prompt: req.prompt,
        cwd,
        ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}),
      });
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
