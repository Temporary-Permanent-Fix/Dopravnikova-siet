import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

function startServer(overrides = {}) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5000);
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

test('server exposes health, version and static files', async t => {
  const { child, baseUrl } = await startServer();
  t.after(() => child.kill());

  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.deepEqual(health, { ok: true });

  const version = await (await fetch(`${baseUrl}/api/version`)).json();
  assert.match(version.version, /^\d+\.\d+\.\d+$/);

  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
});

test('unknown API routes return 404 and non-GET requests are rejected', async t => {
  const { child, baseUrl } = await startServer();
  t.after(() => child.kill());

  const missing = await fetch(`${baseUrl}/api/live/snapshot`);
  assert.equal(missing.status, 404);

  const postHealth = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
  assert.equal(postHealth.status, 405);
});
