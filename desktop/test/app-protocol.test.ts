// app-protocol.test.ts — verify the CSP shape + path-traversal guard.
//
// The protocol handler itself is Electron-runtime-bound; we don't
// stand up Electron in vitest. We test the pure-logic edges
// (CSP locked down, path traversal rejected) via the exposed
// internals.

import { describe, test, expect } from 'vitest';
import { _internals } from '../src/app-protocol.js';

describe('app:// protocol · CSP', () => {
  test('locks default-src to self + app:', () => {
    expect(_internals.DEFAULT_CSP).toContain("default-src 'self' app:");
  });

  test('allows ws + http on loopback for bridge', () => {
    expect(_internals.DEFAULT_CSP).toContain('connect-src');
    expect(_internals.DEFAULT_CSP).toContain('ws://127.0.0.1:*');
    expect(_internals.DEFAULT_CSP).toContain('http://127.0.0.1:*');
  });

  test('forbids frame-ancestors', () => {
    expect(_internals.DEFAULT_CSP).toContain("frame-ancestors 'none'");
  });

  test('forbids form-action', () => {
    expect(_internals.DEFAULT_CSP).toContain("form-action 'none'");
  });

  test('does NOT allow unsafe-eval anywhere', () => {
    expect(_internals.DEFAULT_CSP).not.toContain('unsafe-eval');
  });

  test('does NOT allow remote http/https hosts in connect-src', () => {
    // We allow ONLY loopback. A bug that opens connect-src to
    // arbitrary remotes is the kind of thing this test catches.
    const connectSrc = _internals.DEFAULT_CSP
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('connect-src')) ?? '';
    expect(connectSrc).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(connectSrc).not.toContain('*.com');
  });
});
