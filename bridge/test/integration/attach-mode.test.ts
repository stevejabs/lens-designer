// Attach-mode integration — happy path against a live LS instance.
// Run with the sandbox (or a throwaway project) open and MCP reachable.
//
// These tests gate on LS_MCP_PORT / LS_MCP_URL being set OR the marker scan
// finding a live instance. Skip cleanly when no LS is reachable.
//
// Sources:
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Phase 1–6
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §4

import { describe, test } from 'vitest';

describe('integration — connection abstraction', () => {
  test.todo('scanInstances returns at least one MCP-responsive LS instance');
  test.todo('each result carries port, projectName (best-effort), hasMarker flag');
  test.todo('attaching to a sandbox-flagged target sets editSurface.soName = "ActiveComponent"');
  test.todo('attaching to a non-sandbox target creates/locates __LensDesignerEditBay__ as the edit surface');
  test.todo('detach tears down the AttachSession and (in attached mode) cleans up the edit bay subtree');
});

describe('integration — pack install', () => {
  test.todo('install via plain absolute path succeeds against a fresh project');
  test.todo('install via file:// URI is rejected with a clear error');
  test.todo('idempotent: install on a project where the pack is already present is a no-op');
  test.todo('post-install, GetLensStudioAssetsByName resolves LensDesignerRoundedRect (etc.) with UUIDs identical to the sandbox source');
  test.todo('post-install, duplicateMaterialAssetOnDisk against an installed template produces a usable .mat in Assets/LensDesigner/');
});

describe('integration — apply confined to edit surface', () => {
  test.todo('design.apply teardown-rebuild touches ONLY the edit-surface descendants');
  test.todo('snapshot the scene root children before + after apply; assert non-edit-surface children unchanged');
  test.todo('apply with a tree that would write outside the edit surface returns design.error (caught by the scoped-apply guard)');
});

describe('integration — views.json round-trip', () => {
  test.todo('view.save writes views.json + prefab + controller into Assets/LensDesigner/');
  test.todo('view.list returns the saved view with intact metadata');
  test.todo('view.load returns the original tree; bridge applies it to the edit surface; preview captures');
  test.todo('reload-equivalent: detach + re-attach + view.list returns the same registry');
  test.todo('switching active view tears down + rebuilds the edit surface with the new tree at ACTIVE_COMPONENT_WORLD_Z = -100');
});

describe('integration — assets-dir resolution (TD-4)', () => {
  test.todo('binary ingest works after target.set-assets-dir');
  test.todo('binary ingest returns 503 / clear error before target.set-assets-dir');
  test.todo('lsof-based auto-suggest finds the LS PID\'s open project root (sanity, may skip if lsof unavailable)');
});

describe('integration — sandbox mode regression', () => {
  test.todo('sandbox-mode attach gets the views.json + switcher behavior identical to attached mode');
  test.todo('folder export (design.export) still produces a bundle under tools/lens-designer/exports/');
  test.todo('legacy hello / sandbox.down messages still arrive during the migration window');
});
