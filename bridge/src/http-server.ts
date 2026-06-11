// HTTP server for serving preview PNGs out of a temp directory.
//
// Bridge writes captures into `os.tmpdir()/lens-designer-previews/<uuid>.png`
// and emits a `preview.ready` WS message with the matching URL. The
// browser then fetches `http://localhost:<port>/preview/<uuid>.png`.
//
// Auth: none. The bridge binds 127.0.0.1 and the UUIDs are unguessable.
// Old files (>5 min) get cleaned up opportunistically on every request,
// so the temp dir doesn't grow without bound.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestFontBytes, ingestImageBytes, sandboxAssetPath, type McpClient } from './mcp.ts';

const PREVIEW_DIR = join(tmpdir(), 'lens-designer-previews');
const PREVIEW_MAX_AGE_MS = 5 * 60_000;

/** Where preview PNGs land on disk. Exported so the capture path can write here. */
export function previewDir(): string {
  return PREVIEW_DIR;
}

/** Ensure the preview directory exists. Idempotent. */
export async function ensurePreviewDir(): Promise<void> {
  await mkdir(PREVIEW_DIR, { recursive: true });
}

/**
 * Best-effort cleanup of preview PNGs older than PREVIEW_MAX_AGE_MS.
 * Called opportunistically (every HTTP request); never throws — a
 * failure to clean up shouldn't break a GET.
 */
async function sweepStalePreviews(): Promise<void> {
  try {
    const entries = await readdir(PREVIEW_DIR);
    const cutoff = Date.now() - PREVIEW_MAX_AGE_MS;
    await Promise.all(
      entries.map(async (name) => {
        const full = join(PREVIEW_DIR, name);
        try {
          const s = await stat(full);
          if (s.mtimeMs < cutoff) await unlink(full);
        } catch {
          // entry vanished mid-sweep; nothing to do
        }
      }),
    );
  } catch {
    // PREVIEW_DIR doesn't exist yet, or we couldn't read it. Ignored.
  }
}

export interface HttpServerHandle {
  port: number;
  close(): Promise<void>;
}

/**
 * POST /ingest-image — write an image into the sandbox as a texture and
 * return its asset path + dimensions. Two body shapes:
 *   - JSON  { "url": "https://…" }  → bridge fetches the URL.
 *   - raw bytes (any image content-type) → uploaded directly; extension
 *     comes from the `x-image-ext` header (defaults png).
 * Response: { path, width, height }.
 */
async function handleIngest(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  const sandbox = options.getTarget?.();
  if (!sandbox) {
    res.writeHead(503, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ error: 'sandbox not reachable' }));
    return;
  }
  try {
    const body = await readBody(req);
    const contentType = req.headers['content-type'] ?? null;
    let bytes: Buffer;
    let ext: string;

    if (contentType?.includes('application/json')) {
      const { url } = JSON.parse(body.toString('utf8')) as { url?: string };
      if (!url) throw new Error('missing url');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} → HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
      ext = guessExt(url, r.headers.get('content-type'));
    } else {
      bytes = body;
      const hdr = req.headers['x-image-ext'];
      ext = (Array.isArray(hdr) ? hdr[0] : hdr)?.toLowerCase() ?? guessExt('', contentType);
    }

    const { path, info } = await ingestImageBytes(sandbox.client, bytes, ext);
    res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ path, width: info.width, height: info.height }));
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ error: (err as Error).message }));
  }
}

export interface HttpServerOptions {
  /** Resolve the live sandbox MCP client (for image ingestion), or null. */
  getTarget?: () => { client: McpClient; port: number } | null;
}

/** Max upload size — guards against a runaway POST. 32 MB is plenty for UI art. */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Read a full request body into a Buffer, capped at MAX_UPLOAD_BYTES. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_UPLOAD_BYTES) {
        fail(new Error('upload exceeds 32 MB limit'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-image-ext, x-font-ext',
};

/**
 * POST /ingest-font — write a .ttf/.otf into the sandbox so LS imports it as
 * a Font asset. Body shapes mirror /ingest-image (raw bytes + `x-font-ext`,
 * or JSON {url}). Response: { path, uuid, name }.
 */
async function handleIngestFont(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  const sandbox = options.getTarget?.();
  if (!sandbox) {
    res.writeHead(503, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ error: 'sandbox not reachable' }));
    return;
  }
  try {
    const body = await readBody(req);
    const contentType = req.headers['content-type'] ?? null;
    let bytes: Buffer;
    let ext: string;
    if (contentType?.includes('application/json')) {
      const { url } = JSON.parse(body.toString('utf8')) as { url?: string };
      if (!url) throw new Error('missing url');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} → HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
      ext = url.match(/\.(ttf|otf)(?:\?|#|$)/i)?.[1]?.toLowerCase() ?? 'ttf';
    } else {
      bytes = body;
      const hdr = req.headers['x-font-ext'];
      ext = (Array.isArray(hdr) ? hdr[0] : hdr)?.toLowerCase() ?? 'ttf';
    }
    const { path, uuid, name } = await ingestFontBytes(sandbox.client, bytes, ext);
    res.writeHead(200, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ path, uuid, name }));
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json', ...CORS_HEADERS })
      .end(JSON.stringify({ error: (err as Error).message }));
  }
}

