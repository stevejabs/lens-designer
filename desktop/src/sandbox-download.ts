// sandbox-download.ts — download + (optionally) SHA-verify + extract
// the sandbox archive zip to a user-chosen directory.
//
// v1.0 pulls from `main` via GitHub's archive endpoint (no SHA pin).
// When SANDBOX_PINNED_SHA256 is non-null (release mode), the verify
// phase runs and a mismatch aborts the download.
//
// Design source: docs/design/2026-05-27-lens-designer-standalone-app-design.md §2
// Architecture: docs/architecture/2026-05-27-lens-designer-standalone-app-architecture.md §4
//
// Public surface:
//   - validateTargetDirectory(path) — non-empty check used by the UI's
//     warning callout (DS-2-D3) without blocking continue.
//   - downloadAndExtractSandbox(opts) — the orchestrator. Emits
//     progress callbacks for the renderer's progress bar. Throws
//     typed errors (DS-2-D1..D4 mapping).

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import StreamZip from 'node-stream-zip';
import {
  SANDBOX_PINNED_SHA256,
  sandboxArchiveUrl,
  sandboxArchiveWrapperPrefix,
} from './sandbox-config.js';

/** Number of fetch retries before giving up (per DS-2-D1). */
const MAX_RETRIES = 3;
/** Backoff between retries, in ms. */
const RETRY_BACKOFF_MS = [1_000, 3_000, 9_000] as const;

/** Phases visible to the user in the progress modal. */
export type DownloadPhase = 'downloading' | 'verifying' | 'extracting';

export interface ProgressUpdate {
  phase: DownloadPhase;
  bytesDone: number;
  bytesTotal: number;
}

export type DownloadErrorKind =
  | 'network-failed'        // DS-2-D1
  | 'sha-mismatch'          // DS-2-D2 (only when a SHA is pinned)
  | 'write-failed'          // DS-2-D4
  | 'cancelled';            // DS-2-D5

export class SandboxDownloadError extends Error {
  constructor(
    public kind: DownloadErrorKind,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'SandboxDownloadError';
  }
}

export interface DownloadOptions {
  /** Absolute path to the user-chosen directory. */
  targetDir: string;
  /** Optional override (defaults to the pinned ref's archive URL). */
  url?: string;
  /**
   * Optional override for the expected SHA-256. Set to null (or
   * leave SANDBOX_PINNED_SHA256 as null) to skip verification — the
   * branch-mode default for v1.0. Setting it to a hex string
   * re-enables the verify phase.
   */
  expectedSha256?: string | null;
  /**
   * Optional override for the wrapper-directory prefix stripped from
   * extracted entries. GitHub's archive endpoint nests the tree under
   * `<repo>-<ref>/`; we strip that so the user's targetDir ends up
   * with the project at its root. Pass `''` to disable stripping
   * (release-zip mode).
   */
  stripWrapperPrefix?: string;
  /** Wired by the renderer to drive the progress bar. */
  onProgress?: (update: ProgressUpdate) => void;
  /** Set to true to abort. The orchestrator polls between phases. */
  abortSignal?: AbortSignal;
}

export interface DownloadResult {
  /** Resolved esproj path (the file the user opens in LS). */
  esprojPath: string;
  /** The directory the sandbox was extracted into. */
  sandboxDir: string;
}

/**
 * Non-empty check for the picked directory. Returns the classification
 * so the UI can render the warning callout (DS-2-D3) without forcing
 * the user to pick again.
 */
export async function validateTargetDirectory(
  targetDir: string,
): Promise<
  | { kind: 'empty' }
  | { kind: 'non-empty'; entryCount: number }
  | { kind: 'missing' }
