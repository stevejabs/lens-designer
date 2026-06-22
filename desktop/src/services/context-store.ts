// context-store.ts — per-artifact distilled context sidecars.
//
// Each generated artifact (asset or view) gets a `<artifact>.ldctx.json`
// sidecar stored alongside it in the project, holding a DISTILLED summary
// (not the full transcript), the verbatim prompt history, and the native
// Claude session id for best-effort resume. Named `*.ldctx.json` so a single
// `.gitignore` line excludes them all.

import { readFile, writeFile } from 'node:fs/promises';

export interface ArtifactContext {
  artifactId: string;
  /** Native Claude session id — resume the JSONL when it still exists. */
  sessionId: string | null;
  /** Verbatim user prompts, oldest first (short + high-value). */
  promptHistory: string[];
  /** LLM-distilled summary of the thread; rehydrates a session if the JSONL is gone. */
  distilledSummary: string;
  /** Generation params (backend, model, etc.). */
  genParams?: Record<string, string>;
  schemaVersion: 1;
  updatedAt: string;
}

const SUFFIX = '.ldctx.json';

export function sidecarPath(artifactPath: string): string {
  return `${artifactPath}${SUFFIX}`;
}

export async function readContext(artifactPath: string): Promise<ArtifactContext | null> {
  try {
    const raw = await readFile(sidecarPath(artifactPath), 'utf8');
    return JSON.parse(raw) as ArtifactContext;
  } catch {
    return null;
  }
}

export async function writeContext(
  artifactPath: string,
  ctx: Omit<ArtifactContext, 'schemaVersion' | 'updatedAt'>,
  nowIso: string,
): Promise<void> {
  const full: ArtifactContext = { ...ctx, schemaVersion: 1, updatedAt: nowIso };
  await writeFile(sidecarPath(artifactPath), JSON.stringify(full, null, 2), 'utf8');
}

/** Append a prompt + summary onto an existing (or new) sidecar. */
export async function appendTurn(
  artifactPath: string,
  artifactId: string,
  prompt: string,
  summary: string,
  sessionId: string | null,
  nowIso: string,
): Promise<void> {
  const existing = await readContext(artifactPath);
  await writeContext(
    artifactPath,
    {
      artifactId,
      sessionId,
      promptHistory: [...(existing?.promptHistory ?? []), prompt],
      distilledSummary: summary,
      ...(existing?.genParams ? { genParams: existing.genParams } : {}),
    },
    nowIso,
  );
}
