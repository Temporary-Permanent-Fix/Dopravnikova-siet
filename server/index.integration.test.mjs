import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function startServer(overrides = {}) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', LIVE_DATA_MODE: 'mock', LIVE_POLL_INTERVAL_MS: '1000', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`mock server did not start: ${output}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /(?:localhost|127\.0\.0\.1):(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve({ child, baseUrl: `http://127.0.0.1:${match[1]}` });
      }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { output += chunk; });
  });
}

function startMockServer() {
  return startServer();
}

async function readSseSnapshot(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('event: snapshot')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

test('mock server exposes health, snapshot and an SSE snapshot', async t => {
  const { child, baseUrl } = await startMockServer();
  t.after(() => child.kill());

  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.deepEqual(health, { ok: true, mode: 'mock', pollIntervalMs: 1000, configured: false });

  const snapshot = await (await fetch(`${baseUrl}/api/live/snapshot`)).json();
  assert.equal(snapshot.mode, 'mock');
  assert.ok(snapshot.generatedAt);
  assert.ok(Object.keys(snapshot.edgeMetrics).length > 0);

  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/live/stream`, { signal: abort.signal });
  const text = await readSseSnapshot(response);
  abort.abort();
  assert.match(text, /event: snapshot\ndata: \{/);
});

test('elasticsearch mode queries the configured time field and serves the mapped snapshot', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  let request;
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());
  const port = elastic.address().port;
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: `http://127.0.0.1:${port}`,
    ELASTICSEARCH_API_KEY: 'test-id:test-key',
    ELASTICSEARCH_INDEX: 'sklc3-events',
    ELASTICSEARCH_TIMESTAMP_FIELD: 'time_key'
  });
  t.after(() => child.kill());

  const response = await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.mode, 'elasticsearch');
  assert.equal(snapshot.boxes[0].edgeId, 'e66');
  assert.deepEqual(request.body.sort, [{ time_key: 'asc' }]);
  assert.deepEqual(request.body.query.bool.filter[0], { range: { time_key: { gte: 'now-60s', lte: 'now' } } });
  assert.match(request.headers.authorization, /^ApiKey /);

  const abort = new AbortController();
  const stream = await fetch(`${baseUrl}/api/live/stream`, { signal: abort.signal });
  const sse = await readSseSnapshot(stream);
  abort.abort();
  assert.match(sse, /event: snapshot\ndata: \{[^\n]*"mode":"elasticsearch"/);
});

test('GET /api/live/config reports configured:true when server/.env-style vars are fully set', async t => {
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: 'http://127.0.0.1:1',
    ELASTICSEARCH_API_KEY: 'static-id:static-secret',
    ELASTICSEARCH_INDEX: 'sklc3-events',
    ELASTICSEARCH_TIMESTAMP_FIELD: 'time_key'
  });
  t.after(() => child.kill());

  const config = await (await fetch(`${baseUrl}/api/live/config`)).json();
  assert.equal(config.configured, true);
  assert.equal(config.mode, 'elasticsearch');
  assert.equal(config.connection.index, 'sklc3-events');
  assert.equal(config.hasQuery, false);
  const raw = JSON.stringify(config);
  assert.doesNotMatch(raw, /static-secret/);

  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.configured, true);
});

test('GET /api/live/config stays configured:false (not a crash) when elasticsearch mode is missing required env vars', async t => {
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: '',
    ELASTICSEARCH_INDEX: ''
  });
  t.after(() => child.kill());

  const response = await fetch(`${baseUrl}/api/live/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.deepEqual(config, { configured: false, fallbackMode: 'elasticsearch' });
});

test('GET /api/live/config falls back to configured:false instead of crashing on a malformed ELASTICSEARCH_URL', async t => {
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: 'not a url',
    ELASTICSEARCH_API_KEY: 'static-id:static-secret',
    ELASTICSEARCH_INDEX: 'sklc3-events'
  });
  t.after(() => child.kill());

  const response = await fetch(`${baseUrl}/api/live/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.configured, false);
});

