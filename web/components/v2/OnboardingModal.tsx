'use client';

import { useState } from 'react';
import { Sparkles, FolderTree, AlertTriangle, ArrowRight, Loader2, X } from 'lucide-react';
import { useOnboarding } from '@/lib/v2/hooks';
import { useAgentStore } from '@/lib/v2/agent-store';
import { useUiStore } from '@/lib/v2/ui-store';
import { Button } from './ui/Primitives';

/** First-run onboarding: organize an existing project's scene into the app bay
 *  (gated behind explicit confirm + a commit-first reminder), or kick off a
 *  CLAD build for an empty project. */
export function OnboardingModal() {
  const { state, busy, organize, dismiss } = useOnboarding();
  const startBuild = useAgentStore((s) => s.startBuild);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const [buildPrompt, setBuildPrompt] = useState('');

  if (state.kind === 'none') return null;

  const onBuild = (): void => {
    const text = buildPrompt.trim();
    if (!text) return;
    setAgentOpen(true);
    dismiss(); // close onboarding; BuildProgress takes over
    void startBuild(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="relative w-[520px] max-w-[92vw] rounded-2xl border border-default bg-bg-1 shadow-2xl overflow-hidden">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-3 transition-colors"
          title="Not now"
        >
          <X className="w-4 h-4" />
        </button>

        {state.kind === 'organize' ? (
          <div className="p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg accent-bg shadow-[0_0_16px_-4px_var(--accent-glow)]">
                <FolderTree className="w-4 h-4 text-text-inverse" />
              </span>
              <h2 className="text-base font-semibold text-text-primary">Set up this project</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed mt-2">
              Lens Designer will move your app content under the <b>App Bay</b> so the Design/Run
              posture controls it. Core SPECS objects stay at the scene root.
            </p>

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.07)] p-3">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">
                This rewrites your scene. <b className="text-text-primary">Commit your work in git first</b>{' '}
                so you can roll back if needed.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wider text-accent-300 mb-1.5">
                  Moves to App Bay
                </div>
                <ul className="space-y-1">
                  {state.moveToAppBay.map((n) => (
                    <li key={n} className="text-xs text-text-secondary truncate">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                  Stays at root
                </div>
                <ul className="space-y-1">
                  {state.stayAtRoot.map((n) => (
                    <li key={n} className="text-xs text-text-tertiary truncate">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="ghost" size="md" onClick={dismiss} disabled={busy}>
                Not now
              </Button>
              <Button variant="primary" size="md" onClick={() => void organize()} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Organizing…
                  </>
                ) : (
                  <>
                    I’ve committed — proceed <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg accent-bg shadow-[0_0_16px_-4px_var(--accent-glow)]">
                <Sparkles className="w-4 h-4 text-text-inverse" />
              </span>
              <h2 className="text-base font-semibold text-text-primary">Start building</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed mt-2">
              This project is empty. Describe what you want to build and Lens Designer will have CLAD
              create it — the views and assets import here as they’re made.
            </p>
            <textarea
              value={buildPrompt}
              onChange={(e) => setBuildPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onBuild();
                }
              }}
              rows={3}
              autoFocus
              placeholder="e.g. a cozy bookshelf where I can pull books off the shelf and read them"
              className="mt-4 w-full resize-none rounded-lg border border-default bg-bg-2 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-strong"
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" size="md" onClick={dismiss}>
                I’ll start from scratch
              </Button>
              <Button variant="primary" size="md" onClick={onBuild} disabled={!buildPrompt.trim()}>
                Build it <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
