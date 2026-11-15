// leaklens rescore: run the CLI as a user does, on real public results files (SWE-bench/experiments, resolved lists only),
// and check the numbers against the rescored leaderboard Leaklens published (site/swe-bench-verified-rescored.csv, 12 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResolved, rescore, guessBenchmark, guessNote, inputNotes, citation, tableRow, RescoreInputError } from '../src/rescore.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FLAGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/headline-flags.json'), 'utf8'));
const FX = path.join(ROOT, 'fixtures/rescore');
const SONAR = path.join(FX, '20251205_sonar-foundation-agent_claude-opus-4-5.json');
const TRAE = path.join(FX, '20250928_trae_doubao_seed_code.json');
const ENV = { PATH: process.env.PATH, HOME: os.tmpdir() };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leaklens-rescore-'));

function run(args, input) {
  return new Promise((resolve) => {
    const p = execFile(process.execPath, [path.join(ROOT, 'bin/leaklens.mjs'), ...args], { cwd: ROOT, env: ENV }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }));
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
  });
}

test('flag file: 500 Verified and 300 Lite tasks, flagged counts as the published headline (149, 84)', () => {
  const v = FLAGS.benchmarks['swe-bench-verified'], l = FLAGS.benchmarks['swe-bench-lite'];
  assert.equal(v.tasks.length, 500); assert.equal(v.flagged.length, 149); assert.equal(v.flaggedCount, 149);
  assert.equal(l.tasks.length, 300); assert.equal(l.flagged.length, 84);
  for (const b of [v, l]) { const all = new Set(b.tasks); assert.ok(b.flagged.every((i) => all.has(i))); }
});

