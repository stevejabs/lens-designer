# Bridge integration tests

These tests touch a real Lens Studio instance. They **auto-skip with a
clear message** when no sandbox is reachable, so a normal `pnpm test`
run still passes when LS isn't running.

To run them:

1. Open `spectacles-ui-sandbox/sandbox/sandbox.esproj` in Lens Studio.
2. Confirm the `__LENS_DESIGNER_SANDBOX__` SO is at scene root.
3. `pnpm test:int` from `tools/lens-designer/bridge/`.

The auto-skip uses the same marker-scan logic as the bridge daemon
itself (`resolveConfig` → `scanForSandbox`). If the scan returns null,
all tests in this directory skip with a single-line reason.

## Tests in this directory

- `mcp-ping.test.ts` — sandbox connectivity smoke.
- `single-mutation.test.ts` — apply 1 Rectangle, verify scene.
- `tree-apply.test.ts` — apply 3-node tree, verify z-stack + properties.
- `debounce-burst.test.ts` — 10 mutations within 50 ms produce 1 preview.
- `design-error.test.ts` — invalid property surfaces design.error.
- `sandbox-lifecycle.test.ts` — kill + restart LS recovers cleanly.
- `multi-instance.test.ts` — marker scan picks the sandbox even when
  another LS is running.
- `off-space.test.ts` — capturing an off-Space window fails cleanly
  (requires manual setup: move LS to another macOS Space).
