const BOX_TEMPLATE = "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).";
const ARM_TEMPLATE = 'Arm status changed ({Arms})';
const MESSAGE_TEMPLATE = 'Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)';

function unquote(value) {
  return String(value ?? '').replace(/^['"]+|['"]+$/g, '');
}

function sourceOf(document) {
  return document?._source || document || {};
}

function agentOf(source) {
  const header = source.headers?.['x-AgentName'];
  return Array.isArray(header) ? header[0] : (header || source.agent || null);
}

function parseArms(raw) {
  return unquote(raw).split(',').map(part => {
    const [direction, status] = part.split(':');
    return { direction: Number(direction), status: status?.trim() || '' };
  }).filter(arm => Number.isFinite(arm.direction));
}

export function normalizeLiveEvent(document) {
  const source = sourceOf(document);
  const template = source.messageTemplate || source.event?.type || '';
  const agent = agentOf(source);
  const observedAt = source['@timestamp'] || source.time_key || source.dateTime;
  if (!agent || !observedAt) return null;

  if (template === BOX_TEMPLATE || template === 'Box has been routed') {
    const direction = Number(unquote(source.messageParams?.DirectionTo ?? source.direction));
    const boxCode = unquote(source.messageParams?.BoxCode ?? source.boxCode);
    if (!Number.isFinite(direction) || !boxCode) return null;
    return { kind: 'box-routed', agent, direction, boxCode, observedAt };
  }
  if (template === ARM_TEMPLATE || template === 'Arm status changed') {
    const arms = source.messageParams?.Arms ? parseArms(source.messageParams.Arms) : [];
    return { kind: 'arm-status', agent, arms, observedAt };
  }
  if (template === MESSAGE_TEMPLATE || template === 'Message received') {
    return { kind: 'message', agent, topic: unquote(source.messageParams?.Topic ?? source.topic), observedAt };
  }
  // Keep unsupported telemetry visible to the editor. It is a mapping/input
  // issue, not something that should silently disappear from operations.
  return { kind: 'unknown-event', agent, observedAt, template: String(template || 'bez messageTemplate') };
}

export function passiveSegment(startEdgeId, layout, telemetryAgents) {
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const edges = new Map(layout.edges.map(edge => [edge.id, edge]));
  const segment = [];
  const seen = new Set();
  let edge = edges.get(startEdgeId);
  while (edge && !seen.has(edge.id)) {
    segment.push(edge.id);
    seen.add(edge.id);
    const node = nodes.get(edge.to);
    if (!node || telemetryAgents.has(node.label) || node.type === 'sink' || node.type === 'error') break;
    const outgoing = layout.edges.filter(candidate => candidate.from === node.id);
    if (outgoing.length !== 1) break;
    edge = outgoing[0];
  }
  return segment;
}

// Koncový uzol pasívneho segmentu: ak je to ďalšie telemetrické čidlo, bedna
// naň môže vizuálne počkať na potvrdenie (nextAgent); inak (sink/error/
// nejednoznačné vetvenie) niet na čo čakať a segment je terminálny. Zdieľané
// medzi buildSnapshot (server aj browser-extension cesta) a server-side
// mockSnapshot(), aby sa logika nerozišla.
export function describeSegmentEnd(edgeIds, layout, telemetryAgents) {
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const edges = new Map(layout.edges.map(edge => [edge.id, edge]));
  const lastEdge = edges.get(edgeIds[edgeIds.length - 1]);
  const endNode = lastEdge ? nodes.get(lastEdge.to) : null;
  const nextAgent = endNode && telemetryAgents.has(endNode.label) ? endNode.label : null;
  return { nextAgent, terminal: !nextAgent };
}

export function buildSnapshot(documents, telemetry, layout, windowSeconds) {
  const mappings = telemetry.mappings || {};
  const ambiguousMappings = telemetry.ambiguousMappings || {};
  const telemetryAgents = new Set(Object.keys(mappings).map(key => key.split(':')[0]));
  const edgeMetrics = Object.fromEntries(layout.edges.map(edge => [edge.id, { ratePerHour: 0, occupied: false, lastEventAt: null }]));
  const heartbeats = {};
  const boxes = [];
  const unmappedEvents = [];

  const normalizedEvents = documents.map(normalizeLiveEvent).filter(Boolean);
  normalizedEvents.forEach(event => {
    if (event.kind === 'message') {
      heartbeats[event.agent] = { lastSeenAt: event.observedAt, topic: event.topic };
      return;
    }
    if (event.kind === 'arm-status') {
      event.arms.forEach(arm => {
        const mappingKey = `${event.agent}:${arm.direction}`;
        const edgeId = mappings[mappingKey];
        if (ambiguousMappings[mappingKey]) {
          return unmappedEvents.push({ agent: event.agent, direction: arm.direction, kind: event.kind, reason: 'ambiguous-mapping', edgeIds: ambiguousMappings[mappingKey], observedAt: event.observedAt });
        }
        if (!edgeId || !edgeMetrics[edgeId]) return unmappedEvents.push({ agent: event.agent, direction: arm.direction, kind: event.kind, reason: 'unmapped', observedAt: event.observedAt });
        edgeMetrics[edgeId].occupied = arm.status.toLowerCase() === 'occupied';
        edgeMetrics[edgeId].lastEventAt = event.observedAt;
      });
      return;
    }
    const mappingKey = `${event.agent}:${event.direction}`;
    const edgeId = mappings[mappingKey];
    if (ambiguousMappings[mappingKey]) return unmappedEvents.push({
      agent: event.agent, direction: event.direction, kind: event.kind,
      reason: 'ambiguous-mapping', edgeIds: ambiguousMappings[mappingKey], template: event.template, observedAt: event.observedAt
    });
    if (!edgeId || !edgeMetrics[edgeId]) return unmappedEvents.push({
      agent: event.agent, direction: event.direction, kind: event.kind,
      reason: 'unmapped', template: event.template, observedAt: event.observedAt
    });
    const edgeIds = passiveSegment(edgeId, layout, telemetryAgents);
    edgeIds.forEach(id => {
      const metric = edgeMetrics[id];
      metric.ratePerHour += 3600 / windowSeconds;
      metric.lastEventAt = event.observedAt;
    });
    const { nextAgent, terminal } = describeSegmentEnd(edgeIds, layout, telemetryAgents);
    boxes.push({ ...event, edgeId, edgeIds, nextAgent, terminal });
  });

  const allObservedAt = normalizedEvents.map(event => Date.parse(event.observedAt)).filter(Number.isFinite);
  const latestObservedAt = allObservedAt.length ? new Date(Math.max(...allObservedAt)).toISOString() : null;
  const sourceLagSeconds = latestObservedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(latestObservedAt)) / 1000))
    : null;

  return {
    edgeMetrics,
    boxes: boxes.slice(-100),
    heartbeats,
    unmappedEvents: unmappedEvents.slice(-100),
    latestObservedAt,
    sourceLagSeconds
  };
}

export const elasticTemplates = [BOX_TEMPLATE, ARM_TEMPLATE, MESSAGE_TEMPLATE];

if (typeof window !== 'undefined') {
  window.buildSnapshot = buildSnapshot;
  window.normalizeLiveEvent = normalizeLiveEvent;
}
