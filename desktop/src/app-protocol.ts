// app-protocol.ts — register the custom `app://` protocol that serves
// the Next.js static export from disk. The renderer loads via
// `app://lens-designer/index.html` (TD-4).
//
// Why a custom scheme rather than file://: file:// URLs hit a long
// list of browser quirks (origin = null, mixed-content rules, fetch
// restrictions, no clean CSP attachment). A custom scheme registered
// as { standard, secure, supportFetchAPI } gives us a real origin and
// lets the renderer issue WS/fetch calls to localhost:9229 with a
// proper CSP. Electron has built-in support since 17.

import { protocol, net } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_PROTOCOL_SCHEME = 'app';
export const APP_PROTOCOL_HOST = 'lens-designer';

const DEFAULT_CSP = [
  "default-src 'self' app:",
  // Bridge connections — WS + HTTP on loopback. Ports may shift if
  // 9229/9230 are taken (Step 11 will surface settings overrides).
  "connect-src 'self' app: ws://127.0.0.1:* http://127.0.0.1:*",
  // Next.js's runtime injects inline scripts for hydration; allow
  // self + inline. unsafe-eval is blocked.
  "script-src 'self' app: 'unsafe-inline'",
  // Google Fonts CSS (fonts.googleapis.com) for the canvas's built-in
  // font preview. unsafe-inline still needed for Next's runtime styles.
  "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' app: data: http://127.0.0.1:*",
  // fonts.gstatic.com — Google-Fonts .woff2 for the built-in faces.
  // http://127.0.0.1:* — the bridge HTTP server serves uploaded
  // .ttf/.otf bytes that Canvas registers via the FontFace API.
  // Without the loopback entry, uploaded-font previews fall back to
  // system fonts even though LS renders them correctly.
  "font-src 'self' app: data: https://fonts.gstatic.com http://127.0.0.1:*",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ');

/**
 * Must run before app.whenReady — Electron requires privileged
 * schemes to be registered at this stage.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Wire the handler. Call inside app.whenReady().
 *
 * @param webDistDir absolute path to the directory holding the
 *                   Next.js export (`index.html`, `_next/...`, etc.).
 */
export function installAppHandler(webDistDir: string): void {
  const root = resolve(webDistDir);

  protocol.handle(APP_PROTOCOL_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_PROTOCOL_HOST) {
      return new Response('Not found', { status: 404 });
    }

    // Resolve pathname → on-disk path. Strip the leading "/".
    const requested = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const candidate = requested === '' ? 'index.html' : requested;
    const resolved = normalize(join(root, candidate));

    // Path-traversal guard: every resolved path must stay inside root.
    if (!resolved.startsWith(root)) {
      return new Response('Forbidden', { status: 403 });
    }

    // If the resolved path is a directory, append index.html.
    let finalPath = resolved;
    try {
      const s = statSync(finalPath);
      if (s.isDirectory()) {
        finalPath = join(finalPath, 'index.html');
      }
    } catch {
      // not found — fall through; net.fetch will 404 below
    }

    // Next's static export uses extensionless URLs (`/foo` → `/foo.html`).
    // If the file doesn't exist as-is, try appending .html before failing.
    if (!existsSync(finalPath) && extname(finalPath) === '') {
      const withHtml = `${finalPath}.html`;
      if (existsSync(withHtml)) finalPath = withHtml;
    }

    const fileUrl = pathToFileURL(finalPath).toString();
    const response = await net.fetch(fileUrl);

    // Re-emit with our CSP attached. net.fetch returns a Response;
    // we copy body + status + content-type and overlay headers.
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', DEFAULT_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  });
}

// Exported for tests.
export const _internals = {
  DEFAULT_CSP,
};
