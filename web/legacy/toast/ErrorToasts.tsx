// ErrorToasts.tsx — surface bridge errors (design.error and others)
// as bottom-right toast cards with a Copy button. Replaces the
// inline-in-preview error overlay so users can see + copy errors
// regardless of which pane they're looking at.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, X } from 'lucide-react';
import type { ServerToClientMsg } from '@lens-designer/bridge/client';
import { useDesignStore } from '@/lib/design-model';

export interface ErrorToastsProps {
  onMessage: (fn: (msg: ServerToClientMsg) => void) => () => void;
}

type ToastVariant = 'error' | 'info';

interface ToastEntry {
  id: string;
  variant: ToastVariant;
  /** Short top-line title. */
  title: string;
  /** Body — copyable. May be multi-line. */
  body: string;
  /** Wall-clock ms when this toast was created — used for dedupe. */
  ts: number;
}

const MAX_TOASTS = 3;
/** Suppress duplicate toasts (same title+body) within this window. */
const DEDUPE_WINDOW_MS = 4_000;

export function ErrorToasts({ onMessage }: ErrorToastsProps): React.JSX.Element | null {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const removeCustomFontsByFile = useDesignStore((s) => s.removeCustomFontsByFile);

  const push = useCallback((variant: ToastVariant, title: string, body: string) => {
    setToasts((prev) => {
      const now = Date.now();
      // Dedupe identical toasts within DEDUPE_WINDOW_MS.
      const recentDup = prev.find(
        (t) => t.title === title && t.body === body && now - t.ts < DEDUPE_WINDOW_MS,
      );
      if (recentDup) return prev;
      const next = [
        ...prev,
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          variant,
          title,
          body,
          ts: now,
        },
      ];
      return next.slice(-MAX_TOASTS);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to bridge messages.
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === 'design.error') {
        const node = msg.error.nodeId ? `node ${msg.error.nodeId}` : 'unknown node';
        const prop = msg.error.propertyPath ? ` · ${msg.error.propertyPath}` : '';
        const title = 'Apply failed';
        const body = `${node}${prop}\n${msg.error.lsError}`;
        push('error', title, body);
      } else if (msg.type === 'design.gc.result') {
        // Reconcile the local customFonts list against the actual disk
        // state — fonts whose files were just swept must drop out of
        // the font picker.
        if (msg.deletedFontFiles.length > 0) {
          removeCustomFontsByFile(msg.deletedFontFiles);
        }
        const totalDeleted = msg.deleted.materials + msg.deleted.images + msg.deleted.fonts;
        // Auto sweeps stay silent unless something was actually
        // cleaned — otherwise we'd toast-spam every 5 minutes. Manual
        // sweeps always confirm, even a zero-orphan result.
        if (msg.triggeredBy === 'auto' && totalDeleted === 0 && msg.errors.length === 0) {
          return;
        }
        const title = totalDeleted === 0
          ? 'Nothing to clean up'
          : `Cleaned up ${totalDeleted} orphan${totalDeleted === 1 ? '' : 's'}`;
        const parts: string[] = [];
        if (msg.deleted.materials) parts.push(`${msg.deleted.materials} material${msg.deleted.materials === 1 ? '' : 's'}`);
        if (msg.deleted.images) parts.push(`${msg.deleted.images} image${msg.deleted.images === 1 ? '' : 's'}`);
        if (msg.deleted.fonts) parts.push(`${msg.deleted.fonts} font${msg.deleted.fonts === 1 ? '' : 's'}`);
        const body =
          (parts.length ? `Deleted: ${parts.join(', ')}\n` : '') +
          `Kept: ${msg.kept.materials} materials · ${msg.kept.images} images · ${msg.kept.fonts} fonts` +
          (msg.errors.length ? `\nErrors:\n${msg.errors.join('\n')}` : '');
        push(msg.errors.length ? 'error' : 'info', title, body);
      }
    });
  }, [onMessage, push, removeCustomFontsByFile]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bridge errors"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[420px]"
    >
      {toasts.map((t) => (
        <ErrorToast key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

interface ErrorToastProps {
  entry: ToastEntry;
  onDismiss: () => void;
}

/** How long a toast stays before auto-dismissing. */
const AUTO_DISMISS_MS = 10_000;

function ErrorToast({ entry, onDismiss }: ErrorToastProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  // Auto-dismiss after a few seconds. Keep onDismiss in a ref so a parent
  // re-render doesn't reset the timer; set it once on mount.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  const handleCopy = async (): Promise<void> => {
    try {
      const fullText = `${entry.title}\n${entry.body}`;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API requires a secure context + user gesture in some
      // browsers; the click handler counts as a gesture so this rarely
      // fails. Fall back to a textarea-copy hack if it does.
      const ta = document.createElement('textarea');
      ta.value = `${entry.title}\n${entry.body}`;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const isInfo = entry.variant === 'info';
  const borderClass = isInfo ? 'border-accent-500' : 'border-danger';
  const iconClass = isInfo ? 'text-accent-400' : 'text-danger';
  const Icon = isInfo ? CheckCircle2 : AlertCircle;
  return (
    <div
      role="alert"
      aria-live={isInfo ? 'polite' : 'assertive'}
      className={`bg-bg-2 border-l-4 ${borderClass} rounded-r-lg shadow-2xl px-3.5 py-3 flex items-start gap-2.5 animate-in slide-in-from-right-2`}
    >
      <Icon size={16} className={`shrink-0 mt-0.5 ${iconClass}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text-primary mb-0.5">
          {entry.title}
        </div>
        <pre className="text-[12px] text-text-secondary font-num whitespace-pre-wrap break-words m-0 max-h-[200px] overflow-y-auto">
          {entry.body}
        </pre>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-text-secondary hover:text-text-primary hover:bg-bg-3 rounded transition-colors"
          >
            <Copy size={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded transition-colors ml-auto"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
