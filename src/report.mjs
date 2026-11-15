// results.jsonl (one row per task, input order) and summary.md. No timestamps or paths, so the same input gives the same bytes.
import { METHODOLOGY_VERSION, WORDING, PROCEDURE_TEXT } from './definitions.mjs';

export const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// The published count for the same tasks (BEN-349 item 3): when the input's IDs are in the Leaklens flag file, one line says
// what the public table counts for them, so the bold line of a rules-only run is never read as "Leaklens says".
export function publishedLine(rows, flags) {
  if (!flags || !flags.benchmarks) return null;
  const ids = rows.map((r) => r.instance_id);
  let best = null;
  for (const [slug, b] of Object.entries(flags.benchmarks)) {
    const all = new Set(b.tasks), fl = new Set(b.flagged);
    const inIt = ids.filter((id) => all.has(id));
    if (inIt.length && (!best || inIt.length > best.n)) best = { slug, b, n: inIt.length, flagged: inIt.filter((id) => fl.has(id)).length };
  }
  if (!best) return null;
  const which = best.n === ids.length ? `these ${best.n === 1 ? 'task' : best.n + ' tasks'}` : `the ${best.n} of these tasks in ${best.b.name}`;
  return `Leaklens public table for ${which}: ${best.flagged} flagged (Tier A where both checks agreed, or Tier C), methodology ${best.b.methodologyVersion}, as of ${best.b.asOf}: ${flags.source || 'https://leaklens.grain64.com'}/benchmarks/${best.slug}`;
}

export function summary(rows, { input, judged, model, repos, flags, procedure = judged ? 'm1.1' : 'rules' }) {
  const n = rows.length;
  const count = (f) => rows.filter(f).length;
  const tiers = { A: count((r) => r.tier === 'A'), B: count((r) => r.tier === 'B'), C: count((r) => r.tier === 'C') };
  const flagged = count((r) => r.state === 'flag');
  const pct = (k) => (n ? ` (${Math.round((100 * k) / n)}%)` : '');
  const L = [];
  L.push(`# Leaklens check: ${input}`);
  L.push('');
  L.push(`Methodology ${METHODOLOGY_VERSION} · ${n} task${n === 1 ? '' : 's'} · ${judged ? `judged by \`${model}\` with ` : ''}${PROCEDURE_TEXT[procedure]}`);
  L.push('');
  L.push(judged
    ? `**${flagged} of ${n} tasks flagged${pct(flagged)}: Tier A or B read by \`${model}\`, or Tier C by rule.**`
    : `**${tiers.C} of ${n} tasks${pct(tiers.C)}: gold-patch lines in the issue or discussion (Tier C). Tier A/B not read.**`);
  L.push('');
  const pub = publishedLine(rows, flags);
  if (pub) { L.push(pub); L.push(''); }
  L.push('| Signal | Tasks |');
  L.push('|---|---|');
  if (judged) {
    L.push(`| Tier A: the text states the fix | ${tiers.A} |`);
    L.push(`| Tier B: the text points to the exact place | ${tiers.B} |`);
  }
  L.push(`| Tier C: gold-patch lines appear in the issue or discussion | ${tiers.C} |`);
  L.push(`| Links the fix PR | ${count((r) => r.fix_pr_link)} |`);
  if (judged) {
    L.push(`| Disputed (checks differ, one found a quote) | ${count((r) => r.state === 'disputed')} |`);
    L.push(`| Clear (no quoted evidence) | ${count((r) => r.state === 'clear')} |`);
  }
  if (repos) L.push(`| Fix commit located in the local clone | ${count((r) => r.fix_commit && r.fix_commit.located)} |`);
  else L.push('| Fix commit date | not checked (pass `--repos <dir>` with local clones) |');
  L.push('');
  const shown = rows.filter((r) => r.state !== 'clear' && r.state !== 'rule_clear');
  if (shown.length) {
    L.push('## Tasks to look at');
    L.push('');
    L.push(`| Task | Tier | State | Evidence |${repos ? ' Fix commit |' : ''}`);
    L.push(`|---|---|---|---|${repos ? '---|' : ''}`);
    for (const r of shown) {
      const fc = r.fix_commit ? (r.fix_commit.located ? r.fix_commit.date.slice(0, 10) : 'not located') : '';
      L.push(`| ${r.instance_id} | ${r.tier} | ${r.state} | ${cell(clip(r.verdict, 220))} |${repos ? ` ${fc} |` : ''}`);
    }
    L.push('');
  }
  L.push(WORDING);
  L.push('');
  L.push('Tier and state definitions: DEFINITIONS.md, or https://leaklens.grain64.com/methodology. Per-task evidence (matched lines, quotes with offsets, every check) is in results.jsonl.');
  L.push('');
  return L.join('\n');
}
