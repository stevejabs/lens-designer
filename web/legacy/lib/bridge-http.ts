// Helpers for the bridge's HTTP server (port 9230): image ingestion and
// serving ingested images back to the canvas.

export function bridgeHttpOrigin(): string {
  if (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_BRIDGE_HTTP']) {
    return process.env['NEXT_PUBLIC_BRIDGE_HTTP']!;
  }
  if (typeof window !== 'undefined') {
    // Mirror bridge-client.ts: under the Electron `app://` protocol,
    // the protocol slug isn't a real host; the bridge binds 127.0.0.1.
    if (window.location.protocol === 'app:') {
      return 'http://127.0.0.1:9230';
    }
    return `http://${window.location.hostname}:9230`;
  }
  return 'http://localhost:9230';
}

export interface IngestResult {
  /** Sandbox-relative texture path, stored in the node's imageSource. */
  path: string;
  width: number;
  height: number;
}

/** Upload a local file → bridge writes it into the sandbox as a texture. */
export async function ingestImageFile(file: File): Promise<IngestResult> {
  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
  const res = await fetch(`${bridgeHttpOrigin()}/ingest-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-image-ext': ext },
    body: file,
  });
  if (!res.ok) throw new Error(`ingest failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<IngestResult>;
}

/** Hand the bridge a URL to fetch + import as a texture. */
export async function ingestImageUrl(url: string): Promise<IngestResult> {
  const res = await fetch(`${bridgeHttpOrigin()}/ingest-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`ingest failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<IngestResult>;
}

/** Browser-displayable URL for an ingested sandbox image path. */
export function bridgeImageUrl(sandboxPath: string): string {
  return `${bridgeHttpOrigin()}/image/${sandboxPath}`;
}

export interface FontIngestResult {
  /** Sandbox-relative font path, stored in the node's `font` property. */
  path: string;
  /** LS Font asset UUID. */
  uuid: string;
  /** LS asset name (derived from the filename). */
  name: string;
}

/** Upload a local .ttf/.otf → bridge writes it into the sandbox as a Font. */
export async function ingestFontFile(file: File): Promise<FontIngestResult> {
  const ext = (file.name.split('.').pop() ?? 'ttf').toLowerCase();
  const res = await fetch(`${bridgeHttpOrigin()}/ingest-font`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-font-ext': ext },
    body: file,
  });
  if (!res.ok) throw new Error(`font ingest failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<FontIngestResult>;
}

/** Browser URL for an ingested sandbox font path (for FontFace loading). */
export function bridgeFontUrl(sandboxPath: string): string {
  return `${bridgeHttpOrigin()}/font/${sandboxPath}`;
}

/**
 * Browser URL for a system-installed font (preview only). The bridge
 * refuses paths outside trusted OS font dirs — defense for the
 * picker's drive-by FontFace fetches.
 */
export function bridgeSystemFontUrl(absPath: string): string {
  return `${bridgeHttpOrigin()}/system-font/${encodeURIComponent(absPath)}`;
}
