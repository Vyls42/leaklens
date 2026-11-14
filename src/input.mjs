// Reads a benchmark file: SWE-bench-style JSONL (one task per line) or a JSON array of the same objects.
// Required per task: instance_id, problem_statement, patch. Optional: repo, hints_text, created_at.
import fs from 'node:fs';
import { prNumber } from './rules.mjs';

export class InputError extends Error {}

// owner__name-1234 -> owner/name (the SWE-bench instance id convention)
export function repoFromId(id) {
  const m = /^(.+?)__(.+)-\d+$/.exec(id || '');
  return m ? `${m[1]}/${m[2]}` : '';
}

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
  if (trimmed.startsWith('[')) {
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
    const o = it.o;
    if (!o || typeof o !== 'object') { errors.push(`${it.where}: expected an object`); continue; }
    const miss = ['instance_id', 'problem_statement', 'patch'].filter((k) => typeof o[k] !== 'string' || !o[k]);
    if (miss.length) { errors.push(`${it.where}: missing ${miss.join(', ')}`); continue; }
    if (seen.has(o.instance_id)) { errors.push(`${it.where}: duplicate instance_id ${o.instance_id}`); continue; }
    seen.add(o.instance_id);
    tasks.push({
      instance_id: o.instance_id,
      repo: typeof o.repo === 'string' && o.repo ? o.repo : repoFromId(o.instance_id),
      pr_number: Number.isInteger(o.pr_number) ? o.pr_number : prNumber(o.instance_id),
      created_at: typeof o.created_at === 'string' ? o.created_at : null,
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
