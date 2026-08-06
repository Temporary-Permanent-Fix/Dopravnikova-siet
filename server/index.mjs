import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { buildSnapshot, elasticTemplates, passiveSegment } from './live-events.mjs';

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'src');

// Keep credentials out of the browser and out of git. A local server/.env is
// optional; deployment environments supply the same values directly.
try {
  const envFile = await readFile(join(import.meta.dirname, '.env'), 'utf8');
  envFile.split(/\r?\n/).forEach(line => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1] in process.env) return;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch { /* server/.env is intentionally optional */ }

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const mode = process.env.LIVE_DATA_MODE || 'mock';
const liveWindowSeconds = Math.max(1, Number(process.env.LIVE_WINDOW_SECONDS || 60));
const livePollIntervalMs = Math.max(1000, Number(process.env.LIVE_POLL_INTERVAL_MS || 5000));
const elasticsearchTimeoutMs = Math.max(1000, Number(process.env.ELASTICSEARCH_TIMEOUT_MS || 8000));
const elasticsearchResultLimit = Math.min(10000, Math.max(1, Number(process.env.ELASTICSEARCH_RESULT_LIMIT || 1000)));
// Kibana's Discover time field is not necessarily `@timestamp` for every
// index (e.g. it shows `time_key` for k8s-logistics-core-prd-wtmsklc3int).
// Keep the query field configurable instead of assuming `@timestamp`.
const elasticsearchTimestampField = process.env.ELASTICSEARCH_TIMESTAMP_FIELD || '@timestamp';
// Global (not per-browser) query/index override applied via a pasted Kibana
// link. The Elasticsearch connection itself always comes from server/.env —
// there is no browser-supplied credential path — so this only ever carries
// query/filter/time-range state. Intentionally unscoped/shared: single-
// operator internal tool, no per-viewer isolation needed here.
let staticConnectionState = { query: null, indexOverride: null };
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm'
};

let telemetry = null;
let layout = null;
let tick = 0;

async function loadTelemetry() {
  if (!telemetry) telemetry = JSON.parse(await readFile(join(publicDir, 'sklc3-telemetry.json'), 'utf8'));
  return telemetry;
}

async function loadLayout() {
  if (!layout) layout = JSON.parse(await readFile(join(publicDir, 'sklc3.json'), 'utf8'));
  return layout;
}

async function mockSnapshot() {
  const mappings = Object.entries((await loadTelemetry()).mappings || {});
  const liveLayout = await loadLayout();
  const telemetryAgents = new Set(mappings.map(([key]) => key.split(':')[0]));
  const generatedAt = new Date().toISOString();
  const edgeMetrics = {};
  const boxCandidates = [];
  mappings.forEach(([key, edgeId], index) => {
    const active = (index + tick) % 4 !== 0;
    const ratePerHour = active ? 280 + ((index * 137 + tick * 211) % 1150) : 0;
    const edgeIds = passiveSegment(edgeId, liveLayout, telemetryAgents);
    edgeIds.forEach(id => {
      edgeMetrics[id] = { ratePerHour, occupied: active && (index + tick) % 5 === 0, lastEventAt: generatedAt };
    });
    if (active) {
      const [agent, direction] = key.split(':');
      boxCandidates.push({ boxCode: `DEMO-${String(index + 1).padStart(3, '0')}`, agent, direction: Number(direction), edgeId, edgeIds, observedAt: generatedAt });
    }
  });
  // Sample evenly across the whole mapping list instead of taking the first
  // 12 active entries in object-key order: mappings.json lists agents floor
  // by floor (DS01..DS30 on 1NP first, then Prizemie's agents last), so a
  // "first N" cap always filled its quota before reaching later diverters
  // (e.g. DS11 onward) or the second floor at all — nothing there ever got a
  // demo box. Spreading the sample across the full list, and rotating the
  // offset by `tick`, keeps every floor/diverter visible over time.
  const want = Math.min(12, boxCandidates.length);
  const step = boxCandidates.length / (want || 1);
  const boxes = Array.from({ length: want }, (_, i) => boxCandidates[Math.floor((i * step + tick) % boxCandidates.length)]);
  tick += 1;
  return {
    mode: 'mock', generatedAt, latestObservedAt: generatedAt, sourceLagSeconds: 0,
    edgeMetrics, boxes, heartbeats: {}, unmappedEvents: []
  };
}

