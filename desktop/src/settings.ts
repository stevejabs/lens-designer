// settings.ts — typed wrapper around electron-store for app settings.
//
// Schema mirrors architecture doc §6. All paths use kebab-case (per
// design spec). Schema is versioned so future migrations can hook in.
//
// Renderer never touches this directly — main owns reads/writes and
// exposes a narrow slice via preload (window.lensDesignerNative.settings).
//
// electron-store v10 is ESM-only; main is bundled as CJS for Electron
// loader compatibility. init() uses a dynamic import to bridge the
// two — sync read/update work as expected post-init.

// Lazy type import; never actually loaded at runtime via `require`.
import type Store from 'electron-store';

export const SETTINGS_SCHEMA_VERSION = 1;

export interface Settings {
  schemaVersion: number;
  /** Absolute path to the sandbox project directory, or null if not created. */
  sandboxPath: string | null;
  /** Attach-mode target (an existing user project), or null. */
  attachTarget: {
    esprojPath: string;
    assetsDir: string;
  } | null;
  bridge: {
    wsPort: number;
    httpPort: number;
  };
  mcp: {
    /** Override the auto-discovered LS MCP bearer. null = auto-discover from ~/.claude.json. */
    bearerOverride: string | null;
  };
  windowState: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
    maximized: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  sandboxPath: null,
  attachTarget: null,
  bridge: {
    wsPort: 9229,
    httpPort: 9230,
  },
  mcp: {
    bearerOverride: null,
  },
  windowState: {
    width: 1440,
    height: 900,
    x: null,
    y: null,
    maximized: false,
  },
};

/**
 * Subset of settings that the renderer is allowed to read. The bearer
 * is deliberately NOT exposed — the renderer never needs the raw value.
 */
export interface PublicSettings {
  sandboxPath: string | null;
  attachTarget: Settings['attachTarget'];
  bridge: Settings['bridge'];
  windowState: Settings['windowState'];
  /** Whether a bearer override is in effect, without leaking the value. */
  hasBearerOverride: boolean;
}

export function toPublic(s: Settings): PublicSettings {
  return {
    sandboxPath: s.sandboxPath,
    attachTarget: s.attachTarget,
    bridge: s.bridge,
    windowState: s.windowState,
    hasBearerOverride: s.mcp.bearerOverride !== null,
  };
}

/**
 * Validate + migrate a raw object read from disk. Unknown keys are
 * dropped; missing keys are filled from DEFAULT_SETTINGS; future
 * schemaVersion values are preserved as-is (forward compat).
 */
export function migrate(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = raw as Partial<Settings>;
  const merged: Settings = {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : SETTINGS_SCHEMA_VERSION,
    sandboxPath:
      typeof obj.sandboxPath === 'string' || obj.sandboxPath === null
        ? obj.sandboxPath
        : null,
    attachTarget:
      obj.attachTarget && typeof obj.attachTarget === 'object'
        ? {
            esprojPath: String(obj.attachTarget.esprojPath ?? ''),
            assetsDir: String(obj.attachTarget.assetsDir ?? ''),
          }
        : null,
    bridge: {
      wsPort: clampPort(obj.bridge?.wsPort ?? DEFAULT_SETTINGS.bridge.wsPort),
      httpPort: clampPort(obj.bridge?.httpPort ?? DEFAULT_SETTINGS.bridge.httpPort),
    },
    mcp: {
      bearerOverride:
        typeof obj.mcp?.bearerOverride === 'string' && obj.mcp.bearerOverride.length > 0
          ? obj.mcp.bearerOverride
          : null,
    },
    windowState: {
      width: clampPositive(obj.windowState?.width ?? DEFAULT_SETTINGS.windowState.width, 320),
      height: clampPositive(obj.windowState?.height ?? DEFAULT_SETTINGS.windowState.height, 240),
      x: typeof obj.windowState?.x === 'number' ? obj.windowState.x : null,
      y: typeof obj.windowState?.y === 'number' ? obj.windowState.y : null,
      maximized: Boolean(obj.windowState?.maximized),
    },
  };
  return merged;
}

function clampPort(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const int = Math.trunc(n);
  if (int < 1024 || int > 65_535) return 0;
  return int;
}

function clampPositive(n: number, min: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.trunc(n));
}

/** Singleton store. Wraps electron-store with migrate-on-read. */
export class SettingsStore {
  private store: Store<Settings> | null = null;

  async init(): Promise<void> {
    // electron-store@10 is ESM-only. Bridge to our CJS bundle via
    // dynamic import. Node 22 + Electron 28+ both support this pattern.
    const mod = (await import('electron-store')) as unknown as {
      default: new (opts: { name: string; defaults: Settings }) => Store<Settings>;
    };
    const Ctor = mod.default;
    this.store = new Ctor({
      name: 'settings',
      defaults: { ...DEFAULT_SETTINGS },
    });
    // Read once + migrate + write back so we never have a stale shape.
    const current = this.store.store;
    const migrated = migrate(current);
    if (JSON.stringify(current) !== JSON.stringify(migrated)) {
      this.store.store = migrated;
    }
  }

  read(): Settings {
    if (!this.store) throw new Error('SettingsStore not initialized');
    return migrate(this.store.store);
  }

  update(patch: Partial<Settings>): Settings {
    if (!this.store) throw new Error('SettingsStore not initialized');
    const current = this.read();
    const next: Settings = { ...current, ...patch };
    this.store.store = next;
    return next;
  }

  patchWindowState(patch: Partial<Settings['windowState']>): void {
    const current = this.read();
    this.update({ windowState: { ...current.windowState, ...patch } });
  }

  patchBridge(patch: Partial<Settings['bridge']>): void {
    const current = this.read();
    this.update({ bridge: { ...current.bridge, ...patch } });
  }
}
