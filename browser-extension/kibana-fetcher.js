// Beží na https://kibana.prod.alza.cz/*. Používa aktívnu session (cookies)
// prehliadača na periodické volanie Kibana Dev Tools Console proxy —
// /api/console/proxy prijme presne ten istý ES _search JSON, aký bol ručne
// overený v Console (200 OK), bez obálky bfetch/bsearch, ktorú používa
// Discover UI.

const INDEX_PATTERN = 'p-lct-k8s-*';
const POLL_INTERVAL_MS = 3000;

// Presne overený dopyt (docs: `Робочий приклад запиту` zo zadania) — needny
// meniť len ak sa zmenia filtre v Kibana Discover, nie kvôli refaktoru.
const QUERY_BODY = {
  size: 500,
  sort: [{ dateTime: 'desc' }],
  _source: ['dateTime', 'message', 'headers.x-AgentName', 'level', 'kubernetes.pod_name', 'time_key', 'messageTemplate', 'messageParams'],
  query: {
    bool: {
      filter: [
        { match_phrase: { 'kubernetes.pod_name': 'tms-multi-agent' } },
        { exists: { field: 'message' } },
        {
          bool: {
            must_not: [
              { match_phrase: { message: '*update received*' } },
              { match_phrase: { message: 'PLC heartbeat counter' } },
              { match_phrase: { message: 'SEND rabbitmq://prd-rabbitmq-tmslct/RUR.TMS.Agent.RabbitMq.Contracts.Events:AgentHeartbeatEvent' } },
              { match_phrase: { message: 'MQTT PLC heartbeat' } },
              { match_phrase: { message: 'PLC heartbeat received' } },
              { match_phrase: { message: 'RUR.TMS.Routing.Contracts.Events.HeartbeatEvent' } },
              { match_phrase: { message: 'RUR.TMS.Routing.Contracts.Events.NodeOccupationChangedEvent' } },
              { match_phrase: { message: 'RUR.TMS.Manager.RabbitMq.Contracts.Events.TmsLayoutUtilizationChangedEvent' } },
              { match_phrase: { message: 'Message processing finished' } },
              { match_phrase: { message: '*/diagnostics*' } }
            ]
          }
        }
      ]
    }
  }
};

const proxyUrl = `/api/console/proxy?path=${encodeURIComponent(`/${INDEX_PATTERN}/_search`)}&method=POST`;

function normalizeHit(hit) {
  const source = hit._source || {};
  return {
    id: hit._id,
    dateTime: source.dateTime || source.time_key || null,
    message: source.message || '',
    agent: source.headers?.['x-AgentName'] ?? source['headers.x-AgentName'] ?? null,
    level: source.level || null,
    podName: source.kubernetes?.pod_name ?? source['kubernetes.pod_name'] ?? null,
    messageTemplate: source.messageTemplate || null,
    messageParams: source.messageParams || null
  };
}

async function fetchOnce() {
  const response = await fetch(proxyUrl, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'kbn-xsrf': 'true', 'Content-Type': 'application/json' },
    body: JSON.stringify(QUERY_BODY)
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error('Kibana session nie je aktívna alebo chýbajú práva'), { kind: 'auth' });
    }
    if (response.status === 404) {
      throw Object.assign(new Error('Dev Tools Console proxy nie je pre tento účet dostupný'), { kind: 'not-found' });
    }
    throw Object.assign(new Error(`Kibana vrátila HTTP ${response.status}`), { kind: 'http' });
  }
  const body = await response.json();
  if (body?.error) {
    throw Object.assign(new Error(body.error.reason || 'Elasticsearch vrátil chybu'), { kind: 'http' });
  }
  const hits = body?.hits?.hits || [];
  return hits.map(normalizeHit);
}

async function poll() {
  const fetchedAt = new Date().toISOString();
  try {
    const records = await fetchOnce();
    chrome.runtime.sendMessage({ type: 'sklc3-logs-snapshot', records, fetchedAt });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'sklc3-logs-error',
      error: { kind: error.kind || 'network', message: error.message },
      fetchedAt
    });
  }
}

poll();
setInterval(poll, POLL_INTERVAL_MS);
