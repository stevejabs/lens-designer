'use client';

// TargetChip — interactive replacement for the ConnectionChip (Step 7b).
// Shows the current attach status; click to open the picker. Includes the
// picker dropdown + attach dialog inline so the user flow is one component.

import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '@/lib/bridge-client';
import type { UseAttachMode } from '@/lib/use-attach-mode';
import type { TargetSummary } from '@lens-designer/bridge/client';
import { AttachDialog } from '@/components/AttachDialog';

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
    // Every project attaches in attached mode (needs an assetsDir). The
    // legacy in-tree sandbox (the only thing that ever had the
    // ActiveComponent surface sandbox-mode requires) is gone — projects
    // created from the sandbox template still carry the
    // __LENS_DESIGNER_SANDBOX__ marker, and routing them to sandbox mode
    // failed with "no scene object named ActiveComponent".
    //
    // Prefill the Assets path + name from the scan when the bridge resolved
    // them (lsof + manifest) — for a configured project this turns Attach into
    // a one-look confirm instead of a re-Browse.
    setAttachDialog({
      open: true,
      target: t,
      assetsDir: t.assetsDir ?? '',
      label: t.projectName ?? '',
    });
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
        {[...picker.instances]
          .sort((a, b) => {
            // Elevate configured (already-set-up) projects, else lowest-port-first.
            const ca = a.configured ? 1 : 0;
            const cb = b.configured ? 1 : 0;
            if (ca !== cb) return cb - ca;
            return a.port - b.port;
          })
          .map((t) => {
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
                <span className="text-[13px] text-text-primary font-medium flex items-center gap-1.5 truncate">
                  {t.projectName ?? `port ${t.port}`}
                  {t.configured && (
                    <span className="px-1 py-px text-[9px] font-bold uppercase tracking-wider text-accent-300 bg-accent-500/20 rounded">
                      Set up
                    </span>
                  )}
                  {t.hasMarker && (
                    <span className="px-1 py-px text-[9px] font-bold uppercase tracking-wider text-accent-400 bg-accent-500/15 rounded">
                      Sandbox
                    </span>
                  )}
                </span>
                {t.assetsDir && (
                  <span className="text-[11px] text-text-tertiary font-num truncate">
                    {t.assetsDir}
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
