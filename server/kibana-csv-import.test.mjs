import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectDelimiter, buildColumnIndex, mapRow, parseKibanaCsv } from '../src/kibana-csv-import.mjs';
import { normalizeLiveEvent } from '../src/live-events.mjs';

function asHit(source) {
  return { _source: source };
}

test('parseCsv: splits a simple comma-delimited CSV into rows of cells', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n', ',');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv: handles a quoted field containing an embedded comma', () => {
  const rows = parseCsv('name,note\n"Smith, John",hello\n', ',');
  assert.deepEqual(rows, [['name', 'note'], ['Smith, John', 'hello']]);
});

test('parseCsv: handles a quoted field containing an embedded newline', () => {
  const rows = parseCsv('a,b\n"line1\nline2",x\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['line1\nline2', 'x']]);
});

test('parseCsv: unescapes doubled quotes ("") inside a quoted field', () => {
  const rows = parseCsv('a,b\n"say ""hi""",x\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['say "hi"', 'x']]);
});

test('parseCsv: handles CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('parseCsv: ignores a trailing blank line', () => {
  const rows = parseCsv('a,b\n1,2\n\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('detectDelimiter: auto-detects "," as the default delimiter', () => {
  assert.equal(detectDelimiter('@timestamp,message,agent\n2026-01-01,hi,DS01\n'), ',');
});

test('detectDelimiter: auto-detects ";" for a regional Excel export', () => {
  assert.equal(detectDelimiter('@timestamp;message;agent\n2026-01-01;hi;DS01\n'), ';');
});

test('parseKibanaCsv: strips a UTF-8 BOM before parsing', () => {
  const csv = '﻿@timestamp,message,agent\n2026-08-12T10:00:00.000Z,hello,DS01\n';
  const result = parseKibanaCsv(csv);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].agent, 'DS01');
});

test('buildColumnIndex: recognizes known Kibana CSV export column aliases case-insensitively', () => {
  const { found } = buildColumnIndex(['@timestamp', 'Message', 'headers.x-AgentName', 'Level']);
  assert.equal(found.dateTime, true);
  assert.equal(found.message, true);
  assert.equal(found.agent, true);
  assert.equal(found.level, true);
  assert.equal(found.messageTemplate, false);
});

test('mapRow: structured path — builds messageParams directly from messageParams.* columns', () => {
  const header = ['@timestamp', 'message', 'headers.x-AgentName', 'messageTemplate', 'messageParams.BoxCode', 'messageParams.DirectionTo'];
  const { columns } = buildColumnIndex(header);
  const cells = [
    '2026-08-12T10:00:00.000Z',
    "Box has been routed (boxCode='\"80051959\"'; direction=12).",
    'DS24S26',
    "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
    '"80051959"',
    '12'
  ];
  const { record, error } = mapRow(cells, columns, 2);
  assert.equal(error, undefined);
  assert.deepEqual(record.messageParams, { BoxCode: '"80051959"', DirectionTo: '12' });
  assert.equal(record.messageTemplate, "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).");
});

test('mapRow: falls back to parsing rendered `message` text when messageTemplate/messageParams columns are absent', () => {
  const header = ['@timestamp', 'message', 'headers.x-AgentName'];
  const { columns } = buildColumnIndex(header);
  const cells = ['2026-08-12T10:00:00.000Z', "Box has been routed (boxCode='\"80051959\"'; direction=12).", 'DS24S26'];
  const { record, error } = mapRow(cells, columns, 2);
  assert.equal(error, undefined);
  assert.equal(record.messageTemplate, "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).");
  assert.deepEqual(record.messageParams, { BoxCode: '"80051959"', DirectionTo: '12' });
});

test('mapRow: message-text fallback handles all three known templates (Arm status, Message received)', () => {
  const header = ['@timestamp', 'message', 'agent'];
  const { columns } = buildColumnIndex(header);

  const armRow = mapRow(['2026-08-12T10:00:00.000Z', 'Arm status changed ("0:Occupied,6:Open")', 'OBIWAN'], columns, 2);
  assert.deepEqual(armRow.record.messageParams, { Arms: '"0:Occupied,6:Open"' });

  const msgRow = mapRow(['2026-08-12T10:00:00.000Z', 'Message received (messageId="x"; clientId="OBIWAN-01"; topic="rur/plc/OBIWAN/occupation";)', 'OBIWAN'], columns, 3);
  assert.deepEqual(msgRow.record.messageParams, { Id: '"x"', ClientId: '"OBIWAN-01"', Topic: '"rur/plc/OBIWAN/occupation"' });
});

test('mapRow: unrecognized message text still produces a record (messageTemplate null), not a dropped row', () => {
  const header = ['@timestamp', 'message', 'agent'];
  const { columns } = buildColumnIndex(header);
  const { record, error } = mapRow(['2026-08-12T10:00:00.000Z', 'Begin processing request codes', 'DS24S26'], columns, 2);
  assert.equal(error, undefined);
  assert.equal(record.messageTemplate, null);
  assert.equal(record.messageParams, null);
  assert.equal(normalizeLiveEvent(asHit(record)).kind, 'unknown-event');
});

test('mapRow: rejects a row missing the agent column value', () => {
  const header = ['@timestamp', 'message', 'agent'];
  const { columns } = buildColumnIndex(header);
  const { record, error } = mapRow(['2026-08-12T10:00:00.000Z', 'hello', ''], columns, 5);
  assert.equal(record, undefined);
  assert.deepEqual(error, { rowIndex: 5, reason: 'chýba agent' });
});

test('mapRow: rejects a row with an unparsable timestamp', () => {
  const header = ['@timestamp', 'message', 'agent'];
  const { columns } = buildColumnIndex(header);
  const { record, error } = mapRow(['not-a-date', 'hello', 'DS01'], columns, 7);
  assert.equal(record, undefined);
  assert.deepEqual(error, { rowIndex: 7, reason: 'neplatný alebo chýbajúci čas' });
});

test('parseKibanaCsv: end-to-end — mixed valid/invalid rows, semicolon delimiter, quoted commas', () => {
  const csv = [
    '@timestamp;message;headers.x-AgentName',
    `2026-08-12T10:00:00.000Z;"Box has been routed (boxCode=""80051959""; direction=12).";DS24S26`,
    `2026-08-12T10:00:05.000Z;Message with a, comma inside;DS24S26`,
    `;no timestamp here;DS24S26`
  ].join('\n');
  const result = parseKibanaCsv(csv);
  assert.equal(result.delimiter, ';');
  assert.equal(result.records.length, 2);
  assert.equal(result.rowErrors.length, 1);
  assert.equal(result.rowErrors[0].reason, 'neplatný alebo chýbajúci čas');
  assert.equal(result.records[1].message, 'Message with a, comma inside');
});

test('parseKibanaCsv round-trip: a CSV-parsed row normalizes identically through normalizeLiveEvent to the structured fixture shape', () => {
  const csv = [
    '@timestamp,message,headers.x-AgentName',
    `2026-08-12T10:00:00.000Z,"Box has been routed (boxCode='""80051959""'; direction=12).",DS24S26`
  ].join('\n');
  const { records } = parseKibanaCsv(csv);
  assert.equal(records.length, 1);
  const event = normalizeLiveEvent(asHit(records[0]));
  assert.deepEqual(event, {
    kind: 'box-routed',
    agent: 'DS24S26',
    direction: 12,
    boxCode: '80051959',
    observedAt: '2026-08-12T10:00:00.000Z'
  });
});
