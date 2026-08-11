import { app, BrowserWindow, WebContentsView, session, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kibanaBaseUrl, kibanaIndexPattern, kibanaPollIntervalMs, appServerPort, appServerHost } from './config.mjs';
import { createKibanaPoller } from './kibana-poll.js';

const electronDir = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(electronDir, '..');
const serverEntry = join(root, 'server', 'index.mjs');
const appUrl = `http://${appServerHost}:${appServerPort}`;
const healthUrl = `${appUrl}/api/health`;

let serverProcess = null;
let mainWindow = null;
let kibanaView = null;
let poller = null;
let lastKibanaBounds = { x: 0, y: 0, width: 0, height: 0 };

function startServerProcess() {
  serverProcess = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: process.env
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(electronDir, 'preload.cjs')
    }
  });
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
  kibanaView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  kibanaView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.contentView.addChildView(kibanaView);
  kibanaView.webContents.loadURL(kibanaBaseUrl);
}

function createPoller() {
  poller = createKibanaPoller({
    getWebContents: () => kibanaView?.webContents,
    indexPattern: kibanaIndexPattern,
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
  serverProcess?.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  poller?.stop();
  serverProcess?.kill();
});
