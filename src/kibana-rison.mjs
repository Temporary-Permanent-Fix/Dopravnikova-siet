// Kept as a standalone ES module (rather than inline in index.html, where the
// rest of the frontend lives) purely so it can be unit-tested directly under
// Node via `npm test` against real Kibana `_g`/`_a` shapes, without adding a
// browser/DOM test harness to this zero-dependency project.
//
// Implements the narrow subset of rison (https://rison.io) that Kibana
// actually emits when encoding its global (`_g`) and app (`_a`) URL state:
// objects `(k:v,...)`, arrays `!(...)`, booleans `!t`/`!f`, null `!n`,
// quoted strings with `!`-escaping, bare/unquoted strings, and numbers.
// This is not a general-purpose rison implementation.

const MAX_INPUT_LENGTH = 20000;
const MAX_DEPTH = 64;
const BARE_STRING_STOP = /[()!,:'\s]/;

export function parseRison(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Invalid rison: empty input');
  }
  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error('Invalid rison: input too large');
  }
  const state = { str: input, index: 0 };
  const value = parseValue(state, 0);
  if (state.index !== state.str.length) {
    throw new Error(`Invalid rison: unexpected trailing input at index ${state.index}`);
  }
  return value;
}

function parseValue(state, depth) {
  if (depth > MAX_DEPTH) throw new Error('Invalid rison: nesting too deep');
  const ch = state.str[state.index];
  if (ch === undefined) throw new Error('Invalid rison: unexpected end of input');
  if (ch === '(') return parseObject(state, depth);
  if (ch === '!') return parseBang(state, depth);
  if (ch === "'") return parseQuotedString(state);
  if (ch === '-' && /\d/.test(state.str[state.index + 1] || '')) return parseNumber(state);
  if (/\d/.test(ch)) return parseNumber(state);
  return parseBareString(state);
}

function parseBang(state, depth) {
  const next = state.str[state.index + 1];
  if (next === '(') {
    state.index += 1;
    return parseArray(state, depth);
  }
  if (next === 't') { state.index += 2; return true; }
  if (next === 'f') { state.index += 2; return false; }
  if (next === 'n') { state.index += 2; return null; }
  if (next === 'u') { state.index += 2; return undefined; }
  throw new Error(`Invalid rison: unexpected '!' sequence at index ${state.index}`);
}

function parseObject(state, depth) {
  expect(state, '(');
  const result = {};
  if (state.str[state.index] === ')') { state.index += 1; return result; }
  for (;;) {
    const key = parseValue(state, depth + 1);
    if (typeof key !== 'string') throw new Error(`Invalid rison: object key must be a string at index ${state.index}`);
    expect(state, ':');
    result[key] = parseValue(state, depth + 1);
    const ch = state.str[state.index];
    if (ch === ',') { state.index += 1; continue; }
    if (ch === ')') { state.index += 1; break; }
    throw new Error(`Invalid rison: expected ',' or ')' at index ${state.index}`);
  }
  return result;
}

function parseArray(state, depth) {
  expect(state, '(');
  const result = [];
  if (state.str[state.index] === ')') { state.index += 1; return result; }
  for (;;) {
    result.push(parseValue(state, depth + 1));
    const ch = state.str[state.index];
    if (ch === ',') { state.index += 1; continue; }
    if (ch === ')') { state.index += 1; break; }
    throw new Error(`Invalid rison: expected ',' or ')' at index ${state.index}`);
  }
  return result;
}

function parseQuotedString(state) {
  expect(state, "'");
  let result = '';
  for (;;) {
    const ch = state.str[state.index];
    if (ch === undefined) throw new Error('Invalid rison: unterminated string');
    if (ch === "'") { state.index += 1; break; }
    if (ch === '!') {
      const next = state.str[state.index + 1];
      if (next === "'") { result += "'"; state.index += 2; continue; }
      if (next === '!') { result += '!'; state.index += 2; continue; }
      throw new Error(`Invalid rison: unknown escape sequence at index ${state.index}`);
    }
    result += ch;
    state.index += 1;
  }
  return result;
}

function parseBareString(state) {
  const start = state.index;
  while (state.index < state.str.length && !BARE_STRING_STOP.test(state.str[state.index])) {
    state.index += 1;
  }
  if (state.index === start) throw new Error(`Invalid rison: unexpected character at index ${start}`);
  return state.str.slice(start, state.index);
}

