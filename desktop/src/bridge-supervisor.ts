// bridge-supervisor.ts — manages the bridge utilityProcess lifecycle.
//
// Spawns the bundled bridge entrypoint (dist/bridge/bridge.mjs) via
// Electron's utilityProcess.fork(). Watches for crash, auto-restarts
// up to MAX_RESTARTS within RESTART_WINDOW_MS. Beyond that, surfaces
// a crash-loop event so main can show the design-spec'd toast (T3).
//
// The bridge speaks WS+HTTP on localhost:9229 / 9230 — exactly as it
// does in `pnpm bridge:dev`. The renderer connects to those ports
// directly; this supervisor doesn't relay messages, only lifecycle.

import { utilityProcess, type UtilityProcess } from 'electron';
import { EventEmitter } from 'node:events';

/** Maximum number of automatic restarts inside the window before declaring crash-loop. */
const MAX_RESTARTS = 3;
/** Time window for the restart counter, in ms. */
const RESTART_WINDOW_MS = 60_000;

export type BridgeState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; pid: number }
  | { kind: 'restarting'; afterCrashCount: number }
  | { kind: 'crash-loop'; lastExitCode: number | null }
  | { kind: 'stopped' };

export interface BridgeSupervisorEvents {
  /** Fired on every state transition. */
  state: (s: BridgeState) => void;
  /** Fired with raw stdout lines so main can log them. */
  log: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SupervisorOptions {
  bridgeEntryPath: string;
  /** Forwarded to the child via env. */
  env?: NodeJS.ProcessEnv;
}

export class BridgeSupervisor extends EventEmitter {
  private state: BridgeState = { kind: 'idle' };
  private child: UtilityProcess | null = null;
  private recentCrashes: number[] = []; // unix-ms timestamps
  private intentionalStop = false;

  constructor(private opts: SupervisorOptions) {
    super();
  }

  getState(): BridgeState {
    return this.state;
  }

  start(): void {
    if (this.state.kind === 'starting' || this.state.kind === 'running') return;
    this.intentionalStop = false;
    this.setState({ kind: 'starting' });
    this.spawn();
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.setState({ kind: 'stopped' });
  }

  private spawn(): void {
    const child = utilityProcess.fork(this.opts.bridgeEntryPath, [], {
      stdio: 'pipe',
      serviceName: 'lens-designer-bridge',
      env: { ...process.env, ...(this.opts.env ?? {}) },
    });
    this.child = child;

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.length > 0) this.emit('log', line, 'stdout');
        }
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.length > 0) this.emit('log', line, 'stderr');
        }
      });
    }

    child.on('spawn', () => {
      this.setState({ kind: 'running', pid: child.pid ?? -1 });
    });

    child.on('exit', (code) => {
      this.child = null;
      if (this.intentionalStop) {
        this.setState({ kind: 'stopped' });
        return;
      }

      const now = Date.now();
      this.recentCrashes = this.recentCrashes.filter((t) => now - t < RESTART_WINDOW_MS);
      this.recentCrashes.push(now);

      if (this.recentCrashes.length > MAX_RESTARTS) {
        this.setState({ kind: 'crash-loop', lastExitCode: code });
        return;
      }

      this.setState({ kind: 'restarting', afterCrashCount: this.recentCrashes.length });
      // Small backoff before respawning so a fast crash loop doesn't
      // starve the event loop. Increases with each successive crash.
      const delayMs = Math.min(2_000, 100 * this.recentCrashes.length);
      setTimeout(() => {
        if (this.intentionalStop) return;
        this.spawn();
      }, delayMs);
    });
  }

  private setState(next: BridgeState): void {
    this.state = next;
    this.emit('state', next);
  }
}

// Strongly-typed event surface for callers.
export declare interface BridgeSupervisor {
  on<K extends keyof BridgeSupervisorEvents>(event: K, listener: BridgeSupervisorEvents[K]): this;
  emit<K extends keyof BridgeSupervisorEvents>(
    event: K,
    ...args: Parameters<BridgeSupervisorEvents[K]>
  ): boolean;
}

// Exported for tests.
export const _internals = {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
};
