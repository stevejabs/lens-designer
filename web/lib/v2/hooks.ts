'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  getLd,
  type LDConnState,
  type LDAgentEvent,
  type LDScannedAsset,
  type LDScannedView,
  type LDViewField,
  type LDFieldKind,
} from './native';
import type { AssetItem, DesignView } from './types';
import { MOCK_ASSETS, MOCK_VIEWS } from './mock-data';
import { useUiStore } from './ui-store';

function relTime(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toAssetItem(a: LDScannedAsset): AssetItem {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    backend: a.backend,
    status: 'ready',
    origin: a.origin,
    ...(a.prompt ? { prompt: a.prompt } : {}),
    updated: relTime(a.updatedMs),
    meta: { size: fmtSize(a.sizeBytes) },
    hasContext: a.hasContext,
  };
}

/** Real project assets in Electron; mock data in the browser. */
export function useAssets(): { assets: AssetItem[]; loading: boolean; refresh: () => void } {
  const [assets, setAssets] = useState<AssetItem[]>(() => (getLd() ? [] : MOCK_ASSETS));
  const [loading, setLoading] = useState(false);

  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const conn = useConnection();

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setLoading(true);
    void ld.assets
      .list()
      .then((list) => setAssets(list.map(toAssetItem)))
      .finally(() => setLoading(false));
  }, []);

  // Re-scan on mount, after a run, and once the connection goes live (the
  // first mount usually precedes the LS connection being ready).
  useEffect(() => {
    if (conn.kind === 'connected') refresh();
  }, [refresh, artifactNonce, conn.kind]);

  return { assets, loading, refresh };
}

function toDesignView(v: LDScannedView): DesignView {
  return {
    id: v.id,
    name: v.name,
    module: v.module,
    origin: v.origin,
    updated: relTime(v.updatedMs),
  };
}

/** Real project views (UIKit modules) in Electron; mock in the browser. */
export function useViews(): { views: DesignView[]; refresh: () => void } {
  const [views, setViews] = useState<DesignView[]>(() => (getLd() ? [] : MOCK_VIEWS));
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const conn = useConnection();

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    void ld.views.list().then((list) => setViews(list.map(toDesignView)));
  }, []);

  useEffect(() => {
    if (conn.kind === 'connected') refresh();
  }, [refresh, artifactNonce, conn.kind]);

  return { views, refresh };
}

