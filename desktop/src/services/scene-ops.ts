// scene-ops.ts — deterministic LS operations the cockpit drives directly:
// capture the live preview, recompile TypeScript, and read/save view sources.
// All routed through the orchestrator's single-writer queue by the caller.

import { readFile, writeFile } from 'node:fs/promises';
import type { McpClient } from './mcp-client.js';

const PREVIEW_PANEL = 'Snap.Plugin.Gui.PreviewPanel';

/** Capture the live LS preview panel as a data URL (the real rendered view). */
export async function capturePreview(client: McpClient, maxDimension = 900): Promise<string | null> {
  const blocks = await client.callToolRaw('CapturePanelScreenshotTool', {
    pluginId: PREVIEW_PANEL,
    maxDimension,
  });
  const img = blocks.find((b) => b.type === 'image' && b.data);
  if (!img?.data) return null;
  const mime = img.mimeType ?? 'image/png';
  return `data:${mime};base64,${img.data}`;
}

export interface RecompileResult {
  ok: boolean;
  message: string;
}

/** Recompile the project's TypeScript; returns success + any message. */
export async function recompile(client: McpClient): Promise<RecompileResult> {
  try {
    const res = await client.callTool<{ succeeded?: boolean; status?: string; errors?: unknown }>(
      'RecompileTypeScriptTool',
      {},
    );
    const ok = res?.succeeded === true || res?.status === 'succeeded';
    return { ok, message: typeof res?.errors === 'string' ? res.errors : JSON.stringify(res ?? {}) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Read a project file from disk (LS MCP truncates large reads; disk is truth). */
export async function readViewSource(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** Save a view source to disk and recompile so LS picks it up. */
export async function saveViewSource(
  client: McpClient,
  path: string,
  source: string,
): Promise<RecompileResult> {
  await writeFile(path, source, 'utf8');
  return recompile(client);
}
