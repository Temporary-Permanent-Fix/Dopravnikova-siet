// Service worker: len most medzi kibana-fetcher.js (beží na Kibana origin)
// a app-bridge.js (beží na origin appky). Nič neparsuje, len drží posledný
// stav a rozposiela ho.

const APP_URL_PATTERNS = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*', 'https://*.app.github.dev/*'];

let lastMessage = null;

async function broadcastToAppTabs(message) {
  const tabs = await chrome.tabs.query({ url: APP_URL_PATTERNS });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // App tab bez content scriptu (napr. ešte sa nenačítal) — ignoruj,
      // ďalší poll to skúsi znova.
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'sklc3-logs-snapshot' || message?.type === 'sklc3-logs-error') {
    lastMessage = message;
    broadcastToAppTabs(message);
    return false;
  }
  if (message?.type === 'sklc3-app-ready') {
    sendResponse(lastMessage);
    return false;
  }
  return false;
});
