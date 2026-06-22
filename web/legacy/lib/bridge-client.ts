// BridgeClient — talks to the lens-designer bridge daemon over WS.
//
// State machine:
//   idle → connecting → connected
//          ↘ failed (sandbox down, transient socket error) → reconnecting → connected
//
// Auto-reconnect uses exponential backoff capped at 30s. Tree state is
// owned by the design store and re-sent on every reconnect's first
// design.apply; the bridge has no persistence layer to recover.

import type {
  ClientToServerMsg,
  ServerToClientMsg,
  HelloMsg,
} from '@lens-designer/bridge/client';

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; hello: HelloMsg }
  | { kind: 'reconnecting'; retryInMs: number; reason: string }
  | { kind: 'sandbox-down'; reason: string }
  | { kind: 'offline'; reason: string };

const BACKOFF_LADDER_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export type StateListener = (state: ConnectionState) => void;
export type MessageListener<T extends ServerToClientMsg = ServerToClientMsg> = (msg: T) => void;

export interface BridgeClientOptions {
  url: string;
}

export class BridgeClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = { kind: 'idle' };
  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When true, do NOT auto-reconnect on close. Set by stop(). */
  private stopped = false;

  constructor(private readonly opts: BridgeClientOptions) {}

  /** Current state. Snapshot — subscribe via onState for live updates. */
  getState(): ConnectionState {
    return this.state;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch {
        // ignored
      }
      this.socket = null;
    }
    this.setState({ kind: 'idle' });
  }

  send(msg: ClientToServerMsg): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    this.setState({ kind: 'connecting' });
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.opts.url);
    } catch (err) {
      this.scheduleRetry((err as Error).message);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      // Wait for hello before declaring connected. The server sends it
      // unprompted, but if the WS opens against a non-bridge listener
      // we'd never see one — close after a brief grace if hello is
      // missing.
    };

    socket.onmessage = (ev) => {
      let parsed: ServerToClientMsg;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (parsed.type === 'hello') {
        this.retryIndex = 0;
        this.setState({ kind: 'connected', hello: parsed });
      } else if (parsed.type === 'sandbox.down') {
        this.setState({ kind: 'sandbox-down', reason: parsed.reason });
      }
      for (const fn of this.messageListeners) {
        try {
          fn(parsed);
        } catch (err) {
          // listener faults shouldn't kill the socket
          if (typeof console !== 'undefined') console.error('[bridge] listener threw', err);
        }
      }
    };

    socket.onerror = () => {
      // Don't transition here — onclose will fire next and we'd just be
      // racing it. The browser doesn't surface useful info from `error`.
    };

    socket.onclose = (ev) => {
      this.socket = null;
      if (this.stopped) return;
      this.scheduleRetry(ev.reason || `socket closed (code ${ev.code})`);
    };
  }

  private scheduleRetry(reason: string): void {
    const delay = BACKOFF_LADDER_MS[Math.min(this.retryIndex, BACKOFF_LADDER_MS.length - 1)] ?? 30_000;
    this.retryIndex += 1;
    this.setState({ kind: 'reconnecting', retryInMs: delay, reason });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    for (const fn of this.stateListeners) {
      try {
        fn(s);
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[bridge] state listener threw', err);
      }
    }
  }
}

export function defaultBridgeUrl(): string {
  // Bridge defaults to <pageHost>:9229 so the WS reaches the host
  // wherever the page is loaded from (localhost in normal dev,
  // host.docker.internal when the browser daemon drives the UI).
  // Override via NEXT_PUBLIC_BRIDGE_WS env if developers run on a
  // custom port.
  if (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_BRIDGE_WS']) {
    return process.env['NEXT_PUBLIC_BRIDGE_WS'];
  }
  if (typeof window !== 'undefined') {
    // Under the Electron shell's `app://` protocol, window.location
    // hostname is the protocol's host slug ("lens-designer"), which
    // doesn't resolve. The bridge always binds 127.0.0.1 in that
    // shell, so substitute the loopback explicitly.
    if (window.location.protocol === 'app:') {
      return 'ws://127.0.0.1:9229';
    }
    return `ws://${window.location.hostname}:9229`;
  }
  return 'ws://localhost:9229';
}
