// Bridge daemon entry point. Long-lived process: WS server for control
// messages, HTTP server for preview PNGs, connection manager for liveness.
//
// Run with:
//   pnpm bridge:dev      (from the repo root)
//
// Env overrides:
//   BRIDGE_WS_PORT       default 9229
//   BRIDGE_HTTP_PORT     default 9230
//   LS_MCP_URL / LS_MCP_PORT / LS_MCP_BEARER — see src/mcp.ts

import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { startWsServer, type WsClient } from './ws-server.ts';
import { startHttpServer } from './http-server.ts';
import { ConnectionManager, setBayPosture, type Target } from './connection.ts';
import { ApplyPipeline } from './apply-pipeline.ts';
import {
  clearEditSurface,
  getActiveComponentWorldZ,
  resetActiveComponentCache,
  setActiveComponentDistance,
} from './applier.ts';
import {
  setProperty,
  McpClient,
  resolveBearer,
  getAssetByPath,
  renameAsset,
  deleteOwnedAssetByPath,
  clearScriptAssetIdCache,
} from './mcp.ts';
import { getActiveScope } from './scope.ts';
import { captureWindowToFile, findLensStudioWindowForPort } from './capture.ts';
import { previewDir, ensurePreviewDir } from './http-server.ts';
import { LivePreview } from './live-preview.ts';
import { runGc, type GcInputs } from './gc.ts';
import { fontPathIsTrusted, listSystemFonts } from './fonts-system.ts';
import { sandboxLensDesignerDir, ingestFontBytes } from './mcp.ts';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rename, unlink } from 'node:fs/promises';
import { ensureStateControllerAsset } from './mcp.ts';
import {
  loadRegistry,
  saveRegistry,
  upsertView,
  deleteView,
  findViewById,
  findViewByName,
  listViews,
  setProjectMeta,
  RegistryParseError,
  type GeneratedRef,
  type ViewRegistry,
  type ViewRecord,
} from './registry.ts';
import { generateInPlace } from './generate.ts';
import { collectInstanceRefs, expandInstances } from './instances.ts';
import { findViewBaySO, publishViewPrefab, viewNodeName, retagViewNode } from './publish.ts';
import type { ServerToClientMsg, ViewSummary } from './protocol.ts';

const VERSION = '0.1.0';

interface DaemonConfig {
  wsPort: number;
  httpPort: number;
}

function readConfig(): DaemonConfig {
  return {
    wsPort: Number.parseInt(process.env['BRIDGE_WS_PORT'] ?? '9229', 10),
    httpPort: Number.parseInt(process.env['BRIDGE_HTTP_PORT'] ?? '9230', 10),
  };
}

