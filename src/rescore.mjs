// leaklens rescore: a model's SWE-bench score on all tasks and on the tasks outside the Leaklens headline flags.
// Pure functions, no imports: the CLI (bin/leaklens.mjs) and the browser page (leaklens.grain64.com/rescore) run this same file
// against the same flag file (data/headline-flags.json), so the two cannot count differently. No network, no model.

export const SITE = 'https://leaklens.grain64.com';
export const ID_RE = /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/;
export const CAVEAT = 'Flagged means the task text hands over the fix; it does not say a model saw it. A fix commit dated before a cutoff shows that exposure was possible, not that a model trained on it.';
// One name for the two sets, used by every line below, the CLI, /rescore and the site copy (M9 pass 1 item 1). The set the
// score is restated on is "the tasks outside the headline flags", never "tasks that do not hand over the fix": it still holds
// Tier A tasks settled by a third check, Tier B and disputed tasks, which other Leaklens pages describe as stating the fix.
export const HEADLINE = 'Tier A where both checks agreed on a quote that states the fix, or Tier C';
export const outsideName = (r) => `${r.unflaggedTotal} tasks outside the ${r.flaggedTotal} headline flags`;
export const flaggedName = (r) => `${r.flaggedTotal} headline-flagged tasks`;
export const OUTSIDE_NOTE = 'The tasks outside the headline flags are not a clean set: they include tasks a third check settled as stating the fix, tasks that point to the fix, and disputed tasks. Those are counted apart from the headline, not removed.';
const ALIASES = { verified: 'swe-bench-verified', lite: 'swe-bench-lite' };

export class RescoreInputError extends Error {}

export function benchmarkSlug(name) {
  const s = String(name || '').toLowerCase().trim();
  return ALIASES[s] || s;
}

// What a per-instance results file looks like in practice:
//   SWE-bench/experiments results/results.json   {"resolved": [ids], ...}
//   sb-cli and harness run reports               {"resolved_ids": [ids], ...}
//   harness per-instance report.json             {"<id>": {"resolved": true, ...}, ...}
//   JSONL or a JSON array of objects             {"instance_id": "...", "resolved": true}
//   a CSV with a header and a status column      instance_id,resolved / django__django-11099,True
//   lines with a status next to each ID          django__django-11099 PASSED / astropy__astropy-12907 FAILED
//   a JSON array of ids, or plain text           ids separated by new lines, commas or spaces
// A status next to an ID is always read: only IDs marked resolved count, and an ID line without a status among lines
// that have one is refused, never guessed. Returns the resolved IDs (deduplicated, in first-seen order), which shape was
// read, how many IDs were marked not resolved, and how many other words were dropped (with the first few of them).
export function parseResolved(input) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const t = text.trim();
  if (!t) throw new RescoreInputError('no input: paste resolved instance IDs or a results file');
  if (t[0] === '{' || t[0] === '[') {
    let v = null;
    try { v = JSON.parse(t); } catch { v = undefined; }
    if (v !== undefined) return fromJson(v);
    if (t[0] === '{') return fromJsonl(t);
  }
  return fromCsv(t) || fromText(t);
}

