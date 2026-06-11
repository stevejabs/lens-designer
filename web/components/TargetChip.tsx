'use client';

// TargetChip — interactive replacement for the ConnectionChip (Step 7b).
// Shows the current attach status; click to open the picker. Includes the
// picker dropdown + attach dialog inline so the user flow is one component.

import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '@/lib/bridge-client';
import type { UseAttachMode } from '@/lib/use-attach-mode';
import type { TargetSummary } from '@lens-designer/bridge/client';
import { isElectronHost, requireNative } from '@/lib/native';
import { getRecentProjects, type RecentProject } from '@/lib/recent-projects';

interface Props {
  /** Underlying WS state from useBridge. */
  state: ConnectionState;
  /** Attach session state + actions. */
  attach: UseAttachMode;
}

export function TargetChip({ state, attach }: Props) {
  const [attachDialog, setAttachDialog] = useState<{
    open: boolean;
    target: TargetSummary | null;
    assetsDir: string;
    label: string;
  }>({ open: false, target: null, assetsDir: '', label: '' });

  const wsConnected = state.kind === 'connected';
  const session = attach.attach;
  const attached = session.kind === 'attached' ? session.attachment : null;

  const label = computeLabel(state, attached);
  const pip = computePip(state, attached);

  function handleClick() {
    if (!wsConnected) return;
    if (attach.picker.open) {
      attach.closePicker();
    } else {
      attach.openPicker();
    }
  }

  function handlePick(t: TargetSummary) {
    if (t.hasMarker) {
      // Sandbox — straight attach, no dialog.
      attach.attachTo(t.port, 'sandbox');
      return;
    }
    // Attached mode — need an assetsDir. Seed the name from the scanned
    // project name (the user can override it).
    setAttachDialog({ open: true, target: t, assetsDir: '', label: t.projectName ?? '' });
    attach.closePicker();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={!wsConnected}
        title={attached ? `${attached.kind} · port ${attached.port}` : label}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary border border-border-subtle bg-bg-2 hover:bg-bg-3 hover:text-text-primary disabled:opacity-50"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: pip }} />
        <span>{label}</span>
        {attached?.kind === 'sandbox' && (
          <span className="ml-1 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-accent-400 bg-accent-500/15 rounded">
            Sandbox
          </span>
        )}
        <span className="ml-1 text-text-tertiary text-[9px]">▾</span>
      </button>

      {attach.picker.open && (
        <PickerDropdown
          picker={attach.picker}
          activePort={attached?.port ?? null}
          onPick={handlePick}
          onClose={attach.closePicker}
          onRescan={attach.rescan}
        />
      )}

      {attachDialog.open && attachDialog.target && (
        <AttachDialog
          target={attachDialog.target}
          assetsDir={attachDialog.assetsDir}
          name={attachDialog.label}
          onAssetsDirChange={(v) => setAttachDialog((d) => ({ ...d, assetsDir: v }))}
          onNameChange={(v) => setAttachDialog((d) => ({ ...d, label: v }))}
          onCancel={() => setAttachDialog({ open: false, target: null, assetsDir: '', label: '' })}
          onConfirm={() => {
            const { target, assetsDir, label } = attachDialog;
            if (!target) return;
            attach.attachTo(target.port, 'attached', assetsDir, label);
            setAttachDialog({ open: false, target: null, assetsDir: '', label: '' });
          }}
        />
      )}
    </div>
  );
}

// ---- helpers ----

function computeLabel(state: ConnectionState, attached: { kind: 'sandbox' | 'attached'; projectName: string | null } | null): string {
  if (state.kind === 'idle') return 'Idle';
  if (state.kind === 'connecting') return 'Connecting…';
  if (state.kind === 'reconnecting') return `Reconnecting in ${Math.ceil(state.retryInMs / 1000)}s`;
  if (state.kind === 'offline') return 'Bridge offline';
  if (state.kind === 'sandbox-down') return 'Not connected';
  // ws connected
  if (!attached) return 'Not connected';
  if (attached.kind === 'sandbox') return 'sandbox';
  return attached.projectName ?? `Port ${attached ? 'unknown' : '—'}`;
}

