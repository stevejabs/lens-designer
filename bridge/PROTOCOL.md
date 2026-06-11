# Lens Designer bridge — WebSocket protocol

The bridge daemon and the web designer talk over a single WebSocket
connection. The HTTP server on a sibling port serves preview PNGs, but
that's a one-way fetch (browser ← bridge) — every actual interaction
travels over the WS.

Wire format: JSON text frames, one message per frame. Every message
has a `type` field; the discriminated-union schemas in `src/protocol.ts`
are the source of truth. Anything below is documentation for the human
reading the wire; the code enforces zod.

## Server → client

### `hello`

Sent immediately after a new client connects. Tells the client what
sandbox the daemon is talking to.

```json
{
  "type": "hello",
  "server": { "name": "lens-designer-bridge", "version": "0.1.0" },
  "sandbox": { "url": "http://localhost:50049/mcp", "port": 50049 }
}
```

### `sandbox.down`

Broadcast to every connected client when the daemon discovers the
sandbox LS is no longer reachable. The daemon stays running — the
client should keep editing and show a "Sandbox unreachable" overlay
in the Preview pane (per design spec §"User flow — Sandbox interruption").

```json
{ "type": "sandbox.down", "reason": "marker scan returned no match" }
```

### `design.applied`

Reply to a successful `design.apply`. Includes the node IDs in the
order they were materialized so the client can correlate with its own
tree.

```json
{
  "type": "design.applied",
  "appliedAt": 1727913600123,
  "nodeIds": ["rect-1", "text-1", "text-2"]
}
```

### `design.error`

Reply when `design.apply` failed to converge the sandbox. Includes
the LS error verbatim so the user can see exactly what was rejected.
`nodeId` and `propertyPath` may be `null` if the error happened
before a specific node was being processed (e.g., clearActiveComponent
failed).

```json
{
  "type": "design.error",
  "error": {
    "nodeId": "text-2",
    "propertyPath": "text",
    "lsError": "string too long (limit 1024)"
  }
}
```

### `preview.ready`

Sent after the bridge has captured a fresh preview frame and written
it to its HTTP server's temp dir. The URL is relative to the bridge's
HTTP origin; the client appends a cache-busting query if it wants.

```json
{
  "type": "preview.ready",
  "url": "/preview/c2e3c8b3-aef1-4f8c-93d2-2c0...44b.png",
  "capturedAt": 1727913600234,
  "region": { "x": 1130, "y": 50, "width": 570, "height": 530 }
}
```

### `design.exported`

Reply to a successful `design.export`. Includes the absolute path of
the bundle directory so the client can offer a "Reveal in Finder"
action.

```json
{
  "type": "design.exported",
  "path": "/Users/jabsbot/.../exports/welcome-card-20260518-1845",
  "bundleName": "welcome-card-20260518-1845"
}
```

## Client → server

### `design.apply`

Request the bridge converge the sandbox scene to match `tree`. Tree is
a flat ordered list (architecture doc §6.1 layer model — index 0 =
front layer). Replies with either `design.applied` or `design.error`
(synchronously over the same WS).

After a successful apply, the bridge debounces 100 ms then captures
the preview region and emits `preview.ready` separately.

```json
{
  "type": "design.apply",
  "tree": [
    { "id": "rect-1", "type": "Rectangle", "name": "Header", ... },
    { "id": "text-1", "type": "Text", "name": "Title", ... }
  ]
}
```

### `design.export`

Request the bridge emit a portable folder bundle. `bundleName` must be
filesystem-safe (alphanumerics, dashes, underscores). The bridge applies
the tree fresh to the sandbox, then serializes the scene + materials +
textures into `tools/lens-designer/exports/<bundleName>/`.

```json
{
  "type": "design.export",
  "tree": [ ... ],
  "bundleName": "welcome-card-20260518-1845"
}
```

### `preview.configure-region`

Update the screencap region the bridge uses for subsequent previews.
Window-relative coords in logical points. Takes effect on the next
`preview.ready` cycle.

```json
{
  "type": "preview.configure-region",
  "region": { "x": 1130, "y": 50, "width": 570, "height": 530 }
}
```

## Lifecycle notes

- The daemon binds to `127.0.0.1` only. No auth in Phase 1.
- The bridge accepts multiple concurrent clients (the same design
  session open in two browser tabs is "supported" as last-write-wins;
  multi-tab sync is Phase 2+).
- Every message is validated with zod at the boundary. Malformed
  messages are logged with the offending payload and dropped; the
  connection stays open.
- If the WS connection drops, the client reconnects with the
  documented backoff (1s → 2s → 4s → 8s → 16s → 30s cap).