const TRUE_WORDS = ['true', 'yes', '1', '1.0', 'passed', 'pass', 'resolved', 'resolved_full', 'success', 'succeeded', 'solved'];
const FALSE_WORDS = ['false', 'no', '0', '0.0', 'failed', 'fail', 'unresolved', 'not_resolved', 'resolved_no', 'resolved_partial', 'failure', 'error', 'errored', 'unsolved', 'skipped'];
const STATUS_HELP = 'True/False, 1/0, PASSED/FAILED or resolved/unresolved';
const STATUS_COLUMNS = ['resolved', 'is_resolved', 'status', 'passed', 'pass', 'result', 'outcome', 'success', 'solved'];
const ID_COLUMNS = ['instance_id', 'instance', 'id', 'task_id', 'task'];
const SEP = /[\s,;:|=()"'`[\]]+/;
function statusOf(word) {
  const w = String(word).trim().toLowerCase();
  return TRUE_WORDS.includes(w) ? true : FALSE_WORDS.includes(w) ? false : null;
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// The same ID marked resolved in one place and not resolved in another (several runs or retries in one file): refuse and
// name it, never pick one. entries = [id, resolved, where] in input order; where = 'line 3' or 'item 3'.
function refuseConflicts(entries) {
  const first = new Map(), bad = [];
  for (const [id, ok, where] of entries) {
    const f = first.get(id);
    if (!f) first.set(id, [ok, where]);
    else if (f[0] !== ok && !bad.some((b) => b[0] === id)) bad.push([id, f, [ok, where]]);
  }
  if (!bad.length) return;
  const [id, a, b] = bad[0];
  const word = (x) => (x ? 'resolved' : 'not resolved');
  throw new RescoreInputError(`${id} is marked ${word(a[0])} on ${a[1]} and ${word(b[0])} on ${b[1]}${bad.length > 1 ? ` (and ${plural(bad.length - 1, 'other ID', 'other IDs')}: ${bad.slice(1, 4).map((x) => x[0]).join(', ')}${bad.length > 4 ? ', …' : ''})` : ''}: keep one status per ID (one run per task), or paste only the resolved IDs`);
}

// A predictions file (instance_id + model_patch) lists every attempted task, solved or not: refuse it rather than count all.
const PATCH_COLUMNS = ['model_patch', 'patch', 'prediction', 'model_output'];

function result(ids, format, { notResolved = 0, ignoredWords = [] } = {}) {
  return { ids: uniq(ids), format, notResolved, ignored: ignoredWords.length, ignoredSample: uniq(ignoredWords).slice(0, 5) };
}

function splitCsvLine(line, d) {
  const cells = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === d) { cells.push(cur); cur = ''; } else cur += c;
  }
  cells.push(cur);
  return cells.map((x) => x.trim());
}

// A header line with a status column (resolved, status, passed, ...): read that column on every row.
function fromCsv(t) {
  const lines = t.split(/\r?\n/);
  const head = lines[0];
  const d = head.includes('\t') ? '\t' : head.includes(',') ? ',' : head.includes(';') ? ';' : null;
  if (!d) return null;
  const cols = splitCsvLine(head, d).map((c) => c.toLowerCase());
  if (cols.some((c) => ID_RE.test(c))) return null;
  const sc = cols.findIndex((c) => STATUS_COLUMNS.includes(c));
  if (sc < 0) {
    const pc = cols.find((c) => PATCH_COLUMNS.includes(c));
    if (pc && cols.some((c) => ID_COLUMNS.includes(c))) throw new RescoreInputError(`a "${pc}" column and no status column: this looks like a predictions file, which lists every task the model tried, solved or not. Paste the evaluation results (a "resolved" or "status" column, or the harness report), or only the resolved IDs`);
    return null;
  }
  const ic = cols.findIndex((c) => ID_COLUMNS.includes(c));
  const yes = [], no = [], seen = [];
  for (let n = 1; n < lines.length; n++) {
    if (!lines[n].trim()) continue;
    const cells = splitCsvLine(lines[n], d);
    const id = ic >= 0 ? cells[ic] : cells.find((c) => ID_RE.test(c));
    if (!id || !ID_RE.test(id)) throw new RescoreInputError(`line ${n + 1}: no instance ID${ic >= 0 ? ` in the "${cols[ic]}" column` : ''} (expected IDs like django__django-11099)`);
    const s = statusOf(cells[sc] ?? '');
    if (s === null) throw new RescoreInputError(`line ${n + 1}: "${cells[sc] ?? ''}" in the "${cols[sc]}" column is not a status (use ${STATUS_HELP}), or paste only the resolved IDs`);
    (s ? yes : no).push(id); seen.push([id, s, `line ${n + 1}`]);
  }
  refuseConflicts(seen);
  if (!yes.length && !no.length) throw new RescoreInputError(`a "${cols[sc]}" column but no rows under it`);
  const yesSet = new Set(yes);
  return result(yes, `CSV "${cols[sc]}" column`, { notResolved: uniq(no).filter((i) => !yesSet.has(i)).length });
}