async function main(): Promise<void> {
  const config = readConfig();

  // Ship the runtime state controller into the sandbox so LS imports it before
  // any interaction apply needs to attach it.
  //
  // TODO(Step 5): replace this with the bridge's MCP InstallLensStudioPackage
  // call against the vendored LensDesigner.lspkg.
  try {
    const wrote = await ensureStateControllerAsset();
    if (wrote) process.stdout.write('bridge: wrote LDStateController.ts to sandbox\n');
  } catch (err) {
    process.stdout.write(`bridge: could not write state controller: ${(err as Error).message}\n`);
  }

  const connection = new ConnectionManager();
  await connection.start();
  const initial = connection.current();
  if (initial.status === 'attached' && initial.target) {
    process.stdout.write(
      `bridge: connected to ${initial.target.kind} at ${initial.target.config.url}\n`,
    );
  } else {
    process.stdout.write(
      `bridge: not connected yet — ${initial.reason}\n` +
        `       use Connect… in the app to attach a Lens Studio project.\n`,
    );
  }

  // Per-client apply pipelines. Each WS client gets its own debounce
  // window + region — concurrent editors don't clobber each other.
  const pipelines = new Map<number, ApplyPipeline>();

  // Designer mode (backlog 2). True = normal designing: edit bay visible,
  // applies flow. False = "designer off": the scene sits in runtime posture
  // (edit bay hidden, app bay shown) and design.apply traffic is dropped so
  // the user can run their app in LS without the reconcile loop fighting it.
  // The session, registry saves, and codegen all stay live. Process-global —
  // one LS, one posture. Reset to true on every (re)attach.
  let designing = true;

  function targetForApply(): { client: import('./mcp.ts').McpClient; port: number } | null {
    const t = connection.getTarget();
    return t ? { client: t.client, port: t.port } : null;
  }

  // HTTP server: serves preview PNGs + the /ingest-image endpoint (which
  // needs the target client, hence started after targetForApply exists).
  const http = await startHttpServer(config.httpPort, { getTarget: targetForApply });
  process.stdout.write(`bridge: HTTP http://localhost:${http.port}\n`);

  // Live preview loop — captures the LS window region at ~10fps and
  // broadcasts `preview.ready` to every connected client. Decoupled
  // from `design.apply` so the preview reflects whatever LS is
  // currently rendering (incl. async material/shader uploads).
  const livePreview = new LivePreview({
    getTarget: () => {
      const t = targetForApply();
      return t ? { port: t.port } : null;
    },
    broadcast: ({ url, capturedAt, region }) => {
      ws.broadcast({ type: 'preview.ready', url, capturedAt, region });
    },
  });

  // Subscribe to connection state changes; broadcast to all clients.
  // Phase 1 preserves the existing hello / sandbox.down protocol — the
  // attach-mode `attached` / `target.list.result` messages land in Step 2.
  connection.on((session) => {
    if (session.status === 'attached' && session.target) {
      process.stdout.write(
        `bridge: ${session.target.kind} up at ${session.target.config.url}\n`,
      );
      // A fresh attach always lands in design posture — sync the mode flag.
      designing = true;
      // Invalidate the ActiveComponent UUID cache — an LS restart could
      // have produced a different UUID for the same SO name.
      resetActiveComponentCache();
      // Re-broadcast hello so any connected clients refresh their state.
      const hello = buildHello(session.target);
      if (hello) ws.broadcast(hello);
    } else {
      process.stdout.write(`bridge: connection down — ${session.reason}\n`);
      ws.broadcast({
        type: 'sandbox.down',
        reason: session.reason ?? 'unknown',
      });
    }
  });

  const ws = await startWsServer({
    port: config.wsPort,
    async onConnect(client: WsClient) {
      // Spin up a per-client apply pipeline. Cleaned up on disconnect
      // via the close handler in ws-server.
      pipelines.set(
        client.id,
        new ApplyPipeline({
          getTarget: targetForApply,
          send: (msg) => client.send(msg),
        }),
      );

      // Run a fresh check so the new client sees current state, not a
      // stale poll result.
      const session = await connection.recheck();
      const hello = session.status === 'attached' && session.target ? buildHello(session.target) : null;
      if (hello) {
        client.send(hello);
      } else {
        client.send({
          type: 'sandbox.down',
          reason: session.reason ?? 'unknown',
        });
      }
    },
    onDisconnect(client) {
      const pipeline = pipelines.get(client.id);
      if (pipeline) {
        pipeline.cancel();
        pipelines.delete(client.id);
      }
    },
    async onMessage(msg, client) {
      let pipeline = pipelines.get(client.id);
      if (!pipeline) {
        // First message before onConnect finished setup, or pipeline
        // was reaped — recreate.
        pipeline = new ApplyPipeline({
          getTarget: targetForApply,
          send: (m) => client.send(m),
        });
        pipelines.set(client.id, pipeline);
      }
      switch (msg.type) {
        case 'design.apply':
          // Designer off → drop the reconcile traffic. The client re-sends its
          // tree when the mode comes back on (designer.mode broadcast).
          if (!designing) break;
          pipeline.submit(msg.tree);
          break;

        case 'designer.set-mode': {
          try {
            const t = requireTarget(connection);
            if (msg.designing !== designing) {
              designing = msg.designing;
              await setBayPosture(t, designing ? 'design' : 'runtime');
              if (designing) {
                // Coming back on: the bay may have drifted (e.g. the app ran a
                // lens that touched nothing of ours, but LS restarts can churn
                // UUID caches). Drop incremental state so the next apply
                // reconciles/rebuilds from a clean read.
                for (const p of pipelines.values()) p.resetIncremental();
              }
              process.stdout.write(
                `bridge: designer mode ${designing ? 'ON (design posture)' : 'OFF (runtime posture)'}\n`,
              );
            }
            ws.broadcast({ type: 'designer.mode', designing });
          } catch (err) {
            sendError(client, `designer.set-mode failed: ${(err as Error).message}`);
          }
          break;
        }
        case 'mcp.call': {
          // Generic LS MCP passthrough — invoke any LS tool against whatever
          // instance the bridge can reach (active target by default, or any
          // `port`). The multi-port escape hatch: no statically-configured MCP
          // URL, no reconnect when LS reassigns its port.
          try {
            const active = connection.getTarget();
            let mcp: McpClient;
            if (msg.port !== undefined) {
              mcp =
                active && active.port === msg.port
                  ? active.client
                  : new McpClient({ url: `http://localhost:${msg.port}/mcp`, bearer: await resolveBearer(), source: 'env-port' });
            } else {
              if (!active) throw new Error('no active target — attach to a project or pass an explicit port');
              mcp = active.client;
            }
            const result = await mcp.callTool<unknown>(msg.tool, msg.args as Record<string, unknown>);
            client.send({ type: 'mcp.result', requestId: msg.requestId, ok: true, result });
          } catch (err) {
            client.send({ type: 'mcp.result', requestId: msg.requestId, ok: false, error: (err as Error).message });
          }
          break;
        }
        case 'preview.configure-region':
          // Region is process-global — one LS, one capture region. The
          // live loop picks it up on the next tick (~100ms).
          livePreview.setRegion(msg.region);
          process.stdout.write(
            `bridge: preview.configure-region from client#${client.id}: ` +
              `${msg.region.x},${msg.region.y} ${msg.region.width}x${msg.region.height}\n`,
          );
          break;
        case 'preview.set-distance': {
          setActiveComponentDistance(msg.cm);
          // Reposition the AC immediately so the next live-preview tick
          // reflects the change without needing an apply. Best-effort —
          // a missing target / scope is non-fatal (the next apply will
          // pick up the new distance).
          const target = targetForApply();
          const scope = getActiveScope();
          if (target && scope) {
            try {
              await setProperty(target.client, {
                objectUUID: scope.root,
                propertyPath: 'localTransform.position',
                valueType: 'vec3',
                value: { x: 0, y: 0, z: getActiveComponentWorldZ() },
              });
            } catch (err) {
              process.stderr.write(
                `bridge: preview.set-distance reposition failed: ${(err as Error).message}\n`,
              );
            }
          }
          process.stdout.write(`bridge: preview.set-distance ${msg.cm} cm\n`);
          break;
        }
        case 'preview.capture-full': {
          try {
            const target = targetForApply();
            if (!target) {
              throw new Error('not connected — open the sandbox project in Lens Studio');
            }
            const win = await findLensStudioWindowForPort(target.port);
            if (!win) {
              throw new Error('Lens Studio window not found for port ' + target.port);
            }
            await ensurePreviewDir();
            // Filename stays UUID-only — the /preview/ HTTP route is
            // gated by `[0-9a-f-]+\.png` and a "full-" prefix would 404.
            const filename = `${randomUUID()}.png`;
            const finalPath = join(previewDir(), filename);
            const tmpPath = `${finalPath}.tmp`;
            const fullRegion = {
              x: 0,
              y: 0,
              width: win.bounds.width,
              height: win.bounds.height,
            };
            const cap = await captureWindowToFile(win.id, fullRegion, tmpPath);
            await rename(tmpPath, finalPath);
            client.send({
              type: 'preview.full-snapshot',
              url: `/preview/${filename}`,
              windowWidth: cap.width,
              windowHeight: cap.height,
              capturedAt: cap.capturedAtMs,
            });
          } catch (err) {
            client.send({
              type: 'design.error',
              error: {
                nodeId: null,
                propertyPath: null,
                lsError: `preview.capture-full failed: ${(err as Error).message}`,
              },
            });
          }
          break;
        }
        case 'design.clear': {
          try {
            const target = targetForApply();
            if (!target) {
              throw new Error('not connected — open the sandbox project in Lens Studio');
            }
            await clearEditSurface(target.client);
            resetActiveComponentCache();
            pipeline.resetIncremental();
            client.send({ type: 'design.cleared' });
            process.stdout.write(
              `bridge: design.clear from client#${client.id} — edit surface wiped\n`,
            );
          } catch (err) {
            client.send({
              type: 'design.error',
              error: {
                nodeId: null,
                propertyPath: null,
                lsError: `design.clear failed: ${(err as Error).message}`,
              },
            });
          }
          break;
        }
        case 'design.gc': {
          try {
            const target = targetForApply();
            if (!target) {
              throw new Error('not connected — open the sandbox project in Lens Studio');
            }
            const reg = await loadRegistry(target.client);
            // Shared components: sweep against EXPANDED trees. Instance
            // children get derived node ids (instanceId::defChildId) whose
            // per-node materials exist only post-expansion, and slot overrides
            // can reference images no raw node carries — computing in-use from
            // unexpanded trees would GC both out from under live instances.
            const savedTrees = reg.views.map((v) => expandInstances(v.tree, reg).tree);
            const inputs: GcInputs = {
              currentTree: expandInstances(msg.currentTree, reg).tree,
              savedTrees,
              customFonts: msg.customFonts,
            };
            const result = await runGc(inputs);
            client.send({ type: 'design.gc.result', triggeredBy: 'manual', ...result });
            const d = result.deleted;
            process.stdout.write(
              `bridge: design.gc (manual) deleted ${d.materials}mat ${d.images}img ${d.fonts}font · ` +
                `kept ${result.kept.materials}/${result.kept.images}/${result.kept.fonts}\n`,
            );
          } catch (err) {
            client.send({
              type: 'design.error',
              error: {
                nodeId: null,
                propertyPath: null,
                lsError: `design.gc failed: ${(err as Error).message}`,
              },
            });
          }
          break;
        }
        case 'fonts.list-system': {
          try {
            const fonts = await listSystemFonts();
            client.send({ type: 'fonts.system-list', fonts });
          } catch (err) {
            sendError(client, `fonts.list-system failed: ${(err as Error).message}`);
          }
          break;
        }
        case 'fonts.list-project': {
          try {
            const target = targetForApply();
            if (!target) {
              client.send({ type: 'fonts.project-list', files: [] });
              break;
            }
            const fontsDir = `${sandboxLensDesignerDir()}/fonts`;
            let files: string[] = [];
            try {
              const entries = await readdir(fontsDir);
              files = entries.filter((n) => !n.endsWith('.meta') && /\.(ttf|otf)$/i.test(n));
            } catch {
              // fonts dir doesn't exist yet — empty project, that's fine
              files = [];
            }
            client.send({ type: 'fonts.project-list', files });
          } catch (err) {
            sendError(client, `fonts.list-project failed: ${(err as Error).message}`);
          }
          break;
        }
        case 'fonts.add-from-system': {
          try {
            const target = targetForApply();
            if (!target) {
              throw new Error('not connected — open the sandbox project in Lens Studio');
            }
            if (!fontPathIsTrusted(msg.systemPath)) {
              throw new Error(
                `refused: ${msg.systemPath} is outside the trusted system font dirs`,
              );
            }
            const bytes = await readFile(msg.systemPath);
            const ext = msg.systemPath.toLowerCase().endsWith('.otf') ? 'otf' : 'ttf';
            const ingested = await ingestFontBytes(target.client, bytes, ext);
            client.send({
              type: 'fonts.added',
              family: msg.family,
              path: ingested.path,
            });
            process.stdout.write(
              `bridge: fonts.add-from-system "${msg.family}" → ${ingested.path}\n`,
            );
          } catch (err) {
            sendError(client, `fonts.add-from-system failed: ${(err as Error).message}`);
          }
          break;
        }

        // ---- attach-mode (Step 2 protocol + Step 7a wiring) ----

        case 'target.list': {
          try {
            const instances = await connection.listInstances();
            client.send({
              type: 'target.list.result',
              // projectName: LS exposes no API for the project's open
              // .esproj path (TD-4). The picker chip reads port + marker
              // flag, which is enough to disambiguate sandbox-vs-other on
              // a typical single-user machine. lsof-based lookup against
              // the LS PID's open files is a future enhancement.
              targets: instances.map((i) => ({
                port: i.port,
                hasMarker: i.hasMarker,
                projectName: null,
              })),
            });
          } catch (err) {
            sendError(client, `target.list failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'target.attach': {
          try {
            const session = await connection.attach({
              port: msg.port,
              mode: msg.mode,
              ...(msg.assetsDir !== undefined ? { assetsDir: msg.assetsDir } : {}),
              ...(msg.label !== undefined ? { label: msg.label } : {}),
            });
            const t = session.target!;
            const reg = await attachRegistry(t);
            // Self-heal: regenerate controllers deleted out from under the
            // registry before the client starts loading/saving views.
            await healMissingControllers(t, reg);
            client.send(buildAttached(t, listViews(reg).map((v) => toViewSummary(v, reg))));
          } catch (err) {
            sendError(client, `target.attach failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'target.detach': {
          try {
            await connection.detach();
            // Use the legacy sandbox.down shape for now — the dedicated
            // `detached` server-msg lands in Step 7b alongside the picker.
            client.send({ type: 'sandbox.down', reason: 'detached by request' });
          } catch (err) {
            sendError(client, `target.detach failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'target.set-assets-dir': {
          try {
            const session = await connection.setAssetsDir(msg.assetsDir);
            const t = session.target!;
            const reg = await attachRegistry(t);
            client.send(buildAttached(t, listViews(reg).map((v) => toViewSummary(v, reg))));
          } catch (err) {
            sendError(client, `target.set-assets-dir failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'view.list': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            client.send({
              type: 'view.list.result',
              views: listViews(reg).map((v) => toViewSummary(v, reg)),
            });
          } catch (err) {
            sendError(client, `view.list failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'view.load': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            const view = findViewById(reg, msg.id);
            if (!view) {
              sendError(client, `view.load: no view with id ${msg.id}`);
              break;
            }
            // Drive the apply pipeline so the edit surface materializes
            // the loaded tree at the canonical framed distance. Skipped while
            // the designer is off — the resume re-apply paints it instead.
            if (designing) pipeline.submit(view.tree);
            client.send({ type: 'view.loaded', id: view.id, tree: view.tree });
          } catch (err) {
            sendError(client, `view.load failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'view.save': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);

            // Refuse on name collision BEFORE we touch the filesystem.
            // findViewByName is case-insensitive (matches the UI's collision
            // detection); upsertView would otherwise create a second view
            // with the same name on disk — generate.ts writes
            // `<Name>.prefab`/`<Name>.ts`, so on case-insensitive macOS the
            // second save would clobber the first's files. Errors out cleanly
            // so the UI can offer "Update existing" or "Save as new" branches.
            const collidesWith = findViewByName(reg, msg.name);
            if (collidesWith && collidesWith.id !== msg.id) {
              sendError(
                client,
                `view.save: name "${msg.name}" is already in use by view ${collidesWith.id} ` +
                  `(${collidesWith.name}). Rename one or update the existing view.`,
              );
              break;
            }

            // Always regenerate the controller in place — it's just a string
            // build + a compare-then-write (no prefab, no geometry re-apply),
            // so running it on every save (incl. autosave) is cheap and keeps
            // `<View>.ts` current as bindings/roles/states change. A pure visual
            // edit produces identical source → the write is skipped, no LS
            // re-import. (msg.skipGenerate is now a no-op; kept for protocol
            // compatibility with older clients.)
            const gen = await generateInPlace(t.client, msg.tree, reg);
            let generated: GeneratedRef | null = pickGenerated(gen.generations, msg.name);
            // The Inspector's class-name field changes view.name through this
            // plain save — sweep the old-name controller so it doesn't keep
            // compiling as an orphan (the panel's rename flow does the full
            // stable-UUID rename; this path is the in-tree edit).
            if (msg.id) {
              const prior = findViewById(reg, msg.id);
              const priorCode = prior ? viewNodeName(prior.tree) : null;
              const newCode = viewNodeName(msg.tree);
              if (priorCode && newCode && priorCode !== newCode) {
                try {
                  await sweepOrphanController(t.client, priorCode);
                } catch (err) {
                  process.stdout.write(
                    `bridge: orphan sweep for ${priorCode}.ts failed: ${(err as Error).message}\n`,
                  );
                }
              }
            }
            // Prefab linkage (route B): preserve the existing prefab across
            // edits (no auto-resync — that's the explicit Re-publish), and
            // auto-create one the first time the view is painted in the bay so
            // it's immediately consumable. No bay instance yet → skip; the next
            // save after it paints creates it.
            if (generated) {
              const existingPrefab = (msg.id ? findViewById(reg, msg.id) : undefined)
                ?.generated?.prefab;
              if (existingPrefab) {
                // Preserve the prefab link. If the auto-publish toggle is on,
                // also splice the current design into it in place (stable UUID),
                // so wired consumers see the change live.
                let publishedAt: number | undefined;
                if (msg.republish) {
                  const viewName = viewNodeName(msg.tree) ?? msg.name;
                  try {
                    const baySO = await findViewBaySO(t.client, viewName);
                    if (baySO) {
                      await publishViewPrefab(t.client, viewName, baySO, existingPrefab);
                      publishedAt = Date.now();
                    }
                  } catch (e) {
                    process.stdout.write(`bridge: auto-republish skipped for ${viewName}: ${(e as Error).message}\n`);
                  }
                }
                generated = {
                  ...generated,
                  prefab: existingPrefab,
                  ...(publishedAt !== undefined
                    ? { publishedAt }
                    : findViewById(reg, msg.id!)?.generated?.publishedAt !== undefined
                      ? { publishedAt: findViewById(reg, msg.id!)!.generated!.publishedAt! }
                      : {}),
                };
              } else {
                // Key off the view node's name (the controller's code identity),
                // NOT msg.name — the record name is a display label the user can
                // rename without renaming the controller/prefab.
                const viewName = viewNodeName(msg.tree) ?? msg.name;
                try {
                  const baySO = await findViewBaySO(t.client, viewName);
                  if (baySO) {
                    const pub = await publishViewPrefab(t.client, viewName, baySO, null);
                    generated = { ...generated, prefab: pub.prefab, publishedAt: Date.now() };
                    process.stdout.write(`bridge: auto-published ${viewName} → ${pub.prefab}\n`);
                  }
                } catch (e) {
                  process.stdout.write(`bridge: auto-publish skipped for ${viewName}: ${(e as Error).message}\n`);
                }
              }
            }
            const warnings = gen.warnings;
            const result = upsertView(reg, {
              ...(msg.id !== undefined ? { id: msg.id } : {}),
              name: msg.name,
              tree: msg.tree,
              generated,
            });
            await saveRegistry(t.client, result.reg);
            client.send({
              type: 'view.saved',
              id: result.record.id,
              generated,
              warnings,
            });
          } catch (err) {
            if (err instanceof RegistryParseError) {
              sendError(client, `view.save: registry parse error — ${err.message}`);
            } else {
              sendError(client, `view.save failed: ${(err as Error).message}`);
            }
          }
          break;
        }

        case 'view.delete': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            // Shared components: refuse to delete a definition other views
            // still instance — their instances would collapse to placeholders.
            const dependents = reg.views.filter(
              (v) => v.id !== msg.id && collectInstanceRefs(v.tree).has(msg.id),
            );
            if (dependents.length > 0) {
              sendError(
                client,
                `view.delete: "${findViewById(reg, msg.id)?.name ?? msg.id}" is used as a component by ` +
                  `${dependents.map((d) => `"${d.name}"`).join(', ')} — remove those instances first`,
              );
              break;
            }
            const { reg: next, removed } = deleteView(reg, msg.id);
            if (!removed) {
              sendError(client, `view.delete: no view with id ${msg.id}`);
              break;
            }
            await saveRegistry(t.client, next);
            client.send({
              type: 'view.list.result',
              views: listViews(next).map((v) => toViewSummary(v, next)),
            });
          } catch (err) {
            sendError(client, `view.delete failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'view.get': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            const view = findViewById(reg, msg.id);
            if (!view) {
              sendError(client, `view.get: no view with id ${msg.id}`);
              break;
            }
            client.send({
              type: 'view.tree',
              id: view.id,
              codeName: viewNodeName(view.tree) ?? view.name,
              tree: view.tree,
            });
          } catch (err) {
            sendError(client, `view.get failed: ${(err as Error).message}`);
          }
          break;
        }

        case 'view.rename': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            const rec = findViewById(reg, msg.id);
            if (!rec) {
              sendError(client, `view.rename: no view with id ${msg.id}`);
              break;
            }

            // Collision check against every OTHER record's label AND code
            // name (case-insensitive — macOS filenames + the registry's
            // findViewByName both are).
            const lower = msg.newName.toLowerCase();
            const clash = reg.views.find(
              (v) =>
                v.id !== msg.id &&
                (v.name.toLowerCase() === lower ||
                  (viewNodeName(v.tree) ?? v.name).toLowerCase() === lower),
            );
            if (clash) {
              sendError(
                client,
                `view.rename: "${msg.newName}" is already in use by view "${clash.name}"`,
              );
              break;
            }

            const warnings: string[] = [];
            // Prefer the client's live tree (no WIP loss); fall back to the
            // record for older clients.
            const baseTree = msg.tree.length > 0 ? msg.tree : rec.tree;
            const oldCode = viewNodeName(baseTree);
            let prefabPath = rec.generated?.prefab ?? null;

            // 1. Carry the controller .ts + .prefab to the new name with
            // STABLE UUIDs (RenameAsset) so the bay's ScriptComponent and any
            // wired prefab references survive the rename.
            if (oldCode && oldCode !== msg.newName) {
              const ctrlRel = `LensDesigner/${oldCode}.ts`;
              try {
                const a = await getAssetByPath(t.client, ctrlRel);
                await renameAsset(t.client, a.id, msg.newName, ctrlRel);
                // Wait for the rename to land on disk so the regenerate below
                // updates the SAME file instead of writing a duplicate.
                await waitForFile(`${msg.newName}.ts`, 2000);
              } catch (err) {
                warnings.push(
                  `controller rename skipped (${(err as Error).message}) — regenerating fresh`,
                );
              }
              if (prefabPath) {
                try {
                  const p = await getAssetByPath(t.client, prefabPath);
                  await renameAsset(t.client, p.id, msg.newName, prefabPath);
                  prefabPath = `LensDesigner/${msg.newName}.prefab`;
                } catch (err) {
                  warnings.push(`prefab rename skipped: ${(err as Error).message}`);
                }
              }
              clearScriptAssetIdCache(oldCode);
              clearScriptAssetIdCache(msg.newName);
            }

            // 2. Retag the tree's view node + regenerate the controller (the
            // class inside gets the new name; same file, same UUID).
            const newTree = oldCode ? retagViewNode(baseTree, msg.newName) : baseTree;
            const gen = await generateInPlace(t.client, newTree, reg);
            warnings.push(...gen.warnings);
            let generated: GeneratedRef | null = pickGenerated(gen.generations, msg.newName);
            if (generated && prefabPath) generated = { ...generated, prefab: prefabPath };
            if (!generated) generated = rec.generated; // no view node — pure relabel

            // 3. Orphan sweep (backlog 9): if the old-name controller file
            // still exists (the rename failed and the regenerate wrote a fresh
            // file), delete it — a stale controller keeps compiling forever
            // and errors once its class collides or its bindings rot.
            if (oldCode && oldCode !== msg.newName) {
              try {
                await sweepOrphanController(t.client, oldCode);
              } catch (err) {
                warnings.push(
                  `orphaned ${oldCode}.ts could not be deleted (${(err as Error).message}) — remove it in Lens Studio`,
                );
              }
            }

            const result = upsertView(reg, {
              id: rec.id,
              name: msg.newName,
              tree: newTree,
              generated,
            });
            await saveRegistry(t.client, result.reg);
            process.stdout.write(
              `bridge: renamed view "${rec.name}" → "${msg.newName}" (code identity moved, UUIDs stable)\n`,
            );
            client.send({
              type: 'view.renamed',
              id: rec.id,
              name: msg.newName,
              codeName: msg.newName,
              tree: newTree,
              warnings,
            });
          } catch (err) {
            if (err instanceof RegistryParseError) {
              sendError(client, `view.rename: registry parse error — ${err.message}`);
            } else {
              sendError(client, `view.rename failed: ${(err as Error).message}`);
            }
          }
          break;
        }

        case 'view.republish': {
          try {
            const t = requireTarget(connection);
            const reg = await loadRegistry(t.client);
            const rec = findViewById(reg, msg.id);
            if (!rec) {
              sendError(client, `view.republish: no view with id ${msg.id}`);
              break;
            }
            // The controller + bay component are named by the view node's name
            // (code identity), which can differ from the record's display name.
            const viewName = viewNodeName(rec.tree) ?? rec.name;
            const baySO = await findViewBaySO(t.client, viewName);
            if (!baySO) {
              sendError(client, `view.republish: "${viewName}" isn't in the bay yet — apply it first`);
              break;
            }
            const pub = await publishViewPrefab(t.client, viewName, baySO, rec.generated?.prefab ?? null);
            const { reg: next } = upsertView(reg, {
              id: rec.id,
              name: rec.name,
              tree: rec.tree,
              generated: {
                controller: rec.generated?.controller ?? `LensDesigner/${rec.name}.ts`,
                atVersion: rec.generated?.atVersion ?? 1,
                prefab: pub.prefab,
                publishedAt: Date.now(),
              },
            });
            await saveRegistry(t.client, next);
            process.stdout.write(`bridge: re-published ${rec.name} (${pub.mode}) → ${pub.prefab}\n`);
            client.send({ type: 'view.republished', id: rec.id, prefab: pub.prefab, mode: pub.mode });
          } catch (err) {
            sendError(client, `view.republish failed: ${(err as Error).message}`);
          }
          break;
        }
      }
    },
  });

  process.stdout.write(`bridge: WS ws://localhost:${ws.port}\n`);
  livePreview.start();
  process.stdout.write(`bridge: ready. Ctrl-C to stop.\n`);

  // Clean shutdown
  const shutdown = async (signal: string) => {
    process.stdout.write(`\nbridge: received ${signal}, shutting down...\n`);
    livePreview.stop();
    connection.dispose();
    await Promise.all([ws.close(), http.close()]);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Phase-1 legacy `hello` message — preserves the old wire format so the
 * web app's existing `bridge-client.ts` works unchanged. Step 2 adds the
 * new `attached` message alongside.
 */
function buildHello(target: Target): ServerToClientMsg {
  return {
    type: 'hello',
    server: { name: 'lens-designer-bridge', version: VERSION },
    sandbox: { url: target.config.url, port: target.port },
  };
}

// ---- WS handler helpers (Step 7a) ----

function requireTarget(connection: ConnectionManager): Target {
  const t = connection.getTarget();
  if (!t) throw new Error('no active target — attach to a project first');
  return t;
}

function toViewSummary(v: ViewRecord, reg: ViewRegistry): ViewSummary {
  // Shared components: a dependent is STALE when any definition it instances
  // was edited after the dependent's prefab was last published. Legacy records
  // without publishedAt never flag (no false alarms on old projects).
  let stale = false;
  const publishedAt = v.generated?.publishedAt;
  if (publishedAt !== undefined) {
    for (const defId of collectInstanceRefs(v.tree)) {
      const def = findViewById(reg, defId);
      if (def && def.updatedAt > publishedAt) {
        stale = true;
        break;
      }
    }
  }
  return {
    id: v.id,
    name: v.name,
    codeName: viewNodeName(v.tree) ?? v.name,
    updatedAt: v.updatedAt,
    stale,
  };
}

/** The project's display name: the attach label, else the Assets-dir basename. */
function projectNameFor(target: Target): string {
  if (target.kind === 'sandbox') return 'sandbox';
  return target.label && target.label.trim().length > 0
    ? target.label.trim()
    : basename(target.assetsDir).replace(/\/Assets$/i, '');
}

function buildAttached(target: Target, views: ViewSummary[]): ServerToClientMsg {
  return {
    type: 'attached',
    target: {
      port: target.port,
      kind: target.kind,
      projectName: projectNameFor(target),
      assetsDir: target.assetsDir,
    },
    views,
    needsAssetsDir: false, // sandbox + attached both have assetsDir set by this point
  };
}

/**
 * Load the manifest and, for an attached project, make it self-describing:
 * stamp the project header (name + assets path + designer version) so a later
 * attach can read this one file and know the project without being told. Writes
 * only when the header is absent or changed — connecting twice doesn't churn the
 * file. Sandbox mode is left untouched (legacy in-tree surface, not a project).
 */
async function attachRegistry(target: Target): Promise<ViewRegistry> {
  const reg = await loadRegistry(target.client);
  if (target.kind === 'sandbox') return reg;
  const name = projectNameFor(target);
  const prev = reg.project;
  const unchanged =
    prev?.name === name &&
    prev?.assetsDir === target.assetsDir &&
    prev?.lensDesignerVersion === VERSION;
  if (unchanged) return reg;
  const next = setProjectMeta(reg, {
    name,
    assetsDir: target.assetsDir,
    lensDesignerVersion: VERSION,
  });
  await saveRegistry(target.client, next);
  process.stdout.write(`bridge: stamped project header "${name}" into the manifest\n`);
  return next;
}

function sendError(client: WsClient, msg: string): void {
  client.send({
    type: 'design.error',
    error: { nodeId: null, propertyPath: null, lsError: msg },
  });
  process.stderr.write(`bridge: ${msg}\n`);
}

/**
 * Pick the GeneratedRef for a saved/renamed view. generateInPlace keys
 * generations by the View NODE's name (which drives the controller filename +
 * class); the registry record name can diverge from that, so an exact-key
 * lookup can miss and would store `generated: null`, silently breaking the
 * controller linkage. Fall back: a save carries one view's tree, so a single
 * generation is unambiguously this view's; else match case-insensitively.
 */
function pickGenerated(
  generations: Map<string, GeneratedRef>,
  name: string,
): GeneratedRef | null {
  const exact = generations.get(name);
  if (exact) return exact;
  if (generations.size === 1) return [...generations.values()][0]!;
  const lower = name.toLowerCase();
  for (const [k, v] of generations) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Delete an orphaned old-name controller after a code-identity change:
 * DeleteLensStudioAsset when LS has it imported, direct unlink when it never
 * was (safe — the leaked-entry corruption only applies to imported assets).
 * Returns true when something was removed. Shared by view.rename and the
 * view.save path (the Inspector's class-name field changes view.name through
 * a plain save, which used to leave `<OldName>.ts` compiling forever —
 * BookSpineViewView.ts, 2026-06-10).
 */
async function sweepOrphanController(client: McpClient, oldCode: string): Promise<boolean> {
  let removed = await deleteOwnedAssetByPath(client, `LensDesigner/${oldCode}.ts`);
  if (!removed) {
    const scope = getActiveScope();
    const abs = scope ? join(scope.lensDesignerDir, `${oldCode}.ts`) : null;
    if (abs && existsSync(abs)) {
      await unlink(abs);
      removed = true;
    }
  }
  if (removed) {
    clearScriptAssetIdCache(oldCode);
    process.stdout.write(`bridge: removed orphaned controller ${oldCode}.ts\n`);
  }
  return removed;
}

/** Poll until `Assets/LensDesigner/<filename>` exists on disk (LS-side asset
 *  ops like RenameAsset land asynchronously). Resolves false on timeout. */
async function waitForFile(filename: string, timeoutMs: number): Promise<boolean> {
  const scope = getActiveScope();
  if (!scope) return false;
  const abs = join(scope.lensDesignerDir, filename);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(abs)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return existsSync(abs);
}

/**
 * Self-heal (backlog 10): regenerate any view controller whose `.ts` was
 * deleted out from under the registry. views.json is authoritative — a user
 * deleting `Assets/LensDesigner/<View>.ts` used to strand the bay instance
 * with a dangling ScriptComponent and dead saves; now attach rebuilds the
 * controller from the saved tree. (The `.prefab` heals on the next
 * save/republish — publishViewPrefab is already create-if-absent. The
 * dangling bay component itself is swept by the applier on the next apply.)
 */
async function healMissingControllers(target: Target, reg: ViewRegistry): Promise<void> {
  const scope = getActiveScope();
  if (!scope) return;
  for (const v of reg.views) {
    const code = viewNodeName(v.tree);
    if (!code) continue; // no marked component — nothing generated
    if (existsSync(join(scope.lensDesignerDir, `${code}.ts`))) continue;
    try {
      await generateInPlace(target.client, v.tree, reg);
      clearScriptAssetIdCache(code);
      process.stdout.write(
        `bridge: healed missing controller ${code}.ts (regenerated from views.json)\n`,
      );
    } catch (err) {
      process.stderr.write(
        `bridge: could not heal controller ${code}.ts: ${(err as Error).message}\n`,
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`bridge: fatal: ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(1);
});
