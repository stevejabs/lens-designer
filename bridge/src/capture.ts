// capture.ts — bridge-side wrapper around @lens-designer/capture-addon.
//
// Replaces the deleted screencap.ts (which shelled out to macOS's
// `screencapture` + `sips`) and window.ts (which shelled out to
// `lsof` + a compiled Swift binary). The contract is platform-blind:
// all per-OS variation lives inside the addon, behind a typed API
// (TD-15 rule 1).
//
// Public functions:
//   - findLensStudioWindowForPort(port)   — port → pid → window
//   - captureWindowToFile(sourceId, region, outPath)
//                                         — capture + write PNG to disk

import { writeFile } from 'node:fs/promises';
import {
  enumerateLensStudioWindows,
  captureSource,
  portToPid,
  type Region,
  type WindowEntry,
} from '@lens-designer/capture-addon';

export type { Region, WindowEntry } from '@lens-designer/capture-addon';
export { CaptureError } from '@lens-designer/capture-addon';
export type {
  CaptureErrorKind,
  CaptureResult,
  PlatformCapabilities,
  WindowBounds,
  SourceId,
} from '@lens-designer/capture-addon';

/**
 * Window region in the captured image's pixel space. Same shape as
 * the addon's `Region`, re-exported for clarity at the bridge boundary.
 * The bridge protocol's `preview.configure-region` writes here.
 */
export type WindowRegion = Region;

/** Resolve a TCP port to its owning PID. Returns null if no listener. */
export function pidListeningOnPort(port: number): number | null {
  return portToPid(port);
}

/**
 * Resolve a port → pid → Lens Studio window in one call. Mirrors the
 * legacy window.ts API so call sites only need to change one import.
 */
export async function findLensStudioWindowForPort(
  port: number,
): Promise<WindowEntry | null> {
  const pid = portToPid(port);
  if (pid === null) return null;
  const windows = enumerateLensStudioWindows();
  return windows.find((w) => w.pid === pid) ?? null;
}

/**
 * Capture a window-region and write the PNG to disk. Returns the
 * output path + the capture wall-clock time stamp from the addon.
 *
 * Replaces the legacy `captureWindowRegion(windowId, region, outPath)`.
 * Note the **type change**: `sourceId` is now a string (TD-15 rule 3),
 * not a number. Callers must pass `entry.id` from `enumerateLensStudioWindows`.
 */
export interface CaptureToFileResult {
  path: string;
  sourceId: string;
  region: WindowRegion;
  capturedAtMs: number;
  width: number;
  height: number;
}

export async function captureWindowToFile(
  sourceId: string,
  region: WindowRegion,
  outPath: string,
): Promise<CaptureToFileResult> {
  const result = await captureSource(sourceId, region);
  await writeFile(outPath, result.png);
  return {
    path: outPath,
    sourceId,
    region,
    capturedAtMs: result.capturedAtMs,
    width: result.width,
    height: result.height,
  };
}