function authorizationHeader(apiKey = process.env.ELASTICSEARCH_API_KEY || '') {
  if (!apiKey) throw new Error('ELASTICSEARCH_API_KEY is not configured');
  return `ApiKey ${apiKey.includes(':') ? Buffer.from(apiKey).toString('base64') : apiKey}`;
}

// Reads process.env fresh each call, plus any index override applied via a
// pasted Kibana link on the shared/no-session path (see staticConnectionState
// above) — no longer a pure env-only read.
function staticElasticsearchConnection() {
  return {
    url: process.env.ELASTICSEARCH_URL,
    apiKey: process.env.ELASTICSEARCH_API_KEY || '',
    index: staticConnectionState.indexOverride || process.env.ELASTICSEARCH_INDEX,
    timestampField: elasticsearchTimestampField,
    namespace: process.env.ELASTICSEARCH_NAMESPACE || '',
    container: process.env.ELASTICSEARCH_CONTAINER || ''
  };
}

function staticConnectionConfigured() {
  return mode === 'elasticsearch' && Boolean(process.env.ELASTICSEARCH_URL) &&
    Boolean(staticConnectionState.indexOverride || process.env.ELASTICSEARCH_INDEX);
}

function connectionSummary(connection) {
  return {
    origin: new URL(connection.url).origin,
    index: connection.index,
    timestampField: connection.timestampField,
    namespace: connection.namespace || undefined,
    container: connection.container || undefined
  };
}

async function elasticsearchSnapshot(connection = staticElasticsearchConnection(), queryState = null) {
  const { url, apiKey, index, timestampField, namespace, container } = connection;
  if (!url || !index) throw new Error('ELASTICSEARCH_URL and ELASTICSEARCH_INDEX are required');
  const filters = [
    queryState?.timeRange
      ? { range: { [timestampField]: { gte: queryState.timeRange.from, lte: queryState.timeRange.to } } }
      : { range: { [timestampField]: { gte: `now-${liveWindowSeconds}s`, lte: 'now' } } },
    // Mandatory regardless of any Kibana-derived query: this is the whole
    // reason live events are safe to parse (see normalizeLiveEvent), so a
    // pasted link can never be used to widen it.
    { terms: { 'messageTemplate.keyword': elasticTemplates } }
  ];
  if (namespace) filters.push({ term: { namespace_name: namespace } });
  if (container) filters.push({ term: { container_name: container } });
  for (const filter of queryState?.filters || []) {
    if (filter.disabled) continue;
    filters.push(filter.negate ? { bool: { must_not: [filter.query] } } : filter.query);
  }
  if (queryState?.query?.queryString) {
    filters.push({ query_string: { query: queryState.query.queryString, default_field: 'message', lenient: true } });
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), elasticsearchTimeoutMs);
  let response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/${encodeURIComponent(index)}/_search`, {
      method: 'POST',
      signal: abort.signal,
      headers: { Authorization: authorizationHeader(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size: elasticsearchResultLimit,
        track_total_hits: false,
        _source: ['@timestamp', 'time_key', 'dateTime', 'messageTemplate', 'messageParams', 'headers.x-AgentName', 'agent', 'direction', 'boxCode', 'topic'],
        sort: [{ [timestampField]: 'asc' }],
        query: { bool: { filter: filters } }
      })
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Elasticsearch request timed out');
    // error.cause carries the network-level detail (e.g. DNS ENOTFOUND,
    // ECONNREFUSED). Keep it out of the client response but log it server
    // side so an operator can tell a DNS/network failure apart from other
    // faults instead of seeing one generic message for every case.
    throw new Error(`Elasticsearch request failed: ${error.cause?.message || error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Elasticsearch returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }
  const body = await response.json();
  const snapshot = buildSnapshot(body.hits?.hits || [], await loadTelemetry(), await loadLayout(), liveWindowSeconds);
  return { mode: 'elasticsearch', generatedAt: new Date().toISOString(), ...snapshot };
}

