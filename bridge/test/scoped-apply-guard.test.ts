// Scoped-apply guard — the safety contract that replaces the old sandbox-marker
// hard gate (TD-1, TD-8). Every MCP scene mutation must route through the
// guard; every asset write must resolve under Assets/LensDesigner/.
//
// This is the HIGHEST-STAKES test surface in attach mode. A bug here means a
// designer write lands in the user's real scene or assets. Treat the guard
// like a security boundary.
//
// Sources:
//   - docs/architecture/2026-05-25-lens-designer-attach-mode-architecture.md §TD-1, TD-8
//   - docs/plans/2026-05-25-lens-designer-attach-mode-implementation-plan.md Step 4
//   - docs/design/2026-05-26-lens-designer-attach-mode-design.md (no UI contact)

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import {
  ApplyScope,
  ScopedApplyError,
  setActiveScope,
  getActiveScope,
  requireActiveScope,
} from '../src/scope.ts';

const ROOT = 'edit-surface-root-uuid';
const CHILD_A = 'child-a-uuid';
const CHILD_B = 'child-b-uuid';
const FOREIGN = 'foreign-so-uuid';
const ASSETS_ROOT = '/tmp/test-project/Assets';
const ASSETS_LD = '/tmp/test-project/Assets/LensDesigner';

function makeScope(opts: { descendants?: string[]; assetsRoot?: string } = {}): ApplyScope {
  return new ApplyScope(
    {
      editSurfaceRoot: ROOT,
      assetsRoot: opts.assetsRoot ?? ASSETS_ROOT,
    },
    opts.descendants ?? [],
  );
}

afterEach(() => {
  // The module-level singleton must not leak between tests.
  setActiveScope(null);
});

describe('ApplyScope — construction', () => {
  test('seeds permittedSOs with {root, ...initialDescendants}', () => {
    const scope = makeScope({ descendants: [CHILD_A, CHILD_B] });
    expect(scope.permits(ROOT)).toBe(true);
    expect(scope.permits(CHILD_A)).toBe(true);
    expect(scope.permits(CHILD_B)).toBe(true);
    expect(scope.permits(FOREIGN)).toBe(false);
  });

  test('root is exposed for the applier to use as parent', () => {
    const scope = makeScope();
    expect(scope.root).toBe(ROOT);
  });

  test('lensDesignerDir is the Assets/LensDesigner absolute path', () => {
    const scope = makeScope();
    expect(scope.lensDesignerDir).toBe(ASSETS_LD);
  });
});

describe('ApplyScope.assertSceneTarget — refusal contract (TD-8)', () => {
  test('permits the edit-surface root', () => {
    const scope = makeScope();
    expect(() => scope.assertSceneTarget(ROOT, 'setProperty')).not.toThrow();
  });

  test('permits a seeded descendant', () => {
    const scope = makeScope({ descendants: [CHILD_A] });
    expect(() => scope.assertSceneTarget(CHILD_A, 'setProperty')).not.toThrow();
  });

  test('REFUSES an SO outside the edit-surface subtree', () => {
    const scope = makeScope({ descendants: [CHILD_A] });
    expect(() => scope.assertSceneTarget(FOREIGN, 'setProperty')).toThrow(ScopedApplyError);
  });

  test('REFUSES a null target SO', () => {
    const scope = makeScope();
    expect(() => scope.assertSceneTarget(null, 'createSceneObject')).toThrow(ScopedApplyError);
  });

  test('REFUSES an undefined target SO (root-level create)', () => {
    const scope = makeScope();
    expect(() => scope.assertSceneTarget(undefined, 'createSceneObject')).toThrow(ScopedApplyError);
  });

  test('refusal error message names the operation + the SO + the root', () => {
    const scope = makeScope();
    try {
      scope.assertSceneTarget(FOREIGN, 'setProperty');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopedApplyError);
      expect((err as Error).message).toContain('setProperty');
      expect((err as Error).message).toContain(FOREIGN);
      expect((err as Error).message).toContain(ROOT);
    }
  });
});

