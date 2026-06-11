// Phase-0-preserved: resolveConfig discovery order + bearer resolution.
// Source: tools/lens-designer/src/mcp.ts (moves to bridge/src/mcp.ts in A1).

import { describe, test } from 'vitest';

describe('resolveConfig() — discovery order', () => {
  test.todo('returns env-url URL when LS_MCP_URL env is set');
  test.todo('returns env-port URL when LS_MCP_PORT env is set');
  test.todo('LS_MCP_URL wins over LS_MCP_PORT when both are set');
  test.todo('falls through to marker scan when no env override is set');
  test.todo('throws when LS_MCP_PORT is not a valid integer');
  test.todo('throws when LS_MCP_PORT is out of TCP range (0 or > 65535)');
});

describe('resolveConfig() — bearer resolution', () => {
  test.todo('LS_MCP_BEARER env wins when set');
  test.todo('falls back to ~/.claude.json lens-studio entry when env unset');
  test.todo('throws with a clear message if neither source provides a bearer');
});

describe('scanForSandbox(bearer)', () => {
  test.todo('returns the lowest port whose marker SO is present');
  test.todo('returns null when no port in 50000-50100 has the marker');
  test.todo('silently dedupes the LS port pair (N, N+1) to the lower port');
  test.todo('warns when two distinct (non-pair) ports have the marker');
});
