// useFontSync — keeps the design store's `systemFonts` + `projectFontFiles`
// in sync with the bridge.
//
// On connect: request both lists once. The project list is the
// authoritative truth for "what fonts can the lens render right now"
// — applying it reconciles `customFonts`, dropping any entry whose
// file isn't on disk (the bug Steve hit where Impact / Arial lingered
// after the source file was swept).
//
// On `fonts.added` (success reply to add-from-system): also re-request
// the project list so the new file gets registered + the picker
// re-classifies it from "system" → "available".

import { useEffect } from 'react';
import type { ClientToServerMsg, ServerToClientMsg } from '@lens-designer/bridge/client';
import { useDesignStore } from './design-model';

export interface UseFontSyncOptions {
  connected: boolean;
  send: (msg: ClientToServerMsg) => boolean;
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void;
}

export function useFontSync({ connected, send, onMessage }: UseFontSyncOptions): void {
  const setSystemFonts = useDesignStore((s) => s.setSystemFonts);
  const setProjectFontFiles = useDesignStore((s) => s.setProjectFontFiles);
  const addCustomFont = useDesignStore((s) => s.addCustomFont);

  // Fire one round of list requests every time we (re)connect.
  useEffect(() => {
    if (!connected) return;
    send({ type: 'fonts.list-system' });
    send({ type: 'fonts.list-project' });
  }, [connected, send]);

  // Subscribe to the replies.
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === 'fonts.system-list') {
        setSystemFonts(msg.fonts);
      } else if (msg.type === 'fonts.project-list') {
        setProjectFontFiles(msg.files);
      } else if (msg.type === 'fonts.added') {
        // Register the new font in customFonts. The basename matches
        // what `fonts.list-project` will return — pre-add to
        // projectFontFiles so the new font shows up in the picker
        // without waiting for the round-trip refresh.
        const base = msg.path.split('/').pop();
        if (base) {
          useDesignStore.setState((s) => ({
            projectFontFiles: s.projectFontFiles.includes(base)
              ? s.projectFontFiles
              : [...s.projectFontFiles, base],
          }));
        }
        // Family-as-typed becomes the user-facing label; reuse the
        // same `ldfont-<hash>` CSS family token the upload flow uses
        // so the canvas's FontFace registration treats both paths the
        // same.
        const hash = msg.path.match(/font_([a-z0-9]+)\./i)?.[1] ?? 'sys';
        addCustomFont({ path: msg.path, family: `ldfont-${hash}`, name: msg.family });
        // Refresh project list so any other reconciliation that
        // depends on the authoritative set (e.g. ghost cleanup if the
        // user adds a font that was previously a ghost) lands.
        send({ type: 'fonts.list-project' });
      } else if (msg.type === 'design.gc.result' && msg.deletedFontFiles.length > 0) {
        // GC just swept files — re-pull the project list so the picker
        // reflects reality immediately (without waiting for the next
        // attach).
        send({ type: 'fonts.list-project' });
      }
    });
  }, [onMessage, send, setSystemFonts, setProjectFontFiles, addCustomFont]);
}
