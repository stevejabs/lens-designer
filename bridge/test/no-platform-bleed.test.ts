// no-platform-bleed.test.ts
//
// The load-bearing TD-15 rule-1 enforcement. Bridge source must not
// branch on `process.platform`, `os.platform()`, or `os.type()`. All
// platform variation belongs inside the capture addon, behind a typed
// API surface.
//
// This test runs today, against current bridge src. It will keep
// running at every PR and reject any future regression.
//
// Allowlist: none in the bridge today. If a future entry becomes
// necessary, add it to ALLOWED_PATHS below with a TD-15 justification
// in the PR description.

import { describe, test, expect } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const BRIDGE_ROOT = resolve(here, '..');
const SRC_DIR = join(BRIDGE_ROOT, 'src');

const FORBIDDEN_PATTERNS: ReadonlyArray<{ regex: RegExp; reason: string }> = [
  { regex: /\bprocess\.platform\b/g, reason: 'process.platform branching belongs in capture-addon (TD-15 rule 1)' },
  { regex: /\bos\.platform\s*\(/g, reason: 'os.platform() branching belongs in capture-addon (TD-15 rule 1)' },
  { regex: /\bos\.type\s*\(/g, reason: 'os.type() branching belongs in capture-addon (TD-15 rule 1)' },
];

// Paths under bridge/src/ that are allowed to mention platform identifiers.
// Empty by design — there is currently no legitimate need in the bridge.
const ALLOWED_PATHS: ReadonlySet<string> = new Set([]);

async function* walkTs(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      yield full;
    }
  }
}

interface Hit {
  file: string;
  line: number;
  match: string;
  reason: string;
}

async function scanForBleed(): Promise<Hit[]> {
  // Confirm bridge/src/ exists before scanning. In a fresh worktree it always does.
  await stat(SRC_DIR);
  const hits: Hit[] = [];
  for await (const file of walkTs(SRC_DIR)) {
    const rel = relative(BRIDGE_ROOT, file);
    if (ALLOWED_PATHS.has(rel)) continue;
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Skip lines that are just comments — we don't care if a doc comment mentions process.platform.
      if (line.trim().startsWith('//')) continue;
      for (const { regex, reason } of FORBIDDEN_PATTERNS) {
        regex.lastIndex = 0;
        const m = regex.exec(line);
        if (m) {
          hits.push({ file: rel, line: i + 1, match: m[0], reason });
        }
      }
    }
  }
  return hits;
}

describe('bridge: no platform-bleed (TD-15 rule 1)', () => {
  test('bridge/src/**/*.ts contains zero process.platform / os.platform / os.type references outside the addon', async () => {
    const hits = await scanForBleed();
    if (hits.length > 0) {
      const summary = hits
        .map((h) => `  ${h.file}:${h.line}  ${h.match}  — ${h.reason}`)
        .join('\n');
      throw new Error(
        `Platform-bleed detected in bridge/src. ${hits.length} match(es):\n${summary}\n\n` +
          `Move platform branching into the capture addon (TD-15 rule 1), or add an explicit ` +
          `allowlist entry in test/no-platform-bleed.test.ts with a TD-15 justification.`,
      );
    }
    expect(hits).toHaveLength(0);
  });
});
