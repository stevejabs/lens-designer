// bridge-context.ts — share the bridge `send` fn with deeply nested
// components (Inspector → PropertyRow → FontInput → SystemFontPicker)
// without prop-drilling. The provider lives in app/page.tsx where the
// useBridge hook already runs.

'use client';

import { createContext, useContext } from 'react';
import type { ClientToServerMsg } from '@lens-designer/bridge/client';

export type BridgeSend = (msg: ClientToServerMsg) => boolean;

/** Default no-op so consumers don't need to null-check; renders before
 *  the provider mounts just silently drop their send (the bridge isn't
 *  connected yet anyway). */
const BridgeSendContext = createContext<BridgeSend>(() => false);

export const BridgeSendProvider = BridgeSendContext.Provider;

export function useBridgeSend(): BridgeSend {
  return useContext(BridgeSendContext);
}

/** Lowercased code names of every OTHER saved view (the active view excluded),
 *  shared so the Inspector can reject a component name that collides with an
 *  existing one up front instead of letting the daemon's save reject it. Two
 *  views with the same class name = two controllers with the same class.
 *  Provided in app/page.tsx from useAttachMode. */
const OtherComponentNamesContext = createContext<readonly string[]>([]);

export const OtherComponentNamesProvider = OtherComponentNamesContext.Provider;

export function useOtherComponentNames(): readonly string[] {
  return useContext(OtherComponentNamesContext);
}
