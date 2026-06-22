'use client';

import { useEffect, useMemo, useState } from 'react';
import { BridgeClient, defaultBridgeUrl, type ConnectionState } from './bridge-client';
import type { ServerToClientMsg, ClientToServerMsg } from '@lens-designer/bridge/client';

export interface UseBridgeResult {
  state: ConnectionState;
  send: (msg: ClientToServerMsg) => boolean;
  /** Subscribe to any server-to-client message; returns an unsubscribe fn. */
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void;
}

export function useBridge(): UseBridgeResult {
  const client = useMemo(() => new BridgeClient({ url: defaultBridgeUrl() }), []);
  const [state, setState] = useState<ConnectionState>(client.getState());

  useEffect(() => {
    const off = client.onState(setState);
    client.start();
    return () => {
      off();
      client.stop();
    };
  }, [client]);

  return useMemo(
    () => ({
      state,
      send: (msg) => client.send(msg),
      onMessage: (fn) => client.onMessage(fn),
    }),
    [client, state],
  );
}
