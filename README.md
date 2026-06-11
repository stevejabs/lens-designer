# Lens Designer

**A WYSIWYG designer for Snapchat Spectacles AR UI.** Author your lens's
interface on a 2D canvas, watch it render live in Lens Studio as you work, and
consume what you built from lens code as typed, code-drivable components —
real controllers with real APIs, not exported pictures.

Designing Spectacles UI in stock Lens Studio means nudging Inspector numbers
and replaying the lens to see each change. Lens Designer replaces that loop:
drag rectangles, text, and images on a canvas; the design materializes in your
open LS project in real time; and every component you mark gets a generated
TypeScript controller plus an auto-published prefab your app instantiates at
runtime.

```ts
// What consuming a designed component looks like:
import { BookSpineView } from './LensDesigner/BookSpineView';

const spine = this.spinePrefab.instantiate(this.shelfRoot);
LensDesigner.whenReady(this, spine, BookSpineView, (v) => {
  v.title.text = book.title;                       // typed slot handles
  v.background.fill.color = hexToVec4(book.color); // per-instance materials
  v.onPinch.add(() => this.openBook(book));        // SIK-backed events
});
```

## What it does

- **Live authoring** — a web canvas (rectangles, ellipses, polygons, text,
  images, groups, hug layouts) mirrored into Lens Studio on every edit, with
  the LS preview streamed back into the app. Direct manipulation, drag-resize,
  snap grid, undo/redo, copy/paste.
- **Interaction + states** — mark anything a button or toggle; author hover /
  pinched / disabled appearance per element with a canvas state switcher. SIK
  interactables and colliders are wired at runtime, automatically.
- **Typed controllers** — bind elements to named slots and a `<Name>.ts`
  controller is generated with typed handles (`title.text`,
  `image.setImageUrl(url)`, `fill.color`, `onPinch.add(...)`).
- **Prefab publishing with stable UUIDs** — every component auto-publishes a
  `.prefab`; re-publish updates it **in place**, so wired references in your
  scene survive every design change. Renames carry the class + prefab along.
- **Shared components** — author a component once (a `Button`, a card chrome),
  drop instances of it into other views, override its slots per instance. Edit
  the original; every instance updates everywhere, including in code, where a
  bound instance becomes a typed child controller
  (`card.confirmButton.onPinch.add(...)`).
- **Clean app handoff** — your app's content lives under an App Bay that swaps
  with the authoring workspace: a Designing/Running toggle in the app, and an
  on-device gate so a shipped lens never renders designer scaffolding.
- **Safety by construction** — every scene mutation is scope-guarded to the
  designer's own workspace and `Assets/LensDesigner/`; the rest of your
  project is untouchable, and the design registry (`views.json`) lives in
  *your* project as the source of truth.

## Requirements

- **macOS** (Apple Silicon) — the live preview uses a native window-capture
  addon; the desktop shell is Electron.
- **Lens Studio 5.15.4** with its MCP server enabled — this exact version is
  load-bearing: it's the last release with Spectacles support, and the
  designer's runtime layer is verified against its API surface (SIK 0.16.4).
- **Node 22 + pnpm.**

## Getting started

Lens Designer is a single desktop app — the UI, the bridge daemon, and the
live preview all run inside it.

```bash
pnpm install   # one install, all packages
pnpm app       # build + launch the desktop app
```

To produce a double-clickable `.app` instead: `pnpm app:package`
(electron-builder, lands in `desktop/release/`).

Then, in the app:

1. **Get a project.** Open your own LS project, or click **Create sandbox** —
   it downloads a ready blank Spectacles project from
   [stevejabs/spectacles-sandbox](https://github.com/stevejabs/spectacles-sandbox).
2. **Connect…** — pick the running LS instance and point at the project's
   `Assets/` directory. The designer creates its workspace (edit bay + app
   bay) and ships its runtime files into `Assets/LensDesigner/`.
3. **Author.** Create a view, place primitives, bind slots, add interactions,
   mark it as a component. It auto-publishes as a prefab.
4. **Consume.** Wire the prefab into your lens script and drive it through the
   generated controller (see the sample above — slots, events, and shared
   components all surface as plain typed TypeScript).
5. **Run.** Flip the header toggle to **Running** to test your app in LS with
   the workspace hidden; flip back to keep designing.

## How it works

```
┌─────────────┐   WS :9229    ┌──────────────┐   LS MCP (HTTP)   ┌─────────────┐
│  web (Next) │ ────────────► │ bridge daemon│ ────────────────► │ Lens Studio │
│  the canvas │ ◄──────────── │ apply·codegen│ ◄──────────────── │ your project│
└─────────────┘  live preview │ publish·heal │   native capture  └─────────────┘
                 (HTTP :9230) └──────────────┘
```

The **bridge** translates the design tree into scene mutations (with
diff-apply and in-place reconciliation so your wiring survives edits),
generates the controllers, publishes prefabs, expands shared-component
instances, and self-heals deleted artifacts from the registry. The
**desktop** Electron shell supervises the bridge and serves the UI from its
own bundle — one process, nothing else to run. Protocol details:
[`bridge/PROTOCOL.md`](bridge/PROTOCOL.md).

### Developing the designer itself

Contributors iterating on the UI can point the shell at a live Next dev
server for hot reload — this is a dev-mode override, never required to USE
the app:

```bash
cd web && pnpm dev                                                   # terminal 1
cd desktop && LENS_DESIGNER_DEV_URL=http://localhost:3001 pnpm dev   # terminal 2
```

After bridge changes, rebuild the bundled daemon: `cd desktop && pnpm build`,
then relaunch.

## Repo layout

```
bridge/          Daemon: applier, codegen, registry, publish, instance expansion
web/             The designer UI (Next.js)
desktop/         Electron shell + bridge supervisor + sandbox installer
capture-addon/   Native (Rust/napi) window capture for the live preview
e2e/             Playwright tests
```

## Status

Actively developed. macOS-only today (a Windows port is planned). Pinned to
Lens Studio 5.15.4 by design; the pin moves only when Spectacles support
does.

## License

[MIT](LICENSE)
