import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiveEvent, passiveSegment, buildSnapshot, elasticTemplates, parseRenderedMessage, demoCratesByEdgeAt, boxTrackerCratesByEdge } from '../src/live-events.mjs';

const root = resolve(import.meta.dirname, '..');
const fixturesDir = join(import.meta.dirname, 'fixtures');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadFixture(name) {
  return loadJson(join(fixturesDir, `${name}.json`));
}

// A real Elasticsearch `_search` hit wraps the event under `_source`.
function asHit(source) {
  return { _source: source };
}

const layout = loadJson(join(root, 'src', 'sklc3.json'));
const telemetry = loadJson(join(root, 'src', 'sklc3-telemetry.json'));
const telemetryAgents = new Set(Object.keys(telemetry.mappings).map(key => key.split(':')[0]));

const realBoxRouted = loadFixture('real-box-routed');
const realMessageReceived = loadFixture('real-message-received');
const realArmStatus = loadFixture('real-arm-status');
const mappedArmStatus = loadFixture('mapped-arm-status');
const unmappedBoxRouted = loadFixture('unmapped-box-routed');
const ambiguousBoxRouted = loadFixture('ambiguous-box-routed');

test('elasticTemplates lists exactly the three known message templates', () => {
  assert.deepEqual(elasticTemplates, [
    "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
    'Arm status changed ({Arms})',
    'Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)'
  ]);
});

test('parseRenderedMessage: reconstructs "Box has been routed" from the real rendered message text', () => {
  const parsed = parseRenderedMessage(realBoxRouted.message);
  assert.deepEqual(parsed, {
    messageTemplate: "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
    messageParams: { BoxCode: '"80051959"', DirectionTo: '12' }
  });
});

test('parseRenderedMessage: reconstructs "Arm status changed" from the real rendered message text', () => {
  const parsed = parseRenderedMessage(realArmStatus.message);
  assert.deepEqual(parsed, {
    messageTemplate: 'Arm status changed ({Arms})',
    messageParams: { Arms: '"0:Occupied,6:Open,9:Open,12:Occupied"' }
  });
});

test('parseRenderedMessage: reconstructs "Message received" from the real rendered message text', () => {
  const parsed = parseRenderedMessage(realMessageReceived.message);
  assert.deepEqual(parsed, {
    messageTemplate: 'Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)',
    messageParams: {
      Id: parsed.messageParams.Id, // opaque UUID, just confirm it round-trips below
      ClientId: '"OBIWAN-01"',
      Topic: '"rur/plc/OBIWAN/occupation"'
    }
  });
});

test('parseRenderedMessage: unrecognized message text returns null', () => {
  assert.equal(parseRenderedMessage('Begin processing request codes'), null);
  assert.equal(parseRenderedMessage(''), null);
  assert.equal(parseRenderedMessage(undefined), null);
});

test('parseRenderedMessage output round-trips through normalizeLiveEvent identically to the structured fixture', () => {
  const { messageTemplate, messageParams } = parseRenderedMessage(realBoxRouted.message);
  const reconstructedSource = {
    '@timestamp': realBoxRouted['@timestamp'],
    headers: realBoxRouted.headers,
    messageTemplate,
    messageParams
  };
  assert.deepEqual(normalizeLiveEvent(asHit(reconstructedSource)), normalizeLiveEvent(asHit(realBoxRouted)));
});

test('normalizeLiveEvent: real "Box has been routed" event (DS24S26)', () => {
  const event = normalizeLiveEvent(asHit(realBoxRouted));
  assert.deepEqual(event, {
    kind: 'box-routed',
    agent: 'DS24S26',
    direction: 12,
    boxCode: '80051959',
    observedAt: '2026-07-15T08:12:41.203Z'
  });
});

