// index.d.ts — public TS API for @lens-designer/capture-addon.
//
// Re-exports the napi-generated types from binding.d.ts (do not edit
// that file by hand) and adds the JS-side `CaptureError` class +
// `SourceId` + `CaptureErrorKind` discriminator. The full TS surface
// must mirror tools/lens-designer/bridge/test/MockCaptureAddon.ts
// (TD-15 rule 1).

export {
  Region,
  WindowBounds,
  WindowEntry,
  CaptureResult,
  PlatformCapabilities,
  getPlatformCapabilities,
  enumerateLensStudioWindows,
  pickLensStudioSource,
  captureSource,
  releaseSource,
  portToPid,
} from './binding';

/**
 * Opaque platform-specific source identifier, encoded as a string.
 * macOS: stringified CGWindowID. Windows: stringified HWND.
 * Linux/Wayland: portal session token. The bridge never parses this —
 * it only round-trips it back to `captureSource()`.
 */
export type SourceId = string;

/**
 * Typed error surface. The `kind` is platform-blind; consumers handle
 * it once and translate to per-OS remediation copy in a single table.
 */
export type CaptureErrorKind =
  | 'permission-denied'
  | 'window-not-found'
  | 'capture-failed'
  | 'capability-unsupported'
  | 'platform-unsupported';

export class CaptureError extends Error {
  readonly kind: CaptureErrorKind;
  readonly detail?: string;
  constructor(kind: CaptureErrorKind, detail?: string);
}
