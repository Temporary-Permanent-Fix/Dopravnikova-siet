import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRison, parseKibanaDiscoverUrl } from './kibana-rison.mjs';

test('parseRison decodes objects, arrays, literals, numbers and bare strings', () => {
  assert.deepEqual(parseRison('(a:1,b:2)'), { a: 1, b: 2 });
  assert.deepEqual(parseRison('!(1,2,3)'), [1, 2, 3]);
  assert.deepEqual(parseRison('!()'), []);
  assert.deepEqual(parseRison('()'), {});
  assert.equal(parseRison('!t'), true);
  assert.equal(parseRison('!f'), false);
  assert.equal(parseRison('!n'), null);
  assert.equal(parseRison('now-15m'), 'now-15m');
  assert.equal(parseRison('5000'), 5000);
  assert.equal(parseRison('-3.5'), -3.5);
});

test('parseRison decodes quoted strings with !-escaping', () => {
  assert.equal(parseRison("'AgentName:DS24S26'"), 'AgentName:DS24S26');
  assert.equal(parseRison("'it!!s'"), 'it!s');
  assert.equal(parseRison("'don!'t'"), "don't");
  assert.equal(parseRison("''"), '');
});

test('parseRison decodes nested Kibana _g shape', () => {
  const parsed = parseRison('(refreshInterval:(pause:!f,value:5000),time:(from:now-15m,to:now))');
  assert.deepEqual(parsed, {
    refreshInterval: { pause: false, value: 5000 },
    time: { from: 'now-15m', to: 'now' }
  });
});

test('parseRison decodes nested Kibana _a shape with filters', () => {
  const raw = "(filters:!((meta:(alias:!n,disabled:!f,index:'idx-id',key:'namespace_name',negate:!f," +
    "params:(query:'logistics'),type:phrase),query:(match_phrase:(namespace_name:'logistics'))))," +
    "index:'idx-id',query:(language:kuery,query:'AgentName:DS24S26'))";
  const parsed = parseRison(raw);
  assert.equal(parsed.index, 'idx-id');
  assert.deepEqual(parsed.query, { language: 'kuery', query: 'AgentName:DS24S26' });
  assert.equal(parsed.filters.length, 1);
  assert.equal(parsed.filters[0].meta.negate, false);
  assert.deepEqual(parsed.filters[0].query, { match_phrase: { namespace_name: 'logistics' } });
});

test('parseRison decodes absolute (quoted) timestamps', () => {
  const parsed = parseRison("(from:'2026-08-01T00:00:00.000Z',to:'2026-08-04T00:00:00.000Z')");
  assert.deepEqual(parsed, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z' });
});

test('parseRison rejects malformed input', () => {
  assert.throws(() => parseRison(''));
  assert.throws(() => parseRison('(a:1'));
  assert.throws(() => parseRison("'unterminated"));
  assert.throws(() => parseRison('(a:1)trailing'));
  assert.throws(() => parseRison('!x'));
  assert.throws(() => parseRison('(:1)'));
});

test('parseRison rejects excessively deep nesting', () => {
  const deep = '!('.repeat(100) + '1' + ')'.repeat(100);
  assert.throws(() => parseRison(deep), /nesting too deep/);
});

function kibanaUrl({ g, a, hash = true, path = '/app/discover' }) {
  const base = `https://kibana.example.com${path}`;
  const params = [];
  if (g) params.push(`_g=${g}`);
  if (a) params.push(`_a=${a}`);
  const query = params.join('&');
  return hash ? `${base}#/?${query}` : `${base}?${query}`;
}

test('parseKibanaDiscoverUrl extracts time range, refresh interval, query and filters from a hash-based URL', () => {
  const g = '(refreshInterval:(pause:!f,value:5000),time:(from:now-15m,to:now))';
  const a = "(filters:!((meta:(disabled:!f,negate:!f),query:(match_phrase:(namespace_name:'logistics'))))," +
    "index:'idx-id',query:(language:kuery,query:'AgentName:DS24S26'))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ g, a }));

  assert.deepEqual(parsed.timeRange, { from: 'now-15m', to: 'now' });
  assert.deepEqual(parsed.refreshInterval, { pause: false, value: 5000 });
  assert.deepEqual(parsed.query, { language: 'kuery', queryString: 'AgentName:DS24S26' });
  assert.equal(parsed.filters.length, 1);
  assert.equal(parsed.filters[0].negate, false);
  assert.equal(parsed.filters[0].disabled, false);
  assert.deepEqual(parsed.filters[0].query, { match_phrase: { namespace_name: 'logistics' } });
  assert.equal(parsed.dataViewId, 'idx-id');
});

test('parseKibanaDiscoverUrl reads the data view id from _a.dataSource.dataViewId (newer Discover URL shape)', () => {
  const a = "(dataSource:(dataViewId:'840faa25-12c2-4793-bc94-594f0e55c937',type:dataView)," +
    "query:(language:kuery,query:''))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.equal(parsed.dataViewId, '840faa25-12c2-4793-bc94-594f0e55c937');
});

test('parseKibanaDiscoverUrl prefers the legacy _a.index field over dataSource.dataViewId when both are present', () => {
  const a = "(dataSource:(dataViewId:'newer-id',type:dataView),index:'legacy-id')";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.equal(parsed.dataViewId, 'legacy-id');
});

test('parseKibanaDiscoverUrl reconstructs a bool query from an OR "combined" filter group', () => {
  const a = "(filters:!((meta:(negate:!f,disabled:!f,type:combined,relation:OR,params:!(" +
    "(meta:(negate:!f,disabled:!f),query:(match_phrase:(message:'Box has been routed')))," +
    "(meta:(negate:!f,disabled:!f),query:(match_phrase:(message:'Sending MQTT route')))" +
    ")),query:())))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.equal(parsed.filters.length, 1);
  assert.deepEqual(parsed.filters[0].query, {
    bool: {
      should: [
        { match_phrase: { message: 'Box has been routed' } },
        { match_phrase: { message: 'Sending MQTT route' } }
      ],
      minimum_should_match: 1
    }
  });
});

test('parseKibanaDiscoverUrl reconstructs a bool query from an AND "combined" filter group', () => {
  const a = "(filters:!((meta:(negate:!f,disabled:!f,type:combined,relation:AND,params:!(" +
    "(meta:(negate:!f,disabled:!f),query:(match_phrase:(topic:'plc')))," +
    "(meta:(negate:!f,disabled:!f),query:(exists:(field:message)))" +
    ")),query:())))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.deepEqual(parsed.filters[0].query, {
    bool: { filter: [{ match_phrase: { topic: 'plc' } }, { exists: { field: 'message' } }] }
  });
});

