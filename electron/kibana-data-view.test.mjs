import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataViewFetchScript, normalizeDataViewResponse, createDataViewResolver } from './kibana-data-view.mjs';

test('buildDataViewFetchScript embeds the data view id', () => {
  const script = buildDataViewFetchScript('view-1');
  assert.ok(script.includes('"view-1"'));
  assert.ok(script.includes('/api/data_views/data_view/'));
});

test('normalizeDataViewResponse reads the Kibana 8.x data_view shape', () => {
  const result = normalizeDataViewResponse({ ok: true, body: { data_view: { title: 'p-lct-k8s-*', timeFieldName: '@timestamp' } } });
  assert.deepEqual(result, { title: 'p-lct-k8s-*', timeFieldName: '@timestamp' });
});

test('normalizeDataViewResponse reads the legacy 7.x saved-objects attributes shape', () => {
  const result = normalizeDataViewResponse({ ok: true, body: { attributes: { title: 'p-lct-k8s-*' } } });
  assert.deepEqual(result, { title: 'p-lct-k8s-*', timeFieldName: null });
});

test('normalizeDataViewResponse maps 401/403 to an auth error', () => {
  assert.equal(normalizeDataViewResponse({ ok: false, status: 401 }).error.kind, 'auth');
  assert.equal(normalizeDataViewResponse({ ok: false, status: 403 }).error.kind, 'auth');
});

test('normalizeDataViewResponse maps 404 to a not-found error', () => {
  assert.equal(normalizeDataViewResponse({ ok: false, status: 404 }).error.kind, 'not-found');
});

test('normalizeDataViewResponse maps other HTTP statuses to a generic http error', () => {
  assert.equal(normalizeDataViewResponse({ ok: false, status: 500 }).error.kind, 'http');
});

test('normalizeDataViewResponse maps thrown/network failures to a network error', () => {
  assert.equal(normalizeDataViewResponse({ ok: false, networkError: 'boom' }).error.kind, 'network');
});

test('normalizeDataViewResponse treats a response with no title as not-found', () => {
  assert.equal(normalizeDataViewResponse({ ok: true, body: {} }).error.kind, 'not-found');
});

test('createDataViewResolver.resolve returns a not-found error for a missing id', async () => {
  const resolver = createDataViewResolver({ getWebContents: () => null });
  const result = await resolver.resolve(null);
  assert.equal(result.error.kind, 'not-found');
});

test('createDataViewResolver.resolve calls executeJavaScript once and caches on success', async () => {
  let calls = 0;
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => {
      calls++;
      return { ok: true, body: { data_view: { title: 'p-lct-k8s-*', timeFieldName: 'dateTime' } } };
    }
  };
  const resolver = createDataViewResolver({ getWebContents: () => fakeWebContents });
  const first = await resolver.resolve('view-1');
  const second = await resolver.resolve('view-1');
  assert.deepEqual(first, { title: 'p-lct-k8s-*', timeFieldName: 'dateTime' });
  assert.deepEqual(second, first);
  assert.equal(calls, 1, 'second resolve with the same id should be served from cache');
});

test('createDataViewResolver.resolve re-resolves when the id changes', async () => {
  let calls = 0;
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => {
      calls++;
      return { ok: true, body: { data_view: { title: `index-${calls}` } } };
    }
  };
  const resolver = createDataViewResolver({ getWebContents: () => fakeWebContents });
  const first = await resolver.resolve('view-1');
  const second = await resolver.resolve('view-2');
  assert.equal(first.title, 'index-1');
  assert.equal(second.title, 'index-2');
  assert.equal(calls, 2);
});

test('createDataViewResolver.resolve retries on the next call after a failure instead of caching the error', async () => {
  let calls = 0;
  const fakeWebContents = {
    isDestroyed: () => false,
    executeJavaScript: async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 404 };
      return { ok: true, body: { data_view: { title: 'p-lct-k8s-*' } } };
    }
  };
  const resolver = createDataViewResolver({ getWebContents: () => fakeWebContents });
  const first = await resolver.resolve('view-1');
  const second = await resolver.resolve('view-1');
  assert.equal(first.error.kind, 'not-found');
  assert.equal(second.title, 'p-lct-k8s-*');
  assert.equal(calls, 2);
});

test('createDataViewResolver.resolve reports a network-status error when webContents is unavailable', async () => {
  const resolver = createDataViewResolver({ getWebContents: () => null });
  const result = await resolver.resolve('view-1');
  assert.equal(result.error.kind, 'network');
});
