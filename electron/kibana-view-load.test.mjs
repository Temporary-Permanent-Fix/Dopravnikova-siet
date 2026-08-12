import test from 'node:test';
import assert from 'node:assert/strict';
import { createKibanaLoadWatcher, isSameOrigin } from './kibana-view-load.mjs';

test('isSameOrigin is true for URLs sharing an origin', () => {
  assert.equal(isSameOrigin('https://kibana.prod.alza.cz/login', 'https://kibana.prod.alza.cz'), true);
});

test('isSameOrigin is false for a different origin', () => {
  assert.equal(isSameOrigin('https://sso.alza.cz/login', 'https://kibana.prod.alza.cz'), false);
});

test('isSameOrigin is false (not throwing) for a malformed URL', () => {
  assert.equal(isSameOrigin('not a url', 'https://kibana.prod.alza.cz'), false);
});

test('handleFailure ignores ERR_ABORTED (-3)', () => {
  const states = [];
  let loadCount = 0;
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => { loadCount++; },
    retryDelaysMs: [10, 15],
    onStateChange: s => states.push(s)
  });
  watcher.handleFailure(-3, 'ERR_ABORTED', true);
  assert.equal(states.length, 0);
  assert.equal(loadCount, 0);
});

test('handleFailure ignores non-main-frame failures', () => {
  const states = [];
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => {},
    retryDelaysMs: [10, 15],
    onStateChange: s => states.push(s)
  });
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', false);
  assert.equal(states.length, 0);
});

test('handleFailure sets an error state and retries after the configured delay', async () => {
  const states = [];
  let loadCount = 0;
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => { loadCount++; },
    retryDelaysMs: [10, 15],
    onStateChange: s => states.push(s)
  });
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', true);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).lastError, 'ERR_NAME_NOT_RESOLVED');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(loadCount, 1);
});

test('handleSuccess resets the retry attempt counter and clears pending timers', async () => {
  const states = [];
  let loadCount = 0;
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => { loadCount++; },
    retryDelaysMs: [10, 1000],
    onStateChange: s => states.push(s)
  });
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(loadCount, 1);
  watcher.handleSuccess();
  assert.equal(states.at(-1).status, 'loaded');
  // The pending 1000ms retry from the first failure must not fire after success.
  await new Promise(r => setTimeout(r, 30));
  assert.equal(loadCount, 1);
});

test('auto-retry stops once all configured delays are exhausted', async () => {
  let loadCount = 0;
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => { loadCount++; watcher.handleFailure(-105, 'still down', true); },
    retryDelaysMs: [5, 5]
  });
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', true);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(loadCount, 2); // two retries scheduled by retryDelaysMs, then exhausted
});

test('reload cancels a pending retry timer and gives a fresh retry budget', async () => {
  const states = [];
  let loadCount = 0;
  const watcher = createKibanaLoadWatcher({
    loadUrl: () => { loadCount++; },
    retryDelaysMs: [5, 5],
    onStateChange: s => states.push(s)
  });
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', true);
  watcher.reload();
  assert.equal(loadCount, 1); // the manual reload's own loadUrl() call
  assert.equal(states.at(-1).status, 'loading');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(loadCount, 1); // the cancelled first retry never fired
  watcher.handleFailure(-105, 'ERR_NAME_NOT_RESOLVED', true);
  await new Promise(r => setTimeout(r, 15));
  assert.equal(loadCount, 2); // fresh budget still schedules a retry after reload
});

test('getState reflects the current status', () => {
  const watcher = createKibanaLoadWatcher({ loadUrl: () => {}, retryDelaysMs: [] });
  assert.equal(watcher.getState().status, 'loading');
  watcher.handleSuccess();
  assert.equal(watcher.getState().status, 'loaded');
});
