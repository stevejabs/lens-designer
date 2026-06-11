// Live preview loop. Runs at LIVE_FPS, captures the current LS window
// region into a fixed `live.png` slot, and broadcasts `preview.ready`
// to all connected WS clients. Decoupled from `design.apply` so the
// preview reflects whatever LS is rendering — including material/shader
// uploads that finish after an apply returns, and any change a user
// makes directly in LS.
//
// Why a single rolling filename: avoids per-frame file churn (no
// thousands of orphaned PNGs to sweep) and keeps the URL constant
// except for the cache-buster query param.
//
// Frame-skip rule: if the previous capture hasn't finished by the next
// tick, skip — never queue. Two queued captures would burn CPU racing
// each other for an output slot the renderer can only show one of.

import { rename } from 'node:fs/promises';
import { join } from 'node:path';

import { captureWindowToFile, findLensStudioWindowForPort } from './capture.ts';
import { ensurePreviewDir, previewDir } from './http-server.ts';
import type { Target } from './connection.ts';
import type { WindowRegion } from './protocol.ts';

/** ~10 fps; tweak via LIVE_FPS env. */
const LIVE_FPS = Number.parseInt(process.env['LIVE_FPS'] ?? '10', 10);
const TICK_MS = Math.max(33, Math.round(1000 / LIVE_FPS));

/** Fixed live-preview filename. The route regex must allow this. */
export const LIVE_PREVIEW_FILENAME = 'live.png';

/**
 * Default capture region — matches the LS Preview pane crop for a
 * 1728×1102 LS window. The user can override via
 * `preview.configure-region` and the loop picks it up on the next tick.
 */
const DEFAULT_PREVIEW_REGION: WindowRegion = {
  x: 1290,
  y: 40,
  width: 430,
  height: 810,
};

export interface LivePreviewDeps {
  /** Current attached target, or null while pre-attach / disconnected. */
  getTarget(): Pick<Target, 'port'> | null;
  /** Broadcast a `preview.ready` to all connected clients. */
  broadcast(payload: { url: string; capturedAt: number; region: WindowRegion }): void;
}

export class LivePreview {
  private timer: NodeJS.Timeout | null = null;
  private capturing = false;
  private region: WindowRegion = DEFAULT_PREVIEW_REGION;
  /** Most recent broadcasted capture stamp — used to drop the renderer's "first frame?" gate. */
  private lastBroadcastAt = 0;

  constructor(private readonly deps: LivePreviewDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    process.stdout.write(
      `bridge: live preview started (${LIVE_FPS} fps, tick=${TICK_MS}ms)\n`,
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Update the capture region. Picked up on the next tick. */
  setRegion(region: WindowRegion): void {
    this.region = region;
  }

  getRegion(): WindowRegion {
    return this.region;
  }

  private async tick(): Promise<void> {
    if (this.capturing) return; // frame-skip if the previous capture is still in flight
    const target = this.deps.getTarget();
    if (!target) return;

    this.capturing = true;
    try {
      const win = await findLensStudioWindowForPort(target.port);
      if (!win) return;
      await ensurePreviewDir();
      const finalPath = join(previewDir(), LIVE_PREVIEW_FILENAME);
      const tmpPath = `${finalPath}.${process.pid}.tmp`;
      const cap = await captureWindowToFile(win.id, this.region, tmpPath);
      // Atomic publish: rename overwrites the previous live.png in one
      // step so HTTP GETs never read a half-written PNG.
      await rename(cap.path, finalPath);
      this.lastBroadcastAt = Date.now();
      this.deps.broadcast({
        url: `/preview/${LIVE_PREVIEW_FILENAME}`,
        capturedAt: this.lastBroadcastAt,
        region: this.region,
      });
    } catch (err) {
      // Silent — capture errors are common (window minimized, permission
      // not granted yet, LS just closed). The next tick will retry.
      // Logged at debug level only to avoid spam.
      if (process.env['BRIDGE_DEBUG']) {
        process.stderr.write(
          `[live-preview] tick failed: ${(err as Error).message}\n`,
        );
      }
    } finally {
      this.capturing = false;
    }
  }
}
