'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useBridge } from '@/lib/use-bridge';
import { useAutoSync } from '@/lib/use-auto-sync';
import { useAutoSaveView } from '@/lib/use-auto-save-view';
import { useAttachMode } from '@/lib/use-attach-mode';
import { useFontSync } from '@/lib/use-font-sync';
import { BridgeSendProvider, OtherComponentNamesProvider } from '@/lib/bridge-context';
import { TargetChip } from '@/components/TargetChip';
import { ViewsPanel } from '@/components/ViewsPanel';
import { Palette } from '@/components/Palette';
import { Canvas } from '@/components/Canvas';
import { Inspector } from '@/components/Inspector';
import { Layers } from '@/components/Layers';
import { Preview } from '@/components/Preview';
import { useDesignStore } from '@/lib/design-model';
import { Shapes, Undo2, Redo2, Pencil, Play } from 'lucide-react';
import { FirstLaunchEmptyState } from '@/components/empty-state/FirstLaunchEmptyState';
import { CreateSandboxModal } from '@/components/sandbox/CreateSandboxModal';
import { ErrorToasts } from '@/components/toast/ErrorToasts';
import { isElectronHost, type PublicSettings } from '@/lib/native';

export default function Page() {
  const { state, send, onMessage } = useBridge();
  useAutoSync({ connected: state.kind === 'connected', send });
  const connected = state.kind === 'connected';
  const attach = useAttachMode(send, onMessage);
  const previewDistance = useDesignStore((s) => s.previewDistance);

  const activeViewName =
    attach.views.find((v) => v.id === attach.activeViewId)?.name ?? null;

  // Code names of every OTHER view (active excluded) — the Inspector rejects a
  // component name that collides with one of these.
  const otherComponentNames = useMemo(
    () =>
      attach.views
        .filter((v) => v.id !== attach.activeViewId)
        .map((v) => v.codeName.toLowerCase()),
    [attach.views, attach.activeViewId],
  );

  // Continuous autosave to the bridge registry. Removes the "Save"
  // button as a data-safety mechanism — every change is durable within
  // ~800 ms. Explicit Save still exists for naming new views.
  useAutoSaveView({ connected, views: attach.views, send });

  // Keep systemFonts + projectFontFiles in lockstep with the bridge;
  // also reconciles ghost customFonts (files that disappeared without
  // the picker noticing) on every connect.
  useFontSync({ connected, send, onMessage });

  // Sync the user's preferred preview distance to the bridge whenever
  // it changes or whenever we (re)connect. Bridge clamps + persists in
  // its own module state; ActiveComponent is repositioned immediately
  // so the live preview reflects the change on the next tick.
  useEffect(() => {
    if (!connected) return;
    send({ type: 'preview.set-distance', cm: previewDistance });
  }, [connected, previewDistance, send]);

  // First-launch routing. Only active under the Electron shell.
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false);
  // True for ~30s after a Create-sandbox success: drives the
  // background "wait for LS to come online + auto-attach" effect.
  const [awaitingSandbox, setAwaitingSandbox] = useState(false);

  useEffect(() => {
    if (!isElectronHost()) {
      setSettingsLoaded(true);
      return;
    }
    void window.lensDesignerNative!.settings.read().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
    });
  }, []);

  // Show the first-launch empty state whenever the bridge isn't
  // attached to a Lens Studio target. `state.kind === 'connected'` only
  // tells us the renderer↔bridge WS is up; it stays `connected` even
  // when LS is closed. The actual LS-reachable signal lives in
  // useAttachMode.
  // Skipped in browser dev mode (no Electron preload) so the existing
  // `pnpm web dev` workflow keeps working.
  const showEmptyState =
    settingsLoaded && isElectronHost() && attach.attach.kind !== 'attached';

  const handleSandboxCreated = (result: {
    sandboxPath: string;
    esprojPath: string;
  }): void => {
    setSandboxModalOpen(false);
    setSettings((prev) =>
      prev ? { ...prev, sandboxPath: result.sandboxPath } : prev,
    );
    // Kick off the auto-attach polling: LS is spinning up in another
    // process; the bridge needs a few seconds before it can see the
    // marker SO. The effect below polls the bridge's instance list +
    // attaches the moment a sandbox-marker target appears.
    setAwaitingSandbox(true);
  };

  // Auto-attach to the new sandbox after Create-sandbox. Polls every
  // 2 s for up to 30 s. Bails on successful attach or timeout.
  useEffect(() => {
    if (!awaitingSandbox) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 15; // ~30 s

    function pollTick(): void {
      if (cancelled) return;
      if (attach.attach.kind === 'attached') {
        setAwaitingSandbox(false);
        return;
      }
      // Look for a sandbox-marker instance in the picker's known list.
      const sandboxTarget = attach.picker.instances.find((t) => t.hasMarker);
      if (sandboxTarget) {
        attach.attachTo(sandboxTarget.port, 'sandbox');
        setAwaitingSandbox(false);
        return;
      }
      // No instance yet. Refresh the list + re-poll.
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        setAwaitingSandbox(false);
        return;
      }
      attach.rescan();
    }

    // Fire immediately + then on an interval.
    pollTick();
    const id = setInterval(pollTick, 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [awaitingSandbox, attach]);

  if (showEmptyState) {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-0 text-text-primary">
        <header className="h-12 flex items-center justify-between px-4 bg-bg-1 border-b border-border-subtle">
          <div className="flex items-center gap-2.5">
            <span
              className="w-6 h-6 rounded-md bg-accent-500 flex items-center justify-center shadow-sm"
              aria-hidden
            >
              <Shapes size={14} strokeWidth={2.25} className="text-white" />
            </span>
            <span className="font-semibold text-sm tracking-tight">Lens Designer</span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-[11px] font-num text-text-tertiary"
              title="ws-state · attach-state · instance count"
            >
              ws:{state.kind} · attach:{attach.attach.kind} · n=
              {attach.picker.instances.length}
            </span>
            {/* TargetChip mounted here so its picker dropdown has an
                anchor when the user clicks "Attach to a project". */}
            <TargetChip state={state} attach={attach} />
          </div>
        </header>
        <FirstLaunchEmptyState
          onAttach={() => attach.openPicker()}
          onCreateSandbox={() => setSandboxModalOpen(true)}
          onLocateSandbox={() => {
            // eslint-disable-next-line no-alert
            alert('"I already have one" lands with the Settings dialog (Step 11b).');
          }}
        />
        {awaitingSandbox && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-lg bg-bg-2 border border-border-default text-text-secondary text-[12.5px] shadow-2xl flex items-center gap-2.5"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-accent-400 animate-pulse" />
            Waiting for Lens Studio to come online…
          </div>
        )}
        <CreateSandboxModal
          open={sandboxModalOpen}
          onClose={() => setSandboxModalOpen(false)}
          onCreated={handleSandboxCreated}
        />
        <ErrorToasts onMessage={onMessage} />
      </div>
    );
  }

  return (
    <BridgeSendProvider value={send}>
    <OtherComponentNamesProvider value={otherComponentNames}>
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-bg-0 text-text-primary">
      <Header
        state={state}
        connected={connected}
        send={send}
        onMessage={onMessage}
        attach={attach}
        activeViewName={activeViewName}
      />
      <main
        className="flex-1 min-h-0 grid"
        style={{ gridTemplateColumns: '240px 1fr 1fr 320px', gridTemplateRows: 'minmax(0, 1fr)' }}
      >
        <LeftRail
          attach={attach}
          onCreateSandbox={() => setSandboxModalOpen(true)}
          hasActiveView={attach.activeViewId !== null}
        />
        <Canvas
          hasActiveView={attach.activeViewId !== null}
          hasAnyViews={attach.views.length > 0}
          connected={connected}
        />
        <Preview onMessage={onMessage} send={send} connected={connected} />
        <RightRail send={send} onMessage={onMessage} connected={connected} />
      </main>
      <CreateSandboxModal
        open={sandboxModalOpen}
        onClose={() => setSandboxModalOpen(false)}
        onCreated={handleSandboxCreated}
      />
      <ErrorToasts onMessage={onMessage} />
    </div>
    </OtherComponentNamesProvider>
    </BridgeSendProvider>
  );
}

