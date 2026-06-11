// binding-shape.test.ts — verify the addon's public surface matches
// the locked TS API (TD-15 rule 1). This test runs anywhere — it only
// checks names + types, not platform behavior.

import { describe, test, expect } from 'vitest';
import * as addon from '../index.js';

describe('@lens-designer/capture-addon · public surface', () => {
  test('exports all locked functions', () => {
    expect(typeof addon.getPlatformCapabilities).toBe('function');
    expect(typeof addon.enumerateLensStudioWindows).toBe('function');
    expect(typeof addon.pickLensStudioSource).toBe('function');
    expect(typeof addon.captureSource).toBe('function');
    expect(typeof addon.releaseSource).toBe('function');
    expect(typeof addon.portToPid).toBe('function');
  });

  test('exports CaptureError class', () => {
    expect(typeof addon.CaptureError).toBe('function');
    const err = new addon.CaptureError('window-not-found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CaptureError');
    expect(err.kind).toBe('window-not-found');
    expect(err.detail).toBeUndefined();
  });

  test('CaptureError carries detail when provided', () => {
    const err = new addon.CaptureError('capture-failed', 'GPU error');
    expect(err.kind).toBe('capture-failed');
    expect(err.detail).toBe('GPU error');
    expect(err.message).toContain('capture-failed');
    expect(err.message).toContain('GPU error');
  });
});

describe('@lens-designer/capture-addon · getPlatformCapabilities', () => {
  test('returns a PlatformCapabilities-shaped object on the host', () => {
    const caps = addon.getPlatformCapabilities();
    expect(typeof caps.canEnumerate).toBe('boolean');
    expect(typeof caps.requiresInteractivePick).toBe('boolean');
    expect(typeof caps.requiresPermissionGrant).toBe('boolean');
    expect(typeof caps.hasStatefulCaptureSession).toBe('boolean');
  });
});

describe.skipIf(process.platform !== 'darwin')('@lens-designer/capture-addon · macOS host', () => {
  test('capabilities match the locked macOS shape', () => {
    const caps = addon.getPlatformCapabilities();
    expect(caps.canEnumerate).toBe(true);
    expect(caps.requiresInteractivePick).toBe(false);
    expect(caps.requiresPermissionGrant).toBe(true);
    expect(caps.hasStatefulCaptureSession).toBe(false);
  });

  test('enumerateLensStudioWindows returns an array', () => {
    const result = addon.enumerateLensStudioWindows();
    expect(Array.isArray(result)).toBe(true);
  });

  test('portToPid returns null for a free port', () => {
    // Pick a port well outside common ranges to reduce flakiness.
    expect(addon.portToPid(63421)).toBeNull();
  });

  test('captureSource throws a typed CaptureError when given an unknown source id', async () => {
    await expect(
      addon.captureSource('not-a-real-window', { x: 0, y: 0, width: 1, height: 1 }),
    ).rejects.toMatchObject({
      name: 'CaptureError',
      // Step 1 stub returns `capture-failed`; Step 3 will tighten this to `window-not-found`.
      kind: expect.stringMatching(/^(capture-failed|window-not-found)$/),
    });
  });
});

describe.skipIf(process.platform !== 'win32')('@lens-designer/capture-addon · Windows host', () => {
  test('stub returns platform-unsupported for enumerate', () => {
    expect(() => addon.enumerateLensStudioWindows()).toThrow(/platform-unsupported/);
  });
});

describe.skipIf(process.platform !== 'linux')('@lens-designer/capture-addon · Linux host', () => {
  test('stub returns platform-unsupported for enumerate', () => {
    expect(() => addon.enumerateLensStudioWindows()).toThrow(/platform-unsupported/);
  });
});