function parseNumber(state) {
  const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(state.str.slice(state.index));
  if (!match) throw new Error(`Invalid rison: expected a number at index ${state.index}`);
  state.index += match[0].length;
  return Number(match[0]);
}

function expect(state, char) {
  if (state.str[state.index] !== char) {
    throw new Error(`Invalid rison: expected '${char}' at index ${state.index}`);
  }
  state.index += 1;
}

// Most Kibana filter pills carry their ES DSL directly at `filter.query`
// (e.g. a `phrase` filter is `{match_phrase: {...}}`, a `phrases` — "is one
// of" — filter is already `{bool: {should: [...], minimum_should_match: 1}}`).
// A "combined" filter (an explicit AND/OR group of other filters, built via
// Kibana's "Create custom label"/group UI) is the one shape that does NOT:
// its sub-filters live in `filter.meta.params`, each with their own nested
// `.query`, and the top-level `filter.query` is empty. Reconstruct the
// equivalent `bool` DSL from those so it survives the server's clause
// whitelist (see ALLOWED_FILTER_QUERY_KEYS / assertValidQueryClause in
// server/index.mjs) same as any other filter, instead of being dropped or
// producing an invalid empty-object query.
function filterQuery(filter) {
  const meta = filter?.meta;
  if (meta?.type === 'combined' && Array.isArray(meta.params)) {
    const subQueries = meta.params
      .map(sub => (sub?.query && typeof sub.query === 'object' ? sub.query : null))
      .filter(Boolean);
    if (!subQueries.length) return null;
    return meta.relation === 'OR'
      ? { bool: { should: subQueries, minimum_should_match: 1 } }
      : { bool: { filter: subQueries } };
  }
  return filter?.query && typeof filter.query === 'object' ? filter.query : null;
}

// Reads Kibana's `_g` (global: time range + auto-refresh) and `_a` (app:
// query + filters + data view) state out of a full Kibana result URL, e.g.
// one copied from the address bar of a Discover tab after the user has set
// up their filter/time-range/auto-refresh there.
export function parseKibanaResultUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    throw new Error('Invalid Kibana link: empty input');
  }
  let url;
  try {
    url = new URL(urlString.trim());
  } catch {
    throw new Error('Invalid Kibana link: not a valid URL');
  }

  const rawG = extractParam(url, '_g');
  const rawA = extractParam(url, '_a');
  if (rawG == null && rawA == null) {
    throw new Error('Invalid Kibana link: no _g or _a state found in URL');
  }

  const g = rawG != null ? parseRison(rawG) : null;
  const a = rawA != null ? parseRison(rawA) : null;

  const timeRange = g?.time && typeof g.time === 'object'
    ? { from: valueOrNull(g.time.from), to: valueOrNull(g.time.to) }
    : null;

  const refreshInterval = g?.refreshInterval && typeof g.refreshInterval === 'object'
    ? { pause: Boolean(g.refreshInterval.pause), value: Number(g.refreshInterval.value) || 0 }
    : null;

  const query = a?.query && typeof a.query === 'object'
    ? {
        language: typeof a.query.language === 'string' ? a.query.language : 'kuery',
        queryString: typeof a.query.query === 'string' ? a.query.query : ''
      }
    : null;

  const filters = Array.isArray(a?.filters)
    ? a.filters
        .map(filter => ({
          negate: Boolean(filter?.meta?.negate ?? filter?.negate),
          disabled: Boolean(filter?.meta?.disabled ?? filter?.disabled),
          query: filterQuery(filter)
        }))
        .filter(filter => filter.query && Object.keys(filter.query).length > 0)
    : [];

  // Older Discover URLs put the data view reference directly at `_a.index`;
  // newer ones (confirmed against a real kibana.prod.alza.cz link) nest it at
  // `_a.dataSource.dataViewId` instead. Check both so the index-confirmation
  // safety gate (see applyKibanaLink in src/index.html) actually triggers.
  const dataViewId = typeof a?.index === 'string'
    ? a.index
    : typeof a?.dataSource?.dataViewId === 'string' ? a.dataSource.dataViewId : null;

  return { timeRange, refreshInterval, query, filters, dataViewId };
}

function valueOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function extractParam(url, name) {
  if (url.searchParams.has(name)) return url.searchParams.get(name);
  const hash = url.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
  return hashParams.has(name) ? hashParams.get(name) : null;
}

if (typeof window !== 'undefined') {
  window.parseRison = parseRison;
  window.parseKibanaResultUrl = parseKibanaResultUrl;
}