> {
  try {
    const s = await stat(targetDir);
    if (!s.isDirectory()) return { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return { kind: 'missing' };
  }
  const visible = entries.filter((e) => !e.startsWith('.'));
  return visible.length === 0
    ? { kind: 'empty' }
    : { kind: 'non-empty', entryCount: visible.length };
}

/**
 * Top-level orchestrator. Emits 3 phases (download → verify → extract),
 * returns the resolved esproj path on success. Throws SandboxDownloadError
 * with a typed `kind` for all failure modes.
 */
export async function downloadAndExtractSandbox(
  opts: DownloadOptions,
): Promise<DownloadResult> {
  if (opts.abortSignal?.aborted) {
    throw new SandboxDownloadError('cancelled', 'cancelled before start');
  }

  const url = opts.url ?? sandboxArchiveUrl();
  // expectedSha === null disables the verify phase entirely (the v1.0
  // branch-mode default).
  const expectedSha = (() => {
    if (opts.expectedSha256 === null) return null;
    if (opts.expectedSha256) return opts.expectedSha256.toLowerCase();
    return SANDBOX_PINNED_SHA256?.toLowerCase() ?? null;
  })();

  // 1. Download → tmp file
  const tmpFile = join(
    tmpdir(),
    `spectacles-sandbox-${Date.now()}-${process.pid}.zip`,
  );
  try {
    await fetchToFile(url, tmpFile, opts);
    if (opts.abortSignal?.aborted) {
      throw new SandboxDownloadError('cancelled', 'cancelled after download');
    }

    // 2. Verify SHA-256 (skipped when no SHA is pinned).
    if (expectedSha !== null) {
      opts.onProgress?.({ phase: 'verifying', bytesDone: 0, bytesTotal: 0 });
      const actualSha = await sha256OfFile(tmpFile);
      if (actualSha !== expectedSha) {
        throw new SandboxDownloadError(
          'sha-mismatch',
          `SHA-256 mismatch: expected ${expectedSha}, got ${actualSha}`,
        );
      }
      if (opts.abortSignal?.aborted) {
        throw new SandboxDownloadError('cancelled', 'cancelled after verify');
      }
    }

    // 3. Extract
    opts.onProgress?.({ phase: 'extracting', bytesDone: 0, bytesTotal: 0 });
    const result = await extractZipToDir(tmpFile, opts.targetDir, opts);
    return result;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// --------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------

async function fetchToFile(
  url: string,
  outPath: string,
  opts: DownloadOptions,
): Promise<void> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (opts.abortSignal?.aborted) {
      throw new SandboxDownloadError('cancelled', 'cancelled during download');
    }
    try {
      // Re-use the renderer's AbortSignal so Cancel cancels the fetch
      // promptly instead of waiting for retry-budget exhaustion.
      // (exactOptionalPropertyTypes: omit the key entirely when absent.)
      const res = await fetch(url, {
        ...(opts.abortSignal ? { signal: opts.abortSignal } : {}),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error('response had no body');
      }
      const totalHeader = res.headers.get('content-length');
      const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;

      let done = 0;
      const reader = res.body.getReader();
      const sink = createWriteStream(outPath);
      const readable = new Readable({
        async read() {
          try {
            const { value, done: finished } = await reader.read();
            if (finished) {
              this.push(null);
              return;
            }
            done += value.byteLength;
            opts.onProgress?.({
              phase: 'downloading',
              bytesDone: done,
              bytesTotal: total,
            });
            this.push(Buffer.from(value));
          } catch (err) {
            this.destroy(err as Error);
          }
        },
      });
      await pipeline(readable, sink);
      return; // success
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new SandboxDownloadError('cancelled', 'fetch aborted');
      }
      lastErr = err;
      // Don't wait after the final attempt.
      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_BACKOFF_MS[attempt] ?? 1_000);
      }
    }
  }

  throw new SandboxDownloadError(
    'network-failed',
    `Failed after ${MAX_RETRIES} attempts: ${(lastErr as Error)?.message ?? 'unknown'}`,
    lastErr,
  );
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function extractZipToDir(
  zipPath: string,
  targetDir: string,
  opts: DownloadOptions,
): Promise<DownloadResult> {
  await mkdir(targetDir, { recursive: true }).catch(() => {});
  try {
    await stat(targetDir);
  } catch (err) {
    throw new SandboxDownloadError(
      'write-failed',
      `target directory unreachable: ${(err as Error).message}`,
      err,
    );
  }

  // GitHub's archive endpoint nests everything under `<repo>-<ref>/`.
  // Strip that prefix so the user's targetDir gets the project tree at
  // its root, not nested inside another directory.
  const wrapperPrefix =
    opts.stripWrapperPrefix ?? sandboxArchiveWrapperPrefix();

  // node-stream-zip handles path-traversal entries safely (`..` segments
  // are normalized). We additionally guard by resolving each entry name
  // against targetDir and rejecting if it escapes.
  const zip = new StreamZip.async({ file: zipPath });
  let esprojPath: string | null = null;
  try {
    const entries = await zip.entries();
    const totalBytes = Object.values(entries).reduce(
      (sum, e) => sum + (e.size ?? 0),
      0,
    );
    let extractedBytes = 0;

    for (const entry of Object.values(entries)) {
      if (opts.abortSignal?.aborted) {
        throw new SandboxDownloadError('cancelled', 'cancelled during extract');
      }
      // Strip the wrapper prefix. If an entry name doesn't start with
      // the wrapper, leave it as-is (release-zip mode passes '' here).
      const stripped =
        wrapperPrefix && entry.name.startsWith(wrapperPrefix)
          ? entry.name.slice(wrapperPrefix.length)
          : entry.name;
      if (stripped === '') continue; // the wrapper directory entry itself

      // Reject any entry whose normalized path escapes targetDir.
      const dest = resolve(targetDir, stripped);
      if (!dest.startsWith(resolve(targetDir))) {
        throw new SandboxDownloadError(
          'write-failed',
          `zip entry escapes target dir: ${entry.name}`,
        );
      }
      if (entry.isDirectory) continue;
      try {
        await mkdir(resolve(dest, '..'), { recursive: true });
        await zip.extract(entry.name, dest);
        extractedBytes += entry.size ?? 0;
        if (stripped.toLowerCase().endsWith('.esproj') && !esprojPath) {
          esprojPath = dest;
        }
        opts.onProgress?.({
          phase: 'extracting',
          bytesDone: extractedBytes,
          bytesTotal: totalBytes,
        });
      } catch (err) {
        if (err instanceof SandboxDownloadError) throw err;
        throw new SandboxDownloadError(
          'write-failed',
          `failed to extract ${entry.name}: ${(err as Error).message}`,
          err,
        );
      }
    }
  } finally {
    await zip.close().catch(() => {});
  }

  if (!esprojPath) {
    throw new SandboxDownloadError(
      'write-failed',
      'extracted archive did not contain an .esproj — wrong source ref?',
    );
  }

  return {
    esprojPath,
    sandboxDir: targetDir,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveP) => setTimeout(resolveP, ms));
}

// Exported for tests.
export const _internals = {
  MAX_RETRIES,
  RETRY_BACKOFF_MS,
  sha256OfFile,
};