test('POST /api/live/query applies a pasted Kibana link to the shared static Elasticsearch connection', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());
  const elasticPort = elastic.address().port;

  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: `http://127.0.0.1:${elasticPort}`,
    ELASTICSEARCH_API_KEY: 'static-id:static-secret',
    ELASTICSEARCH_INDEX: 'sklc3-events',
    ELASTICSEARCH_TIMESTAMP_FIELD: 'time_key'
  });
  t.after(() => child.kill());

  const queryState = await loadFixture('kibana-query-state-valid');
  const applied = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queryState)
  });
  assert.equal(applied.status, 200);

  const configAfter = await (await fetch(`${baseUrl}/api/live/config`)).json();
  assert.equal(configAfter.hasQuery, true);

  const snapshotResponse = await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const filter = requests[0].body.query.bool.filter;
  assert.deepEqual(filter[0], { range: { time_key: { gte: 'now-15m', lte: 'now' } } });
  assert.deepEqual(filter.at(-1), { query_string: { query: 'AgentName:DS24S26', default_field: 'message', lenient: true } });
  assert.ok(filter.some(clause => JSON.stringify(clause) === JSON.stringify({ match_phrase: { namespace_name: 'logistics' } })));

  const abort = new AbortController();
  const stream = await fetch(`${baseUrl}/api/live/stream`, { signal: abort.signal });
  const retryMatch = /retry: (\d+)/.exec(await readSseSnapshot(stream));
  abort.abort();
  assert.equal(retryMatch[1], '5000');
});

test('POST /api/live/query can override the index (Kibana dataViewId confirmation), and DELETE resets it', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());
  const elasticPort = elastic.address().port;

  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: `http://127.0.0.1:${elasticPort}`,
    ELASTICSEARCH_API_KEY: 'static-id:static-secret',
    ELASTICSEARCH_INDEX: 'default-index'
  });
  t.after(() => child.kill());

  const applied = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: 'confirmed-index' })
  });
  assert.equal(applied.status, 200);

  const configAfter = await (await fetch(`${baseUrl}/api/live/config`)).json();
  assert.equal(configAfter.connection.index, 'confirmed-index');

  await fetch(`${baseUrl}/api/live/snapshot`);
  assert.match(requests[0].url, /\/confirmed-index\//);

  const deleted = await fetch(`${baseUrl}/api/live/config`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const configAfterDelete = await (await fetch(`${baseUrl}/api/live/config`)).json();
  assert.equal(configAfterDelete.connection.index, 'default-index');
  assert.equal(configAfterDelete.hasQuery, false);
});

test('the Elasticsearch API key never reaches the browser in any /api/live response', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());
  const elasticPort = elastic.address().port;

  const apiKey = 'static-id:static-secret';
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: `http://127.0.0.1:${elasticPort}`,
    ELASTICSEARCH_API_KEY: apiKey,
    ELASTICSEARCH_INDEX: 'session-events',
    ELASTICSEARCH_TIMESTAMP_FIELD: 'time_key',
    ELASTICSEARCH_NAMESPACE: 'warehouse'
  });
  t.after(() => child.kill());

  const config = await (await fetch(`${baseUrl}/api/live/config`)).text();
  assert.match(config, /"configured":true/);
  assert.match(config, /"index":"session-events"/);
  assert.doesNotMatch(config, new RegExp(apiKey));

  const snapshotResponse = await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const snapshotText = await snapshotResponse.text();
  assert.match(snapshotText, /"mode":"elasticsearch"/);
  assert.doesNotMatch(snapshotText, new RegExp(apiKey));
  assert.equal(requests[0].headers.authorization, `ApiKey ${Buffer.from(apiKey).toString('base64')}`);
  assert.deepEqual(requests[0].body.sort, [{ time_key: 'asc' }]);
  assert.deepEqual(requests[0].body.query.bool.filter.at(-1), { term: { namespace_name: 'warehouse' } });

  const abort = new AbortController();
  const stream = await fetch(`${baseUrl}/api/live/stream`, { signal: abort.signal });
  const sse = await readSseSnapshot(stream);
  abort.abort();
  assert.match(sse, /"mode":"elasticsearch"/);
  assert.doesNotMatch(sse, new RegExp(apiKey));
});

async function loadFixture(name) {
  return JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
}

