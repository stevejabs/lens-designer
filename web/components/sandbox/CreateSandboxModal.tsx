// CreateSandboxModal.tsx — design surface 2, all 6 states.
//
// States:
//   A  pick directory
//   B  downloading (sub-phases: downloading → verifying → extracting)
//   C  done
//   D1 network failure
//   D2 SHA-256 mismatch
//   D4 disk/write failure
// (D3 non-empty directory renders inline on A — it's a warning, not
//  a separate state.)

'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  requireNative,
  type ProgressUpdate,
  type SandboxCreateResult,
  type SandboxValidateResult,
} from '@/lib/native';

const REPO_PAGE_URL = 'https://github.com/stevejabs/spectacles-sandbox';

// Visible phases. State C ("Sandbox ready") used to ask the user to
// click "Open in Lens Studio"; we now auto-open on success and close
// the modal, so there's no C phase on the happy path.
type Phase = 'A' | 'B' | 'D1' | 'D2' | 'D4';

interface State {
  phase: Phase;
  picked: string;
  validation: SandboxValidateResult | null;
  progress: ProgressUpdate | null;
  error: string | null;
}

type Action =
  | { type: 'reset'; defaultPath: string }
  | { type: 'set-default'; defaultPath: string; validation: SandboxValidateResult }
  | { type: 'pick'; path: string; validation: SandboxValidateResult }
  | { type: 'start' }
  | { type: 'progress'; update: ProgressUpdate }
  | { type: 'fail'; phase: 'D1' | 'D2' | 'D4'; message: string };

const initialState: State = {
  phase: 'A',
  picked: '',
  validation: null,
  progress: null,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return { ...initialState, picked: action.defaultPath };
    case 'set-default':
      // Only apply when the user hasn't picked anything yet.
      if (state.picked && state.picked !== '') return state;
      return { ...state, picked: action.defaultPath, validation: action.validation };
    case 'pick':
      return { ...state, phase: 'A', picked: action.path, validation: action.validation };
    case 'start':
      return { ...state, phase: 'B', progress: { phase: 'downloading', bytesDone: 0, bytesTotal: 0 } };
    case 'progress':
      return { ...state, progress: action.update };
    case 'fail':
      return { ...state, phase: action.phase, error: action.message };
    default:
      return state;
  }
}

export interface CreateSandboxModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { sandboxPath: string; esprojPath: string }) => void;
}