test('normalizeLiveEvent: real "Message received" event (OBIWAN)', () => {
  const event = normalizeLiveEvent(asHit(realMessageReceived));
  assert.deepEqual(event, {
    kind: 'message',
    agent: 'OBIWAN',
    topic: 'rur/plc/OBIWAN/occupation',
    observedAt: '2026-07-15T08:12:41.560Z'
  });
});

test('normalizeLiveEvent: real "Arm status changed" event (OBIWAN)', () => {
  const event = normalizeLiveEvent(asHit(realArmStatus));
  assert.deepEqual(event, {
    kind: 'arm-status',
    agent: 'OBIWAN',
    arms: [
      { direction: 0, status: 'Occupied' },
      { direction: 6, status: 'Open' },
      { direction: 9, status: 'Open' },
      { direction: 12, status: 'Occupied' }
    ],
    observedAt: '2026-07-15T08:12:42.010Z'
  });
});

test('normalizeLiveEvent: accepts a raw source document (no _source wrapper)', () => {
  const event = normalizeLiveEvent(realBoxRouted);
  assert.equal(event.kind, 'box-routed');
  assert.equal(event.agent, 'DS24S26');
});

test('normalizeLiveEvent: unrecognized messageTemplate normalizes to kind "unknown-event"', () => {
  const event = normalizeLiveEvent(asHit({ ...realBoxRouted, messageTemplate: 'Something else happened' }));
  assert.deepEqual(event, {
    kind: 'unknown-event',
    agent: 'DS24S26',
    observedAt: '2026-07-15T08:12:41.203Z',
    template: 'Something else happened'
  });
});

test('normalizeLiveEvent: missing x-AgentName header returns null', () => {
  const event = normalizeLiveEvent(asHit({ ...realBoxRouted, headers: {} }));
  assert.equal(event, null);
});

test('normalizeLiveEvent: missing timestamp returns null', () => {
  const { '@timestamp': _dropped, ...withoutTimestamp } = realBoxRouted;
  assert.equal(normalizeLiveEvent(asHit(withoutTimestamp)), null);
});

test('passiveSegment: stops immediately when the next node is a telemetry agent', () => {
  // e7: DS01S03 -> DS02S04, and DS02S04 is itself a mapped telemetry agent.
  assert.deepEqual(passiveSegment('e7', layout, telemetryAgents), ['e7']);
});

test('passiveSegment: stops when the next node branches into multiple edges', () => {
  // e38: DS14 -> C3PO, and C3PO has two outgoing edges (e40, e129) in the real layout.
  assert.deepEqual(passiveSegment('e38', layout, telemetryAgents), ['e38']);
});

test('passiveSegment: walks a real multi-hop chain through passive junction nodes', () => {
  // e348 -> e349 -> e351 -> e354: OBIWAN -> JoinerSorter08 -> JoinerSorter12 -> JoinerSorter01,
  // each a single-outgoing junction node, until SL01AL18A branches into 18 edges.
  assert.deepEqual(passiveSegment('e348', layout, telemetryAgents), ['e348', 'e349', 'e351', 'e354']);
});

test('passiveSegment: unknown startEdgeId yields an empty segment', () => {
  assert.deepEqual(passiveSegment('e-does-not-exist', layout, telemetryAgents), []);
});

test('buildSnapshot: maps agent+direction to an edge for a real box-routed event', () => {
  const snapshot = buildSnapshot([asHit(realBoxRouted)], telemetry, layout, 60);

  assert.equal(snapshot.boxes.length, 1);
  const [box] = snapshot.boxes;
  assert.equal(box.agent, 'DS24S26');
  assert.equal(box.direction, 12);
  assert.equal(box.boxCode, '80051959');
  assert.equal(box.edgeId, 'e66');
  assert.deepEqual(box.edgeIds, ['e66']);

  assert.equal(snapshot.edgeMetrics.e66.ratePerHour, 60); // 3600 / 60s window
  assert.equal(snapshot.edgeMetrics.e66.lastEventAt, '2026-07-15T08:12:41.203Z');
  assert.equal(snapshot.unmappedEvents.length, 0);
});

