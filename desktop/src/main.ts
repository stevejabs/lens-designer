// main.ts — Electron main process for Lens Designer (macOS v1.0).
//
// Owns: app lifecycle, BrowserWindow creation, app:// protocol
// handler (Step 9), settings store (Step 11), bridge supervisor as
// utilityProcess (Step 8). Step 7 (this commit) is the minimum scaffold
// that opens a blank BrowserWindow.

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { BridgeSupervisor } from './bridge-supervisor.js';
import {
  installAppHandler,
  registerAppScheme,
  APP_PROTOCOL_SCHEME,
  APP_PROTOCOL_HOST,
} from './app-protocol.js';
import { SettingsStore, toPublic } from './settings.js';
import { registerSandboxIpc } from './sandbox-ipc.js';

// CJS globals — esbuild emits CommonJS, which provides these natively.
// Using them directly avoids the import.meta-in-CJS warning.
declare const __dirname: string;

// In dev these resolve under dist/{main,preload,bridge,web,assets}.
// In packaged builds, electron-builder ships dist/ inside app.asar,
// but the LensDesigner.lspkg lives in `process.resourcesPath` via
// extraResources (Node can't dlopen / LS can't read assets inside
// asar). lensDesignerPackPath() resolves both.
const PRELOAD_PATH = join(__dirname, '..', 'preload', 'preload.cjs');
const BRIDGE_ENTRY = join(__dirname, '..', 'bridge', 'bridge.cjs');
const WEB_DIR = join(__dirname, '..', 'web');
const APP_URL = `${APP_PROTOCOL_SCHEME}://${APP_PROTOCOL_HOST}/index.html`;

function lensDesignerPackPath(): string {
  // Packaged build: electron-builder writes extraResources to
  // process.resourcesPath. Dev: dist/assets/, next to bridge/.
  if (app.isPackaged) {
    return join(process.resourcesPath, 'LensDesigner.lspkg');
  }
  return join(__dirname, '..', 'assets', 'LensDesigner.lspkg');
}

// Must register before app.whenReady (Electron requirement).
registerAppScheme();

let mainWindow: BrowserWindow | null = null;
let supervisor: BridgeSupervisor | null = null;
const settings = new SettingsStore();

function createMainWindow(): void {
  const ws = settings.read().windowState;
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    // exactOptionalPropertyTypes: omit x/y entirely when unset (Electron
    // centers the window) instead of passing explicit undefined.
    ...(ws.x !== null && ws.x !== undefined ? { x: ws.x } : {}),
    ...(ws.y !== null && ws.y !== undefined ? { y: ws.y } : {}),
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#08080a',
    // Standard macOS title bar — full draggable area + traffic lights.
    // Earlier `hiddenInset` mode would need explicit
    // -webkit-app-region:drag on the existing header to be draggable;
    // not worth the polish work for v1.0.
    titleBarStyle: 'default',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (ws.maximized) mainWindow.maximize();

  // Persist window state on every change (debounced is overkill at
  // this volume — electron-store writes are atomic and fast).
  const persistWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    settings.patchWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
  mainWindow.on('maximize', persistWindowState);
  mainWindow.on('unmaximize', persistWindowState);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Auto-open DevTools in dev so renderer errors surface immediately.
    if (!app.isPackaged) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Web app loaded via custom app:// protocol (TD-4). In dev (when
  // LENS_DESIGNER_DEV_URL is set), point at the Next dev server
  // instead so HMR works while iterating on the UI.
  const devUrl = process.env.LENS_DESIGNER_DEV_URL;
  if (devUrl && devUrl.length > 0) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadURL(APP_URL);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBridge(): void {
  supervisor = new BridgeSupervisor({
    bridgeEntryPath: BRIDGE_ENTRY,
    env: { LENS_DESIGNER_PACK_PATH: lensDesignerPackPath() },
  });
  supervisor.on('log', (line, stream) => {
    const prefix = stream === 'stderr' ? '[bridge!]' : '[bridge]';
    process.stdout.write(`${prefix} ${line}\n`);
  });
  supervisor.on('state', (state) => {
    process.stdout.write(`[supervisor] bridge state: ${state.kind}\n`);
  });
  supervisor.start();
}

function stopBridge(): void {
  supervisor?.stop();
  supervisor = null;
}

function registerIpc(): void {
  ipcMain.handle('settings:read', () => toPublic(settings.read()));
  ipcMain.handle('app:get-versions', () => ({
    app: process.env.LENS_DESIGNER_APP_VERSION ?? 'dev',
    electron: process.versions.electron ?? '',
    node: process.versions.node ?? '',
    chrome: process.versions.chrome ?? '',
  }));
  registerSandboxIpc({
    getMainWindow: () => mainWindow,
    settings,
  });
}

app.whenReady().then(async () => {
  await settings.init();
  installAppHandler(WEB_DIR);
  registerIpc();
  startBridge();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  stopBridge();
});

app.on('window-all-closed', () => {
  // macOS convention: keep the app alive when all windows close. The
  // user explicitly quits via Cmd+Q / menu. (v1.0 ships macOS only;
  // the non-Mac branch here is dead code that satisfies the
  // documented Electron convention for future platforms.)
  if (process.platform !== 'darwin') {
    stopBridge();
    app.quit();
  }
});