interface HeaderProps {
  state: ReturnType<typeof useBridge>['state'];
  connected: boolean;
  send: ReturnType<typeof useBridge>['send'];
  onMessage: ReturnType<typeof useBridge>['onMessage'];
  attach: ReturnType<typeof useAttachMode>;
  activeViewName: string | null;
}

function Header({ state, connected, send, onMessage, attach, activeViewName }: HeaderProps) {
  const undo = useDesignStore((s) => s.undo);
  const redo = useDesignStore((s) => s.redo);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);

  const toolBtn =
    'w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-3 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-secondary';

  return (
    <header className="h-12 flex items-center justify-between px-4 bg-bg-1 border-b border-border-subtle">
      <div className="flex items-center gap-2.5">
        <span
          className="w-6 h-6 rounded-md bg-accent-500 flex items-center justify-center shadow-sm"
          aria-hidden
        >
          <Shapes size={14} strokeWidth={2.25} className="text-white" />
        </span>
        <span className="font-semibold text-sm tracking-tight">Lens Designer</span>
        <span className="text-text-tertiary text-sm">/</span>
        <span className="text-text-secondary text-sm flex items-center gap-1.5">
          {activeViewName ?? 'untitled'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {attach.attach.kind === 'attached' && attach.attach.attachment.kind === 'attached' && (
          <button
            type="button"
            onClick={() => attach.setDesignerMode(!attach.designing)}
            title={
              attach.designing
                ? 'Switch to Run mode — hides the edit bay, shows your app content, and pauses the designer’s scene updates so you can run the lens in Lens Studio. Edits keep autosaving.'
                : 'Back to Design mode — shows the edit bay, hides app content, and resumes live scene updates.'
            }
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium border transition-colors ${
              attach.designing
                ? 'text-text-secondary border-border-default hover:bg-bg-3 hover:text-text-primary'
                : 'text-amber-300 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
            }`}
          >
            {attach.designing ? <Pencil size={12} /> : <Play size={12} />}
            {attach.designing ? 'Designing' : 'Running'}
          </button>
        )}
        <TargetChip state={state} attach={attach} />
        <div className="w-px h-5 bg-border-subtle mx-0.5" aria-hidden />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className={toolBtn}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
            className={toolBtn}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ---- Left rail ----
// Views (top, fills) + Primitives (bottom, resizable). Mirrors the right
// rail's Inspector / Layers drag pattern — Steve called out the parity in
// the design feedback. Primitives default to ~280px (height of the six
// palette rows); persisted to localStorage.

const PRIMITIVES_MIN = 100;
const PRIMITIVES_KEY = 'ld:primitivesHeight';

interface LeftRailProps {
  attach: ReturnType<typeof useAttachMode>;
  onCreateSandbox: () => void;
  hasActiveView: boolean;
}
function LeftRail({ attach, onCreateSandbox, hasActiveView }: LeftRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const [primitivesH, setPrimitivesH] = useState(280);
  const hRef = useRef(280);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(PRIMITIVES_KEY));
    const h = saved > 0 ? saved : 280;
    hRef.current = h;
    setPrimitivesH(h);
  }, []);

  useEffect(() => {
    function move(e: PointerEvent) {
      if (!dragging.current || !railRef.current) return;
      e.preventDefault();
      const rect = railRef.current.getBoundingClientRect();
      const h = Math.min(Math.max(rect.bottom - e.clientY, PRIMITIVES_MIN), rect.height - PRIMITIVES_MIN);
      hRef.current = h;
      setPrimitivesH(h);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
      localStorage.setItem(PRIMITIVES_KEY, String(hRef.current));
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = 'none';
  }

  return (
    <aside
      ref={railRef}
      className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-1 border-r border-border-subtle"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ViewsPanel attach={attach} onCreateSandbox={onCreateSandbox} />
      </div>
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="h-1.5 shrink-0 cursor-row-resize border-y border-border-subtle bg-bg-1 hover:bg-accent-500/40 active:bg-accent-500/60 transition-colors"
      />
      <div style={{ height: primitivesH }} className="shrink-0 overflow-y-auto">
        <Palette hasActiveView={hasActiveView} attach={attach} />
      </div>
    </aside>
  );
}

const LAYERS_MIN = 90;
const LAYERS_KEY = 'ld:layersHeight';

interface RightRailProps {
  send: ReturnType<typeof useBridge>['send'];
  onMessage: ReturnType<typeof useBridge>['onMessage'];
  connected: boolean;
}

// Inspector (top, fills) + Layers (bottom, resizable). Layers defaults to a
// quarter of the column height; the divider between them is draggable and the
// height is persisted to localStorage.
function RightRail({ send, onMessage, connected }: RightRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const [layersH, setLayersH] = useState(220);
  const hRef = useRef(220);
  const dragging = useRef(false);
  const treeLen = useDesignStore((s) => s.tree.length);
  const resetStore = useDesignStore((s) => s.reset);
  const tree = useDesignStore((s) => s.tree);
  const customFonts = useDesignStore((s) => s.customFonts);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [gcing, setGcing] = useState(false);

  // Drop the "clearing…" indicator when the bridge confirms or errors out.
  useEffect(() => {
    if (!clearing) return;
    return onMessage((msg) => {
      if (msg.type === 'design.cleared' || msg.type === 'design.error') {
        setClearing(false);
      }
    });
  }, [clearing, onMessage]);

  // Drop "cleaning…" once the bridge replies.
  useEffect(() => {
    if (!gcing) return;
    return onMessage((msg) => {
      if (msg.type === 'design.gc.result' || msg.type === 'design.error') {
        setGcing(false);
      }
    });
  }, [gcing, onMessage]);

  // Background sweep every 5 minutes while connected. Saves users from
  // having to remember to click the button; cumulative orphans from a
  // long editing session don't pile up between manual triggers.
  // Triggered with `triggeredBy=auto` so the toast is silent unless
  // something actually got cleaned.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => {
      send({
        type: 'design.gc',
        currentTree: useDesignStore.getState().tree,
        customFonts: useDesignStore.getState().customFonts.map((f) => ({
          family: f.family,
          path: f.path,
        })),
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [connected, send]);

  function doClear() {
    resetStore();
    if (connected) {
      setClearing(true);
      send({ type: 'design.clear' });
    }
    setClearConfirm(false);
  }

  function doCleanup() {
    if (!connected) return;
    setGcing(true);
    send({
      type: 'design.gc',
      currentTree: tree,
      customFonts: customFonts.map((f) => ({ family: f.family, path: f.path })),
    });
  }

  useEffect(() => {
    const saved = Number(localStorage.getItem(LAYERS_KEY));
    const h = saved > 0 ? saved : Math.round((railRef.current?.clientHeight ?? 880) * 0.25);
    hRef.current = h;
    setLayersH(h);
  }, []);

  useEffect(() => {
    function move(e: PointerEvent) {
      if (!dragging.current || !railRef.current) return;
      e.preventDefault();
      const rect = railRef.current.getBoundingClientRect();
      const h = Math.min(Math.max(rect.bottom - e.clientY, LAYERS_MIN), rect.height - LAYERS_MIN);
      hRef.current = h;
      setLayersH(h);
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = '';
      localStorage.setItem(LAYERS_KEY, String(hRef.current));
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = 'none';
  }

  return (
    <aside
      ref={railRef}
      className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-1 border-l border-border-subtle"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="text-md font-medium mb-2">Inspector</div>
        <Inspector />
      </div>
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="h-1.5 shrink-0 cursor-row-resize border-y border-border-subtle bg-bg-1 hover:bg-accent-500/40 active:bg-accent-500/60 transition-colors"
      />
      <div style={{ height: layersH }} className="shrink-0 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-md font-medium">Layers</div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={doCleanup}
              disabled={!connected || gcing}
              title="Delete orphaned per-node materials, ingested images, and fonts no view references"
              aria-label="Clean up assets"
              className="text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded px-2 py-0.5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
            >
              {gcing ? 'Cleaning…' : 'Clean up'}
            </button>
            <button
              type="button"
              onClick={() => setClearConfirm(true)}
              disabled={treeLen === 0 && !connected}
              title="Force-clear every designer-placed object in the scene"
              aria-label="Clear scene"
              className="text-[11px] text-text-tertiary hover:text-danger hover:bg-bg-3 rounded px-2 py-0.5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-tertiary"
            >
              {clearing ? 'Clearing…' : 'Clear scene'}
            </button>
          </div>
        </div>
        <Layers />
      </div>
      {clearConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
        >
          <div className="w-[440px] bg-bg-2 border border-border-default rounded-lg p-5 shadow-2xl">
            <h2 className="m-0 mb-1 text-base font-semibold text-text-primary">Clear scene?</h2>
            <p className="m-0 mb-4 text-xs text-text-secondary leading-relaxed">
              Deletes every designer-placed scene object in
              {connected ? ' the attached Lens Studio project' : ' the local design'} and resets
              the layers list. Owned assets under{' '}
              <code className="font-num text-text-primary">Assets/LensDesigner/</code> stay in
              place. <strong className="text-text-primary">Cannot be undone.</strong>
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirm(false)}
                className="px-3.5 py-1.5 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doClear}
                className="px-3.5 py-1.5 text-xs text-text-inverse font-semibold rounded-md bg-danger hover:bg-danger/80"
              >
                Clear scene
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