async function liveSnapshot(queryState) {
  if (mode === 'mock') return mockSnapshot();
  if (mode === 'elasticsearch') return elasticsearchSnapshot(staticElasticsearchConnection(), queryState);
  throw new Error(`Unsupported LIVE_DATA_MODE=${mode}`);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function liveErrorBody(error) {
  // Deliberately keep implementation details, credentials and endpoints out
  // of the browser. Operators have the server log and the documented checks.
  console.error(`Live snapshot failed: ${error.message}`);
  return { error: 'Live data source is unavailable. Check server configuration and read-only Elasticsearch access.' };
}

function optionalText(value, name) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 256 || /[\r\n]/.test(value)) throw new Error(`Invalid ${name}`);
  return value.trim();
}

// Query/filter/time-range/refresh-interval state derived from a pasted
// Kibana URL. This never carries credentials — the Elasticsearch connection
// always comes from server/.env — but it is the one place where content
// copied from a URL (which may have been forwarded by someone other than the
// person pasting it) becomes literal Elasticsearch query DSL, so the
// filter-shape whitelist below is a required safety boundary, not optional
// hardening.
const TIME_VALUE_PATTERN = /^(now([+-]\d+[smhdwMy])?(\/[smhdwMy])?|\d{4}-\d{2}-\d{2}[T0-9:.Z-]*)$/;
const ALLOWED_FILTER_QUERY_KEYS = ['match_phrase', 'match', 'term', 'terms', 'range', 'exists'];
// `bool` groups (Kibana "is one of" / combined-filter groups) are allowed,
// but only as a container for the same leaf clauses above — never as an
// escape hatch to some other clause type. Depth/size caps below are
// generous enough for real Kibana filters but keep the whitelist walk
// itself bounded on untrusted input.
const BOOL_CLAUSE_KEYS = ['must', 'should', 'must_not', 'filter'];
const MAX_BOOL_DEPTH = 4;
const MAX_BOOL_CLAUSES = 20;

function assertNoScriptKey(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'script') throw new Error('Invalid filter: script queries are not allowed');
    assertNoScriptKey(nested);
  }
}

function assertValidQueryClause(query, depth = 0) {
  if (!query || typeof query !== 'object') throw new Error('Invalid filter: unsupported query clause');
  const keys = Object.keys(query);
  if (keys.length !== 1) throw new Error('Invalid filter: unsupported query clause');
  const [key] = keys;
  if (ALLOWED_FILTER_QUERY_KEYS.includes(key)) return;
  if (key !== 'bool') throw new Error('Invalid filter: unsupported query clause');
  if (depth >= MAX_BOOL_DEPTH) throw new Error('Invalid filter: nested bool query too deep');
  const bool = query.bool;
  if (!bool || typeof bool !== 'object') throw new Error('Invalid filter: unsupported query clause');
  for (const [clauseKey, value] of Object.entries(bool)) {
    if (clauseKey === 'minimum_should_match') {
      if (typeof value !== 'number') throw new Error('Invalid filter: unsupported query clause');
      continue;
    }
    if (!BOOL_CLAUSE_KEYS.includes(clauseKey)) throw new Error('Invalid filter: unsupported query clause');
    if (!Array.isArray(value) || value.length > MAX_BOOL_CLAUSES) throw new Error('Invalid filter: unsupported query clause');
    value.forEach(clause => assertValidQueryClause(clause, depth + 1));
  }
}

function validateTimeRange(timeRange) {
  if (timeRange == null) return undefined;
  if (typeof timeRange !== 'object') throw new Error('Invalid time range');
  const { from, to } = timeRange;
  if (typeof from !== 'string' || typeof to !== 'string' || from.length > 64 || to.length > 64) throw new Error('Invalid time range');
  if (!TIME_VALUE_PATTERN.test(from) || !TIME_VALUE_PATTERN.test(to)) throw new Error('Invalid time range');
  return { from, to };
}

function validateRefreshInterval(refreshInterval) {
  if (refreshInterval == null) return undefined;
  if (typeof refreshInterval !== 'object') throw new Error('Invalid refresh interval');
  const pause = Boolean(refreshInterval.pause);
  const value = Math.min(300000, Math.max(1000, Number(refreshInterval.value) || livePollIntervalMs));
  return { pause, value };
}

function validateQuery(query) {
  if (query == null) return undefined;
  if (typeof query !== 'object') throw new Error('Invalid query');
  const language = ['kuery', 'lucene'].includes(query.language) ? query.language : 'kuery';
  const queryString = typeof query.queryString === 'string' ? query.queryString : '';
  if (queryString.length > 2000 || /[\r\n]/.test(queryString)) throw new Error('Invalid query string');
  return { language, queryString };
}

