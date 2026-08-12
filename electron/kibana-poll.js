// Electron main-process equivalent of browser-extension/kibana-fetcher.js.
// That file runs as a Chrome content script inside a Kibana tab; this module
// drives the same query/poll logic from the main process, but the actual
// fetch() still has to execute *inside* the embedded Kibana WebContentsView
// (via webContents.executeJavaScript) so it rides that page's own session
// cookies. Keep BASE_FILTER/NOISE_MUST_NOT/EVENT_TEMPLATES/buildQueryBody/
// normalizeHit in sync with browser-extension/kibana-fetcher.js by hand —
// that file already duplicates its event templates from src/live-events.mjs
// for the same reason (a content script can't import an ES module of the app).
//
// The index queried and any extra filters/free-text/time-range applied come
// from whatever the operator has actually set up in the embedded Kibana
// Discover view (read live off its URL via kibana-rison.mjs and resolved via
// kibana-data-view.mjs) — not from a fixed app-config index. BASE_FILTER
// still narrows to this app's own telemetry pod, since the box/arm event
// templates this app understands only ever originate there.

import { parseKibanaDiscoverUrl, isDiscoverPath } from './kibana-rison.mjs';
import { createDataViewResolver } from './kibana-data-view.mjs';

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

export function buildQueryBody({ filters = [], query = '', eventKinds = ALL_EVENT_KINDS, discoverState = null } = {}) {
  const positive = [];
  const negative = NOISE_MUST_NOT.slice();
  for (const item of filters) {
    const field = String(item?.field || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!field || !value) continue;
    const clause = { match_phrase: { [field]: value } };
    (item.negate ? negative : positive).push(clause);
  }
  // Filter pills the operator set up directly in Kibana Discover — already
  // reconstructed as ES DSL by kibana-rison.mjs, merged in alongside this
  // app's own field/value pills above.
  for (const discoverFilter of discoverState?.filters || []) {
    if (!discoverFilter?.query) continue;
    (discoverFilter.negate ? negative : positive).push(discoverFilter.query);
  }
  const filter = [...BASE_FILTER, ...positive, { bool: { must_not: negative } }];
  if (query) filter.push({ query_string: { query, default_field: 'message', lenient: true } });
  if (discoverState?.queryString) {
    // Best-effort: Discover's free-text bar is KQL, this treats it as a
    // Lucene-ish query_string (same lenient approach already used for the
    // app's own free-text field above). Exotic KQL syntax may not translate
    // exactly — filter pills (handled above) decode losslessly instead.
    filter.push({ query_string: { query: discoverState.queryString, default_field: 'message', lenient: true } });
  }
  if (discoverState?.timeRange?.from || discoverState?.timeRange?.to) {
    const range = {};
    if (discoverState.timeRange.from) range.gte = discoverState.timeRange.from;
    if (discoverState.timeRange.to) range.lte = discoverState.timeRange.to;
    filter.push({ range: { [discoverState.timeFieldName || 'dateTime']: range } });
  }
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

const DISCOVER_STATUS_ERRORS = {
  'no-discover-url': { kind: 'no-discover-url', message: 'V Kibane nemáte otvorený Discover s aktívnym vyhľadávaním.' },
  'no-state': { kind: 'no-state', message: 'Discover sa práve načítava, skúsim znova.' }
};

export function createKibanaPoller({ getWebContents, intervalMs, onSnapshot, onError }) {
  let currentFilters = [];
  let currentQuery = '';
  let currentEventKinds = ALL_EVENT_KINDS.slice();
  let lastMessage = null;
  let timer = null;
  let inFlight = false;
  const dataViewResolver = createDataViewResolver({ getWebContents });

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

  // Reads what the operator has actually set up in the embedded Kibana
  // Discover view right now (index/data view, filter pills, free-text
  // search, time range) instead of a fixed app-config index — see the
  // module header. Never throws: an unresolvable/absent Discover state is a
  // normal, surfaced status, not an error to bubble up.
  async function resolveDiscoverState(webContents) {
    const url = webContents.getURL?.();
    if (!url || !isDiscoverPath(url)) return { status: 'no-discover-url' };
    const parsed = parseKibanaDiscoverUrl(url);
    if (!parsed || !parsed.dataViewId) return { status: 'no-state' };
    const resolved = await dataViewResolver.resolve(parsed.dataViewId);
    if (resolved.error) return { status: 'data-view-unresolved', error: resolved.error };
    return {
      status: 'tracking',
      trackedIndex: resolved.title,
      discoverState: {
        filters: parsed.filters,
        queryString: parsed.query?.queryString || '',
        timeRange: parsed.timeRange,
        timeFieldName: resolved.timeFieldName
      }
    };
  }

  async function runPoll() {
    const fetchedAt = new Date().toISOString();
    const webContents = getWebContents();
    if (!webContents || webContents.isDestroyed()) return;

    const discover = await resolveDiscoverState(webContents);
    if (discover.status !== 'tracking') {
      const error = discover.error || DISCOVER_STATUS_ERRORS[discover.status];
      lastMessage = { type: 'sklc3-logs-error', error, discoverStatus: discover.status, fetchedAt };
      onError?.({ error, discoverStatus: discover.status, fetchedAt });
      return;
    }

    const proxyUrl = buildProxyUrl(discover.trackedIndex);
    const bodyJson = JSON.stringify(buildQueryBody({
      filters: currentFilters, query: currentQuery, eventKinds: currentEventKinds, discoverState: discover.discoverState
    }));
    let result;
    try {
      result = await webContents.executeJavaScript(buildInPageFetchScript(proxyUrl, bodyJson), true);
    } catch (e) {
      result = { ok: false, networkError: String((e && e.message) || e) };
    }
    const classified = classifyResult(result);
    if (classified.records) {
      lastMessage = { type: 'sklc3-logs-snapshot', records: classified.records, fetchedAt, discoverStatus: 'tracking', trackedIndex: discover.trackedIndex };
      onSnapshot?.({ records: classified.records, fetchedAt, discoverStatus: 'tracking', trackedIndex: discover.trackedIndex });
    } else {
      lastMessage = { type: 'sklc3-logs-error', error: classified.error, discoverStatus: 'tracking', fetchedAt };
      onError?.({ error: classified.error, discoverStatus: 'tracking', fetchedAt });
    }
  }

  function start() {
    const initial = poll();
    timer = setInterval(poll, intervalMs);
    return initial;
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
