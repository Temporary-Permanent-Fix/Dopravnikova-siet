// Beží na https://kibana.prod.alza.cz/*. Používa aktívnu session (cookies)
// prehliadača na periodické volanie Kibana Dev Tools Console proxy —
// /api/console/proxy prijme presne ten istý ES _search JSON, aký bol ručne
// overený v Console (200 OK), bez obálky bfetch/bsearch, ktorú používa
// Discover UI.
//
// Index a časť dopytu (filtre/voľný text/časový rozsah) sa čítajú živo z
// toho, čo má operátor práve nastavené v samotnom Kibana Discover (táto
// stránka) — z jej URL (_g/_a rison stav), nie z pevne zadaného indexu.
// Toto je content-script ekvivalent electron/kibana-poll.js +
// electron/kibana-rison.mjs + electron/kibana-data-view.mjs; content script
// nemôže importovať ES moduly appky, preto je logika skopírovaná ručne —
// udržiavať v súlade s tými súbormi.

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

function buildQueryBody(discoverState) {
  const positive = [];
  const negative = NOISE_MUST_NOT.slice();
  for (const item of currentFilters) {
    const field = String(item?.field || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!field || !value) continue;
    const clause = { match_phrase: { [field]: value } };
    (item.negate ? negative : positive).push(clause);
  }
  for (const discoverFilter of discoverState?.filters || []) {
    if (!discoverFilter?.query) continue;
    (discoverFilter.negate ? negative : positive).push(discoverFilter.query);
  }
  const filter = [...BASE_FILTER, ...positive, { bool: { must_not: negative } }];
  if (currentQuery) filter.push({ query_string: { query: currentQuery, default_field: 'message', lenient: true } });
  if (discoverState?.queryString) {
    filter.push({ query_string: { query: discoverState.queryString, default_field: 'message', lenient: true } });
  }
  if (discoverState?.timeRange?.from || discoverState?.timeRange?.to) {
    const range = {};
    if (discoverState.timeRange.from) range.gte = discoverState.timeRange.from;
    if (discoverState.timeRange.to) range.lte = discoverState.timeRange.to;
    filter.push({ range: { [discoverState.timeFieldName || 'dateTime']: range } });
  }
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

// --- Rison decode of Kibana's Discover `_g`/`_a` URL state -----------------
// Mirrors electron/kibana-rison.mjs — keep in sync by hand (see file header).

const MAX_RISON_LENGTH = 20000;
const MAX_RISON_DEPTH = 64;
const BARE_STRING_STOP = /[()!,:'\s]/;

function parseRison(input) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('Invalid rison: empty input');
  if (input.length > MAX_RISON_LENGTH) throw new Error('Invalid rison: input too large');
  const state = { str: input, index: 0 };
  const value = parseRisonValue(state, 0);
  if (state.index !== state.str.length) throw new Error(`Invalid rison: unexpected trailing input at index ${state.index}`);
  return value;
}

function parseRisonValue(state, depth) {
  if (depth > MAX_RISON_DEPTH) throw new Error('Invalid rison: nesting too deep');
  const ch = state.str[state.index];
  if (ch === undefined) throw new Error('Invalid rison: unexpected end of input');
  if (ch === '(') return parseRisonObject(state, depth);
  if (ch === '!') return parseRisonBang(state, depth);
  if (ch === "'") return parseRisonQuotedString(state);
  if (ch === '-' && /\d/.test(state.str[state.index + 1] || '')) return parseRisonNumber(state);
  if (/\d/.test(ch)) return parseRisonNumber(state);
  return parseRisonBareString(state);
}

function parseRisonBang(state, depth) {
  const next = state.str[state.index + 1];
  if (next === '(') { state.index += 1; return parseRisonArray(state, depth); }
  if (next === 't') { state.index += 2; return true; }
  if (next === 'f') { state.index += 2; return false; }
  if (next === 'n') { state.index += 2; return null; }
  if (next === 'u') { state.index += 2; return undefined; }
  throw new Error(`Invalid rison: unexpected '!' sequence at index ${state.index}`);
}

function parseRisonObject(state, depth) {
  risonExpect(state, '(');
  const result = {};
  if (state.str[state.index] === ')') { state.index += 1; return result; }
  for (;;) {
    const key = parseRisonValue(state, depth + 1);
    if (typeof key !== 'string') throw new Error(`Invalid rison: object key must be a string at index ${state.index}`);
    risonExpect(state, ':');
    result[key] = parseRisonValue(state, depth + 1);
    const ch = state.str[state.index];
    if (ch === ',') { state.index += 1; continue; }
    if (ch === ')') { state.index += 1; break; }
    throw new Error(`Invalid rison: expected ',' or ')' at index ${state.index}`);
  }
  return result;
}

function parseRisonArray(state, depth) {
  risonExpect(state, '(');
  const result = [];
  if (state.str[state.index] === ')') { state.index += 1; return result; }
  for (;;) {
    result.push(parseRisonValue(state, depth + 1));
    const ch = state.str[state.index];
    if (ch === ',') { state.index += 1; continue; }
    if (ch === ')') { state.index += 1; break; }
    throw new Error(`Invalid rison: expected ',' or ')' at index ${state.index}`);
  }
  return result;
}

function parseRisonQuotedString(state) {
  risonExpect(state, "'");
  let result = '';
  for (;;) {
    const ch = state.str[state.index];
    if (ch === undefined) throw new Error('Invalid rison: unterminated string');
    if (ch === "'") { state.index += 1; break; }
    if (ch === '!') {
      const next = state.str[state.index + 1];
      if (next === "'") { result += "'"; state.index += 2; continue; }
      if (next === '!') { result += '!'; state.index += 2; continue; }
      throw new Error(`Invalid rison: unknown escape sequence at index ${state.index}`);
    }
    result += ch;
    state.index += 1;
  }
  return result;
}

function parseRisonBareString(state) {
  const start = state.index;
  while (state.index < state.str.length && !BARE_STRING_STOP.test(state.str[state.index])) state.index += 1;
  if (state.index === start) throw new Error(`Invalid rison: unexpected character at index ${start}`);
  return state.str.slice(start, state.index);
}

function parseRisonNumber(state) {
  const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(state.str.slice(state.index));
  if (!match) throw new Error(`Invalid rison: expected a number at index ${state.index}`);
  state.index += match[0].length;
  return Number(match[0]);
}

function risonExpect(state, char) {
  if (state.str[state.index] !== char) throw new Error(`Invalid rison: expected '${char}' at index ${state.index}`);
  state.index += 1;
}

// See electron/kibana-rison.mjs's filterQuery() for the "combined" filter
// (AND/OR group) reconstruction rationale — identical logic here.
function filterQuery(filter) {
  const meta = filter?.meta;
  if (meta?.type === 'combined' && Array.isArray(meta.params)) {
    const subQueries = meta.params
      .map(sub => (sub?.query && typeof sub.query === 'object' ? sub.query : null))
      .filter(Boolean);
    if (!subQueries.length) return null;
    return meta.relation === 'OR'
      ? { bool: { should: subQueries, minimum_should_match: 1 } }
      : { bool: { filter: subQueries } };
  }
  return filter?.query && typeof filter.query === 'object' ? filter.query : null;
}

function isDiscoverUrl(url) {
  if (url.pathname.includes('/app/discover')) return true;
  const hash = url.hash || '';
  return /(^|\/)discover(\/|\?|$)/.test(hash);
}

function extractRisonParam(url, name) {
  if (url.searchParams.has(name)) return url.searchParams.get(name);
  const hash = url.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  return hashParams.has(name) ? hashParams.get(name) : null;
}

// Returns null (never throws) when the tab isn't on Discover, or Discover
// hasn't written _g/_a state yet — both expected/transient, not errors.
function parseKibanaDiscoverUrl(urlString) {
  let url;
  try { url = new URL(urlString); } catch { return null; }
  if (!isDiscoverUrl(url)) return null;

  const rawG = extractRisonParam(url, '_g');
  const rawA = extractRisonParam(url, '_a');
  if (rawG == null && rawA == null) return null;

  const g = rawG != null ? parseRison(rawG) : null;
  const a = rawA != null ? parseRison(rawA) : null;

  const timeRange = g?.time && typeof g.time === 'object'
    ? { from: typeof g.time.from === 'string' ? g.time.from : null, to: typeof g.time.to === 'string' ? g.time.to : null }
    : null;

  const query = a?.query && typeof a.query === 'object'
    ? { queryString: typeof a.query.query === 'string' ? a.query.query : '' }
    : null;

  const filters = Array.isArray(a?.filters)
    ? a.filters
        .map(filter => ({
          negate: Boolean(filter?.meta?.negate ?? filter?.negate),
          disabled: Boolean(filter?.meta?.disabled ?? filter?.disabled),
          query: filterQuery(filter)
        }))
        .filter(filter => !filter.disabled && filter.query && Object.keys(filter.query).length > 0)
    : [];

  const dataViewId = typeof a?.index === 'string'
    ? a.index
    : typeof a?.dataSource?.dataViewId === 'string' ? a.dataSource.dataViewId : null;

  return { timeRange, query, filters, dataViewId };
}

// --- Data view (index pattern) resolution -----------------------------------
// Running inside the Kibana page already, so this is a plain in-context
// fetch — no cross-process indirection needed (unlike electron/kibana-poll.js's
// executeJavaScript-into-the-page trick). Cached per id; only re-resolved on
// id change or a previous failure, so an unchanged Discover selection
// doesn't get re-resolved on every ~3s poll tick.

let dataViewCache = { id: null, result: null };

async function resolveDataView(id) {
  if (!id) return { error: { kind: 'not-found', message: 'Chýba id data view' } };
  if (dataViewCache.id === id && dataViewCache.result && !dataViewCache.result.error) return dataViewCache.result;
  let response;
  try {
    response = await fetch(`/api/data_views/data_view/${encodeURIComponent(id)}`, {
      credentials: 'same-origin', headers: { 'kbn-xsrf': 'true' }
    });
    if (response.status === 404) {
      response = await fetch(`/api/saved_objects/index-pattern/${encodeURIComponent(id)}`, {
        credentials: 'same-origin', headers: { 'kbn-xsrf': 'true' }
      });
    }
  } catch (e) {
    const result = { error: { kind: 'network', message: String(e?.message || e) } };
    dataViewCache = { id, result };
    return result;
  }
  let result;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      result = { error: { kind: 'auth', message: 'Kibana session nie je aktívna alebo chýbajú práva' } };
    } else if (response.status === 404) {
      result = { error: { kind: 'not-found', message: 'Data view sa nenašiel' } };
    } else {
      result = { error: { kind: 'http', message: `Kibana vrátila HTTP ${response.status}` } };
    }
  } else {
    const body = await response.json();
    const title = body.data_view?.title || body.attributes?.title || null;
    const timeFieldName = body.data_view?.timeFieldName || body.attributes?.timeFieldName || null;
    result = title ? { title, timeFieldName: timeFieldName || null } : { error: { kind: 'not-found', message: 'Data view neobsahuje index title' } };
  }
  dataViewCache = { id, result };
  return result;
}