// Plain text: IDs anywhere. A line with one ID and a status word next to it is a status line; 1/0 count as a status
// only after the ID (so "1) django__django-11099" stays a numbered list).
function fromText(t) {
  const lines = t.split(/\r?\n/);
  const plain = [], yes = [], no = [], ignoredWords = [], seen = [];
  let firstStatus = 0, firstPlain = 0;
  lines.forEach((line, n) => {
    const tokens = line.split(SEP).filter(Boolean);
    const at = tokens.findIndex((x) => ID_RE.test(x));
    if (at < 0) { ignoredWords.push(...tokens); return; }
    const ids = tokens.filter((x) => ID_RE.test(x));
    const st = [];
    tokens.forEach((x, i) => { if (!ID_RE.test(x) && statusOf(x) !== null && (i > at || !/^[\d.]+$/.test(x))) st.push(x); });
    const vals = st.map(statusOf);
    if (ids.length > 1) {
      const bad = st[vals.indexOf(false)];
      if (bad !== undefined) throw new RescoreInputError(`line ${n + 1} has several IDs and the status "${bad}": put one ID per line with its status, or paste only the resolved IDs`);
      plain.push(...ids); if (!firstPlain) firstPlain = n + 1;
      ignoredWords.push(...tokens.filter((x) => !ID_RE.test(x)));
      return;
    }
    if (!st.length) { plain.push(ids[0]); if (!firstPlain) firstPlain = n + 1; ignoredWords.push(...tokens.filter((x) => !ID_RE.test(x))); return; }
    if (vals.some((v) => v !== vals[0])) throw new RescoreInputError(`line ${n + 1}: ${ids[0]} has more than one status (${st.join(', ')}); give one (${STATUS_HELP}), or paste only the resolved IDs`);
    (vals[0] ? yes : no).push(ids[0]); seen.push([ids[0], vals[0], `line ${n + 1}`]); if (!firstStatus) firstStatus = n + 1;
    ignoredWords.push(...tokens.filter((x) => !ID_RE.test(x) && !st.includes(x)));
  });
  if (firstStatus && plain.length) {
    throw new RescoreInputError(`line ${firstStatus} has a status next to its ID but line ${firstPlain} (${plain[0]}) has none: give every ID a status (${STATUS_HELP}), or paste only the resolved IDs`);
  }
  if (firstStatus) {
    refuseConflicts(seen);
    const yesSet = new Set(yes);
    return result(yes, 'IDs with a status on each line', { notResolved: uniq(no).filter((i) => !yesSet.has(i)).length, ignoredWords });
  }
  if (!plain.length) throw new RescoreInputError('no instance IDs found (expected IDs like django__django-11099)');
  return result(plain, 'id list', { ignoredWords });
}

// What the reader of a result should know about how the input was read: rows marked not resolved, words dropped.
export function inputNotes(parsed) {
  const L = [];
  if (parsed.notResolved) L.push(`${plural(parsed.notResolved, 'ID was', 'IDs were')} marked not resolved and not counted.`);
  if (parsed.ignored) L.push(`${plural(parsed.ignored, 'other word was', 'other words were')} ignored (${parsed.ignoredSample.join(', ')}${parsed.ignored > parsed.ignoredSample.length ? ', …' : ''}).`);
  return L;
}

function uniq(a) { return [...new Set(a)]; }

function fromJson(v) {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string')) return result(v.map((x) => x.trim()).filter(Boolean), 'JSON list of IDs');
    return fromObjects(v, 'JSON array of results');
  }
  if (v && typeof v === 'object') {
    for (const k of ['resolved', 'resolved_ids', 'resolved_instances']) {
      if (Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string')) return result(v[k], `JSON "${k}" list`);
    }
    const vals = Object.entries(v);
    if (vals.length && vals.every(([k, x]) => ID_RE.test(k) && x && typeof x === 'object')) {
      if (!vals.some(([, x]) => typeof x.resolved === 'boolean')) throw new RescoreInputError('per-instance report has no "resolved" field');
      return result(vals.filter(([, x]) => x.resolved === true).map(([k]) => k), 'per-instance report', { notResolved: vals.filter(([, x]) => x.resolved !== true).length });
    }
  }
  throw new RescoreInputError('JSON without a "resolved" or "resolved_ids" list of instance IDs');
}

function fromObjects(arr, format, where = (i) => `item ${i + 1}`) {
  const objs = arr.filter((x) => x && typeof x === 'object');
  if (!objs.length || !objs.some((x) => typeof x.instance_id === 'string')) throw new RescoreInputError(`${format}: no "instance_id" field`);
  if (!objs.some((x) => typeof x.resolved === 'boolean')) throw new RescoreInputError(`${format}: no "resolved" field (true/false per instance)`);
  refuseConflicts(arr.map((x, i) => [x, i]).filter(([x]) => x && typeof x === 'object' && typeof x.instance_id === 'string').map(([x, i]) => [x.instance_id, x.resolved === true, where(i)]));
  const yes = objs.filter((x) => x.resolved === true && typeof x.instance_id === 'string').map((x) => x.instance_id), yesSet = new Set(yes);
  return result(yes, format, { notResolved: uniq(objs.filter((x) => typeof x.instance_id === 'string' && !yesSet.has(x.instance_id)).map((x) => x.instance_id)).length });
}

