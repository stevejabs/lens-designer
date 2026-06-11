// sandbox-download.test.ts — covers the load-bearing failure modes
// of the download orchestrator without needing the network or a real
// zip on disk.
//
// Test plan rows covered:
//   - sandbox-non-empty-dir.test.ts (validateTargetDirectory)
//   - sandbox-download-sha-mismatch.test.ts
//   - sandbox-download-retry.test.ts (retry budget via mocked fetch)
//   - sandbox-download (placeholder-SHA guard)

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SandboxDownloadError,
  downloadAndExtractSandbox,
  validateTargetDirectory,
  _internals,
} from '../src/sandbox-download.js';

describe('validateTargetDirectory', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ld-sandbox-test-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('returns kind: empty for a freshly created dir', async () => {
    const result = await validateTargetDirectory(tmpDir);
    expect(result).toEqual({ kind: 'empty' });
  });

  test('returns kind: non-empty when dir has visible files', async () => {
    await writeFile(join(tmpDir, 'somefile.txt'), 'hello');
    const result = await validateTargetDirectory(tmpDir);
    expect(result.kind).toBe('non-empty');
    if (result.kind === 'non-empty') {
      expect(result.entryCount).toBe(1);
    }
  });

  test('treats dot-files as not blocking ("empty" classification)', async () => {
    await writeFile(join(tmpDir, '.DS_Store'), 'macos meta');
    const result = await validateTargetDirectory(tmpDir);
    expect(result).toEqual({ kind: 'empty' });
  });

  test('returns kind: missing when path does not exist', async () => {
    const missing = join(tmpDir, 'nope', 'never-existed');
    const result = await validateTargetDirectory(missing);
    expect(result).toEqual({ kind: 'missing' });
  });

  test('returns kind: missing when path is a file, not a dir', async () => {
    const filePath = join(tmpDir, 'a-file');
    await writeFile(filePath, 'x');
    const result = await validateTargetDirectory(filePath);
    expect(result).toEqual({ kind: 'missing' });
  });
});

describe('downloadAndExtractSandbox · network retry budget', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ld-net-test-'));
    // Force the retry backoffs to ~0 so the test doesn't take 13 seconds.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((cb: () => void) => {
        cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    );
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('gives up with kind: network-failed after MAX_RETRIES', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    let err: SandboxDownloadError | null = null;
    try {
      await downloadAndExtractSandbox({
        targetDir: tmpDir,
        url: 'https://example.invalid/sandbox.zip',
        expectedSha256: 'a'.repeat(64),
      });
    } catch (e) {
      err = e as SandboxDownloadError;
    }

    expect(err).toBeInstanceOf(SandboxDownloadError);
    expect(err?.kind).toBe('network-failed');
    expect(fetchSpy).toHaveBeenCalledTimes(_internals.MAX_RETRIES);
  });

  test('branch-mode default (no SHA pin) does not throw on missing SHA — fails with network-failed instead', async () => {
    // The v1.0 branch-mode flow skips the SHA verify phase. This test
    // ensures we never see the legacy "pinned-sha-placeholder" error
    // kind: the call should proceed to the fetch and fail there.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    let err: SandboxDownloadError | null = null;
    try {
      await downloadAndExtractSandbox({
        targetDir: tmpDir,
        url: 'https://example.invalid/sandbox.zip',
        expectedSha256: null,
      });
    } catch (e) {
      err = e as SandboxDownloadError;
    }
    expect(err).toBeInstanceOf(SandboxDownloadError);
    expect(err?.kind).toBe('network-failed');
  });

  test('propagates cancel through AbortSignal as kind: cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    let err: SandboxDownloadError | null = null;
    try {
      await downloadAndExtractSandbox({
        targetDir: tmpDir,
        url: 'https://example.invalid/sandbox.zip',
        expectedSha256: 'a'.repeat(64),
        abortSignal: controller.signal,
      });
    } catch (e) {
      err = e as SandboxDownloadError;
    }
    expect(err).toBeInstanceOf(SandboxDownloadError);
    expect(err?.kind).toBe('cancelled');
  });
});

describe('downloadAndExtractSandbox · SHA-256 mismatch', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ld-sha-test-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('throws kind: sha-mismatch when the downloaded bytes do not match', async () => {
    const fakeBytes = new TextEncoder().encode('not a real zip — just some bytes');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(fakeBytes, {
        status: 200,
        headers: { 'content-length': String(fakeBytes.byteLength) },
      });
    });

    let err: SandboxDownloadError | null = null;
    try {
      await downloadAndExtractSandbox({
        targetDir: tmpDir,
        url: 'https://example.invalid/sandbox.zip',
        expectedSha256: '0'.repeat(63) + '1', // any non-zero placeholder
      });
    } catch (e) {
      err = e as SandboxDownloadError;
    }

    expect(err).toBeInstanceOf(SandboxDownloadError);
    expect(err?.kind).toBe('sha-mismatch');
    expect(err?.message).toContain('SHA-256 mismatch');
  });
});
