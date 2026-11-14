// leaklens rescore: a model's SWE-bench score on all tasks and on the tasks whose text does not hand over the fix.
// Pure functions, no imports: the CLI (bin/leaklens.mjs) and the browser page (leaklens.grain64.com/rescore) run this same file
// against the same flag file (data/headline-flags.json), so the two cannot count differently. No network, no model.

export const SITE = 'https://leaklens.grain64.com';
export const ID_RE = /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+$/;
export const CAVEAT = 'Flagged means the task text hands over the fix; it does not say a model saw it. A fix commit dated before a cutoff shows that exposure was possible, not that a model trained on it.';
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
//   a JSON array of ids, or plain text           ids separated by new lines, commas or spaces
// Returns the resolved IDs (deduplicated, in first-seen order) and which shape was read.
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
  const tokens = t.split(/[\s,;"'`[\]]+/).filter(Boolean);
  const ids = tokens.filter((x) => ID_RE.test(x));
  if (!ids.length) throw new RescoreInputError('no instance IDs found (expected IDs like django__django-11099)');
  return { ids: uniq(ids), format: 'id list', ignored: tokens.length - ids.length };
}

function uniq(a) { return [...new Set(a)]; }

function fromJson(v) {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string')) return { ids: uniq(v.map((x) => x.trim()).filter(Boolean)), format: 'JSON list of IDs', ignored: 0 };
    return fromObjects(v, 'JSON array of results');
  }
  if (v && typeof v === 'object') {
    for (const k of ['resolved', 'resolved_ids', 'resolved_instances']) {
      if (Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string')) return { ids: uniq(v[k]), format: `JSON "${k}" list`, ignored: 0 };
    }
    const vals = Object.entries(v);
    if (vals.length && vals.every(([k, x]) => ID_RE.test(k) && x && typeof x === 'object')) {
      if (!vals.some(([, x]) => typeof x.resolved === 'boolean')) throw new RescoreInputError('per-instance report has no "resolved" field');
      return { ids: vals.filter(([, x]) => x.resolved === true).map(([k]) => k), format: 'per-instance report', ignored: 0 };
    }
  }
  throw new RescoreInputError('JSON without a "resolved" or "resolved_ids" list of instance IDs');
}

function fromObjects(arr, format) {
  const objs = arr.filter((x) => x && typeof x === 'object');
  if (!objs.length || !objs.some((x) => typeof x.instance_id === 'string')) throw new RescoreInputError(`${format}: no "instance_id" field`);
  if (!objs.some((x) => typeof x.resolved === 'boolean')) throw new RescoreInputError(`${format}: no "resolved" field (true/false per instance)`);
  return { ids: uniq(objs.filter((x) => x.resolved === true && typeof x.instance_id === 'string').map((x) => x.instance_id)), format, ignored: 0 };
}

function fromJsonl(t) {
  const objs = [];
  t.split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { objs.push(JSON.parse(l)); } catch { throw new RescoreInputError(`line ${i + 1}: not valid JSON`); }
  });
  return fromObjects(objs, 'JSONL');
}

// Which benchmark a list of IDs belongs to, when the caller does not say: the one holding the most of them; Verified on a tie.
export function guessBenchmark(ids, flags) {
  let best = 'swe-bench-verified', bestN = -1;
  for (const [slug, b] of Object.entries(flags.benchmarks)) {
    const set = new Set(b.tasks);
    const n = ids.filter((i) => set.has(i)).length;
    if (n > bestN || (n === bestN && slug === 'swe-bench-verified')) { best = slug; bestN = n; }
  }
  return best;
}

const pct = (k, n) => (n ? Math.round((1000 * k) / n) / 10 : null);
export const fmtPct = (p) => (p === null ? 'n/a' : p.toFixed(1) + '%');

export function rescore(ids, flags, benchmark) {
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
    flaggedSolved, unknown,
  };
  r.change = r.pctAll === null || r.pctUnflagged === null ? null : Math.round(10 * (r.pctUnflagged - r.pctAll)) / 10;
  return r;
}

const signed = (x) => (x === null ? 'n/a' : (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1));

export function tableHeader(r) {
  return `| Model | All ${r.total} tasks | ${r.unflaggedTotal} unflagged tasks | Change (points) | Flagged tasks solved |\n|---|---|---|---|---|`;
}
export function tableRow(r, label = 'your model') {
  return `| ${label} | ${fmtPct(r.pctAll)} (${r.resolved}/${r.total}) | ${fmtPct(r.pctUnflagged)} (${r.resolvedUnflagged}/${r.unflaggedTotal}) | ${signed(r.change)} | ${r.resolvedFlagged}/${r.flaggedTotal} |`;
}
export function citation(r) {
  return `${r.name}: ${fmtPct(r.pctAll)} (${r.resolved}/${r.total}) on all tasks, ${fmtPct(r.pctUnflagged)} (${r.resolvedUnflagged}/${r.unflaggedTotal}) on the ${r.unflaggedTotal} tasks whose text does not hand over the fix (Leaklens headline flags, methodology ${r.methodologyVersion}, flags as of ${r.asOf}; ${SITE}/rescore).`;
}

// The CLI's text report. The page renders the same fields.
export function report(r, label = 'your model') {
  const L = [];
  L.push(`${r.name} (Leaklens headline flags, methodology ${r.methodologyVersion}, as of ${r.asOf})`);
  L.push('');
  L.push(`  All ${r.total} tasks                ${fmtPct(r.pctAll).padStart(6)}  (${r.resolved} resolved)`);
  L.push(`  ${r.unflaggedTotal} unflagged tasks          ${fmtPct(r.pctUnflagged).padStart(6)}  (${r.resolvedUnflagged} resolved)   change ${signed(r.change)} points`);
  L.push(`  ${r.flaggedTotal} flagged tasks            ${fmtPct(r.pctFlagged).padStart(6)}  (${r.resolvedFlagged} resolved)`);
  L.push('');
  if (r.flaggedSolved.length) {
    L.push(`Flagged tasks it solved (${r.flaggedSolved.length}): the task text hands over the fix. Evidence: ${SITE}/t/<instance_id>`);
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