function fromJsonl(t) {
  const objs = [], lineOf = [];
  t.split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { objs.push(JSON.parse(l)); lineOf.push(i + 1); } catch { throw new RescoreInputError(`line ${i + 1}: not valid JSON`); }
  });
  return fromObjects(objs, 'JSONL', (i) => `line ${lineOf[i]}`);
}

// Which benchmark a list of IDs belongs to, when the caller does not say: the one holding the most of them; Verified on a tie.
export function guessBenchmark(ids, flags) {
  let best = 'swe-bench-verified', bestN = -1;
  for (const [slug, n] of Object.entries(fits(ids, flags))) {
    if (n > bestN || (n === bestN && slug === 'swe-bench-verified')) { best = slug; bestN = n; }
  }
  return best;
}
function fits(ids, flags) {
  return Object.fromEntries(Object.entries(flags.benchmarks).map(([slug, b]) => { const set = new Set(b.tasks); return [slug, uniq(ids).filter((i) => set.has(i)).length]; }));
}
const shortName = (name) => String(name).replace(/^SWE-bench\s+/, '');

// When the benchmark was worked out from the IDs and another one holds just as many of them, say so: the score's
// denominator depends on the choice. how = 'page' or 'cli' (only the last sentence differs).
export function guessNote(r, how = 'cli') {
  if (!r.workedOut || !r.alsoFits.length) return '';
  const other = r.alsoFits.map((x) => shortName(x.name));
  return `Worked out as ${shortName(r.name)}; these IDs also fit ${other.join(' and ')}. ` +
    (how === 'page' ? 'Choose the benchmark above if that is wrong.' : `Add --benchmark ${r.alsoFits[0].slug.replace('swe-bench-', '')} if that is wrong.`);
}

// A dropped file's name becomes the model name for the table row only when it names something: a harness output called
// results.json, report.json or "results (1).json" says nothing about the model, so the row keeps "your model" (M9 pass 1 item 5).
const GENERIC_FILE_NAMES = new Set(['results', 'result', 'report', 'reports', 'run', 'runs', 'output', 'outputs', 'out', 'predictions', 'prediction', 'preds', 'all_preds',
  'eval', 'evaluation', 'evaluations', 'resolved', 'resolved_ids', 'ids', 'instance_ids', 'instances', 'summary', 'final', 'final_report', 'scores', 'score', 'submission',
  'data', 'harness', 'logs', 'log', 'export', 'download', 'untitled', 'swe-bench', 'swebench', 'verified', 'lite', 'swe-bench-verified', 'swe-bench-lite']);
export function labelFromFileName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.(json|jsonl|txt|csv)$/i, '').trim();
  const core = base.toLowerCase().replace(/\s*\(\d+\)$/, '').replace(/[\s._-]*\d*$/, '').replace(/^[\s._-]+/, '');
  if (!core || GENERIC_FILE_NAMES.has(core) || GENERIC_FILE_NAMES.has(core.replace(/[\s.]+/g, '_'))) return '';
  return base.slice(0, 80);
}

const pct = (k, n) => (n ? Math.round((1000 * k) / n) / 10 : null);
export const fmtPct = (p) => (p === null ? 'n/a' : p.toFixed(1) + '%');

