'use client';

// DetectedInstances — the live "what Lens Studio is running right now" list,
// shown inline on the first-launch landing so the user sees every reachable
// LS MCP instance (ports 50000–51000) the moment Lens Designer loads, instead
// of having to open a picker.
//
// Projects Lens Designer has already set up (they carry an
// Assets/LensDesigner/views.json manifest → `configured`) are ELEVATED to the
// top with a "Set up" badge and attach in one click — the bridge resolved
// their Assets dir from the scan, so there's nothing to re-Browse. Other
// reachable instances list below; selecting one opens the attach dialog to
// confirm the Assets path before we write the LensDesigner pack into it.

import type { TargetSummary } from '@lens-designer/bridge/client';
import { RefreshCw, Plug, FolderOpen } from 'lucide-react';

export interface DetectedInstancesProps {
  instances: TargetSummary[];
  scanning: boolean;
  /** Select an instance. Configured instances attach in one click; others open
   *  the attach dialog (the parent decides via `instance.configured`). */
  onSelect: (t: TargetSummary) => void;
  onRescan: () => void;
}

export function DetectedInstances({
  instances,
  scanning,
  onSelect,
  onRescan,
}: DetectedInstancesProps): React.JSX.Element {
  // Elevate configured (already-set-up) projects to the top; otherwise keep the
  // scan's lowest-port-first order.
  const ordered = [...instances].sort((a, b) => {
    const ca = a.configured ? 1 : 0;
    const cb = b.configured ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return a.port - b.port;
  });

  return (
    <section className="text-left mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="m-0 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
          Lens Studio instances
        </h2>
        <button
          type="button"
          onClick={onRescan}
          aria-label="Rescan for Lens Studio instances"
          title="Rescan"
          className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : undefined} />
          {scanning ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-bg-2/40 px-4 py-5 text-[12.5px] text-text-secondary leading-relaxed">
          {scanning
            ? 'Scanning ports 50000–51000…'
            : 'No Lens Studio instances detected on ports 50000–51000. Open your project in Lens Studio (its MCP server starts a few seconds after launch), then Rescan.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
          {ordered.map((t) => (
            <li key={t.port}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                title={t.assetsDir ?? undefined}
                className={`w-full text-left grid grid-cols-[18px_1fr_auto] gap-2.5 items-center rounded-lg border px-3 py-2.5 transition-colors ${
                  t.configured
                    ? 'border-accent-500/40 bg-accent-500/[0.06] hover:bg-accent-500/[0.12]'
                    : 'border-border-subtle hover:bg-bg-3'
                }`}
              >
                {t.configured ? (
                  <Plug size={16} className="text-accent-400" />
                ) : (
                  <FolderOpen size={16} className="text-text-tertiary" />
                )}
                <span className="flex flex-col min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary truncate">
                    {t.projectName ?? `port ${t.port}`}
                    {t.configured && (
                      <span className="px-1 py-px text-[9px] font-bold uppercase tracking-wider text-accent-300 bg-accent-500/20 rounded">
                        Set up
                      </span>
                    )}
                    {t.hasMarker && (
                      <span className="px-1 py-px text-[9px] font-bold uppercase tracking-wider text-text-secondary bg-bg-4 rounded">
                        Sandbox
                      </span>
                    )}
                  </span>
                  {t.assetsDir && (
                    <span className="text-[10.5px] text-text-tertiary font-num truncate">
                      {t.assetsDir}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-num text-[11px] text-text-tertiary">:{t.port}</span>
                  <span className="text-[11px] font-semibold text-accent-400">
                    {t.configured ? 'Attach' : 'Set up…'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