test('rescore = the published rescored leaderboard for two entries', async () => {
  for (const [file, want] of [[SONAR, { resolved: 396, pctAll: 79.2, resolvedFlagged: 136, resolvedUnflagged: 260, pctUnflagged: 74.1 }],
    [TRAE, { resolved: 394, pctAll: 78.8, resolvedFlagged: 134, resolvedUnflagged: 260, pctUnflagged: 74.1 }]]) {
    const r = await run(['rescore', file, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    for (const [k, v] of Object.entries(want)) assert.equal(j[k], v, `${path.basename(file)} ${k}`);
    assert.equal(j.benchmark, 'swe-bench-verified');
    assert.equal(j.unflaggedTotal, 351);
    assert.equal(j.flaggedSolved.length, want.resolvedFlagged);
    assert.deepEqual(j.unknown, []);
  }
});

test('text report: three scores, flagged tasks solved, a table row and a citation line; wording rule', async () => {
  const r = await run(['rescore', SONAR, '--label', 'Sonar (Opus 4.5)']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /All 500 tasks\s+79\.2%/);
  assert.match(r.stdout, /351 unflagged tasks\s+74\.1%/);
  assert.match(r.stdout, /Flagged tasks it solved \(136\): the task text hands over the fix/);
  assert.match(r.stdout, /\| Sonar \(Opus 4\.5\) \| 79\.2% \(396\/500\) \| 74\.1% \(260\/351\) \| −5\.1 \| 136\/149 \|/);
  assert.match(r.stdout, /SWE-bench Verified: 79\.2% \(396\/500\) on all tasks, 74\.1% \(260\/351\) on the 351 tasks whose text does not hand over the fix/);
  assert.match(r.stdout, /exposure was possible, not that a model trained on it/);
  assert.doesNotMatch(r.stdout, /contaminat|cheat/i);
});

test('every input shape gives the same numbers', async () => {
  const ids = JSON.parse(fs.readFileSync(SONAR, 'utf8')).resolved;
  const notResolved = FLAGS.benchmarks['swe-bench-verified'].tasks.filter((i) => !ids.includes(i));
  const d = tmp();
  const shapes = {
    'ids.txt': ids.join('\n') + '\n',
    'ids-commas.txt': ids.join(', '),
    'list.json': JSON.stringify(ids),
    'report.json': JSON.stringify({ total_instances: 500, resolved_ids: ids, unresolved_ids: notResolved }),
    'per-instance.json': JSON.stringify(Object.fromEntries([...ids.map((i) => [i, { resolved: true }]), ...notResolved.map((i) => [i, { resolved: false }])])),
    'results.jsonl': [...ids.map((i) => JSON.stringify({ instance_id: i, resolved: true })), ...notResolved.map((i) => JSON.stringify({ instance_id: i, resolved: false }))].join('\n') + '\n',
    'array.json': JSON.stringify(ids.map((i) => ({ instance_id: i, resolved: true }))),
    'bom.txt': '﻿' + ids.join('\n'),
  };
  for (const [f, body] of Object.entries(shapes)) {
    fs.writeFileSync(path.join(d, f), body);
    const r = await run(['rescore', path.join(d, f), '--json']);
    assert.equal(r.code, 0, f + ': ' + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual([j.resolved, j.resolvedUnflagged, j.resolvedFlagged], [396, 260, 136], f);
  }
  const stdin = await run(['rescore', '-', '--json'], ids.join(' '));
  assert.equal(JSON.parse(stdin.stdout).resolvedUnflagged, 260);
});

test('IDs outside the benchmark are listed and left out of every count; Lite is guessed from the IDs', () => {
  const lite = FLAGS.benchmarks['swe-bench-lite'];
  const ids = [...lite.tasks.slice(0, 40), 'nobody__nothing-1'];
  assert.equal(guessBenchmark(ids, FLAGS), 'swe-bench-lite');
  const r = rescore(ids, FLAGS);
  assert.equal(r.benchmark, 'swe-bench-lite');
  assert.equal(r.resolved, 40);
  assert.deepEqual(r.unknown, ['nobody__nothing-1']);
  assert.equal(r.unflaggedTotal, 216);
  const forced = rescore(ids, FLAGS, 'verified');
  assert.equal(forced.benchmark, 'swe-bench-verified');
  assert.equal(forced.resolved + forced.unknown.length, 41);
  assert.match(citation(r), /^SWE-bench Lite: /);
  assert.match(tableRow(r), /\/216\)/);
});

test('bad input says what is wrong and exits 2', async () => {
  assert.throws(() => parseResolved(''), RescoreInputError);
  assert.throws(() => parseResolved('hello world'), /no instance IDs/);
  assert.throws(() => parseResolved('{"foo": 1}'), /resolved/);
  assert.throws(() => parseResolved('[{"instance_id":"a__b-1"}]'), /no "resolved" field/);
  const d = tmp();
  fs.writeFileSync(path.join(d, 'x.json'), '{"foo": 1}');
  const r = await run(['rescore', path.join(d, 'x.json')]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /leaklens: JSON without a "resolved"/);
  const r2 = await run(['rescore', SONAR, '--benchmark', 'pro']);
  assert.equal(r2.code, 2);
  assert.match(r2.stderr, /unknown benchmark "pro"/);
  const r3 = await run(['rescore']);
  assert.equal(r3.code, 2);
});

// BEN-346: a status next to each ID is read (only resolved rows count) or refused; dropped words are counted; a worked-out
// benchmark that the IDs also fit is named.
test('status next to each ID: CSV column, PASSED/FAILED lines, harness enum; mixed lines refused; dropped words counted', () => {
  const OK = 'django__django-11099', BAD = 'astropy__astropy-12907';
  for (const text of [`instance_id,resolved\n${OK},True\n${BAD},False\n`, `instance_id\tmodel\tstatus\n${OK}\tm\tRESOLVED_FULL\n${BAD}\tm\tRESOLVED_NO\n`,
    `model,instance_id,resolved,cost\n"a, b",${OK},1,0.3\n"a, b",${BAD},0,0.2\n`, `${OK} PASSED\n${BAD} FAILED\n`, `${OK}: true\n${BAD}: false\n`]) {
    const p = parseResolved(text);
    assert.deepEqual(p.ids, [OK], text); assert.equal(p.notResolved, 1, text);
  }
  assert.throws(() => parseResolved(`${OK} PASSED\n${BAD}\n`), (e) => e instanceof RescoreInputError && /line 1 has a status.*line 2 \(astropy__astropy-12907\) has none/.test(e.message));
  assert.throws(() => parseResolved(`instance_id,resolved\n${OK},maybe\n`), (e) => e instanceof RescoreInputError && /"maybe" in the "resolved" column is not a status/.test(e.message));
  assert.throws(() => parseResolved(`${OK}, ${BAD} FAILED\n`), (e) => e instanceof RescoreInputError && /several IDs and the status "FAILED"/.test(e.message));
  const numbered = parseResolved(`1) ${OK}\n2) ${BAD}\n`);
  assert.deepEqual(numbered.ids, [OK, BAD], 'a numbered list is not a status');
  const plain = parseResolved(`instance_id\n${OK}\n${BAD}\nfoo bar\n`);
  assert.deepEqual([plain.ids.length, plain.ignored, plain.format], [2, 3, 'id list']);
  assert.deepEqual(inputNotes(plain), ['3 other words were ignored (instance_id, foo, bar).']);
});

test('a worked-out benchmark the IDs also fit is named (page and CLI); a full Lite run still resolves to Lite', async () => {
  const v = new Set(FLAGS.benchmarks['swe-bench-verified'].tasks), lite = FLAGS.benchmarks['swe-bench-lite'].tasks;
  const both = lite.filter((i) => v.has(i)).slice(0, 5);
  const r = rescore(both, FLAGS);
  assert.equal(r.benchmark, 'swe-bench-verified');
  assert.equal(guessNote(r, 'page'), 'Worked out as Verified; these IDs also fit Lite. Choose the benchmark above if that is wrong.');
  assert.equal(guessNote(rescore(both, FLAGS, 'verified'), 'page'), '', 'chosen: no note');
  const full = rescore(lite, FLAGS);
  assert.equal(full.benchmark, 'swe-bench-lite'); assert.equal(guessNote(full), '');
  const cli = await run(['rescore', '-'], both.join('\n'));
  assert.equal(cli.code, 0, cli.stderr);
  assert.match(cli.stdout, /Worked out as Verified; these IDs also fit Lite\. Add --benchmark lite if that is wrong\./);
  const csv = await run(['rescore', '-'], `instance_id,resolved\ndjango__django-11099,True\nastropy__astropy-12907,False\n`);
  assert.match(csv.stderr, /read 1 resolved ID \(CSV "resolved" column\)/); assert.match(csv.stderr, /1 ID was marked not resolved and not counted\./);
  assert.match(csv.stdout, /All 500 tasks\s+0\.2%/);
});

test('the same ID with two disagreeing statuses is refused and named (lines, CSV, JSON, JSONL); agreeing repeats count once; a predictions CSV is refused', () => {
  const A = 'django__django-11099', B = 'astropy__astropy-12907';
  const refuses = (text, re) => assert.throws(() => parseResolved(text), (e) => e instanceof RescoreInputError && re.test(e.message));
  refuses(`${A} PASSED\n${A} FAILED\n`, new RegExp(`${A} is marked resolved on line 1 and not resolved on line 2`));
  refuses(`instance_id,resolved\n${A},False\n${B},True\n${A},True\n`, new RegExp(`${A} is marked not resolved on line 2 and resolved on line 4`));
  refuses(JSON.stringify([{ instance_id: A, resolved: true }, { instance_id: A, resolved: false }]), /item 1 and not resolved on item 2/);
  refuses(`{"instance_id":"${A}","resolved":true}\n\n{"instance_id":"${A}","resolved":false}\n`, /line 1 and not resolved on line 3/);
  refuses(`${A} PASSED\n${A} FAILED\n${B} PASSED\n${B} FAILED\n`, /\(and 1 other ID: astropy__astropy-12907\)/);
  const same = parseResolved(`${A} PASSED\n${A} PASSED\n${B} FAILED\n${B} FAILED\n`);
  assert.deepEqual(same.ids, [A]); assert.equal(same.notResolved, 1);
  refuses(`instance_id,model_patch\n${A},"diff --git a/x b/x"\n`, /"model_patch" column and no status column: this looks like a predictions file/);
});
