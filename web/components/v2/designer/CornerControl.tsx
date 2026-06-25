'use client';

import { useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { cn } from '@/lib/v2/cn';

/** Individual rounded corners — the headline extension over UIKit, whose
 *  RoundedRectangle only exposes a single `cornerRadius` uniform.
 *
 *  Linked mode maps to that uniform and works against the stock shader today.
 *  Unlinked (true per-corner) requires the forked CollapsedSquircle shader (4
 *  uniforms + per-quadrant SDF) — see uikit/corners. The four values are
 *  captured here so the fork applies them once the shader lands. */
export function CornerControl() {
  const [linked, setLinked] = useState(true);
  const [all, setAll] = useState('1');
  const [corners, setCorners] = useState({ tl: '1', tr: '1', br: '1', bl: '1' });

  const setCorner = (k: keyof typeof corners, v: string): void =>
    setCorners((c) => ({ ...c, [k]: v }));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs text-text-tertiary">{linked ? 'Uniform' : 'Per-corner'}</span>
        <button
          onClick={() => setLinked((l) => !l)}
          title={linked ? 'Unlink corners' : 'Link corners'}
          className={cn(
            'flex items-center gap-1 px-1.5 h-5 rounded text-2xs border transition-colors',
            linked
              ? 'border-subtle text-text-tertiary hover:text-text-secondary'
              : 'border-[rgba(34,211,238,0.3)] text-accent-300',
          )}
        >
          {linked ? <Link2 className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
          {linked ? 'Linked' : 'Split'}
        </button>
      </div>

      {linked ? (
        <div className="flex items-center justify-between h-8">
          <span className="text-xs text-text-secondary">Radius</span>
          <input
            value={all}
            onChange={(e) => setAll(e.target.value)}
            className="w-28 h-6 px-2 rounded-md bg-bg-2 border border-default text-2xs text-text-primary text-right font-num outline-none focus:border-strong"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="text-2xs uppercase text-text-tertiary w-5">{k}</span>
                <input
                  value={corners[k]}
                  onChange={(e) => setCorner(k, e.target.value)}
                  className="flex-1 h-6 px-2 rounded-md bg-bg-2 border border-default text-2xs text-text-primary text-right font-num outline-none focus:border-strong"
                />
              </div>
            ))}
          </div>
          <p className="text-2xs text-text-tertiary mt-1.5 leading-relaxed">
            Split corners use the forked squircle shader.
          </p>
        </>
      )}
    </div>
  );
}