/** Guess an image extension from a URL or content-type. */
function guessExt(url: string, contentType: string | null): string {
  const fromUrl = url.match(/\.([a-z0-9]{3,4})(?:\?|#|$)/i)?.[1]?.toLowerCase();
  if (fromUrl && /^(png|jpg|jpeg|webp|gif)$/.test(fromUrl)) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
  const fromCt = contentType?.match(/image\/([a-z0-9]+)/i)?.[1]?.toLowerCase();
  if (fromCt) return fromCt === 'jpeg' ? 'jpg' : fromCt;
  return 'png';
}

/**
 * Start an HTTP server that serves preview PNGs and ingests images on
 * `127.0.0.1:port`. Listens on the requested port, or picks a free one
 * if `port = 0`.
 */
export async function startHttpServer(
  port: number,
  options: HttpServerOptions = {},
): Promise<HttpServerHandle> {
  await ensurePreviewDir();

  const server: Server = createServer(async (req, res) => {
    // Fire-and-forget cleanup on every request. Doesn't block the response.
    void sweepStalePreviews();

    if (!req.url) {
      res.writeHead(400).end();
      return;
    }

    // CORS preflight (the web app POSTs cross-origin from :3001).
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS).end();
      return;
    }

    // Image ingestion: POST raw bytes (x-image-ext header) or JSON {url}.
    if (req.method === 'POST' && req.url.replace(/\?.*$/, '') === '/ingest-image') {
      await handleIngest(req, res, options);
      return;
    }

    // Font ingestion: POST raw bytes (x-font-ext header) or JSON {url}.
    if (req.method === 'POST' && req.url.replace(/\?.*$/, '') === '/ingest-font') {
      await handleIngestFont(req, res, options);
      return;
    }

    // Serve an ingested sandbox font back to the canvas (FontFace preview).
    const fontMatch = req.url.match(/^\/font\/(LensDesigner\/fonts\/[^?]+)(?:\?.*)?$/);
    if (req.method === 'GET' && fontMatch) {
      try {
        const abs = sandboxAssetPath(decodeURIComponent(fontMatch[1]!));
        const data = await readFile(abs);
        const ct = abs.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf';
        res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store', ...CORS_HEADERS });
        res.end(data);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('not found');
      }
      return;
    }

    // Serve a system-installed font for the SystemFontPicker preview.
    // Path is URL-encoded in the segment; refused unless under a known
    // OS font dir (`fontPathIsTrusted` — same guard as the WS
    // `fonts.add-from-system` handler). Cache long: a system font's
    // bytes don't change between picker opens. Adding `immutable`
    // would be wrong (user could install a new version with the same
    // path) — 1h is a reasonable compromise.
    const sysFontMatch = req.url.match(/^\/system-font\/(.+?)(?:\?.*)?$/);
    if (req.method === 'GET' && sysFontMatch) {
      try {
        const { fontPathIsTrusted } = await import('./fonts-system.ts');
        const abs = decodeURIComponent(sysFontMatch[1]!);
        if (!fontPathIsTrusted(abs)) {
          res.writeHead(403, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('forbidden');
          return;
        }
        const data = await readFile(abs);
        const ct = abs.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf';
        res.writeHead(200, {
          'content-type': ct,
          'cache-control': 'public, max-age=3600',
          ...CORS_HEADERS,
        });
        res.end(data);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('not found');
      }
      return;
    }

    // Serve an ingested sandbox image back to the canvas. Scoped to the
    // images dir; the path resolver rejects traversal outside Assets/.
    const imgMatch = req.url.match(/^\/image\/(LensDesigner\/images\/[^?]+)(?:\?.*)?$/);
    if (req.method === 'GET' && imgMatch) {
      try {
        const abs = sandboxAssetPath(decodeURIComponent(imgMatch[1]!));
        const data = await readFile(abs);
        const ext = abs.split('.').pop()?.toLowerCase() ?? 'png';
        const ct = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
        res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store', ...CORS_HEADERS });
        res.end(data);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('not found');
      }
      return;
    }

    // UUID-shaped (one-off snapshots) or the literal `live.png` (live
    // preview loop's fixed rolling slot). No other names allowed.
    const match = req.url.match(/^\/preview\/([0-9a-f-]+\.png|live\.png)(?:\?.*)?$/i);
    if (!match) {
      res.writeHead(404, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('not found');
      return;
    }

    const filename = match[1]!;
    const path = join(PREVIEW_DIR, filename);

    try {
      const data = await readFile(path);
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(data.byteLength),
        'cache-control': 'no-store',
        ...CORS_HEADERS,
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain', ...CORS_HEADERS }).end('not found');
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    const host = process.env['BRIDGE_BIND_ALL'] ? '0.0.0.0' : '127.0.0.1';
    server.listen(port, host, () => {
      server.off('error', fail);
      ok();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('HTTP server failed to bind a TCP port');
  }

  return {
    port: addr.port,
    async close() {
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
