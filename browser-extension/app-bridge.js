// Beží na origin appky (localhost:5173). Číry reléový mostík medzi
// background.js (extension messaging) a stránkou (window.postMessage) —
// appka si sama vykresľuje panel, extension jej len dodáva dáta.

const BRIDGE_SOURCE = 'sklc3-ext-bridge';

let cached = null;

function postToPage(message) {
  window.postMessage({ source: BRIDGE_SOURCE, ...message }, window.location.origin);
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'sklc3-logs-snapshot' && message?.type !== 'sklc3-logs-error') return;
  cached = message;
  postToPage(message);
});

chrome.runtime.sendMessage({ type: 'sklc3-app-ready' }, response => {
  if (chrome.runtime.lastError) return; // service worker ešte nenabehol — ďalší push príde sám
  if (response) { cached = response; postToPage(response); }
});

// Stránka (panel) môže po vlastnom naštartovaní požiadať o znovu-poslanie
// posledného stavu — rieši prípad, keď content script pošle dáta skôr,
// než appka pridá svoj listener (document_start beží pred jej vlastným JS).
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source !== 'sklc3-app') return;
  if (event.data.type === 'request-snapshot') {
    if (cached) postToPage(cached);
    return;
  }
  // Filter panel appky (pole/hodnota pills + textové vyhľadávanie) — pošli
  // ho na kibana-fetcher.js cez background.js, aby prepísal dopyt do ES.
  if (event.data.type === 'set-filters') {
    chrome.runtime.sendMessage({ type: 'sklc3-set-filters', filters: event.data.filters || [], query: event.data.query || '' });
  }
});
