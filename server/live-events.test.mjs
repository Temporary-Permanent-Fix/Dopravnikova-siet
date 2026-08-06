import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiveEvent, passiveSegment, buildSnapshot, elasticTemplates } from './live-events.mjs';

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
