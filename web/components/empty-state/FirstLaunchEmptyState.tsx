// FirstLaunchEmptyState.tsx — design surface 1.
//
// Shown when settings.sandboxPath === null AND attachTarget === null.
// Primary CTA is "Attach to a project" (per owner-locked design
// pass on 2026-05-27). Sandbox CTA + "I already have one" link sit
// in a secondary section under a divider.

'use client';

import { useEffect, useRef } from 'react';
import { Link2 } from 'lucide-react';

export interface FirstLaunchEmptyStateProps {
  onAttach: () => void;
  onCreateSandbox: () => void;
  onLocateSandbox: () => void;
}

export function FirstLaunchEmptyState(
  props: FirstLaunchEmptyStateProps,
): React.JSX.Element {
  const attachButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the primary CTA on mount so the user can hit Enter.
    attachButtonRef.current?.focus();
  }, []);

  return (
    <main
      role="main"
      className="flex-1 flex items-center justify-center px-6 py-12 bg-bg-0"
    >
      <div className="w-full max-w-[540px] bg-bg-1 rounded-xl px-9 pt-10 pb-9 text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-[14px] bg-bg-2 border border-border-subtle flex items-center justify-center text-accent-400">
          <Link2 size={30} strokeWidth={1.6} />
        </div>

        <h1 className="text-[20px] font-semibold tracking-tight text-text-primary m-0 mb-2.5">
          Attach to a project
        </h1>
        <p className="text-text-secondary text-[13.5px] leading-[21px] m-0 mb-6">
          Lens Designer authors UI primitives inside a Lens Studio project.
          Point it at the project you&rsquo;re working on &mdash; we install
          the LensDesigner package into it.
        </p>

        <div className="flex items-center justify-center gap-3.5">
          <button
            ref={attachButtonRef}
            type="button"
            onClick={props.onAttach}
            className="px-4 py-2 text-[13px] font-semibold text-text-inverse bg-accent-500 hover:bg-accent-400 rounded-md transition-colors shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_6px_14px_-4px_rgba(14,165,233,0.35)]"
          >
            Attach to a project
          </button>
        </div>

        <div className="mt-7 pt-6 border-t border-border-subtle">
          <div className="flex items-center gap-3 mb-3 text-text-tertiary text-[11.5px] tracking-wider">
            <span className="flex-1 h-px bg-border-subtle" />
            <span className="uppercase font-semibold">or, start with a sandbox</span>
            <span className="flex-1 h-px bg-border-subtle" />
          </div>
          <p className="text-[12.5px] text-text-secondary m-0 mb-4">
            A pre-wired Lens Studio project we maintain. Ships ready to use
            &mdash; good for trying the tool or building a one-off view.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={props.onCreateSandbox}
              className="px-4 py-2 text-[13px] text-text-primary bg-bg-3 hover:bg-bg-4 border border-border-default rounded-md transition-colors"
            >
              Create sandbox
            </button>
            <button
              type="button"
              onClick={props.onLocateSandbox}
              className="text-[13px] text-accent-400 hover:text-accent-300 bg-transparent border-0 cursor-pointer"
            >
              I already have one
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
