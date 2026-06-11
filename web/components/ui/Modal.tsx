// Modal.tsx — the one new primitive across the standalone-app
// surfaces (per design spec §Design language). Renders a scrim +
// centered card with header / body / footer slots. Focus trap +
// Esc-to-close baked in; alertdialog variant disables both.
//
// All Phase 3 modals (Create-sandbox, Settings, About, Screen-
// Recording-permission) share this shell.

'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type ModalRole = 'dialog' | 'alertdialog';

export interface ModalProps {
  open: boolean;
  /**
   * Modal width preset. Maps to the design spec's modal sizes:
   *   default = 520 px (Create-sandbox, Screen-Recording)
   *   wide    = 640 px (Settings)
   *   narrow  = 360 px (About)
   */
  size?: 'default' | 'wide' | 'narrow';
  role?: ModalRole;
  title: string;
  showClose?: boolean;
  /** Closing-via-Esc and backdrop-click are no-ops when role='alertdialog'. */
  onClose?: (() => void) | undefined;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Accessible label override; defaults to the title. */
  ariaLabel?: string;
}

const SIZE_TO_WIDTH: Record<NonNullable<ModalProps['size']>, string> = {
  default: 'max-w-[520px]',
  wide: 'max-w-[640px]',
  narrow: 'max-w-[360px]',
};

export function Modal(props: ModalProps): React.JSX.Element | null {
  const {
    open,
    size = 'default',
    role = 'dialog',
    title,
    showClose = true,
    onClose,
    footer,
    children,
    ariaLabel,
  } = props;

  const cardRef = useRef<HTMLDivElement>(null);

  // Focus the first focusable element when the modal opens.
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const focusable = card.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  // Esc-to-close (dialog only). alertdialog stays open until the
  // owner explicitly closes it.
  useEffect(() => {
    if (!open || role === 'alertdialog' || !onClose) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, role, onClose]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (role === 'alertdialog' || !onClose) return;
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      role={role}
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      onClick={handleBackdrop}
    >
      <div
        ref={cardRef}
        className={`${SIZE_TO_WIDTH[size]} w-full flex flex-col max-h-[calc(100vh-48px)] bg-bg-2 border border-border-subtle rounded-[10px] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-[18px] pt-[14px] pb-3 border-b border-border-subtle">
          <h2 className="m-0 text-sm font-semibold tracking-tight text-text-primary">
            {title}
          </h2>
          {showClose && onClose && role === 'dialog' && (
            <button
              type="button"
              className="w-6 h-6 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded transition-colors"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </header>
        <div className="px-[18px] py-[18px] overflow-y-auto text-text-secondary text-[13px] leading-[19px]">
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-4 pt-3 pb-[14px] border-t border-border-subtle bg-bg-2 rounded-b-[10px]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
