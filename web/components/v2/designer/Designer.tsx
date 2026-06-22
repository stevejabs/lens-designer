'use client';

import { useUiStore } from '@/lib/v2/ui-store';
import { DesignerLeft } from './DesignerLeft';
import { DesignerCanvas } from './DesignerCanvas';
import { Inspector } from './Inspector';

export function Designer() {
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  return (
    <div className="flex flex-1 min-h-0">
      <DesignerLeft />
      <DesignerCanvas />
      {inspectorOpen && <Inspector />}
    </div>
  );
}
