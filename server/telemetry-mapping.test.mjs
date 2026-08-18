import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const markdown = readFileSync(join(root, 'data', 'sklc3-telemetry-mapping.md'), 'utf8');
const layout = JSON.parse(readFileSync(join(root, 'src', 'sklc3.json'), 'utf8'));
const telemetry = JSON.parse(readFileSync(join(root, 'src', 'sklc3-telemetry.json'), 'utf8'));

function markdownMappings() {
  const labels = new Set(layout.nodes.map(node => node.label));
  let agent = null;
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      agent = labels.has(heading[1]) ? heading[1] : null;
      continue;
    }
    const row = /^-\s+(e\d+)\s+→\s+.+?\|\s*direction:\s*(\d+)\s*$/.exec(line);
    if (row && agent) rows.push({ key: `${agent}:${row[2]}`, agent, direction: Number(row[2]), edgeId: row[1] });
  }
  return rows;
}

test('telemetry JSON exactly mirrors the filled Markdown mapping with explicit ambiguous pairs', () => {
  const rows = markdownMappings();
  const edges = new Map(layout.edges.map(edge => [edge.id, edge]));
  const labels = new Map(layout.nodes.map(node => [node.id, node.label]));
  const grouped = new Map();
  for (const row of rows) {
    const values = grouped.get(row.key) || [];
    values.push(row);
    grouped.set(row.key, values);
  }

  assert.equal(rows.length, 169);
  assert.equal(grouped.size, 169);

  for (const row of rows) {
    const edge = edges.get(row.edgeId);
    assert.ok(edge, `${row.key} references missing ${row.edgeId}`);
    assert.equal(labels.get(edge.from), row.agent, `${row.key} must start at its agent`);
  }

  const expectedMappings = Object.fromEntries(
    [...grouped].filter(([, values]) => values.length === 1).map(([key, values]) => [key, values[0].edgeId])
  );
  const expectedAmbiguous = Object.fromEntries(
    [...grouped].filter(([, values]) => values.length > 1).map(([key, values]) => [key, values.map(value => value.edgeId)])
  );

  assert.deepEqual(telemetry.mappings, expectedMappings);
  assert.deepEqual(telemetry.ambiguousMappings, expectedAmbiguous);
  assert.equal(Object.keys(telemetry.mappings).length + Object.keys(telemetry.ambiguousMappings).length, 169);
});
