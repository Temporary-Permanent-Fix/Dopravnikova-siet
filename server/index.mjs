import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { loadDotEnvFile } from './env-file.mjs';

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'src');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await loadDotEnvFile(join(import.meta.dirname, '.env'));

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm'
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (url.pathname === '/api/version') return json(res, 200, { version: pkg.version });
  return serveStatic(url.pathname, res);
});

server.listen(port, host, () => console.log(`SKLC3 server listening on http://${host}:${server.address().port}`));
