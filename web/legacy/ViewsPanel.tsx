'use client';

// Views panel — top half of the left column.
//
// Saving model: autosave is the sole persistence path during editing.
// There is no "Save" button — every tree change writes through the
// `useAutoSaveView` hook within ~800ms. The dialog this panel raises
// only collects a NAME for a brand-new view; the new view is created
// EMPTY and the user fills it in afterward. Renames happen inline
// (double-click a view name in the list).
//
// Invariant: the local tree always mirrors the active view. No code
// path here mutates the tree without first updating `activeViewId` —
// otherwise autosave would write the wrong content under the wrong id
// and silently destroy a saved view. The previous bug (lost work on
// "+ new view") was caused by a `reset()` that ran while
// `activeViewId` still pointed at the OLD view; the 800ms autosave
// then wrote `[]` to the bridge under that id.

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, PackageCheck } from 'lucide-react';
import type { UseAttachMode } from '@/lib/use-attach-mode';
import { isValidViewName } from '@/lib/use-attach-mode';
import { useDesignStore } from '@/lib/design-model';

interface Props {
  attach: UseAttachMode;
  /** Optional — when present, the disconnected empty state renders a
   *  "Create sandbox" affordance alongside "Connect…". Owned by the
   *  page (the modal lives in app/page.tsx). */
  onCreateSandbox?: (() => void) | undefined;
}

type ConfirmState =
  | { kind: 'none' }
  | { kind: 'delete'; id: string; name: string };

interface NameDialogState {
  open: boolean;
  name: string;
}

