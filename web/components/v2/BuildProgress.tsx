'use client';

import {
  Sparkles,
  Loader2,
  Check,
  AlertTriangle,
  Box,
  Music,
  AudioWaveform,
  LayoutPanelTop,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAgentStore, type ThreadStatus } from '@/lib/v2/agent-store';
import type { LDBuildStepKind } from '@/lib/v2/native';
import { cn } from '@/lib/v2/cn';
import { Button } from './ui/Primitives';

const KIND_ICON: Record<LDBuildStepKind, LucideIcon> = {
  mesh: Box,
  music: Music,
  sfx: AudioWaveform,
  ui: LayoutPanelTop,
};

function StatusIcon({ status }: { status: ThreadStatus }) {
  if (status === 'running')
    return <Loader2 className="w-4 h-4 animate-spin text-accent-400" />;
  if (status === 'done') return <Check className="w-4 h-4 text-success" />;
  if (status === 'error') return <AlertTriangle className="w-4 h-4 text-danger" />;
  return <span className="w-2 h-2 rounded-full bg-text-tertiary" />;
}

/** Live interstitial for an orchestrated build: planning → per-step jobs →
 *  done. Each step is a real tracked job; assets import as they finish. */
export function BuildProgress() {
  const build = useAgentStore((s) => s.build);
  const threads = useAgentStore((s) => s.threads);
  const dismissBuild = useAgentStore((s) => s.dismissBuild);
  const startBuild = useAgentStore((s) => s.startBuild);

  if (build.phase === 'idle') return null;

  const steps = build.stepThreadIds
    .map((id) => threads.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  const doneCount = steps.filter((t) => t.status === 'done' || t.status === 'error').length;
  const total = steps.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-fade-in">
      <div className="relative w-[560px] max-w-[92vw] rounded-2xl border border-default bg-bg-1 shadow-2xl overflow-hidden">
        {(build.phase === 'done' || build.phase === 'error') && (
          <button
            onClick={dismissBuild}
            className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="p-6">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg accent-bg shadow-[0_0_16px_-4px_var(--accent-glow)]">
              <Sparkles className="w-4 h-4 text-text-inverse" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                {build.phase === 'planning'
                  ? 'Planning your experience…'
                  : build.phase === 'building'
                    ? 'Building your experience'
                    : build.phase === 'done'
                      ? 'Build complete'
                      : 'Build failed'}
              </h2>
              <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">
                {build.summary || build.prompt}
              </p>
            </div>
          </div>

          {build.phase === 'planning' && (
            <div className="flex items-center gap-2 text-sm text-text-secondary mt-6 mb-1">
              <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
              Asking CLAD what this needs…
            </div>
          )}

          {build.phase === 'error' && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.07)] p-3">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">{build.error}</p>
            </div>
          )}

          {(build.phase === 'building' || build.phase === 'done') && (
            <>
              {/* progress bar */}
              <div className="mt-5 mb-3">
                <div className="flex items-center justify-between text-2xs text-text-tertiary mb-1.5">
                  <span>
                    {doneCount} / {total} steps
                  </span>
                  <span>assets import as they finish</span>
                </div>
                <div className="h-1.5 rounded-full bg-bg-3 overflow-hidden">
                  <div
                    className="h-full accent-bg transition-all duration-500"
                    style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* per-step rows */}
              <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                {steps.map((t) => {
                  const Icon = KIND_ICON[t.kind as LDBuildStepKind] ?? Box;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors',
                        t.status === 'running'
                          ? 'border-[rgba(34,211,238,0.25)] bg-bg-2'
                          : 'border-subtle bg-bg-1',
                      )}
                    >
                      <Icon className="w-4 h-4 text-text-tertiary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary truncate">{t.title}</div>
                        <div className="text-2xs text-text-tertiary capitalize">{t.kind}</div>
                      </div>
                      <StatusIcon status={t.status} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* actions */}
          <div className="mt-6 flex items-center justify-end gap-2">
            {build.phase === 'building' && (
              <Button variant="ghost" size="md" onClick={dismissBuild}>
                Run in background
              </Button>
            )}
            {build.phase === 'done' && (
              <Button variant="primary" size="md" onClick={dismissBuild}>
                Done
              </Button>
            )}
            {build.phase === 'error' && (
              <>
                <Button variant="ghost" size="md" onClick={dismissBuild}>
                  Close
                </Button>
                <Button variant="primary" size="md" onClick={() => void startBuild(build.prompt)}>
                  Retry
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
