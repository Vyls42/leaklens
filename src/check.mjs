// One task in, one result row out. Deterministic tiers always; the fix commit when a clone is given; the judged tier on request.
import { overlap, isFlag, linkSignal, finalTier, stateOf, verdictOf } from './rules.mjs';
export { finalTier, stateOf, verdictOf };
import { METHODOLOGY_VERSION, procedureOf } from './definitions.mjs';
import { findClone, fixCommit } from './gitdate.mjs';
import { judgeTask } from './judge.mjs';

export async function checkTask(task, { reposDir = null, client = null, tiebreak = false, effort = true } = {}) {
  const ov = overlap(task.patch, task.issue, task.hints);
  const ovFlag = isFlag(ov);
  const l = linkSignal(task.repo, task.pr_number, task.issue, task.hints);
  const link = l ? { source: l.source === 'hints' ? 'discussion' : 'issue', start: l.start, end: l.end, text: l.text } : null;
  let fix = null;
  if (reposDir) {
    const clone = findClone(reposDir, task.repo);
    fix = clone ? fixCommit(clone, task) : { located: false, sha: null, date: null, how: null, similarity: null, url: null, note: `no clone of ${task.repo} under ${reposDir}` };
  }
  // As on the hosted tables, the third check runs only on splits that Tier C does not already settle.
  const j = client ? await judgeTask(client, task, { tiebreak: tiebreak && !ovFlag }) : null;
  const tier = finalTier(ovFlag, j);
  const state = stateOf(tier, j, link);
  return {
    instance_id: task.instance_id,
    repo: task.repo,
    pr_number: task.pr_number,
    tier,
    state,
    agreement: !j || tier === 'C' ? 'n/a' : j.agreement,
    verdict: verdictOf(tier, state, j, ov, link),
    tier_c: { flag: ovFlag, matched_line_count: ov.matched_line_count, patch_line_count: ov.patch_line_count, matched_lines: ov.matched },
    fix_pr_link: link,
    fix_commit: fix,
    judge: j ? { model_tier: j.modelTier, any_check_flagged: j.anyRunFlag, runs: j.runsOut } : null,
    methodology_version: METHODOLOGY_VERSION,
    procedure: procedureOf({ judged: !!client, tiebreak, effort }),
    ...(task.reversed ? { patch_reversed: true } : {}),
  };
}

// Runs tasks with bounded concurrency, keeping input order in the output. A failing task (judge or git error)
// stops new work; the tasks already finished are returned with the error so the caller can keep them.
export async function checkAll(tasks, opts = {}, onDone = () => {}) {
  const out = new Array(tasks.length);
  let next = 0;
  let error = null;
  const model = opts.client && opts.client.describe ? opts.client.describe().model : null;
  const conc = Math.max(1, opts.client ? opts.concurrency || 4 : 1);
  async function worker() {
    while (next < tasks.length && !error) {
      const i = next++;
      const reuse = opts.reuse && opts.reuse.get(tasks[i].instance_id);
      try {
        out[i] = reuse || (await checkTask(tasks[i], opts));
      } catch (e) {
        if (!error) error = e;
        return;
      }
      if (out[i].judge && model) out[i].judge.model = model;
      onDone(i, out[i], !!reuse);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return { rows: out.filter(Boolean), error };
}
