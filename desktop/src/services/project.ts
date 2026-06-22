// project.ts — resolve the on-disk project directory Lens Studio has open.
//
// The agent channel must run with cwd = the LS project dir so CLAD operates on
// the right project. We find it the same way v1 did: lsof the LS process that
// owns the MCP port, then locate the `.esproj` it has open and return its
// directory. Best-effort; returns null if it can't be determined.

import { exec } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(exec);

async function pidForPort(port: number): Promise<number | null> {
  try {
    const { stdout } = await pexec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
    const pid = Number.parseInt(stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Resolve the project directory (the dir containing the open `.esproj`). */
export async function resolveProjectDir(port: number): Promise<string | null> {
  const pid = await pidForPort(port);
  if (pid === null) return null;
  try {
    const { stdout } = await pexec(`lsof -nP -p ${pid} -Fn`);
    // -Fn output: lines like `n/Users/.../ld-specs-test/ld-specs-test.esproj.<n>.lock`
    const esproj = stdout
      .split('\n')
      .map((l) => (l.startsWith('n') ? l.slice(1) : ''))
      .find((p) => /\.esproj(\.\d+\.lock)?$/.test(p));
    if (!esproj) return null;
    // For `<dir>/<name>.esproj` the project dir is dirname; for the
    // `.esproj.<n>.lock` variant the .esproj segment is mid-path.
    const match = esproj.match(/^(.*)\/[^/]+\.esproj/);
    return match?.[1] ?? dirname(esproj);
  } catch {
    return null;
  }
}
