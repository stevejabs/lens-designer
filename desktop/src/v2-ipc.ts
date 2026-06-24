// v2-ipc.ts — IPC surface for the v2 cockpit.
//
// Bridges the renderer (sandboxed) to the Orchestrator in main. Agent work is
// job-based: create / refine / chat each START a concurrent job and return its
// id immediately; streamed events arrive on `ld:agent-event` tagged with the
// jobId, and lifecycle/post-processing lands on `ld:job-meta`. The heavy
// choreography for the three product asks lives here:
//   - tool reuse:   refine reads the asset's sidecar and routes to the same
//                   CLAD skill (gen-prompt) so the agent acts on turn 1.
//   - replace:      refine snapshots a version, then reconciles the result so
//                   the asset is overwritten in place, not duplicated.
//   - concurrency:  jobs run in the background; handlers don't block on them.

import { ipcMain, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { Orchestrator, type TaggedAgentEvent } from './services/orchestrator.js';
import { resolveProjectDir } from './services/project.js';
import { scanAssets, kindFor, type AssetKind } from './services/assets.js';
import { scanViews } from './services/views.js';
import { capturePreview, readViewSource, saveViewSource, recompile } from './services/scene-ops.js';
import { parseViewFields, setViewField, type FieldKind } from './services/view-parse.js';
import { readContext, appendTurn, recordCreation } from './services/context-store.js';
import {
  buildCreatePrompt,
  buildRefinePrompt,
  buildScriptMeshRefinePrompt,
  SKILL_FOR_KIND,
  type GenKind,
} from './services/gen-prompt.js';
import {
  ensureBays,
  setBayPosture,
  writeRuntimeGate,
  attachRuntimeGate,
  loadViewIntoEditBay,
  clearEditBay,
  type BayPosture,
} from './services/bays.js';
import { snapshotAssets, detectCreated, reconcileRefine } from './services/asset-watch.js';
import { snapshot as snapshotVersion, listVersions, restoreVersion } from './services/versions.js';
import type { JobMeta, JobMode } from './services/jobs.js';
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

  orchestrator.on('agent-event', (e: TaggedAgentEvent) => send('ld:agent-event', e));

  // ── Bay bootstrap on connect ──
  // On every fresh connection, find-or-create the edit/app bays (ownership-
  // marked), (re)write + attach the on-device runtime gate, and settle into
  // design posture. Idempotent; re-runs on reconnect.
  let bootstrapping = false;
  const bootstrapBays = async (): Promise<void> => {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      await orchestrator.runDirect((c) => ensureBays(c), { write: true });
      const dir = await projectDir();
      if (dir) await writeRuntimeGate(dir);
      for (let i = 0; i < 25; i++) {
        const r = await orchestrator.runDirect((c) => attachRuntimeGate(c), { write: true });
        if (r.status === 'attached') break;
        await new Promise((res) => setTimeout(res, 400)); // LS still importing the gate
      }
      await orchestrator.runDirect((c) => setBayPosture(c, 'design'), { write: true });
      send('ld:bays', { ok: true });
    } catch (err) {
      send('ld:bays', { ok: false, message: (err as Error).message });
    } finally {
      bootstrapping = false;
    }
  };

  orchestrator.on('connection', (s: ConnState) => {
    send('ld:connection', s);
    if (s.kind === 'connected') void bootstrapBays();
  });

  /** Resolve the open project directory (cwd for jobs, scope for reads). */
  const projectDir = async (): Promise<string | null> => {
    const conn = orchestrator.getConnection();
    if (conn.kind !== 'connected') return null;
    return resolveProjectDir(conn.port);
  };

  /** Accumulate a job's final text (for the distilled sidecar summary). */
  const trackSummary = (jobId: string): { get: () => string; stop: () => void } => {
    let summary = '';
    const onEvt = (e: TaggedAgentEvent): void => {
      if (e.jobId !== jobId) return;
      if (e.kind === 'result' && e.text) summary = e.text;
      else if (e.kind === 'assistant' && e.text) summary = e.text;
    };
    orchestrator.on('agent-event', onEvt);
    return { get: () => summary, stop: () => orchestrator.off('agent-event', onEvt) };
  };

  const emitMeta = (jobId: string, meta: Omit<JobMeta, 'jobId'>): void =>
    send('ld:job-meta', { jobId, ...meta } satisfies JobMeta);

  // ── Connection ──
  ipcMain.handle('ld:connection:get', () => orchestrator.getConnection());
  ipcMain.handle('ld:connection:reconnect', () => {
    orchestrator.reconnect();
  });
  ipcMain.handle('ld:agent:cli', () => orchestrator.getAgentCli());

  // ── Project ──
  ipcMain.handle('ld:project:dir', () => projectDir());

  // ── Direct channel proof: report the live LS tool surface ──
  ipcMain.handle('ld:scene:tools', async () => {
    return orchestrator.runDirect(async (client) => {
      const tools = await client.listTools();
      return { count: tools.length, sample: tools.slice(0, 12), server: client.serverInfo };
    });
  });

  // ── Assets ──
  ipcMain.handle('ld:assets:list', async () => {
    const dir = await projectDir();
    return dir ? scanAssets(dir) : [];
  });

  // ── Views ──
  ipcMain.handle('ld:views:list', async () => {
    const dir = await projectDir();
    return dir ? scanViews(dir) : [];
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
      return orchestrator.runDirect((client) => saveViewSource(client, req.path, next), { write: true });
    },
  );

  // ── Live preview (the real LS render) ──
  ipcMain.handle('ld:preview:capture', () => orchestrator.runDirect((client) => capturePreview(client)));
  ipcMain.handle('ld:recompile', () => orchestrator.runDirect((client) => recompile(client), { write: true }));

  // ── Per-artifact context ──
  ipcMain.handle('ld:context:get', (_e, path: string) => readContext(path));

  // ── Versions (rollback history) ──
  ipcMain.handle('ld:versions:list', async (_e, path: string) => {
    const dir = await projectDir();
    return dir ? listVersions(dir, path) : [];
  });
  ipcMain.handle('ld:versions:restore', async (_e, req: { path: string; versionId: string }) => {
    const dir = await projectDir();
    if (!dir) return { ok: false, message: 'not connected' };
    return restoreVersion(dir, req.path, req.versionId, Date.now());
  });

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
    const dir = await projectDir();
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

  // ── Bays / posture ──
  ipcMain.handle('ld:posture:set', (_e, posture: BayPosture) =>
    orchestrator.runDirect((c) => setBayPosture(c, posture), { write: true }),
  );
  // Load the selected view's content into the edit bay (so the preview shows
  // what you're editing). The TS asset name is the view file's basename.
  ipcMain.handle('ld:view:load', (_e, viewPath: string) => {
    const assetName = basename(viewPath).replace(/\.[tj]s$/, '');
    return orchestrator.runDirect((c) => loadViewIntoEditBay(c, assetName), { write: true });
  });
  ipcMain.handle('ld:view:clear', () =>
    orchestrator.runDirect((c) => clearEditBay(c), { write: true }),
  );

  // ── Jobs ──
  ipcMain.handle('ld:jobs:list', () => orchestrator.listJobs());
  ipcMain.handle('ld:jobs:cancel', (_e, jobId: string) => {
    orchestrator.cancelJob(jobId);
  });

  // ── Create a NEW asset (routed to the CLAD skill for its kind) ──
  ipcMain.handle('ld:asset:create', async (_e, req: { kind: AssetKind; userText: string }) => {
    const dir = (await projectDir()) ?? process.cwd();
    const before = await snapshotAssets(dir);
    const prompt = buildCreatePrompt({ kind: req.kind, userText: req.userText });
    const { jobId, done } = orchestrator.startJob({
      prompt,
      cwd: dir,
      kind: req.kind,
      mode: 'create',
      title: `New ${req.kind}`,
    });
    const summary = trackSummary(jobId);
    void done.then(async (res) => {
      try {
        const created = await detectCreated(dir, before, req.kind);
        if (created) {
          orchestrator.setJobArtifact(jobId, created, created);
          await recordCreation(
            created,
            created,
            req.userText,
            summary.get().slice(0, 2000),
            res.sessionId,
            { skill: SKILL_FOR_KIND[req.kind] ?? '', kind: req.kind },
            new Date().toISOString(),
          );
        }
        emitMeta(jobId, {
          status: res.ok ? 'done' : 'error',
          artifactPath: created,
          artifactId: created,
          note: created ? 'created' : 'no new asset detected',
        });
      } finally {
        summary.stop();
      }
    });
    return { jobId, title: `New ${req.kind}` };
  });

  // ── Refine an EXISTING asset in place (reuse tool + version + replace) ──
  ipcMain.handle('ld:asset:refine', async (_e, req: { artifactPath: string; userText: string }) => {
    const dir = (await projectDir()) ?? process.cwd();
    const ctx = await readContext(req.artifactPath);
    const priorPrompt = ctx?.promptHistory?.[ctx.promptHistory.length - 1];
    // A code-authored (scripted) mesh is a .ts file — refine edits the code in
    // place rather than regenerating a GLB via /build-mesh.
    const isScript = req.artifactPath.toLowerCase().endsWith('.ts');
    const kind: GenKind = isScript
      ? 'code'
      : (ctx?.genParams?.['kind'] as GenKind | undefined) ?? kindFor(req.artifactPath) ?? 'mesh';
    const skill = ctx?.genParams?.['skill'] || SKILL_FOR_KIND[kind] || undefined;

    // Snapshot the current bytes BEFORE the edit so it's restorable, and
    // snapshot the asset file set so we can reconcile a duplicate.
    await snapshotVersion(dir, req.artifactPath, Date.now());
    const before = await snapshotAssets(dir);

    const prompt = isScript
      ? buildScriptMeshRefinePrompt({ artifactPath: req.artifactPath, userText: req.userText, priorPrompt })
      : buildRefinePrompt({
          kind,
          artifactPath: req.artifactPath,
          userText: req.userText,
          priorPrompt,
          skill,
        });
    const { jobId, done } = orchestrator.startJob({
      prompt,
      cwd: dir,
      kind,
      mode: 'refine',
      title: `Refine ${basename(req.artifactPath)}`,
      artifactPath: req.artifactPath,
      artifactId: req.artifactPath,
      ...(ctx?.sessionId ? { resumeSessionId: ctx.sessionId } : {}),
    });
    const summary = trackSummary(jobId);
    void done.then(async (res) => {
      try {
        const recon = await reconcileRefine(dir, req.artifactPath, before);
        await appendTurn(
          req.artifactPath,
          req.artifactPath,
          req.userText,
          summary.get().slice(0, 2000),
          res.sessionId,
          new Date().toISOString(),
        );
        emitMeta(jobId, {
          status: res.ok ? 'done' : 'error',
          artifactPath: req.artifactPath,
          artifactId: req.artifactPath,
          note: recon.note,
        });
      } finally {
        summary.stop();
      }
    });
    return { jobId };
  });

  // ── Generic chat turn on a thread (optionally scoped to an artifact) ──
  ipcMain.handle(
    'ld:agent:run',
    async (
      _e,
      req: {
        prompt: string;
        kind?: GenKind;
        mode?: JobMode;
        title?: string;
        resumeSessionId?: string;
        artifactPath?: string;
        artifactId?: string;
      },
    ) => {
      const dir = (await projectDir()) ?? process.cwd();
      const kind = req.kind ?? 'code';
      // A first create-mode turn routes to the kind's CLAD skill; follow-up
      // chat turns resume the session and pass the raw prompt.
      const prompt =
        req.mode === 'create' ? buildCreatePrompt({ kind, userText: req.prompt }) : req.prompt;
      const { jobId, done } = orchestrator.startJob({
        prompt,
        cwd: dir,
        kind,
        mode: req.mode ?? 'chat',
        title: req.title ?? 'Chat',
        ...(req.artifactPath ? { artifactPath: req.artifactPath, artifactId: req.artifactId ?? req.artifactPath } : {}),
        ...(req.resumeSessionId ? { resumeSessionId: req.resumeSessionId } : {}),
      });
      const summary = trackSummary(jobId);
      void done.then(async (res) => {
        try {
          if (req.artifactPath && req.artifactId) {
            await appendTurn(
              req.artifactPath,
              req.artifactId,
              req.prompt,
              summary.get().slice(0, 2000),
              res.sessionId,
              new Date().toISOString(),
            );
          }
          emitMeta(jobId, {
            status: res.ok ? 'done' : 'error',
            artifactPath: req.artifactPath ?? null,
            artifactId: req.artifactId ?? null,
            note: null,
          });
        } finally {
          summary.stop();
        }
      });
      return { jobId };
    },
  );
  ipcMain.handle('ld:agent:cancel', (_e, jobId?: string) => {
    if (jobId) orchestrator.cancelJob(jobId);
  });

  orchestrator.start();

  return {
    orchestrator,
    dispose: () => orchestrator.stop(),
  };
}