/** The loaded view's live UIKit element tree (from the running preview). */
export function useElementTree(): {
  tree: import('./native').LDElementNode | null;
  ok: boolean;
  reason: string | null;
  loading: boolean;
  refresh: () => void;
} {
  const [tree, setTree] = useState<import('./native').LDElementNode | null>(null);
  const [ok, setOk] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeArtifact = useUiStore((s) => s.activeArtifact);
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const conn = useConnection();

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setLoading(true);
    void ld.ui
      .tree()
      .then((r) => {
        setTree(r.tree ?? null);
        setOk(r.ok);
        setReason(r.reason ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Re-read when a view is (re)selected, after edits, and on connect. The
  // runtime tree appears a beat after the view loads, so refresh is debounced.
  useEffect(() => {
    if (conn.kind !== 'connected') return;
    const t = setTimeout(refresh, 600);
    return () => clearTimeout(t);
  }, [refresh, conn.kind, activeArtifact?.path, artifactNonce]);

  return { tree, ok, reason, loading, refresh };
}

/** Capture the live Lens Studio preview as an image data URL. */
export function usePreview(): { image: string | null; capturing: boolean; capture: () => void } {
  const [image, setImage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const artifactNonce = useUiStore((s) => s.artifactNonce);
  const activeArtifact = useUiStore((s) => s.activeArtifact);
  const conn = useConnection();

  const capture = useCallback(() => {
    const ld = getLd();
    if (!ld) return;
    setCapturing(true);
    void ld.preview
      .capture()
      .then((img) => {
        if (img) setImage(img);
      })
      .finally(() => setCapturing(false));
  }, []);

  // Capture once connected, after edits (artifactNonce), and when the
  // selected view changes. Connected-trigger fixes the blank-on-open case.
  useEffect(() => {
    if (conn.kind === 'connected') capture();
  }, [capture, artifactNonce, conn.kind, activeArtifact?.path]);

  return { image, capturing, capture };
}

/** Render a scripted mesh NATIVELY: read its .ts source and run it against a
 *  shimmed Lens runtime to extract three.js geometry — fast, no scene round
 *  trip. Returns null when the script uses unsupported APIs (caller falls back
 *  to the LS preview). */
export function useScriptMeshRender(path: string | null): {
  description: import('./script-mesh/runtime').SceneDescription | null;
  loading: boolean;
} {
  const [description, setDescription] = useState<
    import('./script-mesh/runtime').SceneDescription | null
  >(null);
  const [loading, setLoading] = useState(false);
  const artifactNonce = useUiStore((s) => s.artifactNonce);

  useEffect(() => {
    const ld = getLd();
    if (!ld || !path) {
      setDescription(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void ld.file
      .read(path)
      .then((url) => (url ? fetch(url).then((r) => r.text()) : null))
      .then(async (src) => {
        if (!alive) return;
        if (!src) {
          setDescription(null);
          return;
        }
        const { runScriptMesh } = await import('./script-mesh/runtime');
        setDescription(runScriptMesh(src));
      })
      .catch(() => {
        if (alive) setDescription(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, artifactNonce]);

  return { description, loading };
}

/** Render a code-authored (scripted) mesh: load it into the edit bay so it's
 *  isolated, then capture the live Lens Studio preview. Unlike a GLB we can't
 *  render the TS in three.js — Lens Studio runs the script and we screenshot it. */
export function useScriptMeshPreview(path: string | null): {
  image: string | null;
  loading: boolean;
  render: () => void;
} {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const conn = useConnection();

  const render = useCallback(() => {
    const ld = getLd();
    if (!ld || !path) return;
    setLoading(true);
    void ld.view
      .load(path) // isolate this script under the edit bay (design posture)
      .then(() => new Promise((r) => setTimeout(r, 700))) // let LS attach + run onAwake
      .then(() => ld.preview.capture())
      .then((img) => {
        if (img) setImage(img);
      })
      .finally(() => setLoading(false));
  }, [path]);

  // Auto-render when a script-mesh is opened in the viewer and we're connected.
  useEffect(() => {
    setImage(null);
    if (conn.kind === 'connected' && path) render();
  }, [render, conn.kind, path]);

  return { image, loading, render };
}

/** Editable design constants parsed from a view's source. */
export function useViewFields(path: string | null): {
  fields: LDViewField[];
  setField: (name: string, kind: LDFieldKind, value: number | number[] | string | boolean) => Promise<void>;
  saving: boolean;
} {
  const [fields, setFields] = useState<LDViewField[]>([]);
  const [saving, setSaving] = useState(false);
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld || !path) {
      setFields([]);
      return;
    }
    void ld.views.fields(path).then(setFields);
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setField = useCallback(
    async (name: string, kind: LDFieldKind, value: number | number[] | string | boolean) => {
      const ld = getLd();
      if (!ld || !path) return;
      // Optimistic local update.
      setFields((prev) => prev.map((f) => (f.name === name ? { ...f, value } : f)));
      setSaving(true);
      try {
        await ld.views.setField({ path, name, kind, value });
        bumpArtifacts(); // triggers a preview re-capture
      } finally {
        setSaving(false);
      }
    },
    [path, bumpArtifacts],
  );

  return { fields, setField, saving };
}

/** Returns [ref, inView] — true once the element scrolls near the viewport.
 *  Latches on so heavy content (3D thumbnails, media) loads lazily, once. */
export function useInView<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '150px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return [ref, inView];
}

/** Read a project media file (audio/glb/image) as a data URL for the viewers. */
export function useFileUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const ld = getLd();
    if (!ld || !path) {
      setUrl(null);
      return;
    }
    let alive = true;
    void ld.file.read(path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export type OnboardState =
  | { kind: 'none' }
  | { kind: 'organize'; moveToAppBay: string[]; stayAtRoot: string[] }
  | { kind: 'build' };

/** Decide whether a freshly-connected project needs onboarding:
 *  - 'organize': it has app content at the scene root to move under the app bay.
 *  - 'build'  : it's empty — offer a "build this" prompt.
 *  Detection runs once per connection; dismissing suppresses it for the session. */
export function useOnboarding(): {
  state: OnboardState;
  busy: boolean;
  organize: () => Promise<void>;
  dismiss: () => void;
} {
  const [state, setState] = useState<OnboardState>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const conn = useConnection();
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const ld = getLd();
    if (!ld || conn.kind !== 'connected' || dismissedRef.current) return;
    let alive = true;
    void Promise.all([ld.project.organizePlan(), ld.assets.list(), ld.views.list()]).then(
      ([plan, assets, views]) => {
        if (!alive) return;
        if (plan.moveToAppBay.length > 0) {
          setState({ kind: 'organize', moveToAppBay: plan.moveToAppBay, stayAtRoot: plan.stayAtRoot });
        } else if (assets.length === 0 && views.length === 0) {
          setState({ kind: 'build' });
        } else {
          setState({ kind: 'none' });
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [conn.kind]);

  const organize = useCallback(async () => {
    const ld = getLd();
    if (!ld) return;
    setBusy(true);
    try {
      await ld.project.organize();
      bumpArtifacts();
      dismissedRef.current = true;
      setState({ kind: 'none' });
    } finally {
      setBusy(false);
    }
  }, [bumpArtifacts]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setState({ kind: 'none' });
  }, []);

  return { state, busy, organize, dismiss };
}

/** The open project's name (basename of its dir), refreshed whenever the
 *  connection (re)connects — so switching projects + reconnecting updates it. */
export function useProjectName(): string | null {
  const [name, setName] = useState<string | null>(null);
  const conn = useConnection();
  const port = conn.kind === 'connected' ? conn.port : null;

  useEffect(() => {
    const ld = getLd();
    if (!ld || conn.kind !== 'connected') return;
    let alive = true;
    void ld.project.dir().then((dir) => {
      if (!alive) return;
      setName(dir ? (dir.replace(/\/+$/, '').split('/').pop() ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [conn.kind, port]);

  return name;
}

/** Live LS connection state from the desktop shell (disconnected in browser). */
export function useConnection(): LDConnState {
  const [state, setState] = useState<LDConnState>({ kind: 'disconnected' });

  useEffect(() => {
    const ld = getLd();
    if (!ld) return;
    let alive = true;
    void ld.connection.get().then((s) => {
      if (alive) setState(s);
    });
    const off = ld.connection.onChange((s) => setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}

/** An asset's version history + a restore action (rollback). */
export function useVersions(path: string | null): {
  versions: { id: string; createdMs: number; sizeBytes: number }[];
  restore: (versionId: string) => Promise<void>;
  refresh: () => void;
} {
  const [versions, setVersions] = useState<{ id: string; createdMs: number; sizeBytes: number }[]>([]);
  const bumpArtifacts = useUiStore((s) => s.bumpArtifacts);
  const artifactNonce = useUiStore((s) => s.artifactNonce);

  const refresh = useCallback(() => {
    const ld = getLd();
    if (!ld || !path) {
      setVersions([]);
      return;
    }
    void ld.versions.list(path).then(setVersions);
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh, artifactNonce]);

  const restore = useCallback(
    async (versionId: string) => {
      const ld = getLd();
      if (!ld || !path) return;
      await ld.versions.restore({ path, versionId });
      bumpArtifacts(); // re-read the asset + preview
      refresh();
    },
    [path, bumpArtifacts, refresh],
  );

  return { versions, restore, refresh };
}

