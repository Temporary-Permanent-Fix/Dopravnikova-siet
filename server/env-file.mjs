import { readFile } from 'node:fs/promises';

// Keep credentials out of the browser and out of git. A local .env file is
// optional; deployment environments supply the same values directly.
// Existing process.env values always win (never overwritten).
export async function loadDotEnvFile(path) {
  try {
    const envFile = await readFile(path, 'utf8');
    envFile.split(/\r?\n/).forEach(line => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || match[1] in process.env) return;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch { /* .env is intentionally optional */ }
}
