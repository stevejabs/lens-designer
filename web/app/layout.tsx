import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lens Designer',
  description: 'WYSIWYG editor for Spectacles UI primitives.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* LS-bundled font matches we ship: Libre Baskerville, Cutive
            Mono, Merriweather. Loaded from Google Fonts so the canvas
            SVG renders the same typeface the LS Spectacles Preview
            will render. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Cutive+Mono&family=Merriweather:wght@300;400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
