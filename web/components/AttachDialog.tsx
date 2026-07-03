'use client';

// AttachDialog — confirm-and-attach modal for a picked LS instance.
//
// Extracted from TargetChip so both the target-chip picker AND the
// first-launch landing (DetectedInstances) drive the same flow. Collects the
// project's Assets/ path + a display label, then confirms. When the scan
// already resolved an Assets dir (configured or lsof-known instance), the
// caller prefills it so this is a one-look confirm rather than a re-Browse.
//
// No port is captured here: the port travels with the picked `target` for THIS
// session only — it is never persisted (identity is the Assets dir).

import { useState } from 'react';
import type { TargetSummary } from '@lens-designer/bridge/client';
import { isElectronHost, requireNative } from '@/lib/native';
import { getRecentProjects, type RecentProject } from '@/lib/recent-projects';

export interface AttachDialogProps {
  target: TargetSummary;
  assetsDir: string;
  name: string;
  onAssetsDirChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AttachDialog({
  target,
  assetsDir,
  name,
  onAssetsDirChange,
  onNameChange,
  onCancel,
  onConfirm,
}: AttachDialogProps) {
  const valid = assetsDir.trim().length > 0 && assetsDir.startsWith('/');
  const [recents] = useState<RecentProject[]>(() => getRecentProjects());
  function pickRecent(r: RecentProject) {
    onAssetsDirChange(r.assetsDir);
    onNameChange(r.name);
  }

  async function browse() {
    // Reuse the native directory picker (Electron host only).
    if (!isElectronHost()) return;
    try {
      const dir = await requireNative().sandbox.chooseDirectory();
      if (dir) {
        onAssetsDirChange(dir);
        // Default the name to the picked folder's parent (the project dir) if
        // the user hasn't typed one — "…/MyLens/Assets" → "MyLens".
        if (name.trim().length === 0) {
          const parts = dir.replace(/\/+$/, '').split('/');
          const base = parts[parts.length - 1] === 'Assets' ? parts[parts.length - 2] : parts[parts.length - 1];
          if (base) onNameChange(base);
        }
      }
    } catch {
      // user cancelled / dialog failed — leave the field as-is
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
    >
      <div className="w-[440px] bg-bg-2 border border-border-default rounded-lg p-5 shadow-2xl">
        <h2 className="m-0 mb-1 text-base font-semibold text-text-primary">Attach to project</h2>
        <p className="m-0 mb-4 text-xs text-text-secondary">
          {target.projectName ? `${target.projectName} · ` : ''}port{' '}
          <strong className="text-text-primary">{target.port}</strong>
        </p>
        {recents.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3.5">
            <span className="text-[11px] font-semibold text-text-secondary">Recent projects</span>
            <div className="flex flex-col gap-1 max-h-[140px] overflow-auto">
              {recents.map((r) => (
                <button
                  type="button"
                  key={r.assetsDir}
                  onClick={() => pickRecent(r)}
                  title={r.assetsDir}
                  className={`text-left px-2.5 py-1.5 rounded-md border text-[12px] ${
                    assetsDir === r.assetsDir
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-border-subtle hover:bg-bg-3'
                  }`}
                >
                  <span className="block font-medium text-text-primary truncate">{r.name}</span>
                  <span className="block font-num text-[10.5px] text-text-tertiary truncate">{r.assetsDir}</span>
                </button>
              ))}
            </div>
            <span className="text-[11px] text-text-tertiary">Pick one to refill the path + name, then Attach.</span>
          </div>
        )}
        <div className="flex flex-col gap-1.5 mb-3.5">
          <span className="text-[11px] font-semibold text-text-secondary">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={`e.g. ${target.projectName ?? 'wb4-sandbox'}`}
            spellCheck={false}
            className="bg-bg-4 border border-border-subtle text-text-primary rounded-md px-2.5 py-2 text-[12.5px] focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
          />
          <span className="text-[11px] text-text-tertiary">
            Shown in the target chip instead of “port {target.port}”.
          </span>
        </div>
        <div className="flex flex-col gap-1.5 mb-3.5">
          <span className="text-[11px] font-semibold text-text-secondary">Project path</span>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={assetsDir}
              onChange={(e) => onAssetsDirChange(e.target.value)}
              placeholder="/Users/you/Developer/my-lens/Assets"
              spellCheck={false}
              autoFocus
              className="flex-1 min-w-0 bg-bg-4 border border-border-subtle text-text-primary rounded-md px-2.5 py-2 font-num text-[12.5px] focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
            />
            {isElectronHost() && (
              <button
                type="button"
                onClick={() => void browse()}
                className="shrink-0 px-3 py-2 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary"
              >
                Browse…
              </button>
            )}
          </div>
          <span className="text-[11px] text-text-tertiary">
            Absolute path to the project's <code className="font-num">Assets/</code> directory.
            Required for image + font ingest.
          </span>
        </div>
        <div className="flex items-start gap-2 pt-1 pb-3.5">
          <input type="checkbox" id="pack-on" defaultChecked className="mt-0.5" />
          <label htmlFor="pack-on" className="text-xs text-text-secondary leading-snug">
            <strong className="text-text-primary font-semibold">Install the LensDesigner asset pack</strong>{' '}
            — required for designs to render. Idempotent; skipped if already installed.
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!valid}
            className="px-3.5 py-1.5 text-xs text-text-inverse font-semibold rounded-md bg-accent-500 hover:bg-accent-400 disabled:bg-bg-3 disabled:text-text-tertiary"
          >
            Attach
          </button>
        </div>
      </div>
    </div>
  );
}