export function CreateSandboxModal(
  props: CreateSandboxModalProps,
): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const inFlight = useRef(false);

  // Reset state every time the modal opens fresh + ask main for the
  // suggested default path (full user-path, no ~ shorthand). Validate
  // that default so the warning callout fires if it's a non-empty dir.
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    const native = window.lensDesignerNative;
    if (!native) return;
    (async () => {
      const def = await native.sandbox.suggestDefaultPath();
      if (cancelled) return;
      dispatch({ type: 'reset', defaultPath: def });
      const validation = await native.sandbox.validateDirectory(def);
      if (cancelled) return;
      dispatch({ type: 'set-default', defaultPath: def, validation });
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open]);

  // Subscribe to native progress events.
  useEffect(() => {
    if (!props.open) return;
    const native = window.lensDesignerNative;
    if (!native) return;
    const off = native.sandbox.onProgress((update) =>
      dispatch({ type: 'progress', update }),
    );
    return off;
  }, [props.open]);

  const choose = useCallback(async () => {
    try {
      // eslint-disable-next-line no-console
      console.log('[sandbox-modal] Choose… clicked, invoking chooseDirectory');
      const native = requireNative();
      const picked = await native.sandbox.chooseDirectory();
      // eslint-disable-next-line no-console
      console.log('[sandbox-modal] chooseDirectory returned:', picked);
      if (!picked) return;
      const validation = await native.sandbox.validateDirectory(picked);
      // eslint-disable-next-line no-console
      console.log('[sandbox-modal] validation:', validation);
      dispatch({ type: 'pick', path: picked, validation });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sandbox-modal] choose failed:', err);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (inFlight.current) return;
    const native = requireNative();
    if (state.validation === null || state.picked === '') return;
    const path = state.picked;
    inFlight.current = true;
    dispatch({ type: 'start' });
    let result: SandboxCreateResult;
    try {
      result = await native.sandbox.create(path);
    } finally {
      inFlight.current = false;
    }
    if (result.ok) {
      // Auto-open the .esproj in Lens Studio. shell.openPath returns
      // a non-empty string on failure; we fire-and-forget here (a
      // failure is rare and the user can re-open manually from the
      // empty-state's "I already have one" path or Settings). Then
      // notify the parent + close the modal.
      void requireNative().shell.openPath(result.esprojPath);
      props.onCreated({
        sandboxPath: result.sandboxPath,
        esprojPath: result.esprojPath,
      });
      props.onClose();
      return;
    }
    const failPhase: 'D1' | 'D2' | 'D4' =
      result.kind === 'network-failed'
        ? 'D1'
        : result.kind === 'sha-mismatch'
          ? 'D2'
          : 'D4';
    dispatch({ type: 'fail', phase: failPhase, message: result.message });
  }, [props, state.picked, state.validation]);

  const handleCancel = useCallback(async () => {
    const native = requireNative();
    await native.sandbox.cancel();
    dispatch({ type: 'reset', defaultPath: state.picked });
  }, [state.picked]);

  const openReleasePage = useCallback(() => {
    void requireNative().shell.openExternal(REPO_PAGE_URL);
  }, []);

  // ----- Header copy per phase ----- //
  const titleByPhase: Record<Phase, string> = {
    A: 'Create sandbox',
    B: 'Downloading sandbox…',
    D1: "Couldn't reach GitHub",
    D2: 'Download was corrupted',
    D4: "Couldn't write to disk",
  };

  // ----- Footer per phase ----- //
  const footer = renderFooter({
    phase: state.phase,
    canCreate:
      state.validation !== null &&
      state.validation.kind !== 'missing' &&
      state.picked !== '',
    onCancel: props.onClose,
    onCreate: handleCreate,
    onCancelDownload: handleCancel,
    onOpenReleasePage: openReleasePage,
    onRetry: () => dispatch({ type: 'reset', defaultPath: state.picked }),
    onChooseDifferent: () => dispatch({ type: 'reset', defaultPath: state.picked }),
  });

  return (
    <Modal
      open={props.open}
      title={titleByPhase[state.phase]}
      onClose={state.phase === 'B' ? undefined : props.onClose}
      showClose={state.phase !== 'B'}
      footer={footer}
    >
      {state.phase === 'A' && <StateA picked={state.picked} validation={state.validation} onChoose={choose} />}
      {state.phase === 'B' && state.progress && <StateB progress={state.progress} />}
      {state.phase === 'D1' && <StateError icon="warn">{ERROR_COPY.D1}</StateError>}
      {state.phase === 'D2' && <StateError icon="warn">{ERROR_COPY.D2}</StateError>}
      {state.phase === 'D4' && <StateD4 errno={state.error ?? ''} />}
    </Modal>
  );
}

// ============================================================
//  per-state bodies
// ============================================================

