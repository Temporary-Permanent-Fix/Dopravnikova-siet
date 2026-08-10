import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFile } from '../server/env-file.mjs';

const electronDir = fileURLToPath(new URL('.', import.meta.url));

await loadDotEnvFile(join(electronDir, '.env'));

export const kibanaBaseUrl = process.env.KIBANA_BASE_URL || 'https://kibana.prod.alza.cz';
export const kibanaIndexPattern = process.env.KIBANA_INDEX_PATTERN || 'p-lct-k8s-*';
export const kibanaPollIntervalMs = Math.max(1000, Number(process.env.KIBANA_POLL_INTERVAL_MS || 3000));
export const appServerPort = Number(process.env.PORT || 5173);
export const appServerHost = process.env.HOST || '127.0.0.1';
