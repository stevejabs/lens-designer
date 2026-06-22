'use client';

// Lens Designer mark — a faceted aperture/lens glyph on the accent gradient.
// `size` controls the square px box; the gradient id is unique per render.
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="ld-mark" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="0.55" stopColor="#818cf8" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#ld-mark)" opacity="0.16" />
      <rect
        x="2.6"
        y="2.6"
        width="26.8"
        height="26.8"
        rx="7.6"
        stroke="url(#ld-mark)"
        strokeOpacity="0.5"
        strokeWidth="1.2"
      />
      <path
        d="M16 7.5 L23.5 12 V21 L16 25.5 L8.5 21 V12 Z"
        stroke="url(#ld-mark)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.5" r="3.2" fill="url(#ld-mark)" />
    </svg>
  );
}