function validateFilters(filters) {
  if (filters == null) return undefined;
  if (!Array.isArray(filters) || filters.length > 20) throw new Error('Invalid filters');
  return filters.map(filter => {
    if (!filter || typeof filter !== 'object' || !filter.query || typeof filter.query !== 'object') {
      throw new Error('Invalid filter');
    }
    assertValidQueryClause(filter.query);
    assertNoScriptKey(filter.query);
    return { negate: Boolean(filter.negate), disabled: Boolean(filter.disabled), query: filter.query };
  });
}

function validateQueryState(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid query state');
  const timeRange = validateTimeRange(body.timeRange);
  const refreshInterval = validateRefreshInterval(body.refreshInterval);
  const query = validateQuery(body.query);
  const filters = validateFilters(body.filters);
  const index = body.index != null ? optionalText(body.index, 'index') : '';
  if (index && (/[\\/\s]/.test(index) || index.length > 255)) throw new Error('Invalid index');
  return { timeRange, refreshInterval, query, filters, index: index || undefined };
}

function resolvePollInterval(queryState) {
  if (!queryState?.refreshInterval || queryState.refreshInterval.pause) return livePollIntervalMs;
  return queryState.refreshInterval.value;
}

async function jsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error('Request body is too large');
  }
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON body'); }
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/live/config') {
    if (req.method === 'GET') {
      if (staticConnectionConfigured()) {
        try {
          return json(res, 200, {
            configured: true, mode: 'elasticsearch',
            connection: connectionSummary(staticElasticsearchConnection()),
            hasQuery: Boolean(staticConnectionState.query)
          });
        } catch (error) {
          console.error(`Static Elasticsearch connection summary failed: ${error.message}`);
        }
      }
      return json(res, 200, { configured: false, fallbackMode: mode });
    }
    if (req.method === 'DELETE') {
      // Resets whatever Kibana-link filter was layered on top of the
      // server/.env connection, so a bad/empty filter can be undone without
      // restarting the server. There is no "disconnect" for the connection
      // itself — it is always the env-configured one.
      staticConnectionState = { query: null, indexOverride: null };
      if (staticConnectionConfigured()) {
        return json(res, 200, { configured: true, mode: 'elasticsearch', connection: connectionSummary(staticElasticsearchConnection()), hasQuery: false });
      }
      return json(res, 200, { configured: false, fallbackMode: mode });
    }
    return json(res, 405, { error: 'Method not allowed' });
  }
  if (url.pathname === '/api/live/query') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!staticConnectionConfigured()) return json(res, 400, { error: 'Configure ELASTICSEARCH_URL/INDEX in server/.env first' });
    try {
      const parsed = validateQueryState(await jsonBody(req));
      const merge = current => ({
        ...(current || {}),
        ...Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key !== 'index' && value !== undefined)),
        updatedAt: Date.now()
      });
      staticConnectionState.query = merge(staticConnectionState.query);
      if (parsed.index) staticConnectionState.indexOverride = parsed.index;
      return json(res, 200, { applied: true, query: staticConnectionState.query, connection: connectionSummary(staticElasticsearchConnection()) });
    } catch (error) {
      return json(res, 400, { error: error.message || 'Invalid query state' });
    }
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const queryState = mode === 'elasticsearch' ? staticConnectionState.query : null;
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, mode, pollIntervalMs: livePollIntervalMs, configured: staticConnectionConfigured() });
  if (url.pathname === '/api/live/snapshot') {
    try { return json(res, 200, await liveSnapshot(queryState)); }
    catch (error) { return json(res, 503, liveErrorBody(error)); }
  }
  if (url.pathname === '/api/live/stream') {
    const pollMs = resolvePollInterval(queryState);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: ${pollMs}\n\n`);
    const send = async () => {
      try { res.write(`event: snapshot\ndata: ${JSON.stringify(await liveSnapshot(queryState))}\n\n`); }
      catch (error) { res.write(`event: error\ndata: ${JSON.stringify(liveErrorBody(error))}\n\n`); }
    };
    await send();
    const timer = setInterval(send, pollMs);
    req.on('close', () => clearInterval(timer));
    return;
  }
  return serveStatic(url.pathname, res);
});

server.listen(port, host, () => console.log(`SKLC3 server listening on http://${host}:${server.address().port} (${mode})`));