interface StateAProps {
  picked: string;
  validation: SandboxValidateResult | null;
  onChoose: () => void;
}
function StateA({ picked, validation, onChoose }: StateAProps): React.JSX.Element {
  const showWarning = validation?.kind === 'non-empty';
  return (
    <>
      <p className="m-0 mb-3">
        Lens Designer will download a sandbox project (~12 MB) and put it on
        your disk. Open it in Lens Studio after to start designing.
      </p>
      <div className="mt-3.5">
        <div className="text-[11px] font-semibold tracking-wider uppercase text-text-tertiary mb-1.5">
          Location
        </div>
        <div className="flex gap-1.5">
          <input
            readOnly
            value={picked}
            className="flex-1 bg-bg-1 border border-border-default rounded-md px-2.5 py-1.5 text-[12.5px] text-text-secondary font-num"
          />
          <button
            type="button"
            onClick={onChoose}
            className="px-4 py-1.5 text-[13px] text-text-primary bg-bg-3 hover:bg-bg-4 border border-border-default rounded-md transition-colors"
          >
            Choose&hellip;
          </button>
        </div>
        <div className="mt-1.5 text-[11.5px] text-text-tertiary">
          Needs ~50 MB free.
        </div>
        {showWarning && (
          <div
            role="alert"
            className="mt-2.5 px-3 py-2.5 rounded-md flex items-start gap-2.5 border border-warning/30 bg-warning/10 text-warning text-[12.5px] leading-[18px]"
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="text-[#fde68a]">
              This folder isn&rsquo;t empty. Continuing will add{' '}
              <span className="font-num">sandbox/</span> next to the existing
              files there.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface StateBProps {
  progress: ProgressUpdate;
}
function StateB({ progress }: StateBProps): React.JSX.Element {
  const pct =
    progress.bytesTotal > 0
      ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
      : 0;
  const indeterminate = progress.phase !== 'downloading';
  const phaseLabel = {
    downloading: 'Downloading…',
    verifying: 'Verifying…',
    extracting: 'Extracting…',
  }[progress.phase];
  return (
    <>
      <div className="mt-1 h-1.5 bg-bg-3 rounded-[3px] overflow-hidden relative" role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuetext={`${phaseLabel} ${progress.bytesDone} of ${progress.bytesTotal} bytes`}
      >
        <div
          className={`h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-[3px] ${
            indeterminate ? 'w-[40%] animate-pulse' : 'transition-[width] duration-200 ease-linear'
          }`}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11.5px] text-text-tertiary font-num">
        <span>{formatBytes(progress.bytesDone)} of {formatBytes(progress.bytesTotal)}</span>
        <span>{indeterminate ? '' : ''}</span>
      </div>
      <div className="mt-1 text-[11.5px] text-text-secondary">{phaseLabel}</div>
    </>
  );
}

interface StateErrorProps {
  icon: 'warn' | 'danger';
  children: React.ReactNode;
}
function StateError({ icon, children }: StateErrorProps): React.JSX.Element {
  const Ico = icon === 'warn' ? AlertTriangle : AlertCircle;
  return (
    <div role="alert" className="px-3 py-2.5 rounded-md flex items-start gap-2.5 border border-danger/30 bg-danger/[0.06] text-danger text-[12.5px] leading-[18px]">
      <Ico size={16} className="shrink-0 mt-0.5" />
      <div className="text-[#fca5a5]">{children}</div>
    </div>
  );
}

interface StateD4Props {
  errno: string;
}
function StateD4({ errno }: StateD4Props): React.JSX.Element {
  return (
    <>
      <p className="m-0">We couldn&rsquo;t save the sandbox to that location. macOS said:</p>
      <div className="mt-2 bg-bg-1 border border-border-default rounded-md px-2.5 py-2 text-[12px] font-num text-danger">
        {errno || 'unknown error'}
      </div>
    </>
  );
}

const ERROR_COPY = {
  D1: (
    <>
      We tried 3 times to download the sandbox and couldn&rsquo;t connect.
      Check your network &mdash; or download it directly from the release page.
    </>
  ),
  D2: (
    <>
      The downloaded file didn&rsquo;t match the expected checksum. Try again
      &mdash; if this keeps happening, download manually from the release page
      and verify against the <span className="font-num">.sha256</span> file.
    </>
  ),
};

// ============================================================
//  footer
// ============================================================
interface FooterDeps {
  phase: Phase;
  canCreate: boolean;
  onCancel: () => void;
  onCreate: () => void;
  onCancelDownload: () => void;
  onOpenReleasePage: () => void;
  onRetry: () => void;
  onChooseDifferent: () => void;
}
function renderFooter(deps: FooterDeps): React.ReactNode {
  switch (deps.phase) {
    case 'A':
      return (
        <>
          <button type="button" onClick={deps.onCancel} className={btnGhost}>
            Cancel
          </button>
          <button
            type="button"
            onClick={deps.onCreate}
            disabled={!deps.canCreate}
            className={btnPrimary}
          >
            Create here
          </button>
        </>
      );
    case 'B':
      return (
        <button type="button" onClick={deps.onCancelDownload} className={btnGhost}>
          Cancel
        </button>
      );
    case 'D1':
    case 'D2':
      return (
        <>
          <button type="button" onClick={deps.onOpenReleasePage} className={btnSecondary}>
            Open repo
          </button>
          <button type="button" onClick={deps.onRetry} className={btnPrimary}>
            Try again
          </button>
        </>
      );
    case 'D4':
      return (
        <button type="button" onClick={deps.onChooseDifferent} className={btnPrimary}>
          Choose a different folder
        </button>
      );
  }
}

// ----- shared button class strings (kept inline so they read at the call site) -----
const btnPrimary =
  'px-4 py-1.5 text-[13px] font-semibold text-text-inverse bg-accent-500 hover:bg-accent-400 disabled:bg-bg-3 disabled:text-text-tertiary rounded-md transition-colors shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_6px_14px_-4px_rgba(14,165,233,0.35)] disabled:shadow-none';
const btnSecondary =
  'px-4 py-1.5 text-[13px] text-text-primary bg-bg-3 hover:bg-bg-4 border border-border-default rounded-md transition-colors';
const btnGhost =
  'px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-2 rounded-md transition-colors';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
