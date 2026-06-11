import type { NextConfig } from 'next';

// Static export so the Electron app can load the designer via a
// custom `app://` protocol with no Next server runtime (TD-4). The
// web app has zero API routes + no server-only code paths; this
// produces a flat `out/` tree of HTML/CSS/JS we can serve from disk.

const config: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  // Static export requires unoptimized images (no server endpoint).
  // Lens Designer's renderer doesn't use <Image /> — this is defense.
  images: { unoptimized: true },
  // The bridge package ships .ts source; Next compiles it on demand.
  transpilePackages: ['@lens-designer/bridge'],
};

export default config;
