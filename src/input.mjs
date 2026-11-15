// Reads a benchmark file: SWE-bench-style JSONL (one task per line), a JSON array of the same objects, or CSV with a header row.
// Required per task: instance_id, problem_statement, patch. Optional: repo, hints_text, created_at, merged_at.
// Same columns and aliases as the hosted audit upload (src/table.mjs: gold_patch = patch, fix_commit_date = merged_at).
import fs from 'node:fs';
import { prNumber } from './rules.mjs';
import { repoFromId, withAliases, csvObjects, looksLikeCsv } from './table.mjs';

export { repoFromId };

export class InputError extends Error {}

export function readTasks(file) {
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
  const errors = [];
  const tasks = [];
  const seen = new Set();
  for (const it of items) {
    if (it.error) { errors.push(`${it.where}: ${it.error}`); continue; }
    if (!it.o || typeof it.o !== 'object' || Array.isArray(it.o)) { errors.push(`${it.where}: expected an object`); continue; }
    const o = withAliases(it.o);
    const miss = ['instance_id', 'problem_statement', 'patch'].filter((k) => typeof o[k] !== 'string' || !o[k]);
    if (miss.length) { errors.push(`${it.where}: missing ${miss.join(', ')}`); continue; }
    if (seen.has(o.instance_id)) { errors.push(`${it.where}: duplicate instance_id ${o.instance_id}`); continue; }
    seen.add(o.instance_id);
    tasks.push({
      instance_id: o.instance_id,
      repo: typeof o.repo === 'string' && o.repo ? o.repo : repoFromId(o.instance_id),
      pr_number: Number.isInteger(o.pr_number) ? o.pr_number : prNumber(o.instance_id),
      created_at: typeof o.created_at === 'string' ? o.created_at : null,
      ...(typeof o.merged_at === 'string' && o.merged_at ? { merged_at: o.merged_at } : {}),
      issue: o.problem_statement,
      hints: typeof o.hints_text === 'string' ? o.hints_text : '',
      patch: o.patch,
    });
  }
  if (errors.length) {
    const more = errors.length > 10 ? `\n... and ${errors.length - 10} more` : '';
    throw new InputError(`${file}: ${errors.length} task(s) rejected, nothing checked:\n${errors.slice(0, 10).join('\n')}${more}`);
  }
  if (!tasks.length) throw new InputError(`${file}: no tasks found`);
  return tasks;
}
