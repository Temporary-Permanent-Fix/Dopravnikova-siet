// Beží na https://kibana.prod.alza.cz/*. Používa aktívnu session (cookies)
// prehliadača na periodické volanie Kibana Dev Tools Console proxy —
// /api/console/proxy prijme presne ten istý ES _search JSON, aký bol ručne
// overený v Console (200 OK), bez obálky bfetch/bsearch, ktorú používa
// Discover UI.

const INDEX_PATTERN = 'p-lct-k8s-*';
const POLL_INTERVAL_MS = 3000;

// Základ dopytu (docs: `Робочий приклад запиту` zo zadania) — needny meniť
// len ak sa zmenia predpoklady, nie kvôli refaktoru. Nad týmto základom sa
// vrstvia filtre nastavené v appke cez filtrovací panel (pozri
// currentFilters/currentQuery nižšie) — appka posiela len POLE + HODNOTU
// (+ negáciu), nie surové ES DSL, takže tu žiadna validácia untrusted
// vstupu netreba (appka bežiaca lokálne u toho istého operátora).
const BASE_FILTER = [
  { match_phrase: { 'kubernetes.pod_name': 'tms-multi-agent' } },
  { exists: { field: 'message' } }
];
const NOISE_MUST_NOT = [
  { match_phrase: { message: '*update received*' } },
  { match_phrase: { message: 'PLC heartbeat counter' } },
  { match_phrase: { message: 'SEND rabbitmq://prd-rabbitmq-tmslct/RUR.TMS.Agent.RabbitMq.Contracts.Events:AgentHeartbeatEvent' } },
  { match_phrase: { message: 'MQTT PLC heartbeat' } },
  { match_phrase: { message: 'PLC heartbeat received' } },
  { match_phrase: { message: 'RUR.TMS.Routing.Contracts.Events.HeartbeatEvent' } },
  { match_phrase: { message: 'RUR.TMS.Routing.Contracts.Events.NodeOccupationChangedEvent' } },
  { match_phrase: { message: 'RUR.TMS.Manager.RabbitMq.Contracts.Events.TmsLayoutUtilizationChangedEvent' } },
  { match_phrase: { message: 'Message processing finished' } },
  { match_phrase: { message: '*/diagnostics*' } }
];

// Filter panel appky (src/index.html) — pole+hodnota pills a voľný text.
// Naplní sa handshakeom pri štarte (sklc3-fetcher-ready) a potom pri každej
// zmene z appky (sklc3-set-filters, relayované cez background.js).
let currentFilters = [];
let currentQuery = '';

// Typ udalosti (📦 box-routed / 🦾 arm-status / ✉ message / ❓ unknown-event)
// — appka posiela kind-keys (svoj vlastný slovník zo src/live-events.mjs),
// tu ich prekladáme na Kibana messageTemplate stringy. Kópia templatov je
// zámerná (content script nemôže importovať ES modul appky) — musí zostať
// v súlade s BOX_TEMPLATE/ARM_TEMPLATE/MESSAGE_TEMPLATE v src/live-events.mjs.
const EVENT_TEMPLATES = {
  'box-routed': "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
  'arm-status': 'Arm status changed ({Arms})',
  'message': 'Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)'
};
const ALL_EVENT_KINDS = ['box-routed', 'arm-status', 'message', 'unknown-event'];
// Chýbajúce/neplatné pole = "žiadny filter" (nie "blokuj všetko") — poistka
// proti starému stavu appky/rozšírenia, ktoré eventKinds ešte neposiela.
let currentEventKinds = ALL_EVENT_KINDS.slice();

function buildQueryBody() {
  const positive = [];
  const negative = NOISE_MUST_NOT.slice();
  for (const item of currentFilters) {
    const field = String(item?.field || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!field || !value) continue;
    const clause = { match_phrase: { [field]: value } };
    (item.negate ? negative : positive).push(clause);
  }
  const filter = [...BASE_FILTER, ...positive, { bool: { must_not: negative } }];
  if (currentQuery) filter.push({ query_string: { query: currentQuery, default_field: 'message', lenient: true } });
  if (currentEventKinds.length < ALL_EVENT_KINDS.length) {
    const should = [];
    for (const kind of currentEventKinds) {
      if (kind === 'unknown-event') {
        should.push({ bool: { must_not: { terms: { messageTemplate: Object.values(EVENT_TEMPLATES) } } } });
      } else if (EVENT_TEMPLATES[kind]) {
        should.push({ match_phrase: { messageTemplate: EVENT_TEMPLATES[kind] } });
      }
    }
    // Prázdny `should` (operátor odškrtol všetky typy) úmyselne nevráti nič.
    filter.push({ bool: { should, minimum_should_match: 1 } });
  }
  return {
    size: 500,
    sort: [{ dateTime: 'desc' }],
    _source: ['dateTime', 'message', 'headers.x-AgentName', 'level', 'kubernetes.pod_name', 'time_key', 'messageTemplate', 'messageParams'],
    query: { bool: { filter } }
  };
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'sklc3-set-filters') return;
  currentFilters = Array.isArray(message.filters) ? message.filters : [];
  currentQuery = message.query || '';
  currentEventKinds = Array.isArray(message.eventKinds) ? message.eventKinds : ALL_EVENT_KINDS.slice();
});

chrome.runtime.sendMessage({ type: 'sklc3-fetcher-ready' }, response => {
  if (chrome.runtime.lastError) return; // service worker ešte nenabehol — appka pošle filter znova pri Apply
  if (response) {
    currentFilters = Array.isArray(response.filters) ? response.filters : [];
    currentQuery = response.query || '';
    currentEventKinds = Array.isArray(response.eventKinds) ? response.eventKinds : ALL_EVENT_KINDS.slice();
  }
});

const proxyUrl = `/api/console/proxy?path=${encodeURIComponent(`/${INDEX_PATTERN}/_search`)}&method=POST`;

function normalizeHit(hit) {
  const source = hit._source || {};
  return {
    id: hit._id,
    dateTime: source.dateTime || source.time_key || null,
    message: source.message || '',
    agent: source.headers?.['x-AgentName'] ?? source['headers.x-AgentName'] ?? null,
    level: source.level || null,
    podName: source.kubernetes?.pod_name ?? source['kubernetes.pod_name'] ?? null,
    messageTemplate: source.messageTemplate || null,
    messageParams: source.messageParams || null
  };
}

async function fetchOnce() {
  const response = await fetch(proxyUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'kbn-xsrf': 'true', 'Content-Type': 'application/json' },
    body: JSON.stringify(buildQueryBody())
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error('Kibana session nie je aktívna alebo chýbajú práva'), { kind: 'auth' });
    }
    if (response.status === 404) {
      throw Object.assign(new Error('Dev Tools Console proxy nie je pre tento účet dostupný'), { kind: 'not-found' });
    }
    throw Object.assign(new Error(`Kibana vrátila HTTP ${response.status}`), { kind: 'http' });
  }
  const body = await response.json();
  if (body?.error) {
    throw Object.assign(new Error(body.error.reason || 'Elasticsearch vrátil chybu'), { kind: 'http' });
  }
  const hits = body?.hits?.hits || [];
  return hits.map(normalizeHit);
}

async function poll() {
  const fetchedAt = new Date().toISOString();
  try {
    const records = await fetchOnce();
    chrome.runtime.sendMessage({ type: 'sklc3-logs-snapshot', records, fetchedAt });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'sklc3-logs-error',
      error: { kind: error.kind || 'network', message: error.message },
      fetchedAt
    });
  }
}

poll();
setInterval(poll, POLL_INTERVAL_MS);
