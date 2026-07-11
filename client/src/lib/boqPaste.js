const BOQ_ALIASES = {
  item_ref:     ['item ref', 'item no', 'ref', 'item'],
  description:  ['description', 'desc', 'item description'],
  unit:         ['unit', 'uom'],
  qty:          ['qty', 'quantity'],
  rate:         ['rate', 'unit rate', 'rate eur'],
  amount:       ['amount', 'total', 'value', 'sum', 'contract sum', 'boq value'],
  section:      ['section', 'sub section', 'subsection'],
  iw_cost_code: ['iw cost code', 'cost code', 'code'],
  schedule:     ['schedule', 'sched'],
};

const VALID_TYPES = ['F', 'T', 'M'];

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9%/]/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  if (/ {2,}/.test(line)) return line.split(/ {2,}/);
  return line.split(',');
}

function mapCols(headerCells) {
  const result = {};
  // Pass 1: exact match (normalized header cell === one of the aliases). Resolving exact
  // matches first prevents a short header like "Unit" from being fuzzy-claimed by a longer
  // alias of another field (e.g. rate's "unit rate" alias contains the substring "unit").
  headerCells.forEach((cell, c) => {
    const v = norm(cell);
    if (!v) return;
    for (const [field, aliasList] of Object.entries(BOQ_ALIASES)) {
      if (field in result) continue;
      if (aliasList.includes(v)) result[field] = c;
    }
  });
  // Pass 2: fuzzy substring match for anything still unresolved, skipping columns already claimed.
  headerCells.forEach((cell, c) => {
    const v = norm(cell);
    if (!v || Object.values(result).includes(c)) return;
    for (const [field, aliasList] of Object.entries(BOQ_ALIASES)) {
      if (field in result) continue;
      if (aliasList.some(a => v.includes(a) || (a.includes(v) && v.length > 2))) result[field] = c;
    }
  });
  return result;
}

function numOrNull(v) {
  if (v == null || v === '' || isNaN(Number(v))) return null;
  return Number(v);
}

export function parsePastedBOQ(text, { schedule, type } = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) {
    return { rows: [], warnings: ['No text pasted'], error: true };
  }

  const headerCells = splitLine(lines[0]);
  const cols = mapCols(headerCells);
  if (cols.description == null) {
    return { rows: [], warnings: ['First line must be a header row with a Description column'], error: true };
  }

  const rows = [];
  const warnings = [];
  const batchTs = Date.now();
  let sortOrder = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const get = c => (c == null ? null : (cells[c] ?? '').trim());

    const description = get(cols.description) || '';
    const rawItemRef  = cols.item_ref != null ? (get(cols.item_ref) || '') : '';

    if (!description && !rawItemRef) continue;
    if (/total|carried forward/i.test(description) || /total|carried forward/i.test(rawItemRef)) continue;

    if (!description) {
      warnings.push(`Row ${i + 1} skipped: no description`);
      continue;
    }

    let qty  = cols.qty != null ? numOrNull(get(cols.qty)) : null;
    let rate = cols.rate != null ? numOrNull(get(cols.rate)) : null;

    if (qty == null) {
      const amount = cols.amount != null ? numOrNull(get(cols.amount)) : (rate != null ? rate : null);
      if (amount != null) {
        qty = 1;
        rate = amount;
        warnings.push(`Row ${i + 1}: no qty column — treated as lump sum`);
      } else {
        warnings.push(`Row ${i + 1} skipped: no qty/rate/amount value found`);
        continue;
      }
    }
    if (rate == null) {
      warnings.push(`Row ${i + 1}: no rate found — defaulted to 0`);
      rate = 0;
    }

    const item_ref = rawItemRef || `AUTO-${batchTs}-${rows.length + 1}`;

    let rowType = cols.type != null ? (get(cols.type) || '').toUpperCase() : '';
    if (!VALID_TYPES.includes(rowType)) rowType = VALID_TYPES.includes(type) ? type : 'M';

    const section  = cols.section != null ? (get(cols.section) || null) : null;
    const rowSched = cols.schedule != null ? (get(cols.schedule) || schedule) : schedule;
    const iw_cost_code = cols.iw_cost_code != null ? (get(cols.iw_cost_code) || null) : null;

    rows.push({
      item_ref, description, unit: cols.unit != null ? (get(cols.unit) || '') : '',
      qty, rate, section, type: rowType, iw_cost_code, schedule: rowSched,
      sort_order: sortOrder++,
      contract_sum: Math.round(qty * rate * 100) / 100,
    });
  }

  return { rows, warnings, error: false };
}
