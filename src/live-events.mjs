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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Derives a matcher from a `{Placeholder}` template string (e.g. BOX_TEMPLATE)
// so a fully-rendered message (placeholders already substituted with real
// values, as Kibana stores it in `message`) can be parsed back into the same
// {messageTemplate, messageParams} shape normalizeLiveEvent expects from the
// structured `messageParams` field. One definition per template — reused by
// both the live (structured) path and the CSV-import (message-text-only) path.
function templateToMatcher(template) {
  const names = [];
  let pattern = '';
  let lastIndex = 0;
  const placeholderRe = /\{(\w+)\}/g;
  let match;
  while ((match = placeholderRe.exec(template))) {
    pattern += escapeRegExp(template.slice(lastIndex, match.index));
    names.push(match[1]);
    pattern += '(.*?)';
    lastIndex = placeholderRe.lastIndex;
  }
  pattern += escapeRegExp(template.slice(lastIndex));
  return { template, names, regex: new RegExp(`^${pattern}$`) };
}

const RENDERED_MESSAGE_MATCHERS = [BOX_TEMPLATE, ARM_TEMPLATE, MESSAGE_TEMPLATE].map(templateToMatcher);

// Reconstructs {messageTemplate, messageParams} from a fully-rendered message
// string (e.g. "Box has been routed (boxCode='\"80051959\"'; direction=12).")
// — for sources (like a Kibana CSV export) that only carry the rendered
// `message` text, not the structured `messageTemplate`/`messageParams` fields.
// Returns null if the message doesn't match any known template.
export function parseRenderedMessage(message) {
  const text = String(message ?? '');
  for (const { template, names, regex } of RENDERED_MESSAGE_MATCHERS) {
    const match = regex.exec(text);
    if (!match) continue;
    const messageParams = {};
    names.forEach((name, index) => { messageParams[name] = match[index + 1]; });
    return { messageTemplate: template, messageParams };
  }
  return null;
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

// Which edge of a telemetry-demo passive segment currently carries each demo
// KLT, at a given point in the demo's looping phase cycle. Shared between the
// canvas draw loop and the edge inspector panel (src/index.html) so they never
// drift. `demoCrates` items are `{boxCode, edgeIds, offset}`; `cratePhase` is
// the demo's current animation phase (advances once per RAF tick).
export function demoCratesByEdgeAt(demoCrates, cratePhase) {
  const byEdge = new Map();
  demoCrates.forEach(crate => {
    const n = crate.edgeIds.length;
    const scaled = (cratePhase + crate.offset * n) % n;
    const edgeIndex = Math.min(n - 1, Math.floor(scaled));
    const edgeId = crate.edgeIds[edgeIndex];
    const list = byEdge.get(edgeId) || [];
    list.push({ boxCode: crate.boxCode, progress: scaled - edgeIndex });
    byEdge.set(edgeId, list);
  });
  return byEdge;
}

// Real Kibana-driven equivalent of demoCratesByEdgeAt: a box approaches the
// end of its passive segment and stops `stopMargin` short of the next node
// until confirmed by nextAgent (see updateBoxTracker in src/index.html),
// rather than looping forever like the demo. Pure function — a terminal box
// that has fully arrived is reported via `expired` instead of being deleted
// from `boxTrackerEntries` here, so the caller (which owns the Map) performs
// the actual cleanup.
export function boxTrackerCratesByEdge(boxTrackerEntries, nowMs, { crateMsPerEdge, stopMargin }) {
  const byEdge = new Map();
  const expired = [];
  for (const [boxCode, box] of boxTrackerEntries) {
    const n = box.edgeIds.length;
    const elapsedEdges = (nowMs - box.legStartAt) / crateMsPerEdge;
    const cap = box.terminal ? n : Math.max(0, n - stopMargin);
    if (box.terminal && elapsedEdges >= n) { expired.push(boxCode); continue; }
    const scaled = Math.min(elapsedEdges, cap);
    const edgeIndex = Math.min(n - 1, Math.floor(scaled));
    const edgeId = box.edgeIds[edgeIndex];
    const waiting = !box.terminal && elapsedEdges >= cap;
    const list = byEdge.get(edgeId) || [];
    list.push({ boxCode, progress: scaled - edgeIndex, waiting });
    byEdge.set(edgeId, list);
  }
  return { byEdge, expired };
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
  window.passiveSegment = passiveSegment;
  window.demoCratesByEdgeAt = demoCratesByEdgeAt;
  window.boxTrackerCratesByEdge = boxTrackerCratesByEdge;
}