test('buildSnapshot: unmapped direction for a known agent is recorded, not silently dropped', () => {
  const snapshot = buildSnapshot([asHit(unmappedBoxRouted)], telemetry, layout, 60);

  assert.equal(snapshot.boxes.length, 0);
  assert.deepEqual(snapshot.unmappedEvents, [
    { agent: 'DS24S26', direction: 250, kind: 'box-routed', reason: 'unmapped', template: undefined, observedAt: '2026-07-15T08:13:10.000Z' }
  ]);
  // Edges for DS24S26 must be untouched by the unmapped event.
  assert.equal(snapshot.edgeMetrics.e66.ratePerHour, 0);
});

test('buildSnapshot: an unrecognized messageTemplate lands in unmappedEvents with its template', () => {
  const snapshot = buildSnapshot([asHit({ ...realBoxRouted, messageTemplate: 'Something else happened' })], telemetry, layout, 60);

  assert.equal(snapshot.boxes.length, 0);
  assert.deepEqual(snapshot.unmappedEvents, [
    { agent: 'DS24S26', direction: undefined, kind: 'unknown-event', reason: 'unmapped', template: 'Something else happened', observedAt: '2026-07-15T08:12:41.203Z' }
  ]);
});

test('buildSnapshot: arm occupancy updates mapped edges and reports unmapped arms', () => {
  const snapshot = buildSnapshot([asHit(mappedArmStatus)], telemetry, layout, 60);

  // DS02S04:7 -> e84 (Occupied), DS02S04:11 -> e83 (Open), DS02S04:12 -> e11 (Occupied)
  assert.equal(snapshot.edgeMetrics.e84.occupied, true);
  assert.equal(snapshot.edgeMetrics.e84.lastEventAt, '2026-07-15T08:13:05.500Z');
  assert.equal(snapshot.edgeMetrics.e83.occupied, false);
  assert.equal(snapshot.edgeMetrics.e11.occupied, true);

  // Arm status does not consume the passive-segment rate counter.
  assert.equal(snapshot.edgeMetrics.e84.ratePerHour, 0);
  assert.equal(snapshot.boxes.length, 0);

  // DS02S04:99 has no entry in src/sklc3-telemetry.json.
  assert.deepEqual(snapshot.unmappedEvents, [
    { agent: 'DS02S04', direction: 99, kind: 'arm-status', reason: 'unmapped', observedAt: '2026-07-15T08:13:05.500Z' }
  ]);
});

test('buildSnapshot: mapped arms update edges while unknown arms remain visible', () => {
  const snapshot = buildSnapshot([asHit(realArmStatus)], telemetry, layout, 60);

  assert.equal(snapshot.edgeMetrics.e367.occupied, false); // OBIWAN:6
  assert.equal(snapshot.edgeMetrics.e348.occupied, false); // OBIWAN:9
  assert.deepEqual(snapshot.unmappedEvents, [
    { agent: 'OBIWAN', direction: 0, kind: 'arm-status', reason: 'unmapped', observedAt: '2026-07-15T08:12:42.010Z' },
    { agent: 'OBIWAN', direction: 12, kind: 'arm-status', reason: 'unmapped', observedAt: '2026-07-15T08:12:42.010Z' }
  ]);
});

test('buildSnapshot: an ambiguous mapping is diagnosed and never animates either edge', () => {
  const snapshot = buildSnapshot([asHit(ambiguousBoxRouted)], telemetry, layout, 60);

  assert.equal(snapshot.boxes.length, 0);
  assert.equal(snapshot.edgeMetrics.e40.ratePerHour, 0);
  assert.equal(snapshot.edgeMetrics.e129.ratePerHour, 0);
  assert.deepEqual(snapshot.unmappedEvents, [
    { agent: 'C3PO', direction: 6, kind: 'box-routed', reason: 'ambiguous-mapping', edgeIds: ['e40', 'e129'], template: undefined, observedAt: '2026-07-15T08:14:00.000Z' }
  ]);
});

