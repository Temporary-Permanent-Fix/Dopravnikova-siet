import { app, BrowserWindow, WebContentsView, session, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kibanaBaseUrl, kibanaPollIntervalMs, appServerPort, appServerHost } from './config.mjs';
import { createKibanaPoller } from './kibana-poll.js';
import { createKibanaLoadWatcher, isSameOrigin } from './kibana-view-load.mjs';

const electronDir = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(electronDir, '..');
const serverEntry = join(root, 'server', 'index.mjs');
const appUrl = `http://${appServerHost}:${appServerPort}`;
const healthUrl = `${appUrl}/api/health`;

let serverProcess = null;
let mainWindow = null;
let kibanaView = null;
let poller = null;
let kibanaLoadWatcher = null;
let lastKibanaBounds = { x: 0, y: 0, width: 0, height: 0 };

function startServerProcess() {
  // process.execPath is the Electron binary, not plain node. In a packaged
  // app it ignores serverEntry and just reloads main.mjs again (a second
  // full app instance) unless we force Node-only mode via this env var.
  serverProcess = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    // The app server exiting unexpectedly makes the whole window useless.
    if (mainWindow && !mainWindow.isDestroyed() && code !== 0) app.quit();
  });
}

async function waitForServerReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch { /* server not listening yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`SKLC3 server did not become ready at ${healthUrl}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // Matches src/index.html's --bg token. Without this, Electron's default
    // white background shows through until the page finishes its first
    // paint — a flash of the wrong (light) theme right at launch.
    backgroundColor: '#111111',
    // Held back until 'ready-to-show' below so the window only ever appears
    // already painted in the app's own dark theme, never blank/white.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(electronDir, 'preload.cjs')
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(appUrl);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createKibanaView() {
  const kibanaSession = session.fromPartition('persist:kibana', { cache: true });
  kibanaView = new WebContentsView({
    webPreferences: {
      session: kibanaSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  // Poller keeps scraping on a fixed interval regardless of tab visibility —
  // don't let Chromium throttle timers/fetch in the hidden webContents.
  kibanaView.webContents.setBackgroundThrottling(false);

  // SAML/SSO popups Kibana may open for login must land in the same
  // persist:kibana session as this view, not the OS browser, or the login
  // cookies never reach the WebContentsView the poller reads from. Only
  // truly external links (different origin) still go to shell.openExternal.
  kibanaView.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, kibanaBaseUrl)) kibanaView.webContents.loadURL(url);
    else shell.openExternal(url);
    return { action: 'deny' };
  });

  // The initial loadURL below can fail (e.g. VPN/DNS not ready yet right at
  // launch) with no visible sign to the operator — this watcher detects that,
  // retries automatically a few times, and backs the manual "reload" button.
  kibanaLoadWatcher = createKibanaLoadWatcher({
    loadUrl: () => kibanaView.webContents.loadURL(kibanaBaseUrl),
    onStateChange: state => mainWindow?.webContents.send('kibana:load-state', state)
  });
  kibanaView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) =>
    kibanaLoadWatcher.handleFailure(errorCode, errorDescription, isMainFrame));
  kibanaView.webContents.on('did-finish-load', () => kibanaLoadWatcher.handleSuccess());

  kibanaView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.contentView.addChildView(kibanaView);
  kibanaView.webContents.loadURL(kibanaBaseUrl);
}

function createPoller() {
  poller = createKibanaPoller({
    getWebContents: () => kibanaView?.webContents,
    intervalMs: kibanaPollIntervalMs,
    onSnapshot: payload => mainWindow?.webContents.send('kibana:snapshot', payload),
    onError: payload => mainWindow?.webContents.send('kibana:error', payload)
  });
  poller.start();
}

function registerIpcHandlers() {
  let lastKibanaVisible = false;
  ipcMain.on('kibana:set-filters', (_event, filters) => poller?.setFilters(filters));
  ipcMain.handle('kibana:get-last-snapshot', () => poller?.getLastMessage() ?? null);
  ipcMain.on('kibana:set-bounds', (_event, bounds) => {
    if (!bounds) return;
    lastKibanaBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
    // Only takes effect while the view is visible; setViewVisible(true) will
    // apply the latest bounds even if a resize was sent while hidden.
    if (kibanaView && lastKibanaVisible) kibanaView.setBounds(lastKibanaBounds);
  });
  ipcMain.on('kibana:set-visible', (_event, visible) => {
    lastKibanaVisible = Boolean(visible);
    if (!kibanaView) return;
    kibanaView.setBounds(lastKibanaVisible ? lastKibanaBounds : { x: 0, y: 0, width: 0, height: 0 });
  });
  ipcMain.on('kibana:reload-view', () => kibanaLoadWatcher?.reload());
  ipcMain.handle('kibana:get-load-state', () => kibanaLoadWatcher?.getState() ?? null);
}

async function main() {
  startServerProcess();
  try {
    await waitForServerReady();
  } catch (err) {
    // Never leave the spawned server process orphaned if startup fails —
    // that's how repeated failed launches used to pile up zombie processes.
    serverProcess?.kill();
    console.error(err);
    app.exit(1);
    return;
  }
  createMainWindow();
  createKibanaView();
  createPoller();
  registerIpcHandlers();
}

// Without this, every double-click (or every retry after a slow/failed
// launch) starts a brand new app + server process tree instead of reusing
// the running one, which is how instances silently pile up in Task Manager.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(main);
}

app.on('window-all-closed', () => {
  poller?.stop();
  kibanaLoadWatcher?.dispose();
  serverProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  poller?.stop();
  kibanaLoadWatcher?.dispose();
  serverProcess?.kill();
});
