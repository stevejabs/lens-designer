'use client';

import { AppShell } from '@/components/v2/AppShell';

// Lens Designer v2 — the cockpit shell. The legacy four-pane primitive
// editor (Canvas/Inspector/Palette/Layers under components/) is retired;
// its salvageable pieces are lifted into the v2 surfaces under components/v2.
export default function Page() {
  return <AppShell />;
}
