// Service worker: len most medzi kibana-fetcher.js (beží na Kibana origin)
// a app-bridge.js (beží na origin appky). Nič neparsuje, len drží posledný
// stav/filter a rozposiela ho. Dva nezávislé smery:
//   kibana-fetcher.js → (lastMessage)  → app-bridge.js  (logy/chyby)
//   app-bridge.js     → (lastFilters)  → kibana-fetcher.js (filter panel appky)

const APP_URL_PATTERNS = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*', 'https://*.app.github.dev/*'];
const KIBANA_URL_PATTERNS = ['https://kibana.prod.alza.cz/*'];

let lastMessage = null;
let lastFilters = null; // { filters: [...], query: '', eventKinds: [...] } — naposledy aplikovaný filter panel appky

async function broadcastToTabs(patterns, message) {
  const tabs = await chrome.tabs.query({ url: patterns });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // Karta bez content scriptu (napr. ešte sa nenačítal) — ignoruj,
      // ďalší poll/apply to skúsi znova.
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'sklc3-logs-snapshot' || message?.type === 'sklc3-logs-error') {
    lastMessage = message;
    broadcastToTabs(APP_URL_PATTERNS, message);
    return false;
  }
  if (message?.type === 'sklc3-app-ready') {
    sendResponse(lastMessage);
    return false;
  }
  if (message?.type === 'sklc3-set-filters') {
    lastFilters = {
      filters: Array.isArray(message.filters) ? message.filters : [],
      query: message.query || '',
      eventKinds: Array.isArray(message.eventKinds) ? message.eventKinds : null
    };
    broadcastToTabs(KIBANA_URL_PATTERNS, { type: 'sklc3-set-filters', ...lastFilters });
    return false;
  }
  if (message?.type === 'sklc3-fetcher-ready') {
    sendResponse(lastFilters);
    return false;
  }
  return false;
});