const DISCOVER_STATUS_ERRORS = {
  'no-discover-url': { kind: 'no-discover-url', message: 'V Kibane nemáte otvorený Discover s aktívnym vyhľadávaním.' },
  'no-state': { kind: 'no-state', message: 'Discover sa práve načítava, skúsim znova.' }
};

async function resolveDiscoverState() {
  let url;
  try { url = new URL(window.location.href); } catch { return { status: 'no-discover-url' }; }
  if (!isDiscoverUrl(url)) return { status: 'no-discover-url' };
  const parsed = parseKibanaDiscoverUrl(window.location.href);
  if (!parsed || !parsed.dataViewId) return { status: 'no-state' };
  const resolved = await resolveDataView(parsed.dataViewId);
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

async function fetchOnce(discoverState, trackedIndex) {
  const proxyUrl = `/api/console/proxy?path=${encodeURIComponent(`/${trackedIndex}/_search`)}&method=POST`;
  const response = await fetch(proxyUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'kbn-xsrf': 'true', 'Content-Type': 'application/json' },
    body: JSON.stringify(buildQueryBody(discoverState))
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
  const discover = await resolveDiscoverState();
  if (discover.status !== 'tracking') {
    const error = discover.error || DISCOVER_STATUS_ERRORS[discover.status];
    chrome.runtime.sendMessage({ type: 'sklc3-logs-error', error, discoverStatus: discover.status, fetchedAt });
    return;
  }
  try {
    const records = await fetchOnce(discover.discoverState, discover.trackedIndex);
    chrome.runtime.sendMessage({
      type: 'sklc3-logs-snapshot', records, fetchedAt, discoverStatus: 'tracking', trackedIndex: discover.trackedIndex
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'sklc3-logs-error',
      error: { kind: error.kind || 'network', message: error.message },
      discoverStatus: 'tracking',
      fetchedAt
    });
  }
}

poll();
setInterval(poll, POLL_INTERVAL_MS);
