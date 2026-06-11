// index.js — thin wrapper around the napi-generated binding.js.
// Adds the typed `CaptureError` class and parses the Rust-side JSON
// payload that Rust packs into napi error messages.
//
// The generated binding.js is the per-platform dispatcher; it picks
// the right `.node` file and re-exports the napi symbols. Do not edit
// binding.js by hand.

const native = require('./binding.js');

/**
 * Typed capture error. Mirrors the locked TS shape in
 * bridge/test/MockCaptureAddon.ts so consumers handle both real and
 * mock the same way. The `kind` discriminator drives all per-OS
 * remediation copy in a single translation table (TD-15 rule 4).
 */
class CaptureError extends Error {
  constructor(kind, detail) {
    super(detail ? `CaptureError: ${kind} (${detail})` : `CaptureError: ${kind}`);
    this.name = 'CaptureError';
    this.kind = kind;
    if (detail !== undefined) this.detail = detail;
  }
}

function reThrow(err) {
  // The Rust side packs a JSON payload into the napi error message.
  // Parse it back to a typed CaptureError; on parse failure, fall back
  // to a generic capture-failed so callers always see the same shape.
  const message = typeof err?.message === 'string' ? err.message : '';
  try {
    const payload = JSON.parse(message);
    if (payload && typeof payload.kind === 'string') {
      throw new CaptureError(payload.kind, payload.detail);
    }
  } catch (parseErr) {
    if (parseErr instanceof CaptureError) throw parseErr;
    // fall through to generic
  }
  throw new CaptureError('capture-failed', message || 'unknown error');
}

function wrapSync(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      reThrow(err);
    }
  };
}

function wrapAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      reThrow(err);
    }
  };
}

// Explicit named exports written one-per-line so Node's
// cjs-module-lexer (used to expose CJS modules' named exports to ESM
// consumers) reliably detects every symbol. An object-literal RHS
// with computed values breaks lexer detection on Node 20.
module.exports.getPlatformCapabilities = native.getPlatformCapabilities;
module.exports.enumerateLensStudioWindows = wrapSync(native.enumerateLensStudioWindows);
module.exports.pickLensStudioSource = wrapAsync(native.pickLensStudioSource);
module.exports.captureSource = wrapAsync(native.captureSource);
module.exports.releaseSource = native.releaseSource;
module.exports.portToPid = native.portToPid;
module.exports.CaptureError = CaptureError;