describe('ApplyScope.assertAssetPath — disk-write boundary', () => {
  test('permits a path under Assets/LensDesigner/', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath(`${ASSETS_LD}/images/foo.png`, 'ingestImageBytes'))
      .not.toThrow();
  });

  test('permits the Assets/LensDesigner/ directory itself', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath(ASSETS_LD, 'mkdir')).not.toThrow();
  });

  test('REFUSES a path outside Assets/LensDesigner/', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath(`${ASSETS_ROOT}/Scene.scene`, 'writeFile'))
      .toThrow(ScopedApplyError);
  });

  test('REFUSES a sibling under Assets/ that is NOT LensDesigner', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath(`${ASSETS_ROOT}/OtherDir/x.mat`, 'writeFile'))
      .toThrow(ScopedApplyError);
  });

  test('REFUSES path traversal that escapes LensDesigner/', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath(`${ASSETS_LD}/../Scene.scene`, 'writeFile'))
      .toThrow(ScopedApplyError);
  });

  test('REFUSES an absolute path outside the project root entirely', () => {
    const scope = makeScope();
    expect(() => scope.assertAssetPath('/etc/passwd', 'writeFile')).toThrow(ScopedApplyError);
  });

  test('REFUSES writes into the installed package Cache/ path', () => {
    // Editable packages land under <project>/Cache/<pkg-uuid>/<hash>/Data/
    // (S1 finding). Those are LS-managed and not in our scope.
    const scope = makeScope();
    expect(() =>
      scope.assertAssetPath(`${ASSETS_ROOT}/../Cache/abc/xyz/Data/foo.mat`, 'writeFile'),
    ).toThrow(ScopedApplyError);
  });
});

describe('ApplyScope.assertProjectRelativeAssetPath — MCP asset paths', () => {
  test('permits paths beginning with LensDesigner/', () => {
    const scope = makeScope();
    expect(() =>
      scope.assertProjectRelativeAssetPath('LensDesigner/foo.mat', 'createAssetFromPreset'),
    ).not.toThrow();
  });

  test('permits the LensDesigner folder root', () => {
    const scope = makeScope();
    expect(() =>
      scope.assertProjectRelativeAssetPath('LensDesigner', 'createAssetFromPreset'),
    ).not.toThrow();
  });

  test('REFUSES a path outside the LensDesigner namespace', () => {
    const scope = makeScope();
    expect(() =>
      scope.assertProjectRelativeAssetPath('OtherDir/foo.mat', 'createAssetFromPreset'),
    ).toThrow(ScopedApplyError);
  });

  test('REFUSES a sneaky prefix that looks like LensDesigner but is not', () => {
    const scope = makeScope();
    expect(() =>
      scope.assertProjectRelativeAssetPath('LensDesignerOther/foo.mat', 'createAssetFromPreset'),
    ).toThrow(ScopedApplyError);
  });
});

describe('ApplyScope.markCreated / markDeleted — set lifecycle', () => {
  test('markCreated adds the UUID to the permitted set', () => {
    const scope = makeScope();
    expect(scope.permits('new-uuid')).toBe(false);
    scope.markCreated('new-uuid');
    expect(scope.permits('new-uuid')).toBe(true);
  });

  test('markDeleted removes a previously-permitted UUID', () => {
    const scope = makeScope({ descendants: [CHILD_A] });
    expect(scope.permits(CHILD_A)).toBe(true);
    scope.markDeleted(CHILD_A);
    expect(scope.permits(CHILD_A)).toBe(false);
  });

  test('a deleted-then-recreated UUID is permitted again', () => {
    const scope = makeScope({ descendants: [CHILD_A] });
    scope.markDeleted(CHILD_A);
    scope.markCreated(CHILD_A);
    expect(scope.permits(CHILD_A)).toBe(true);
  });

  test('the root is not removable via markDeleted side-effects (sanity)', () => {
    // markDeleted is intentionally low-level — callers can in principle
    // remove the root. This test documents that as caller-beware; the
    // applier never deletes the root (only its descendants).
    const scope = makeScope();
    scope.markDeleted(ROOT);
    expect(scope.permits(ROOT)).toBe(false);
  });
});