test('parseKibanaDiscoverUrl drops a "combined" filter whose group has no usable sub-queries', () => {
  const a = "(filters:!((meta:(negate:!f,disabled:!f,type:combined,relation:OR,params:!()),query:())))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.deepEqual(parsed.filters, []);
});

test('parseKibanaDiscoverUrl drops disabled filters', () => {
  const a = "(filters:!((meta:(negate:!f,disabled:!t),query:(match_phrase:(message:'ignored')))))";
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ a }));
  assert.deepEqual(parsed.filters, []);
});

test('parseKibanaDiscoverUrl works with a plain query-string (non-hash) URL', () => {
  const g = '(refreshInterval:(pause:!t,value:0),time:(from:now-1h,to:now))';
  const parsed = parseKibanaDiscoverUrl(kibanaUrl({ g, hash: false }));
  assert.deepEqual(parsed.timeRange, { from: 'now-1h', to: 'now' });
  assert.deepEqual(parsed.refreshInterval, { pause: true, value: 0 });
  assert.equal(parsed.query, null);
  assert.deepEqual(parsed.filters, []);
});

test('parseKibanaDiscoverUrl applies partial state when only _g or only _a is present', () => {
  const onlyG = parseKibanaDiscoverUrl(kibanaUrl({ g: '(time:(from:now-30m,to:now))' }));
  assert.deepEqual(onlyG.timeRange, { from: 'now-30m', to: 'now' });
  assert.equal(onlyG.query, null);
  assert.deepEqual(onlyG.filters, []);

  const onlyA = parseKibanaDiscoverUrl(kibanaUrl({ a: "(query:(language:lucene,query:'foo'))" }));
  assert.equal(onlyA.timeRange, null);
  assert.equal(onlyA.refreshInterval, null);
  assert.deepEqual(onlyA.query, { language: 'lucene', queryString: 'foo' });
});

test('parseKibanaDiscoverUrl returns null (not a throw) for URLs with neither _g nor _a', () => {
  assert.equal(parseKibanaDiscoverUrl('https://kibana.example.com/app/discover'), null);
});

test('parseKibanaDiscoverUrl returns null for non-URL input', () => {
  assert.equal(parseKibanaDiscoverUrl(''), null);
  assert.equal(parseKibanaDiscoverUrl('not a url at all'), null);
  assert.equal(parseKibanaDiscoverUrl(undefined), null);
});

test('parseKibanaDiscoverUrl returns null when the operator has navigated away from Discover', () => {
  const g = '(refreshInterval:(pause:!f,value:5000),time:(from:now-15m,to:now))';
  assert.equal(parseKibanaDiscoverUrl(kibanaUrl({ g, path: '/app/management' })), null);
});

test('parseKibanaDiscoverUrl also decodes fully percent-encoded parameter values', () => {
  const g = '(refreshInterval:(pause:!f,value:10000),time:(from:now-5m,to:now))';
  const url = `https://kibana.example.com/app/discover#/?${new URLSearchParams({ _g: g }).toString()}`;
  const parsed = parseKibanaDiscoverUrl(url);
  assert.deepEqual(parsed.refreshInterval, { pause: false, value: 10000 });
  assert.deepEqual(parsed.timeRange, { from: 'now-5m', to: 'now' });
});
