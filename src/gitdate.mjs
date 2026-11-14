// The upstream fix commit and its date, found in a local clone. No network: git only reads the clone you point at.
// Same matching as the Leaklens public tables: candidate commits whose message names the PR, then commits touching the
// patched file after the task was opened; a candidate counts when >= 60% of the gold patch's added lines are in its diff.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_SIMILARITY = 0.6;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Where the clone of owner/name lives under --repos <dir>: the dir itself, or a child named
// owner_name.git, owner_name, name.git, name, or owner/name.
export function findClone(reposDir, repo) {
  const [owner, name] = repo.split('/');
  const isGit = (p) => fs.existsSync(path.join(p, 'HEAD')) || fs.existsSync(path.join(p, '.git'));
  const cands = [`${owner}_${name}.git`, `${owner}_${name}`, `${name}.git`, name, path.join(owner || '', name || '')].map((c) => path.join(reposDir, c));
  for (const c of cands) if (name && fs.existsSync(c) && isGit(c)) return c;
  if (isGit(reposDir)) {
    // a single clone: use it only when its origin is this repo (or it has no origin)
    try {
      const url = execFileSync('git', ['-C', reposDir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (!url || url.replace(/\.git$/, '').toLowerCase().endsWith(repo.toLowerCase())) return reposDir;
    } catch {
      return reposDir;
    }
  }
  return null;
}

const addedSet = (patch) => {
  const s = new Set();
  for (const l of patch.split('\n')) if (l.startsWith('+') && !l.startsWith('+++')) { const n = norm(l.slice(1)); if (n.length >= 4) s.add(n); }
  return s;
};
const filesOf = (patch) => [...patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);

export function fixCommit(clone, task) {
  const git = (args) =>
    execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 });
  const files = filesOf(task.patch);
  const gold = addedSet(task.patch);
  const similarity = (sha) => {
    let diff = '';
    try { diff = git(['diff', '--no-color', `${sha}^1`, sha, '--', ...files]); } catch { return 0; }
    const got = addedSet(diff);
    if (!gold.size) return 0;
    let hit = 0;
    for (const l of gold) if (got.has(l)) hit++;
    return hit / gold.size;
  };
  const cand = new Map();
  const add = (out, how) => {
    for (const l of out.split('\n').filter(Boolean)) {
      const [sha, date0, ...s] = l.split('\t');
      const date = new Date(date0).toISOString();
      if (!cand.has(sha)) cand.set(sha, { sha, date, subject: s.join('\t'), how });
    }
  };
  // An instance id that carries the upstream commit sha (SWE-Bench Pro style) gives the first candidate.
  const idSha = (task.instance_id.match(/-([0-9a-f]{40})(?:-|$)/) || [])[1];
  if (idSha) { try { add(git(['log', '-1', '--format=%H\t%cI\t%s', idSha]), 'id'); } catch {} }
  const pr = task.pr_number;
  if (pr > 0) {
    try { add(git(['log', '--format=%H\t%cI\t%s', '-E', `--grep=(#${pr}\\)|pull request #${pr}( |$)|[Cc]loses #${pr}\\b)`]), 'message'); } catch {}
  }
  let best = null;
  const eval1 = (c) => {
    const sim = similarity(c.sha);
    if (sim >= MIN_SIMILARITY && (!best || sim > best.sim || (sim === best.sim && c.date < best.date))) best = { ...c, sim };
  };
  for (const c of [...cand.values()].slice(0, 6)) eval1(c);
  if (!best && files.length && task.created_at) {
    try {
      const since = new Date(new Date(task.created_at).getTime() - 7 * 864e5).toISOString();
      const out = git(['log', '--format=%H\t%cI\t%s', '--reverse', `--since=${since}`, '--max-count=400', '--', files[0]]);
      cand.clear();
      add(out, 'path');
      let tried = 0;
      for (const c of cand.values()) { if (tried++ >= 40) break; eval1(c); if (best) break; }
    } catch {}
  }
  if (!best) return { located: false, sha: null, date: null, how: null, similarity: null, url: null };
  return {
    located: true,
    sha: best.sha,
    date: best.date,
    how: best.how,
    similarity: Math.round(best.sim * 100) / 100,
    url: `https://github.com/${task.repo}/commit/${best.sha}`,
  };
}
