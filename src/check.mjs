// One task in, one result row out. Deterministic tiers always; the fix commit when a clone is given; the judged tier on request.
import { overlap, isFlag, linkSignal, verdictSentence, tiebreakVerdict } from './rules.mjs';
import { METHODOLOGY_VERSION } from './definitions.mjs';
import { findClone, fixCommit } from './gitdate.mjs';
import { judgeTask } from './judge.mjs';

const SOURCE_WORD = { issue: 'The issue text', discussion: 'The discussion' };

// Same reading as the Leaklens task pages: tier A only when the checks agree (or a third settles it); C outranks B.
export function finalTier(ov, j) {
  if (!j) return ov ? 'C' : 'none';
  if (j.modelTier === 'A' && (j.agreement === 'agreed' || j.agreement === 'tiebreak')) return 'A';
  if (ov) return 'C';
  return j.modelTier === 'B' ? 'B' : 'none';
}

export function stateOf(tier, j, link) {
  if (tier === 'A' || tier === 'B' || tier === 'C') return 'flag';
  if (!j) return link ? 'link' : 'rule_clear';
  if (j.anyRunFlag && j.agreement !== 'tiebreak') return 'disputed';
  return link ? 'link' : 'clear';
}

function verdictOf(tier, state, j, ov, link) {
  let v;
  if (state === 'disputed') {
    v = j.runs.length >= 3
      ? `Disputed after three checks: they did not agree on one reading, and at least one found ${j.anyRunFlag === 'A' ? 'a stated fix' : 'a pointer to the fix'}. Not counted as a flag; the quotes are in the runs.`
      : `Disputed: one of the two checks found ${j.anyRunFlag === 'A' ? 'a stated fix' : 'a pointer to the fix'}, the other found nothing. Not counted as a flag; the quote is in the runs.`;
  } else if (state === 'rule_clear') {
    v = 'No rule matched: no added patch line appears in the text and the fix pull request is not linked. The text was not read by a model (add --judge for Tier A/B).';
  } else if (state === 'link') {
    v = '';
  } else if (j && j.agreement === 'tiebreak' && (tier === 'A' || tier === 'B')) {
    v = tiebreakVerdict(j.decision, tier, j.shown.length ? j.shown[0].text : null);
  } else {
    v = verdictSentence(tier, j ? j.agreement : 'n/a', j && j.shown.length ? j.shown[0].text : null, { matched: ov.matched_line_count, total: ov.patch_line_count });
  }
  if (link && (state === 'link' || state === 'disputed')) v = (v ? v + ' ' : '') + `${SOURCE_WORD[link.source]} links the pull request that is the fix.`;
  return v;
}

export async function checkTask(task, { reposDir = null, client = null, tiebreak = false } = {}) {
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