test('buildSnapshot: a message event records a heartbeat, not a box or edge update', () => {
  const snapshot = buildSnapshot([asHit(realMessageReceived)], telemetry, layout, 60);

  assert.deepEqual(snapshot.heartbeats, {
    OBIWAN: { lastSeenAt: '2026-07-15T08:12:41.560Z', topic: 'rur/plc/OBIWAN/occupation' }
  });
  assert.equal(snapshot.boxes.length, 0);
  assert.equal(snapshot.unmappedEvents.length, 0);
});

test('buildSnapshot: preserves its output shape with no events', () => {
  const snapshot = buildSnapshot([], telemetry, layout, 60);

  assert.deepEqual(Object.keys(snapshot).sort(), [
    'boxes', 'edgeMetrics', 'heartbeats', 'latestObservedAt', 'sourceLagSeconds', 'unmappedEvents'
  ]);
  assert.deepEqual(Object.keys(snapshot.edgeMetrics).sort(), layout.edges.map(edge => edge.id).sort());
  for (const metric of Object.values(snapshot.edgeMetrics)) {
    assert.deepEqual(metric, { ratePerHour: 0, occupied: false, lastEventAt: null });
  }
  assert.deepEqual(snapshot.boxes, []);
  assert.deepEqual(snapshot.heartbeats, {});
  assert.deepEqual(snapshot.unmappedEvents, []);
  assert.equal(snapshot.latestObservedAt, null);
  assert.equal(snapshot.sourceLagSeconds, null);
});

test('buildSnapshot: latestObservedAt/sourceLagSeconds reflect the newest normalized event', () => {
  // realMessageReceived (08:12:41.560Z) is later than realBoxRouted (08:12:41.203Z).
  const snapshot = buildSnapshot([asHit(realBoxRouted), asHit(realMessageReceived)], telemetry, layout, 60);

  assert.equal(snapshot.latestObservedAt, '2026-07-15T08:12:41.560Z');
  const expectedLagSeconds = (Date.now() - Date.parse(snapshot.latestObservedAt)) / 1000;
  assert.ok(
    Math.abs(snapshot.sourceLagSeconds - expectedLagSeconds) < 5,
    `sourceLagSeconds ${snapshot.sourceLagSeconds} should be within 5s of ${expectedLagSeconds}`
  );
});

test('buildSnapshot: caps boxes and unmappedEvents at the most recent 100 entries', () => {
  const documents = [];
  for (let i = 0; i < 105; i += 1) {
    documents.push(asHit({ ...realBoxRouted, '@timestamp': `2026-07-15T08:${String(20 + i).padStart(2, '0')}:00.000Z`, messageParams: { BoxCode: `"BOX-${i}"`, DirectionTo: '12' } }));
  }
  for (let i = 0; i < 105; i += 1) {
    documents.push(asHit({ ...unmappedBoxRouted, '@timestamp': `2026-07-15T09:${String(20 + i).padStart(2, '0')}:00.000Z`, messageParams: { BoxCode: `"UNMAPPED-${i}"`, DirectionTo: '250' } }));
  }

  const snapshot = buildSnapshot(documents, telemetry, layout, 60);

  assert.equal(snapshot.boxes.length, 100);
  assert.equal(snapshot.boxes[0].boxCode, 'BOX-5'); // first 5 of 105 dropped
  assert.equal(snapshot.boxes[99].boxCode, 'BOX-104');

  assert.equal(snapshot.unmappedEvents.length, 100);
  assert.equal(snapshot.unmappedEvents[0].agent, 'DS24S26');
});

