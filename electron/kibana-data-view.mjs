// Resolves a Kibana "data view" (index pattern) id — as referenced by the
// operator's current Discover URL state (see kibana-rison.mjs's
// parseKibanaDiscoverUrl) — to the actual Elasticsearch index title it
// points at, plus its configured time field. Runs the lookup *inside* the
// embedded Kibana page (via webContents.executeJavaScript, same trick as
// kibana-poll.js's buildInPageFetchScript) so it rides the operator's own
// session cookies, no separate auth needed.
//
// Tries the Kibana >=8.0 Data Views API first, falling back to the legacy
// 7.x saved-objects index-pattern API on a 404.

export function buildDataViewFetchScript(id, timeoutMs = 10000) {
  return `(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${JSON.stringify(timeoutMs)});
    const headers = { 'kbn-xsrf': 'true' };
    try {
      let r = await fetch('/api/data_views/data_view/' + encodeURIComponent(${JSON.stringify(id)}), {
        credentials: 'same-origin', headers, signal: controller.signal
      });
      if (r.status === 404) {
        r = await fetch('/api/saved_objects/index-pattern/' + encodeURIComponent(${JSON.stringify(id)}), {
          credentials: 'same-origin', headers, signal: controller.signal
        });
      }
      if (!r.ok) return { ok: false, status: r.status };
      return { ok: true, body: await r.json() };
    } catch (e) {
      return { ok: false, networkError: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  })()`;
}

export function normalizeDataViewResponse(result) {
  if (!result?.ok) {
    if (result?.status === 401 || result?.status === 403) {
      return { error: { kind: 'auth', message: 'Kibana session nie je aktívna alebo chýbajú práva' } };
    }
    if (result?.status === 404) {
      return { error: { kind: 'not-found', message: 'Data view sa nenašiel' } };
    }
    if (result?.status != null) {
      return { error: { kind: 'http', message: `Kibana vrátila HTTP ${result.status}` } };
    }
    return { error: { kind: 'network', message: result?.networkError || 'Neznáma sieťová chyba' } };
  }
  const body = result.body || {};
  const title = body.data_view?.title || body.attributes?.title || null;
  const timeFieldName = body.data_view?.timeFieldName || body.attributes?.timeFieldName || null;
  if (!title) return { error: { kind: 'not-found', message: 'Data view neobsahuje index title' } };
  return { title, timeFieldName: timeFieldName || null };
}

// Caches the last resolved data view so an unchanged Discover selection
// doesn't get re-resolved on every ~3s poll tick — only when the id changes
// or the previous resolution failed (so transient errors keep retrying).
export function createDataViewResolver({ getWebContents, timeoutMs } = {}) {
  let cache = { id: null, result: null };

  async function resolve(id) {
    if (!id) return { error: { kind: 'not-found', message: 'Chýba id data view' } };
    if (cache.id === id && cache.result && !cache.result.error) return cache.result;
    const webContents = getWebContents?.();
    if (!webContents || webContents.isDestroyed()) {
      return { error: { kind: 'network', message: 'Kibana zobrazenie nie je pripravené' } };
    }
    let raw;
    try {
      raw = await webContents.executeJavaScript(buildDataViewFetchScript(id, timeoutMs), true);
    } catch (e) {
      raw = { ok: false, networkError: String((e && e.message) || e) };
    }
    const normalized = normalizeDataViewResponse(raw);
    cache = { id, result: normalized };
    return normalized;
  }

  return { resolve };
}
