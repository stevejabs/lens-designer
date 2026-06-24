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

