// The task-file conventions shared by the CLI and the hosted audit. No node imports: the Worker imports this file.

// Column names other tools use, mapped to ours. An alias is used only when the real column is absent.
export const ALIASES = { fix_commit_date: 'merged_at', gold_patch: 'patch' };

// owner__name-1234 -> owner/name (the SWE-bench instance id convention)
export function repoFromId(id) {
  const m = /^(.+?)__(.+)-\d+$/.exec(id || '');
  return m ? `${m[1]}/${m[2]}` : '';
}

// Applies ALIASES to one task object.
export function withAliases(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[ALIASES[k] && !(ALIASES[k] in obj) ? ALIASES[k] : k] = v;
  return o;
}

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. Each record carries the line it starts on.
// An unterminated quote returns one record whose first cell is '\u0000unterminated'.
export function csvRecords(text) {
  const out = [];
  let cell = '';
  let cells = [];
  let inQ = false;
  let line = 1;
  let startLine = 1;
  const endRecord = () => {
    cells.push(cell);
    cell = '';
    if (!(cells.length === 1 && cells[0] === '')) out.push({ row: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell === '') inQ = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { endRecord(); line++; startLine = line; }
    else cell += c;
  }
  if (inQ) out.push({ row: startLine, cells: ['\u0000unterminated'] });
  else if (cell !== '' || cells.length) endRecord();
  return out;
}

// A CSV file's tasks as objects keyed by header, or { error, row } for the first structural problem.
export function csvObjects(text) {
  const recs = csvRecords(text);
  if (recs.length && recs[0].cells[0] === '\u0000unterminated') return { errors: [{ row: recs[0].row, message: 'a quoted field is never closed' }], items: [] };
  if (recs.length < 2) return { errors: [{ row: 1, message: 'the CSV needs a header row and at least one task' }], items: [] };
  const header = recs[0].cells.map((h) => h.trim());
  const errors = [];
  const items = [];
  for (const r of recs.slice(1)) {
    if (r.cells.length !== header.length) { errors.push({ row: r.row, message: `expected ${header.length} columns, found ${r.cells.length}` }); continue; }
    const obj = {};
    header.forEach((h, i) => (obj[h] = r.cells[i]));
    items.push({ row: r.row, obj });
  }
  return { errors, items };
}

// A file is read as CSV when it is named .csv, or when its first line is not JSON and names instance_id.
export function looksLikeCsv(text, filename = '') {
  if (/\.csv$/i.test(filename)) return true;
  const first = text.trimStart().split('\n', 1)[0] || '';
  return !/^[\[{]/.test(first) && /(^|,)\s*"?instance_id"?\s*(,|$)/.test(first);
}
