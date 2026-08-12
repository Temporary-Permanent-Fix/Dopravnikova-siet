const { contextBridge, ipcRenderer } = require('electron');

// The only privileged surface exposed to the renderer (src/index.html).
// Mirrors the shape of the postMessage bridge the browser-extension path
// already uses (see the 'sklc3-ext-bridge' listener in src/index.html), so
// the renderer's handleLiveLogsBridgeMessage() needs no changes at all.
contextBridge.exposeInMainWorld('kibanaBridge', {
  onSnapshot(callback) {
    ipcRenderer.on('kibana:snapshot', (_event, payload) => callback(payload));
  },
  onError(callback) {
    ipcRenderer.on('kibana:error', (_event, payload) => callback(payload));
  },
  getLastSnapshot() {
    return ipcRenderer.invoke('kibana:get-last-snapshot');
  },
  setFilters(filters) {
    ipcRenderer.send('kibana:set-filters', filters);
  },
  setViewBounds(bounds) {
    ipcRenderer.send('kibana:set-bounds', bounds);
  },
  setViewVisible(visible) {
    ipcRenderer.send('kibana:set-visible', Boolean(visible));
  },
  onLoadState(callback) {
    ipcRenderer.on('kibana:load-state', (_event, payload) => callback(payload));
  },
  getLoadState() {
    return ipcRenderer.invoke('kibana:get-load-state');
  },
  reload() {
    ipcRenderer.send('kibana:reload-view');
  }
});
