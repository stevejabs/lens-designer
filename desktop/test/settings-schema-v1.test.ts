// settings-schema-v1.test.ts — verify the typed wrapper + migrate
// behavior. Test plan calls this out as the schema-versioning hook;
// the test runs pure logic (no electron-store, no disk).

import { describe, test, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  migrate,
  toPublic,
} from '../src/settings.js';

describe('settings · DEFAULT_SETTINGS', () => {
  test('has the locked v1 schema version', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
  });

  test('default bridge ports match the architecture doc', () => {
    expect(DEFAULT_SETTINGS.bridge.wsPort).toBe(9229);
    expect(DEFAULT_SETTINGS.bridge.httpPort).toBe(9230);
  });

  test('sandboxPath + attachTarget start null', () => {
    expect(DEFAULT_SETTINGS.sandboxPath).toBeNull();
    expect(DEFAULT_SETTINGS.attachTarget).toBeNull();
  });

  test('bearer override starts null (auto-discover ~/.claude.json)', () => {
    expect(DEFAULT_SETTINGS.mcp.bearerOverride).toBeNull();
  });
});

describe('settings · migrate', () => {
  test('null input returns defaults', () => {
    expect(migrate(null)).toEqual(DEFAULT_SETTINGS);
  });

  test('undefined input returns defaults', () => {
    expect(migrate(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test('empty object returns defaults', () => {
    expect(migrate({})).toEqual(DEFAULT_SETTINGS);
  });

  test('partial settings merge with defaults', () => {
    const result = migrate({ sandboxPath: '/Users/steve/Documents/spectacles-sandbox' });
    expect(result.sandboxPath).toBe('/Users/steve/Documents/spectacles-sandbox');
    expect(result.bridge.wsPort).toBe(9229);
  });

  test('strips unknown keys', () => {
    const result = migrate({ unknownKey: 'should be dropped', sandboxPath: '/x' });
    expect(result).not.toHaveProperty('unknownKey');
    expect(result.sandboxPath).toBe('/x');
  });

  test('clamps invalid ports to 0 (signals "pick an ephemeral port")', () => {
    const result = migrate({ bridge: { wsPort: 80, httpPort: 100_000 } });
    expect(result.bridge.wsPort).toBe(0);
    expect(result.bridge.httpPort).toBe(0);
  });

  test('preserves a future schemaVersion untouched (forward compat)', () => {
    const result = migrate({ schemaVersion: 99 });
    expect(result.schemaVersion).toBe(99);
  });

  test('coerces non-string sandboxPath to null', () => {
    expect(migrate({ sandboxPath: 12345 as unknown as string }).sandboxPath).toBeNull();
  });

  test('preserves valid attachTarget', () => {
    const result = migrate({
      attachTarget: { esprojPath: '/x/my.esproj', assetsDir: '/x/Assets' },
    });
    expect(result.attachTarget).toEqual({
      esprojPath: '/x/my.esproj',
      assetsDir: '/x/Assets',
    });
  });
});

describe('settings · toPublic', () => {
  test('omits the bearer value', () => {
    const settings = { ...DEFAULT_SETTINGS, mcp: { bearerOverride: 'super-secret' } };
    const pub = toPublic(settings);
    expect(JSON.stringify(pub)).not.toContain('super-secret');
  });

  test('reports hasBearerOverride: true when set', () => {
    const settings = { ...DEFAULT_SETTINGS, mcp: { bearerOverride: 'x' } };
    expect(toPublic(settings).hasBearerOverride).toBe(true);
  });

  test('reports hasBearerOverride: false when null', () => {
    expect(toPublic(DEFAULT_SETTINGS).hasBearerOverride).toBe(false);
  });

  test('exposes sandboxPath as-is', () => {
    const settings = { ...DEFAULT_SETTINGS, sandboxPath: '/x' };
    expect(toPublic(settings).sandboxPath).toBe('/x');
  });
});