export function rescore(ids, flags, benchmark) {
  const workedOut = !benchmarkSlug(benchmark);
  const slug = benchmarkSlug(benchmark) || guessBenchmark(ids, flags);
  const b = flags.benchmarks[slug];
  if (!b) throw new RescoreInputError(`unknown benchmark "${benchmark}" (use one of: ${Object.keys(flags.benchmarks).map((s) => s.replace('swe-bench-', '')).join(', ')})`);
  const all = new Set(b.tasks), flagged = new Set(b.flagged);
  const resolved = uniq(ids).filter((i) => all.has(i));
  const unknown = uniq(ids).filter((i) => !all.has(i));
  const flaggedSolved = resolved.filter((i) => flagged.has(i)).sort();
  const unflaggedTotal = b.total - b.flaggedCount;
  const resolvedUnflagged = resolved.length - flaggedSolved.length;
  const r = {
    benchmark: slug, name: b.name, methodologyVersion: b.methodologyVersion, asOf: b.asOf,
    total: b.total, flaggedTotal: b.flaggedCount, unflaggedTotal,
    resolved: resolved.length, resolvedUnflagged, resolvedFlagged: flaggedSolved.length,
    pctAll: pct(resolved.length, b.total), pctUnflagged: pct(resolvedUnflagged, unflaggedTotal), pctFlagged: pct(flaggedSolved.length, b.flaggedCount),
    flaggedSolved, unknown, workedOut, alsoFits: [],
  };
  if (workedOut && resolved.length) {
    for (const [s2, n] of Object.entries(fits(ids, flags))) if (s2 !== slug && n === resolved.length) r.alsoFits.push({ slug: s2, name: flags.benchmarks[s2].name });
  }
  r.change = r.pctAll === null || r.pctUnflagged === null ? null : Math.round(10 * (r.pctUnflagged - r.pctAll)) / 10;
  return r;
}

const signed = (x) => (x === null ? 'n/a' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1));

export function tableHeader(r) {
  return `| Model | All ${r.total} tasks | ${r.unflaggedTotal} tasks outside the ${r.flaggedTotal} headline flags | Change (points) | Headline-flagged tasks solved |\n|---|---|---|---|---|`;
}
export function tableRow(r, label = 'your model') {
  return `| ${label} | ${fmtPct(r.pctAll)} (${r.resolved}/${r.total}) | ${fmtPct(r.pctUnflagged)} (${r.resolvedUnflagged}/${r.unflaggedTotal}) | ${signed(r.change)} | ${r.resolvedFlagged}/${r.flaggedTotal} |`;
}
export function citation(r) {
  return `${r.name}: ${fmtPct(r.pctAll)} (${r.resolved}/${r.total}) on all tasks, ${fmtPct(r.pctUnflagged)} (${r.resolvedUnflagged}/${r.unflaggedTotal}) on the ${outsideName(r)} (Leaklens headline flags: ${HEADLINE}; methodology ${r.methodologyVersion}, flags as of ${r.asOf}; ${SITE}/rescore).`;
}

// The CLI's text report. The page renders the same fields.
export function report(r, label = 'your model') {
  const L = [];
  L.push(`${r.name} (Leaklens headline flags, methodology ${r.methodologyVersion}, as of ${r.asOf})`);
  if (guessNote(r)) L.push(guessNote(r));
  L.push('');
  const names = [`All ${r.total} tasks`, outsideName(r), flaggedName(r)], w = Math.max(...names.map((n) => n.length)) + 2;
  L.push(`  ${names[0].padEnd(w)}${fmtPct(r.pctAll).padStart(6)}  (${r.resolved} resolved)`);
  L.push(`  ${names[1].padEnd(w)}${fmtPct(r.pctUnflagged).padStart(6)}  (${r.resolvedUnflagged} resolved)   change ${signed(r.change)} points`);
  L.push(`  ${names[2].padEnd(w)}${fmtPct(r.pctFlagged).padStart(6)}  (${r.resolvedFlagged} resolved)`);
  L.push(`  Headline flags: ${HEADLINE}.`);
  L.push(`  ${OUTSIDE_NOTE}`);
  L.push('');
  if (r.flaggedSolved.length) {
    L.push(`Headline-flagged tasks it solved (${r.flaggedSolved.length}): the task text hands over the fix. Evidence: ${SITE}/t/<instance_id>`);
    for (const id of r.flaggedSolved) L.push('  ' + id);
    L.push('');
  }
  if (r.unknown.length) {
    L.push(`Not in ${r.name} (${r.unknown.length}, left out of every count): ${r.unknown.slice(0, 10).join(', ')}${r.unknown.length > 10 ? ', …' : ''}`);
    L.push('');
  }
  L.push('Table row (markdown):');
  L.push(tableHeader(r));
  L.push(tableRow(r, label));
  L.push('');
  L.push('Cite:');
  L.push(citation(r));
  L.push('');
  L.push(CAVEAT);
  return L.join('\n');
}
