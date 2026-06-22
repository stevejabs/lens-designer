import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lens Designer',
  description: 'Visual + agentic authoring for SPECS AR — on top of Lens Studio 5.22 and CLAD.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter powers the UI chrome. Loaded via <link> (runtime) rather
            than next/font so a static export never depends on a build-time
            fetch. Falls back to the system stack if offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
