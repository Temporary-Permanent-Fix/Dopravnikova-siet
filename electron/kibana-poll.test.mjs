import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueryBody, normalizeHit, buildProxyUrl, classifyResult, createKibanaPoller, ALL_EVENT_KINDS, EVENT_TEMPLATES
} from './kibana-poll.js';

test('buildQueryBody with no filters keeps only the base filter + noise exclusion', () => {
  const body = buildQueryBody({});
  const filter = body.query.bool.filter;
  assert.deepEqual(filter[0], { match_phrase: { 'kubernetes.pod_name': 'tms-multi-agent' } });
  assert.deepEqual(filter[1], { exists: { field: 'message' } });
  assert.ok(filter[2].bool.must_not.length > 0);
  assert.equal(filter.length, 3);
});

test('buildQueryBody adds positive filter pills as match_phrase clauses', () => {
  const body = buildQueryBody({ filters: [{ field: 'headers.x-AgentName', value: 'DS01S03' }] });
  const filter = body.query.bool.filter;
  assert.deepEqual(filter[2], { match_phrase: { 'headers.x-AgentName': 'DS01S03' } });
});

test('buildQueryBody routes negated pills into must_not', () => {
  const body = buildQueryBody({ filters: [{ field: 'level', value: 'Error', negate: true }] });
  const filter = body.query.bool.filter;
  const mustNot = filter[filter.length - 1].bool.must_not;
  assert.ok(mustNot.some(c => c.match_phrase?.level === 'Error'));
});

test('buildQueryBody ignores pills missing field or value', () => {
  const body = buildQueryBody({ filters: [{ field: '', value: 'x' }, { field: 'y', value: '' }] });
  assert.equal(body.query.bool.filter.length, 3);
});

test('buildQueryBody appends a query_string clause for free text', () => {
  const body = buildQueryBody({ query: 'timeout' });
  const filter = body.query.bool.filter;
  assert.deepEqual(filter[filter.length - 1], { query_string: { query: 'timeout', default_field: 'message', lenient: true } });
});

test('buildQueryBody restricts to selected event kinds via a should clause', () => {
  const body = buildQueryBody({ eventKinds: ['box-routed'] });
  const filter = body.query.bool.filter;
  const should = filter[filter.length - 1].bool;
  assert.equal(should.minimum_should_match, 1);
  assert.deepEqual(should.should, [{ match_phrase: { messageTemplate: EVENT_TEMPLATES['box-routed'] } }]);
});

test('buildQueryBody omits the event-kind should clause when all kinds are selected', () => {
  const body = buildQueryBody({ eventKinds: ALL_EVENT_KINDS.slice() });
  const filter = body.query.bool.filter;
  assert.equal(filter.length, 3);
});

test('normalizeHit prefers headers.x-AgentName and falls back to time_key', () => {
  const hit = { _id: 'abc', _source: { time_key: '2026-01-01T00:00:00Z', headers: { 'x-AgentName': 'DS05' }, message: 'hi' } };
  assert.deepEqual(normalizeHit(hit), {
    id: 'abc', dateTime: '2026-01-01T00:00:00Z', message: 'hi', agent: 'DS05',
    level: null, podName: null, messageTemplate: null, messageParams: null
  });
});

test('buildProxyUrl encodes the index pattern into the console proxy path', () => {
  assert.equal(buildProxyUrl('p-lct-k8s-*'), '/api/console/proxy?path=%2Fp-lct-k8s-*%2F_search&method=POST');
});

test('classifyResult maps 401/403 to an auth error', () => {
  assert.equal(classifyResult({ ok: false, status: 401 }).error.kind, 'auth');
  assert.equal(classifyResult({ ok: false, status: 403 }).error.kind, 'auth');
});

test('classifyResult maps 404 to a not-found error', () => {
  assert.equal(classifyResult({ ok: false, status: 404 }).error.kind, 'not-found');
});

test('classifyResult maps other HTTP statuses to a generic http error', () => {
  assert.equal(classifyResult({ ok: false, status: 500 }).error.kind, 'http');
});

test('classifyResult maps thrown/network failures to a network error', () => {
  assert.equal(classifyResult({ ok: false, networkError: 'boom' }).error.kind, 'network');
});

test('classifyResult maps an Elasticsearch-level error body to an http error even on HTTP 200', () => {
  const result = classifyResult({ ok: true, body: { error: { reason: 'bad query' } } });
  assert.equal(result.error.kind, 'http');
  assert.equal(result.error.message, 'bad query');
});

test('classifyResult normalizes hits on success', () => {
  const result = classifyResult({ ok: true, body: { hits: { hits: [{ _id: '1', _source: { message: 'm' } }] } } });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, '1');
});

test('createKibanaPoller reports a snapshot from executeJavaScript results', async () => {
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => ({ ok: true, body: { hits: { hits: [{ _id: '1', _source: { message: 'hello' } }] } } })
  };
  const snapshots = [];
  const poller = createKibanaPoller({
    getWebContents: () => fakeWebContents,
    indexPattern: 'p-lct-k8s-*',
    intervalMs: 10_000,
    onSnapshot: payload => snapshots.push(payload),
    onError: () => assert.fail('unexpected error callback')
  });
  await poller.start();
  poller.stop();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].records[0].message, 'hello');
  assert.equal(poller.getLastMessage().type, 'sklc3-logs-snapshot');
});

test('createKibanaPoller reports an auth error and keeps it as the last message', async () => {
  const fakeWebContents = { isDestroyed: () => false, executeJavaScript: async () => ({ ok: false, status: 401 }) };
  const errors = [];
  const poller = createKibanaPoller({
    getWebContents: () => fakeWebContents,
    indexPattern: 'p-lct-k8s-*',
    intervalMs: 10_000,
    onSnapshot: () => assert.fail('unexpected snapshot callback'),
    onError: payload => errors.push(payload)
  });
  await poller.start();
  poller.stop();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.kind, 'auth');
  assert.equal(poller.getLastMessage().type, 'sklc3-logs-error');
});

test('createKibanaPoller skips a tick instead of stacking concurrent executeJavaScript calls', async () => {
  let callCount = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => {
      callCount++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Simulate a stalled Kibana request that outlives several poll intervals.
      await new Promise(r => setTimeout(r, 120));
      concurrent--;
      return { ok: true, body: { hits: { hits: [] } } };
    }
  };
  const poller = createKibanaPoller({
    getWebContents: () => fakeWebContents,
    indexPattern: 'p-lct-k8s-*',
    intervalMs: 20,
    onSnapshot: () => {},
    onError: () => {}
  });
  poller.start();
  await new Promise(r => setTimeout(r, 260));
  poller.stop();
  assert.equal(maxConcurrent, 1);
  assert.ok(callCount <= 3, `expected only a few polls to actually run, got ${callCount}`);
});

test('createKibanaPoller.setFilters feeds into the next built query', async () => {
  let capturedBody = null;
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async script => {
      const match = /body: (".*"),/s.exec(script);
      capturedBody = JSON.parse(JSON.parse(match[1]));
      return { ok: true, body: { hits: { hits: [] } } };
    }
  };
  const poller = createKibanaPoller({
    getWebContents: () => fakeWebContents,
    indexPattern: 'p-lct-k8s-*',
    intervalMs: 10_000,
    onSnapshot: () => {},
    onError: () => {}
  });
  poller.setFilters({ filters: [{ field: 'headers.x-AgentName', value: 'DS05' }], query: 'q', eventKinds: ['box-routed'] });
  await poller.start();
  poller.stop();
  assert.ok(capturedBody);
  assert.ok(JSON.stringify(capturedBody).includes('DS05'));
});