function computePip(state: ConnectionState, attached: object | null): string {
  if (state.kind === 'idle' || state.kind === 'offline') return 'var(--text-tertiary)';
  if (state.kind === 'connecting' || state.kind === 'reconnecting') return 'var(--warning)';
  if (state.kind === 'sandbox-down') return 'var(--danger)';
  if (attached) return 'var(--success)';
  return 'var(--text-tertiary)';
}

// ---- Picker dropdown ----

interface PickerDropdownProps {
  picker: UseAttachMode['picker'];
  activePort: number | null;
  onPick: (t: TargetSummary) => void;
  onClose: () => void;
  onRescan: () => void;
}

function PickerDropdown({ picker, activePort, onPick, onClose, onRescan }: PickerDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    // Defer one tick so the chip's click that opened us doesn't immediately close.
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="listbox"
      className="absolute right-0 top-full mt-1.5 w-[380px] bg-bg-2 border border-border-default rounded-lg shadow-2xl overflow-hidden z-40"
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
        <h4 className="m-0 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          LS Instances
        </h4>
        <button
          type="button"
          onClick={onRescan}
          aria-label="Rescan"
          className="w-[22px] h-[22px] flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded text-sm"
        >
          ↻
        </button>
      </div>
      <div className="py-1">
        {picker.scanning && picker.instances.length === 0 && (
          <div className="px-3.5 py-3 text-xs text-text-tertiary">Scanning…</div>
        )}
        {!picker.scanning && picker.instances.length === 0 && (
          <div className="px-3.5 py-5 text-xs text-text-secondary leading-relaxed">
            No Lens Studio instances detected. Make sure LS is open with a project loaded.
          </div>
        )}
        {picker.instances.map((t) => {
          const isActive = activePort === t.port;
          return (
            <button
              type="button"
              key={t.port}
              onClick={() => onPick(t)}
              role="option"
              aria-selected={isActive}
              className={`w-full text-left px-3.5 py-2.5 grid grid-cols-[12px_1fr_auto] gap-2.5 items-center ${
                isActive ? 'bg-bg-4' : 'hover:bg-bg-3'
              } relative`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent-500 rounded-sm"
                  style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
                />
              )}
              <span
                className={`w-2.5 h-2.5 rounded-full border ${
                  isActive
                    ? 'bg-accent-500 border-accent-500'
                    : 'border-text-tertiary'
                }`}
              />
              <span className="flex flex-col min-w-0">
                <span className="text-[13px] text-text-primary font-medium flex items-center gap-1.5">
                  {t.hasMarker ? 'sandbox' : `port ${t.port}`}
                  {t.hasMarker && (
                    <span className="px-1 py-px text-[9px] font-bold uppercase tracking-wider text-accent-400 bg-accent-500/15 rounded">
                      Sandbox
                    </span>
                  )}
                </span>
                {t.projectName && (
                  <span className="text-[11px] text-text-tertiary font-num truncate">
                    {t.projectName}
                  </span>
                )}
              </span>
              <span className="font-num text-[11px] text-text-secondary">{t.port}</span>
            </button>
          );
        })}
      </div>
      <div className="px-3.5 py-2.5 border-t border-border-subtle text-[11px] text-text-tertiary">
        No port? Set <code className="font-num text-text-secondary bg-bg-3 px-1 py-px rounded">LS_MCP_PORT</code>{' '}
        manually.
      </div>
    </div>
  );
}

// ---- Attach dialog (for non-sandbox targets) ----

interface AttachDialogProps {
  target: TargetSummary;
  assetsDir: string;
  name: string;
  onAssetsDirChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function AttachDialog({ target, assetsDir, name, onAssetsDirChange, onNameChange, onCancel, onConfirm }: AttachDialogProps) {
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
