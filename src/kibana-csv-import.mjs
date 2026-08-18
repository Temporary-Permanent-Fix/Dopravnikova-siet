import { elasticTemplates, parseRenderedMessage } from './live-events.mjs';

// Column aliases we recognize in a Kibana Discover CSV export. The user picks
// whatever columns are in their Discover table before hitting "Generate CSV" —
// we can't assume any particular set, only match against known names.
const COLUMN_ALIASES = {
  dateTime: ['@timestamp', 'datetime', 'time_key', 'time', 'timestamp'],
  message: ['message'],
  agent: ['headers.x-agentname', 'agent', 'x-agentname'],
  level: ['level'],
  id: ['_id', 'id'],
  messageTemplate: ['messagetemplate'],
  boxCode: ['messageparams.boxcode'],
  directionTo: ['messageparams.directionto'],
  arms: ['messageparams.arms'],
  paramId: ['messageparams.id'],
  clientId: ['messageparams.clientid'],
  topic: ['messageparams.topic']
};

function stripBom(text) {
  return text.replace(/^﻿/, '');
}

// Counts top-level (outside quotes) occurrences of a character in the header
// line, to auto-detect `,` vs `;` — Excel's regional export sometimes uses `;`.
function countTopLevel(line, char) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && c === char) count++;
  }
  return count;
}

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const commas = countTopLevel(firstLine, ',');
  const semicolons = countTopLevel(firstLine, ';');
  return semicolons > commas ? ';' : ',';
}

// RFC4180-ish parser: quoted fields, embedded delimiters/newlines inside
// quotes, `""` escaped quotes, CRLF/LF line endings. Returns string[][].
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = stripBom(text);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function normalizeHeaderName(name) {
  return String(name || '').trim().toLowerCase();
}

export function buildColumnIndex(headerRow) {
  const normalized = headerRow.map(normalizeHeaderName);
  const columns = {};
  const found = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex(name => aliases.includes(name));
    columns[key] = index;
    found[key] = index >= 0;
  }
  return { columns, found };
}

function cell(cells, index) {
  return index >= 0 && index < cells.length ? cells[index] : '';
}

function parseTimestamp(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function mapRow(cells, columns, rowIndex) {
  const agent = cell(cells, columns.agent).trim();
  const dateTime = parseTimestamp(cell(cells, columns.dateTime));
  if (!agent) return { error: { rowIndex, reason: 'chýba agent' } };
  if (!dateTime) return { error: { rowIndex, reason: 'neplatný alebo chýbajúci čas' } };

  const message = cell(cells, columns.message);
  const level = cell(cells, columns.level);
  const id = cell(cells, columns.id) || `csv-${rowIndex}`;

  let messageTemplate = cell(cells, columns.messageTemplate);
  let messageParams = null;
  if (messageTemplate && elasticTemplates.includes(messageTemplate)) {
    const boxCode = cell(cells, columns.boxCode);
    const directionTo = cell(cells, columns.directionTo);
    const arms = cell(cells, columns.arms);
    const paramId = cell(cells, columns.paramId);
    const clientId = cell(cells, columns.clientId);
    const topic = cell(cells, columns.topic);
    const hasAnyStructuredParam = boxCode || directionTo || arms || paramId || clientId || topic;
    if (hasAnyStructuredParam) {
      messageParams = {};
      if (boxCode) messageParams.BoxCode = boxCode;
      if (directionTo) messageParams.DirectionTo = directionTo;
      if (arms) messageParams.Arms = arms;
      if (paramId) messageParams.Id = paramId;
      if (clientId) messageParams.ClientId = clientId;
      if (topic) messageParams.Topic = topic;
    }
  }

  if (!messageParams) {
    const parsed = parseRenderedMessage(message);
    if (parsed) {
      messageTemplate = parsed.messageTemplate;
      messageParams = parsed.messageParams;
    } else {
      messageTemplate = null;
      messageParams = null;
    }
  }

  return {
    record: { id, dateTime, message, agent, level, messageTemplate, messageParams }
  };
}

export function parseKibanaCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (!rows.length) return { records: [], rowErrors: [], columnsSummary: null, delimiter, totalRows: 0 };

  const [headerRow, ...dataRows] = rows;
  const { columns, found } = buildColumnIndex(headerRow);
  const records = [];
  const rowErrors = [];

  dataRows.forEach((cells, index) => {
    const rowIndex = index + 2; // +1 for header, +1 for 1-based row numbering
    const { record, error } = mapRow(cells, columns, rowIndex);
    if (error) rowErrors.push(error);
    else records.push(record);
  });

  return { records, rowErrors, columnsSummary: found, delimiter, totalRows: dataRows.length };
}

if (typeof window !== 'undefined') {
  window.parseKibanaCsv = parseKibanaCsv;
}
