// Reads a benchmark file: SWE-bench-style JSONL (one task per line), a JSON array of the same objects, or CSV with a header row.
// Required per task: instance_id, problem_statement, patch (a row without one is listed as rejected, the rest are checked).
// Optional: repo, hints_text, created_at, merged_at, pr_number.
// Same columns and aliases as the hosted audit upload (src/table.mjs: gold_patch = patch, fix_commit_date = merged_at).
import fs from 'node:fs';
import { prNumber } from './rules.mjs';
import { repoFromId, withAliases, csvObjects, looksLikeCsv } from './table.mjs';

export { repoFromId };

export class InputError extends Error {}

// A row the input rules refuse is listed, not fatal (BEN-370): the valid rows are checked and the summary names each rejected one
// with its line and reason. `strict` restores the v2 behaviour: one bad row fails the whole file and nothing is checked.
export function readTasks(file, { strict = false, reversePatch = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new InputError(`cannot read ${file}: ${e.code || e.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 byte-order mark
  const items = [];
  const trimmed = text.trimStart();
  if (looksLikeCsv(trimmed, file)) {
    const { errors: ce, items: rows } = csvObjects(trimmed);
    for (const e of ce) items.push({ where: `line ${e.row}`, error: e.message });
    for (const r of rows) items.push({ where: `line ${r.row}`, o: r.obj });
  } else if (trimmed.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new InputError(`${file}: not valid JSON (${e.message})`); }
    arr.forEach((o, i) => items.push({ where: `item ${i + 1}`, o }));
  } else {
    text.split('\n').forEach((l, i) => {
      if (!l.trim()) return;
      try { items.push({ where: `line ${i + 1}`, o: JSON.parse(l) }); } catch (e) { items.push({ where: `line ${i + 1}`, error: 'not valid JSON' }); }
    });
  }
  const rejected = [];
  const tasks = [];
  const seen = new Set();
  const reject = (it, reason, id) => rejected.push({ where: it.where, instance_id: typeof id === 'string' && id ? id : null, reason });
  for (const it of items) {
    if (it.error) { reject(it, it.error); continue; }
    if (!it.o || typeof it.o !== 'object' || Array.isArray(it.o)) { reject(it, 'expected an object'); continue; }
    const o = withAliases(it.o);
    const bad = ['instance_id', 'problem_statement', 'patch'].filter((k) => typeof o[k] !== 'string' || !o[k])
      .map((k) => (o[k] === '' ? `empty ${k}` : `missing ${k}`));
    if (bad.length) { reject(it, bad.join(', '), o.instance_id); continue; }
    if (seen.has(o.instance_id)) { reject(it, `duplicate instance_id ${o.instance_id}`, o.instance_id); continue; }
    seen.add(o.instance_id);
    const patch = reversePatch ? reverseDiff(o.patch) : o.patch;
    if (!patch.trim()) { reject(it, 'patch has only test-file sections, nothing left after --reverse-patch', o.instance_id); continue; }
    tasks.push({
      instance_id: o.instance_id,
      repo: typeof o.repo === 'string' && o.repo ? o.repo : repoFromId(o.instance_id),
      pr_number: Number.isInteger(o.pr_number) ? o.pr_number : prNumber(o.instance_id),
      created_at: typeof o.created_at === 'string' ? o.created_at : null,
      ...(typeof o.merged_at === 'string' && o.merged_at ? { merged_at: o.merged_at } : {}),
      issue: o.problem_statement,
      hints: typeof o.hints_text === 'string' ? o.hints_text : '',
      patch,
      ...(reversePatch ? { reversed: true } : {}),
    });
  }
  if (rejected.length && (strict || !tasks.length)) {
    const why = strict ? ' (--strict)' : ', no valid row left';
    throw new InputError(`${file}: ${rejected.length} task(s) rejected, nothing checked${why}:\n${rejected.map(rejectedLine).join('\n')}`);
  }
  if (!tasks.length) throw new InputError(`${file}: no tasks found`);
  return { tasks, rejected };
}

export const rejectedLine = (r) => `${r.where}${r.instance_id ? ` (${r.instance_id})` : ''}: ${r.reason}`;

const TEST_FILE = /(^|\/)(tests?|testing)\/|(^|\/)test_[^/]*$|_test\.[a-z]+$|(^|\/)conftest\.py$/;

// --reverse-patch: for a task-construction diff (it strips the feature out of the repo, FeatureBench style), the solution is the
// reverse. Swap added and removed lines and drop test-file sections. Same output as reverse_patch in pipeline/ben357-convert.py.
export function reverseDiff(patch) {
  const out = [];
  for (const sec of patch.split(/^(?=diff --git )/m)) {
    if (!sec.startsWith('diff --git')) continue;
    const p = sec.split('\n', 1)[0].split(' b/').pop();
    if (TEST_FILE.test(p)) continue;
    out.push(sec.split('\n').map((l) => (l.startsWith('+') && !l.startsWith('+++') ? '-' + l.slice(1)
      : l.startsWith('-') && !l.startsWith('---') ? '+' + l.slice(1) : l)).join('\n'));
  }
  return out.map((x) => (x.endsWith('\n') ? x : x + '\n')).join('');
}

// A construction diff, seen from the added side: at least half the added lines are blank or stubs (pass, ..., raise
// NotImplementedError, a bare return) and the removed side carries the bodies (10+ non-blank lines, 4x the added code).
// Calibrated 15 Nov on raw FeatureBench full (164 of 166 patches) against SWE-bench Verified 0/500, Lite 0/300, Pro 0/731,
// SWE-Gym 0/2438, OmniCode 1/638, PolyBench 1/2110, SWE-rebench 4/6542.
const STUB = /^(pass|\.\.\.|raise NotImplementedError\b.*|return|return None|throw new UnsupportedOperationException\(.*\);?|todo!\(\)|unimplemented!\(\))\s*$/;
export function looksLikeConstruction(patch) {
  let add = 0, filler = 0, rem = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l[0] === '+') { add++; const s = l.slice(1).trim(); if (!s || STUB.test(s)) filler++; }
    else if (l[0] === '-' && l.slice(1).trim()) rem++;
  }
  return rem >= 10 && filler * 2 >= add && rem >= 4 * Math.max(add - filler, 1);
}

// The file-level warning: printed when at least half of the checked patches look like construction diffs.
export function constructionCount(tasks) {
  const n = tasks.filter((t) => looksLikeConstruction(t.patch)).length;
  return { n, of: tasks.length, warn: n > 0 && n * 2 >= tasks.length };
}
