// Phase-0-preserved: assertSandbox() requires the __LENS_DESIGNER_SANDBOX__
// marker SO in the connected LS scene. No bypass flag.
// Source: tools/lens-designer/src/mcp.ts.

import { describe, test } from 'vitest';

describe('assertSandbox(client)', () => {
  test.todo('returns successfully when the marker SO is present');
  test.todo('throws NotSandboxError when the marker SO is absent');
  test.todo('NotSandboxError message points the operator to spectacles-ui-sandbox/sandbox/sandbox.esproj');
  test.todo('NotSandboxError message names the LS_MCP_PORT override for explicit targeting');
  test.todo('treats MCP "no scene object found" error as a missing marker (not a re-throw)');
});