async function startConfiguredServer(elasticPort) {
  const { child, baseUrl } = await startServer({
    LIVE_DATA_MODE: 'elasticsearch',
    ELASTICSEARCH_URL: `http://127.0.0.1:${elasticPort}`,
    ELASTICSEARCH_API_KEY: 'static-id:static-secret',
    ELASTICSEARCH_INDEX: 'session-events',
    ELASTICSEARCH_TIMESTAMP_FIELD: 'time_key'
  });
  return { child, baseUrl };
}

test('POST /api/live/query requires a configured connection first', async t => {
  const { child, baseUrl } = await startMockServer();
  t.after(() => child.kill());
  const response = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
  assert.equal(response.status, 400);
});

test('POST /api/live/query applies a parsed Kibana link to the Elasticsearch query and the stream poll interval', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const queryState = await loadFixture('kibana-query-state-valid');
  const applied = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queryState)
  });
  assert.equal(applied.status, 200);

  const configAfter = await (await fetch(`${baseUrl}/api/live/config`)).json();
  assert.equal(configAfter.hasQuery, true);

  const snapshotResponse = await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(snapshotResponse.status, 200);
  const filter = requests[0].query.bool.filter;
  assert.deepEqual(filter[0], { range: { time_key: { gte: 'now-15m', lte: 'now' } } });
  assert.deepEqual(filter.at(-1), { query_string: { query: 'AgentName:DS24S26', default_field: 'message', lenient: true } });
  assert.ok(filter.some(clause => JSON.stringify(clause) === JSON.stringify({ match_phrase: { namespace_name: 'logistics' } })));

  const abort = new AbortController();
  const stream = await fetch(`${baseUrl}/api/live/stream`, { signal: abort.signal });
  const retryMatch = /retry: (\d+)/.exec(await readSseSnapshot(stream));
  abort.abort();
  assert.equal(retryMatch[1], '5000');
});

test('POST /api/live/query rejects a filter smuggling a script clause and never forwards it to Elasticsearch', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const malicious = await loadFixture('kibana-query-state-script-injection');
  const rejected = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(malicious)
  });
  assert.equal(rejected.status, 400);

  await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(requests[0]), /script/);
});

test('POST /api/live/query accepts a bool ("is one of") filter, e.g. Kibana\'s multi-value phrases filter', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const boolFilter = await loadFixture('kibana-query-state-bool-filter');
  const applied = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(boolFilter)
  });
  assert.equal(applied.status, 200);

  await fetch(`${baseUrl}/api/live/snapshot`);
  const filter = requests[0].query.bool.filter;
  assert.deepEqual(filter.at(-1), {
    bool: {
      should: [{ match_phrase: { level: 'ERROR' } }, { match_phrase: { level: 'warn' } }],
      minimum_should_match: 1
    }
  });
});

test('POST /api/live/query rejects a script clause smuggled inside a bool filter', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const malicious = await loadFixture('kibana-query-state-bool-script-injection');
  const rejected = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(malicious)
  });
  assert.equal(rejected.status, 400);

  await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(requests[0]), /script/);
});

test('POST /api/live/query rejects an excessively nested bool filter', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const tooDeep = await loadFixture('kibana-query-state-bool-too-deep');
  const rejected = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tooDeep)
  });
  assert.equal(rejected.status, 400);

  await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(requests.length, 1);
});

test('POST /api/live/query merges partial state instead of replacing it wholesale', async t => {
  const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'real-box-routed.json'), 'utf8'));
  const requests = [];
  const elastic = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { hits: [{ _source: fixture }] } }));
  });
  await new Promise(resolve => elastic.listen(0, '127.0.0.1', resolve));
  t.after(() => elastic.close());

  const { child, baseUrl } = await startConfiguredServer(elastic.address().port);
  t.after(() => child.kill());

  const partial = await loadFixture('kibana-query-state-partial');
  await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial)
  });
  const secondUpdate = await fetch(`${baseUrl}/api/live/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { language: 'kuery', queryString: 'AgentName:DS24S26' } })
  });
  assert.equal(secondUpdate.status, 200);

  await fetch(`${baseUrl}/api/live/snapshot`);
  const filter = requests[0].query.bool.filter;
  assert.deepEqual(filter[0], { range: { time_key: { gte: 'now-30m', lte: 'now' } } });
  assert.deepEqual(filter.at(-1), { query_string: { query: 'AgentName:DS24S26', default_field: 'message', lenient: true } });
});