export function ViewsPanel({ attach, onCreateSandbox }: Props) {
  const requestNewViewSignal = useDesignStore((s) => s.requestNewViewSignal);
  const autoPublish = useDesignStore((s) => s.autoPublish);
  const setAutoPublish = useDesignStore((s) => s.setAutoPublish);
  const [dialog, setDialog] = useState<NameDialogState>({ open: false, name: '' });
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: 'none' });
  // Inline-rename state: which view id is being edited + the draft name.
  // Null when not editing.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Why the last rename attempt was rejected — shown inline under the row for
  // a few seconds (the old silent revert looked like the rename "took").
  const [renameError, setRenameError] = useState<{ id: string; msg: string } | null>(null);

  const connected = attach.attach.kind === 'attached';

  function openNewViewDialog() {
    setDialog({ open: true, name: '' });
  }

  // External "Create new view" trigger from Canvas / Palette empty
  // states. Tracked via a monotonic signal so connection-state
  // re-renders don't spuriously re-open the dialog.
  const lastHandledSignal = useRef(0);
  useEffect(() => {
    if (requestNewViewSignal === 0) return;
    if (requestNewViewSignal === lastHandledSignal.current) return;
    if (!connected) return;
    lastHandledSignal.current = requestNewViewSignal;
    openNewViewDialog();
  }, [requestNewViewSignal, connected]);

  function submitNewView() {
    const name = dialog.name.trim();
    if (!isValidViewName(name)) return;
    if (attach.views.some((v) => v.name.toLowerCase() === name.toLowerCase())) return;
    attach.createNewView(name);
    setDialog({ open: false, name: '' });
  }

  function beginRename(id: string, currentName: string) {
    setRenamingId(id);
    setRenameDraft(currentName);
  }

  function rejectRename(id: string, msg: string) {
    setRenameError({ id, msg });
    setTimeout(() => setRenameError((e) => (e && e.id === id ? null : e)), 5000);
    setRenamingId(null);
  }

  function commitRename() {
    if (renamingId === null) return;
    const name = renameDraft.trim();
    const current = attach.views.find((v) => v.id === renamingId);
    if (!current) {
      setRenamingId(null);
      return;
    }
    // Unchanged-vs-LABEL is still a real rename when the CODE name diverges
    // (legacy label/code splits, e.g. "BookInfoView" / "BookinfoView") — true
    // rename heals the divergence by carrying the code identity to the label.
    if (name === current.name && name === current.codeName) {
      setRenamingId(null); // no-op, not an error
      return;
    }
    if (!isValidViewName(name)) {
      rejectRename(
        renamingId,
        'Names become the controller class: start with a letter; only letters, digits, dashes, underscores (no spaces).',
      );
      return;
    }
    // Collision against every OTHER view's label AND code name — a rename is
    // a TRUE rename now (controller class + prefab move with it), so the new
    // name must be unique in both namespaces. The bridge re-validates.
    const lower = name.toLowerCase();
    const clash = attach.views.find(
      (v) =>
        v.id !== renamingId &&
        (v.name.toLowerCase() === lower || v.codeName.toLowerCase() === lower),
    );
    if (clash) {
      rejectRename(renamingId, `"${name}" is already used by view "${clash.name}".`);
      return;
    }
    setRenameError(null);
    attach.renameView(renamingId, name);
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  // ---- Empty states ----

  if (!connected) {
    return (
      <PanelShell title="Views" disabled>
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-[13px] text-text-secondary m-0 leading-relaxed">
            Connect to a project to load its views, or create a sandbox.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={attach.openPicker}
              className="px-3.5 py-1.5 text-xs text-text-primary bg-transparent border border-border-default rounded-md hover:bg-bg-3"
            >
              Connect…
            </button>
            {onCreateSandbox && (
              <button
                type="button"
                onClick={onCreateSandbox}
                className="px-3.5 py-1.5 text-xs text-text-inverse font-semibold bg-accent-500 hover:bg-accent-400 rounded-md shadow-sm"
              >
                Create sandbox
              </button>
            )}
          </div>
        </div>
      </PanelShell>
    );
  }

  if (attach.views.length === 0) {
    return (
      <PanelShell title="Views" onAdd={openNewViewDialog}>
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-[13px] text-text-secondary m-0">No views yet.</p>
          <button
            type="button"
            onClick={openNewViewDialog}
            className="px-3.5 py-1.5 text-xs text-text-inverse font-semibold bg-accent-500 hover:bg-accent-400 rounded-md shadow-sm"
          >
            Create your first view
          </button>
        </div>
        {dialog.open && (
          <NameDialog
            value={dialog.name}
            collidesWith={attach.views.find((v) => v.name.toLowerCase() === dialog.name.trim().toLowerCase())?.name}
            onChange={(v) => setDialog((s) => ({ ...s, name: v }))}
            onCancel={() => setDialog({ open: false, name: '' })}
            onSubmit={submitNewView}
          />
        )}
      </PanelShell>
    );
  }

  // ---- Populated state ----

  // Stable alphabetical order — case-insensitive, locale-aware so
  // "alpha", "Beta", "γ" land where a human reads them. Bridge sends
  // registry order (insertion + updatedAt); sorting client-side keeps
  // the list from reshuffling on every autosave.
  const sortedViews = [...attach.views].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  return (
    <PanelShell title="Views" onAdd={openNewViewDialog}>
      <label
        className="flex items-center gap-2 px-3 py-1.5 mx-2 mb-1 rounded text-[12px] text-text-secondary hover:text-text-primary cursor-pointer select-none"
        title="When on, every change re-publishes the view's prefab in place — wired consumers update live (no manual Re-publish). Off: use the package button."
      >
        <input
          type="checkbox"
          checked={autoPublish}
          onChange={(e) => setAutoPublish(e.target.checked)}
          className="accent-accent-500"
        />
        Auto-publish on change
      </label>
      <div className="flex flex-col gap-px px-2 pb-2 overflow-y-auto">
        {sortedViews.map((v) => {
          const isActive = v.id === attach.activeViewId;
          const isRenaming = v.id === renamingId;
          return (
            <div
              key={v.id}
              className={`group relative flex items-center px-2 py-2 rounded-md cursor-pointer text-[13px] ${
                isActive
                  ? 'bg-bg-4 text-text-primary pl-[22px]'
                  : 'text-text-secondary hover:bg-bg-3 hover:text-text-primary pl-4'
              }`}
              onClick={() => {
                if (isRenaming) return;
                attach.loadView(v.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginRename(v.id, v.name);
              }}
              title={isActive ? `${v.name} — double-click to rename` : `Switch to ${v.name} (double-click to rename)`}
            >
              {isActive && (
                <span
                  className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-accent-500 rounded-sm"
                  style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
                />
              )}
              {v.stale && !isRenaming && (
                <span
                  className="shrink-0 mr-1.5 w-1.5 h-1.5 rounded-full bg-amber-400"
                  title="A component this view uses was edited after this view's prefab was published — re-publish to refresh it."
                />
              )}
              {isRenaming ? (
                <input
                  type="text"
                  autoFocus
                  value={renameDraft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  className="flex-1 min-w-0 bg-bg-4 border border-accent-500/50 rounded px-1.5 py-0.5 font-medium text-text-primary outline-none focus:border-accent-500"
                />
              ) : (
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                  {v.name}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  attach.republishView(v.id);
                }}
                title="Re-publish prefab — refresh this view's .prefab from the current design (placed instances update in place)"
                aria-label={`Re-publish prefab for ${v.name}`}
                className="ml-1 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-accent-400 hover:bg-bg-4 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <PackageCheck size={13} />
              </button>
              {renameError && renameError.id === v.id && (
                <span className="absolute left-4 right-2 top-full z-10 mt-0.5 px-2 py-1 rounded bg-bg-4 border border-danger/50 text-[11px] text-danger leading-snug shadow-lg">
                  {renameError.msg}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({ kind: 'delete', id: v.id, name: v.name });
                }}
                title="Delete view"
                aria-label={`Delete view ${v.name}`}
                className="ml-1 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-danger hover:bg-bg-4 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {dialog.open && (
        <NameDialog
          value={dialog.name}
          collidesWith={attach.views.find((v) => v.name.toLowerCase() === dialog.name.trim().toLowerCase())?.name}
          onChange={(v) => setDialog((s) => ({ ...s, name: v }))}
          onCancel={() => setDialog({ open: false, name: '' })}
          onSubmit={submitNewView}
        />
      )}

      {confirm.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete view "${confirm.name}"?`}
          body={
            <>
              Removes the registry entry from{' '}
              <code className="font-num text-text-primary">views.json</code>. The prefab and
              controller files stay in{' '}
              <code className="font-num text-text-primary">Assets/LensDesigner/</code> until you
              delete them in Lens Studio.{' '}
              <strong className="text-text-primary">Cannot be undone.</strong>
            </>
          }
          actions={[
            { label: 'Cancel', onClick: () => setConfirm({ kind: 'none' }) },
            {
              label: 'Delete',
              variant: 'danger',
              onClick: () => {
                attach.deleteView(confirm.id);
                setConfirm({ kind: 'none' });
              },
            },
          ]}
        />
      )}

    </PanelShell>
  );
}

// ---- Shell ----

function PanelShell({
  title,
  onAdd,
  disabled,
  children,
}: {
  title: string;
  onAdd?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3 className="m-0 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          {title}
        </h3>
        <div className="flex items-center gap-0.5">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              disabled={disabled}
              title="New view"
              aria-label="New view"
              className="w-[22px] h-[22px] flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-3 rounded disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Plus size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---- Name dialog (new view only — renames are inline) ----

interface NameDialogProps {
  value: string;
  /** Name of an existing view that collides (case-insensitive); shown
   *  as a warning + blocks submit. Undefined when there's no collision. */
  collidesWith?: string | undefined;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function NameDialog({ value, collidesWith, onChange, onCancel, onSubmit }: NameDialogProps) {
  const trimmed = value.trim();
  const valid = isValidViewName(trimmed) && !collidesWith;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
    >
      <div className="w-[440px] bg-bg-2 border border-border-default rounded-lg p-5 shadow-2xl">
        <h2 className="m-0 mb-1 text-base font-semibold text-text-primary">New view</h2>
        <p className="m-0 mb-4 text-xs text-text-secondary">
          Name becomes the prefab folder + controller class. The new view starts empty —
          your current view is unaffected and keeps autosaving.
        </p>
        <div className="flex flex-col gap-1.5 mb-4">
          <span className="text-[11px] font-semibold text-text-secondary">Name</span>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) onSubmit();
              if (e.key === 'Escape') onCancel();
            }}
            autoFocus
            spellCheck={false}
            className={`bg-bg-4 border text-text-primary rounded-md px-2.5 py-2 font-num text-[12.5px] focus:outline-none focus:ring-2 ${
              !trimmed || (isValidViewName(trimmed) && !collidesWith)
                ? 'border-border-subtle focus:border-accent-500 focus:ring-accent-500/20'
                : 'border-danger focus:ring-danger/20'
            }`}
          />
          <span className={`text-[11px] ${valid || !trimmed ? 'text-text-tertiary' : 'text-danger'}`}>
            {trimmed && !isValidViewName(trimmed)
              ? 'Must start with a letter; only letters, digits, dashes, underscores.'
              : 'Allowed: letters (start), digits, dashes, underscores.'}
          </span>
          {collidesWith && (
            <span className="text-[11px] text-warning">
              A view named "{collidesWith}" already exists.
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!valid}
            className="px-3.5 py-1.5 text-xs text-text-inverse font-semibold rounded-md bg-accent-500 hover:bg-accent-400 disabled:bg-bg-3 disabled:text-text-tertiary"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Confirm dialog (delete only) ----

interface ConfirmAction {
  label: string;
  variant?: 'primary' | 'danger' | 'danger-text';
  onClick: () => void;
}

function ConfirmDialog({
  title,
  body,
  actions,
}: {
  title: string;
  body: React.ReactNode;
  actions: ConfirmAction[];
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
    >
      <div className="w-[400px] bg-bg-2 border border-border-default rounded-lg p-5 shadow-2xl">
        <h2 className="m-0 mb-2 text-[15px] font-semibold text-text-primary">{title}</h2>
        <p className="m-0 mb-4 text-xs text-text-secondary leading-relaxed">{body}</p>
        <div className="flex justify-end gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={
                a.variant === 'primary'
                  ? 'px-3.5 py-1.5 text-xs text-text-inverse font-semibold bg-accent-500 hover:bg-accent-400 rounded-md'
                  : a.variant === 'danger'
                  ? 'px-3.5 py-1.5 text-xs text-text-inverse font-semibold bg-danger hover:bg-red-400 rounded-md'
                  : a.variant === 'danger-text'
                  ? 'px-3.5 py-1.5 text-xs text-danger border border-border-default rounded-md hover:bg-bg-3'
                  : 'px-3.5 py-1.5 text-xs text-text-secondary border border-border-default rounded-md hover:bg-bg-3 hover:text-text-primary'
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