test('demoCratesByEdgeAt: places a crate on the edge matching its phase, with fractional progress', () => {
  const crates = [{ boxCode: 'DEMO-1', edgeIds: ['e1', 'e2', 'e3'], offset: 0 }];

  const byEdge = demoCratesByEdgeAt(crates, 1.5);

  assert.deepEqual([...byEdge.keys()], ['e2']);
  assert.deepEqual(byEdge.get('e2'), [{ boxCode: 'DEMO-1', progress: 0.5 }]);
});

test('demoCratesByEdgeAt: phase wraps around back to the first edge once it exceeds the chain length', () => {
  const crates = [{ boxCode: 'DEMO-1', edgeIds: ['e1', 'e2', 'e3'], offset: 0 }];

  const byEdge = demoCratesByEdgeAt(crates, 3.2); // 3.2 % 3 = 0.2 → back on e1

  const [entry] = byEdge.get('e1');
  assert.equal(entry.boxCode, 'DEMO-1');
  assert.ok(Math.abs(entry.progress - 0.2) < 1e-9);
});

test('demoCratesByEdgeAt: offset spreads crates on the same chain across different edges, grouped per edge', () => {
  const crates = [
    { boxCode: 'DEMO-A', edgeIds: ['e1', 'e2', 'e3'], offset: 0 },
    { boxCode: 'DEMO-B', edgeIds: ['e1', 'e2', 'e3'], offset: 0.5 }
  ];

  const byEdge = demoCratesByEdgeAt(crates, 0);

  assert.deepEqual(byEdge.get('e1'), [{ boxCode: 'DEMO-A', progress: 0 }]);
  assert.deepEqual(byEdge.get('e2'), [{ boxCode: 'DEMO-B', progress: 0.5 }]);
});

test('boxTrackerCratesByEdge: places a non-terminal box on the edge matching elapsed time', () => {
  const entries = [['BOX-1', { edgeIds: ['e1', 'e2', 'e3'], terminal: false, legStartAt: 0 }]];

  const { byEdge, expired } = boxTrackerCratesByEdge(entries, 1500, { crateMsPerEdge: 1000, stopMargin: 0.5 });

  assert.deepEqual(expired, []);
  assert.deepEqual(byEdge.get('e2'), [{ boxCode: 'BOX-1', progress: 0.5, waiting: false }]);
});

test('boxTrackerCratesByEdge: non-terminal box stops at stopMargin short of the end and is flagged waiting', () => {
  const entries = [['BOX-1', { edgeIds: ['e1', 'e2', 'e3'], terminal: false, legStartAt: 0 }]];

  // elapsedEdges = 3.0, cap = 3 - 0.5 = 2.5 → clamped, waiting once elapsed reaches cap.
  const { byEdge } = boxTrackerCratesByEdge(entries, 3000, { crateMsPerEdge: 1000, stopMargin: 0.5 });

  assert.deepEqual(byEdge.get('e3'), [{ boxCode: 'BOX-1', progress: 0.5, waiting: true }]);
});

test('boxTrackerCratesByEdge: terminal box still in flight is not capped by stopMargin and is never waiting', () => {
  const entries = [['BOX-1', { edgeIds: ['e1', 'e2', 'e3'], terminal: true, legStartAt: 0 }]];

  const { byEdge, expired } = boxTrackerCratesByEdge(entries, 2500, { crateMsPerEdge: 1000, stopMargin: 0.5 });

  assert.deepEqual(expired, []);
  assert.deepEqual(byEdge.get('e3'), [{ boxCode: 'BOX-1', progress: 0.5, waiting: false }]);
});

test('boxTrackerCratesByEdge: terminal box that fully reached the end is reported via expired, not placed on an edge', () => {
  const entries = [['BOX-1', { edgeIds: ['e1', 'e2', 'e3'], terminal: true, legStartAt: 0 }]];

  const { byEdge, expired } = boxTrackerCratesByEdge(entries, 3500, { crateMsPerEdge: 1000, stopMargin: 0.5 });

  assert.deepEqual(expired, ['BOX-1']);
  assert.equal(byEdge.size, 0);
});