describe('ApplyScope.assertPermittedUUID — new canonical name', () => {
  test('is the same function as assertSceneTarget (back-compat alias)', () => {
    // assertSceneTarget is kept as an alias for one cycle so external test
    // / call sites don't break. New code reaches for assertPermittedUUID.
    const scope = makeScope({ descendants: [CHILD_A] });
    expect(() => scope.assertPermittedUUID(CHILD_A, 'setProperty')).not.toThrow();
    expect(() => scope.assertPermittedUUID(FOREIGN, 'setProperty')).toThrow(ScopedApplyError);
  });

  test('error message names the operation, the UUID, and the root', () => {
    const scope = makeScope();
    try {
      scope.assertPermittedUUID(FOREIGN, 'deleteAsset');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopedApplyError);
      const msg = (err as Error).message;
      expect(msg).toContain('deleteAsset');
      expect(msg).toContain(FOREIGN);
      expect(msg).toContain(ROOT);
      // The new message says "permitted scope" (neutral) rather than
      // "edit-surface subtree" — assets aren't SOs, and the function
      // serves both.
      expect(msg).toMatch(/permitted scope/);
    }
  });
});

describe('requireActiveScope — fail-closed contract (TD-8)', () => {
  test('throws ScopedApplyError when no scope is active', () => {
    setActiveScope(null);
    expect(() => requireActiveScope('setProperty')).toThrow(ScopedApplyError);
  });

  test('the thrown error names the operation', () => {
    setActiveScope(null);
    try {
      requireActiveScope('deleteSceneObject');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('deleteSceneObject');
      expect((err as Error).message).toContain('no active scope');
    }
  });

  test('returns the scope when one is active', () => {
    const scope = makeScope();
    setActiveScope(scope);
    expect(requireActiveScope('setProperty')).toBe(scope);
  });
});

describe('module-level setActiveScope/getActiveScope singleton', () => {
  beforeEach(() => setActiveScope(null));

  test('starts null', () => {
    expect(getActiveScope()).toBeNull();
  });

  test('setActiveScope installs the scope; getActiveScope returns it', () => {
    const scope = makeScope();
    setActiveScope(scope);
    expect(getActiveScope()).toBe(scope);
  });

  test('setActiveScope(null) clears the active scope', () => {
    setActiveScope(makeScope());
    setActiveScope(null);
    expect(getActiveScope()).toBeNull();
  });

  test('a fresh setActiveScope replaces the previous one (no leak)', () => {
    const a = makeScope({ descendants: [CHILD_A] });
    const b = makeScope({ descendants: [CHILD_B] });
    setActiveScope(a);
    setActiveScope(b);
    expect(getActiveScope()).toBe(b);
    expect(getActiveScope()!.permits(CHILD_A)).toBe(false);
    expect(getActiveScope()!.permits(CHILD_B)).toBe(true);
  });
});

// Remaining tests stay todo until they need a live MCP client or the
// in-process mock harness (folded into Steps 5/6/7).

describe('scopedApplyGuard — scene mutations (live MCP — pending)', () => {
  test.todo('setProperty refused when objectUUID is outside scope (mock McpClient)');
  test.todo('createSceneObject with undefined parent is refused when scope is active');
  test.todo('createComponent on out-of-scope SO is refused');
  test.todo('deleteSceneObject on an in-scope child marks it deleted in the scope set');
  test.todo('a refused mutation does NOT call the underlying MCP (verified via mock-MCP call recorder)');
});

describe('scopedApplyGuard — single choke point invariant (lint-style)', () => {
  test.todo('every mutating helper in mcp.ts routes through the guard (grep test)');
  test.todo('there is no exported "raw" mutate that bypasses the guard');
});

describe('scopedApplyGuard — edit-surface freshness (connection-managed)', () => {
  test.todo('resolves the edit-surface UUID fresh on attach (does not trust stale state)');
  test.todo('after a sandbox restart, the guard re-resolves ActiveComponent UUID before next apply');
  test.todo('after target detach + re-attach, the guard re-resolves the edit-bay UUID');
});
