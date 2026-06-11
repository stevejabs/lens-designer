// MockCaptureAddon.ts
//
// THE ONE MOCK. Any new bridge test that needs the capture addon imports
// this. Do NOT fork it per-platform. Do NOT inline a smaller mock in a
// test file — the whole point of TD-15 rule 8 is that a single mock
// shape works for every platform, today and tomorrow.
//
// Locked by docs/testing/2026-05-27-lens-designer-standalone-app-test-plan.md.
//
// When the capture-addon workspace lands at Phase-1 Step 1, swap the
// inline types below for imports from `@lens-designer/capture-addon`.

// ----------- Addon types (mirror capture-addon/index.d.ts) -----------
// TODO(step-1): replace with `import type { … } from '@lens-designer/capture-addon';`

export type SourceId = string;

export interface WindowEntry {
  id: SourceId;
  pid: number;
  ownerName: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  onscreen: boolean;
}

export interface Region {
  x: number; y: number; width: number; height: number;
}

export interface CaptureResult {
  png: Buffer;
  width: number;
  height: number;
  capturedAtMs: number;
}

export interface PlatformCapabilities {
  canEnumerate: boolean;
  requiresInteractivePick: boolean;
  requiresPermissionGrant: boolean;
  hasStatefulCaptureSession: boolean;
}

export type CaptureErrorKind =
  | 'permission-denied'
  | 'window-not-found'
  | 'capture-failed'
  | 'capability-unsupported'
  | 'platform-unsupported';

export class CaptureError extends Error {
  constructor(public kind: CaptureErrorKind, public detail?: string) {
    super(`CaptureError: ${kind}${detail ? ` (${detail})` : ''}`);
  }
}

// ----------- The mock -----------

export interface MockCaptureAddon {
  getPlatformCapabilities(): PlatformCapabilities;
  enumerateLensStudioWindows(): WindowEntry[];
  pickLensStudioSource(): Promise<WindowEntry | null>;
  captureSource(id: SourceId, region: Region): Promise<CaptureResult>;
  releaseSource(id: SourceId): void;
  portToPid(port: number): number | null;

  __setCapabilities(c: PlatformCapabilities): void;
  __setWindows(entries: WindowEntry[]): void;
  __setCaptureResult(result: CaptureResult): void;
  __setCaptureError(error: CaptureErrorKind, detail?: string): void;
  __setPortMap(map: Record<number, number | null>): void;
  __reset(): void;

  readonly capturedCalls: ReadonlyArray<{ id: SourceId; region: Region }>;
  readonly releasedIds: ReadonlyArray<SourceId>;
}

const DEFAULT_CAPABILITIES: PlatformCapabilities = {
  canEnumerate: true,
  requiresInteractivePick: false,
  requiresPermissionGrant: true,
  hasStatefulCaptureSession: false,
};

const ONE_PIXEL_PNG: Buffer = Buffer.from(
  // 1×1 transparent PNG, deterministic for tests
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636400010000000500010d0a2db40000000049454e44ae426082',
  'hex',
);

const DEFAULT_RESULT: CaptureResult = {
  png: ONE_PIXEL_PNG,
  width: 1,
  height: 1,
  capturedAtMs: 0,
};

/**
 * Create the one mock. All behavior is configurable via __set… helpers;
 * the mock body has zero `process.platform` branches by design.
 */
export function createMockCaptureAddon(
  overrides: Partial<PlatformCapabilities> = {},
): MockCaptureAddon {
  let capabilities: PlatformCapabilities = { ...DEFAULT_CAPABILITIES, ...overrides };
  let windows: WindowEntry[] = [];
  let captureResult: CaptureResult = DEFAULT_RESULT;
  let captureError: { kind: CaptureErrorKind; detail?: string | undefined } | null = null;
  let portMap: Record<number, number | null> = {};
  const capturedCalls: Array<{ id: SourceId; region: Region }> = [];
  const releasedIds: SourceId[] = [];

  return {
    getPlatformCapabilities: () => capabilities,
    enumerateLensStudioWindows: () => (capabilities.canEnumerate ? [...windows] : []),
    pickLensStudioSource: async () => {
      if (captureError) throw new CaptureError(captureError.kind, captureError.detail);
      if (capabilities.requiresInteractivePick) return windows[0] ?? null;
      return windows[0] ?? null;
    },
    captureSource: async (id, region) => {
      capturedCalls.push({ id, region });
      if (captureError) throw new CaptureError(captureError.kind, captureError.detail);
      return captureResult;
    },
    releaseSource: (id) => {
      releasedIds.push(id);
    },
    portToPid: (port) => (port in portMap ? portMap[port] ?? null : null),

    __setCapabilities: (c) => { capabilities = c; },
    __setWindows: (entries) => { windows = entries; },
    __setCaptureResult: (result) => { captureResult = result; captureError = null; },
    __setCaptureError: (kind, detail) => { captureError = { kind, detail }; },
    __setPortMap: (map) => { portMap = map; },
    __reset: () => {
      capabilities = { ...DEFAULT_CAPABILITIES };
      windows = [];
      captureResult = DEFAULT_RESULT;
      captureError = null;
      portMap = {};
      capturedCalls.length = 0;
      releasedIds.length = 0;
    },

    get capturedCalls() { return capturedCalls; },
    get releasedIds() { return releasedIds; },
  };
}

/** A canonical LS window entry for tests that just need *some* window. */
export const FAKE_LS_WINDOW: WindowEntry = {
  id: '267',
  pid: 71234,
  ownerName: 'Lens Studio',
  title: 'sandbox - Lens Studio v5.15.4.26022322',
  bounds: { x: 60, y: 44, width: 1728, height: 1102 },
  onscreen: true,
};

/** A canonical preview-pane region. Mirrors the spike-validated default. */
export const FAKE_PREVIEW_REGION: Region = {
  x: 720, y: 80, width: 600, height: 800,
};
