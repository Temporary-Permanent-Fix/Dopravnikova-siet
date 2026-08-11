// Electron main-process equivalent of browser-extension/kibana-fetcher.js.
// That file runs as a Chrome content script inside a Kibana tab; this module
// drives the same query/poll logic from the main process, but the actual
// fetch() still has to execute *inside* the embedded Kibana WebContentsView
// (via webContents.executeJavaScript) so it rides that page's own session
// cookies. Keep BASE_FILTER/NOISE_MUST_NOT/EVENT_TEMPLATES/buildQueryBody/
// normalizeHit in sync with browser-extension/kibana-fetcher.js by hand —
// that file already duplicates its event templates from src/live-events.mjs
// for the same reason (a content script can't import an ES module of the app).

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

export const EVENT_TEMPLATES = {
  'box-routed': "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
  'arm-status': 'Arm status changed ({Arms})',
  'message': 'Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)'
};
export const ALL_EVENT_KINDS = ['box-routed', 'arm-status', 'message', 'unknown-event'];

export function buildQueryBody({ filters = [], query = '', eventKinds = ALL_EVENT_KINDS } = {}) {
  const positive = [];
  const negative = NOISE_MUST_NOT.slice();
  for (const item of filters) {
    const field = String(item?.field || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!field || !value) continue;
    const clause = { match_phrase: { [field]: value } };
    (item.negate ? negative : positive).push(clause);
  }
  const filter = [...BASE_FILTER, ...positive, { bool: { must_not: negative } }];
  if (query) filter.push({ query_string: { query, default_field: 'message', lenient: true } });
  if (eventKinds.length < ALL_EVENT_KINDS.length) {
    const should = [];
    for (const kind of eventKinds) {
      if (kind === 'unknown-event') {
        should.push({ bool: { must_not: { terms: { messageTemplate: Object.values(EVENT_TEMPLATES) } } } });
      } else if (EVENT_TEMPLATES[kind]) {
        should.push({ match_phrase: { messageTemplate: EVENT_TEMPLATES[kind] } });
      }
    }
    // Empty `should` (operator unchecked every kind) intentionally returns nothing.
    filter.push({ bool: { should, minimum_should_match: 1 } });
  }
  return {
    size: 500,
    sort: [{ dateTime: 'desc' }],
    _source: ['dateTime', 'message', 'headers.x-AgentName', 'level', 'kubernetes.pod_name', 'time_key', 'messageTemplate', 'messageParams'],
    query: { bool: { filter } }
  };
}

export function normalizeHit(hit) {
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

export function buildProxyUrl(indexPattern) {
  return `/api/console/proxy?path=${encodeURIComponent(`/${indexPattern}/_search`)}&method=POST`;
}

// Runs inside the Kibana page (via webContents.executeJavaScript) so the
// fetch() uses that page's own session cookies. Returns a plain, structured-
// clone-safe result object instead of throwing, since executeJavaScript
// rejections are awkward to classify on the Node side.
export function buildInPageFetchScript(proxyUrl, bodyJson, timeoutMs = 10000) {
  return `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${JSON.stringify(timeoutMs)});
    try {
      const r = await fetch(${JSON.stringify(proxyUrl)}, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'kbn-xsrf': 'true', 'Content-Type': 'application/json' },
        body: ${JSON.stringify(bodyJson)},
        signal: controller.signal
      });
      if (!r.ok) return { ok: false, status: r.status };
      return { ok: true, body: await r.json() };
    } catch (e) {
      return { ok: false, networkError: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  })()`;
}

export function classifyResult(result) {
  if (result.ok) {
    if (result.body?.error) {
      return { error: { kind: 'http', message: result.body.error.reason || 'Elasticsearch vrátil chybu' } };
    }
    const hits = result.body?.hits?.hits || [];
    return { records: hits.map(normalizeHit) };
  }
  if (result.status === 401 || result.status === 403) {
    return { error: { kind: 'auth', message: 'Kibana session nie je aktívna alebo chýbajú práva' } };
  }
  if (result.status === 404) {
    return { error: { kind: 'not-found', message: 'Dev Tools Console proxy nie je pre tento účet dostupný' } };
  }
  if (result.status != null) {
    return { error: { kind: 'http', message: `Kibana vrátila HTTP ${result.status}` } };
  }
  return { error: { kind: 'network', message: result.networkError || 'Neznáma sieťová chyba' } };
}

export function createKibanaPoller({ getWebContents, indexPattern, intervalMs, onSnapshot, onError }) {
  let currentFilters = [];
  let currentQuery = '';
  let currentEventKinds = ALL_EVENT_KINDS.slice();
  let lastMessage = null;
  let timer = null;
  let inFlight = false;

  function setFilters({ filters, query, eventKinds } = {}) {
    currentFilters = Array.isArray(filters) ? filters : [];
    currentQuery = query || '';
    currentEventKinds = Array.isArray(eventKinds) && eventKinds.length ? eventKinds : ALL_EVENT_KINDS.slice();
  }

  async function poll() {
    // The in-page fetch has its own timeout, but skip overlap anyway so a
    // slow Kibana can't pile up concurrent executeJavaScript calls in the
    // renderer (that's what was ballooning memory before the timeout existed).
    if (inFlight) return;
    inFlight = true;
    try {
      await runPoll();
    } finally {
      inFlight = false;
    }
  }

  async function runPoll() {
    const fetchedAt = new Date().toISOString();
    const webContents = getWebContents();
    if (!webContents || webContents.isDestroyed()) return;
    const proxyUrl = buildProxyUrl(indexPattern);
    const bodyJson = JSON.stringify(buildQueryBody({ filters: currentFilters, query: currentQuery, eventKinds: currentEventKinds }));
    let result;
    try {
      result = await webContents.executeJavaScript(buildInPageFetchScript(proxyUrl, bodyJson), true);
    } catch (e) {
      result = { ok: false, networkError: String((e && e.message) || e) };
    }
    const classified = classifyResult(result);
    if (classified.records) {
      lastMessage = { type: 'sklc3-logs-snapshot', records: classified.records, fetchedAt };
      onSnapshot?.({ records: classified.records, fetchedAt });
    } else {
      lastMessage = { type: 'sklc3-logs-error', error: classified.error, fetchedAt };
      onError?.({ error: classified.error, fetchedAt });
    }
  }

  function start() {
    poll();
    timer = setInterval(poll, intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getLastMessage() {
    return lastMessage;
  }

  return { start, stop, setFilters, getLastMessage };
}
