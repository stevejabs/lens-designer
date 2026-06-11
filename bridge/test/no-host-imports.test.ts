// Independence-invariant guard. The bridge package must NOT import from
// anywhere outside its own src tree or its declared npm dependencies.
//
// This is the CI-grade enforcement of the architecture doc's promise that
// the lens-designer tool is self-contained and extractable from any host
// monorepo.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { glob } from 'fast-glob';
import packageJson from '../package.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = resolve(here, '..');
const srcRoot = resolve(bridgeRoot, 'src');

const DECLARED_DEPS = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
]);

const NODE_BUILTINS = new Set([
  'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os',
  'node:child_process', 'node:util', 'node:crypto', 'node:net',
  'node:http', 'node:https', 'node:stream', 'node:events',
  'node:buffer', 'node:process', 'node:assert',
]);

/** Extract every static `import ... from '...'` specifier in a TS file. */
function extractImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    out.push(m[1]!);
  }
  return out;
}

function isAllowed(spec: string): boolean {
  if (spec.startsWith('.')) return true; // relative import within the package
  if (NODE_BUILTINS.has(spec)) return true;
  if (spec.startsWith('node:')) return true;

  // Match against declared deps. Sub-paths like 'zod/v4' should match the 'zod' dep.
  for (const dep of DECLARED_DEPS) {
    if (spec === dep || spec.startsWith(`${dep}/`)) return true;
  }
  return false;
}

describe('bridge package independence invariant', () => {
  test('every import in src/ resolves to either a relative path, a Node builtin, or a declared npm dep', async () => {
    const files = await glob('**/*.ts', { cwd: srcRoot, absolute: true });
    expect(files.length, 'src files were found').toBeGreaterThan(0);

    const violations: { file: string; spec: string }[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const spec of extractImports(source)) {
        if (!isAllowed(spec)) {
          violations.push({
            file: file.replace(`${bridgeRoot}/`, ''),
            spec,
          });
        }
      }
    }

    expect(
      violations,
      `bridge/src imports outside allowed scope: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });
});
