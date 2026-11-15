// The deterministic rules and the judge bookkeeping. No network, no model, no dependencies.
// Same rules as the Leaklens public tables (methodology m1.1); the hosted service imports them from this file.

// ---------- Tier C: gold-patch added lines found in the issue or discussion text ----------
export const MIN_MATCHED = 2; // at least two added lines match (a one-line patch quoted whole also counts)
export const MIN_FRACTION = 0.5; // and at least half of the patch's non-trivial added lines

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// An added line counts only when it looks like code: 15+ characters, some punctuation, not a comment or an import.
const isCode = (n) => n.length >= 15 && /[()[\]{}=._:,]/.test(n) && !/^(#|\/\/|"""|'''|\*|import |from \S+ import )/.test(n);

export function addedLines(patch) {
  const out = [];
  for (const l of patch.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) {
      const n = norm(l.slice(1));
      if (isCode(n)) out.push(n);
    }
  }
  return [...new Set(out)];
}

export function overlap(patch, problem, hints) {
  const lines = addedLines(patch);
  const hay = norm(problem + '\n' + hints);
  const matched = lines.filter((n) => hay.includes(n));
  return { patch_line_count: lines.length, matched_line_count: matched.length, matched };
}

export const isFlag = (o) =>
  (o.matched_line_count >= MIN_MATCHED || (o.patch_line_count === 1 && o.matched_line_count === 1)) &&
  o.matched_line_count / Math.max(1, o.patch_line_count) >= MIN_FRACTION;

// ---------- Links the fix PR: the issue or discussion links the pull request that is the gold patch ----------
// SWE-bench instance ids end in the pull-request number (owner__repo-1234).
export function prNumber(instanceId) {
  const m = /-(\d+)$/.exec(instanceId || '');
  return m ? parseInt(m[1], 10) : 0;
}

export function linkSignal(repo, pr, issue, hints) {
  if (!repo || !pr) return null;
  const esc = repo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`github\\.com/${esc}/pull/${pr}(?![0-9])`, 'i');
  for (const [source, text] of [['issue', issue], ['hints', hints]]) {
    const m = re.exec(text || '');
    if (m) {
      // report the whole link as written, scheme included when present
      const pre = /https?:\/\/$/i.exec(text.slice(Math.max(0, m.index - 8), m.index));
      const start = pre ? m.index - pre[0].length : m.index;
      return { source, start, end: m.index + m[0].length, text: text.slice(start, m.index + m[0].length) };
    }
  }
  return null;
}

// ---------- the verbatim-quote check ----------
// Collapse whitespace runs for matching and keep a map back to original offsets.
function normalise(s) {
  const out = [];
  const map = [];
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (!prevSpace) {
        out.push(' ');
        map.push(i);
        prevSpace = true;
      }
    } else {
      out.push(c);
      map.push(i);
      prevSpace = false;
    }
  }
  return { n: out.join(''), map };
}

export function locate(haystack, quote) {
  const q = quote.trim();
  if (q.length < 8) return null;
  const direct = haystack.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length };
  const h = normalise(haystack);
  const nq = normalise(q).n.trim();
  if (nq.length < 8) return null;
  const at = h.n.indexOf(nq);
  if (at < 0) return null;
  const start = h.map[at];
  const end = h.map[at + nq.length - 1] + 1;
  return { start, end };
}

// Keeps only quotes found word for word in the issue or hints; an A/B left without one reads as "none".
export function verify(raw, issue, hints) {
  const tier = raw && (raw.tier === 'A' || raw.tier === 'B') ? raw.tier : 'none';
  const rationale = String((raw && raw.rationale) || '').slice(0, 600);
  const quotes = [];
  let dropped = 0;
  for (const q of (raw && Array.isArray(raw.quotes) ? raw.quotes : []).slice(0, 3)) {
    const source = q && q.source === 'hints' ? 'hints' : 'issue';
    const text = String((q && q.text) || '');
    const kind = q && q.kind === 'points_to' ? 'points_to' : 'stated_fix';
    const hay = source === 'hints' ? hints : issue;
    let loc = locate(hay, text);
    let src = source;
    if (!loc) {
      // the model may mislabel the source; try the other text
      const other = source === 'hints' ? issue : hints;
      loc = locate(other, text);
      if (loc) src = source === 'hints' ? 'issue' : 'hints';
    }
    if (!loc) {
      dropped++;
      continue;
    }
    const exact = (src === 'hints' ? hints : issue).slice(loc.start, loc.end);
    quotes.push({ source: src, start: loc.start, end: loc.end, text: exact, kind });
  }
  if (tier !== 'none' && quotes.length === 0) {
    return { tier: 'none', rationale, quotes: [], dropped };
  }
  return { tier: tier, rationale, quotes: tier === 'none' ? [] : quotes, dropped };
}

const spansOverlap = (a, b) => a.source === b.source && a.start < b.end && b.start < a.end;

// Two runs agree only on the same tier and, for A or B, overlapping quoted text; otherwise the lower reading, marked split.
export function combine(r1, r2) {
  const s1 = new Set();
  const s2 = new Set();
  r1.quotes.forEach((a, i) =>
    r2.quotes.forEach((b, j) => {
      if (spansOverlap(a, b)) {
        s1.add(i);
        s2.add(j);
      }
    })
  );
  const order = ['none', 'B', 'A'];
  const lowerOf = (a, b) => (order.indexOf(a) <= order.indexOf(b) ? a : b);
  const stepDown = (t) => (t === 'A' ? 'B' : 'none');
  if (r1.tier === r2.tier) {
    if (r1.tier === 'none') return { tier: 'none', agreement: 'agreed', sharedIdx: [s1, s2] };
    if (s1.size > 0) return { tier: r1.tier, agreement: 'agreed', sharedIdx: [s1, s2] };
    return { tier: stepDown(r1.tier), agreement: 'split', sharedIdx: [s1, s2] };
  }
  return { tier: lowerOf(r1.tier, r2.tier), agreement: 'split', sharedIdx: [s1, s2] };
}

// m1.1: a task is settled only when the third check lands on the same tier as one of the first two and,
// for A or B, quotes overlapping text. Two of three saying "none" is not a clear.
export function decide(r1, r2, r3) {
  const none = { decided: false, tier: 'none', with: null, shared3: new Set(), sharedWith: new Set() };
  const tries = [];
  if (r3.tier === r1.tier) tries.push(1);
  if (r3.tier === r2.tier) tries.push(2);
  for (const w of tries) {
    const other = w === 1 ? r1 : r2;
    if (r3.tier === 'none') continue;
    const s3 = new Set();
    const sw = new Set();
    r3.quotes.forEach((a, i) => other.quotes.forEach((b, j) => { if (spansOverlap(a, b)) { s3.add(i); sw.add(j); } }));
    if (s3.size > 0) return { decided: true, tier: r3.tier, with: w, shared3: s3, sharedWith: sw };
  }
  return none;
}

// ---------- verdict sentences ----------
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

export function splitNoneSentence(hasQuote) {
  return hasQuote
    ? 'The two checks disagreed on this task: one run found the quoted text, the other found nothing. Not counted as a flag.'
    : 'The two checks disagreed on this task; no quoted evidence is shown for it.';
}

export function verdictSentence(tier, agreement, firstQuote, ov) {
  if (tier === 'A') return `The text states the fix: “${clip(oneLine(firstQuote || ''), 170)}”`;
  if (tier === 'C') return `${ov.matched} of ${ov.total} added patch lines appear in the issue or discussion.`;
  if (tier === 'B')
    return agreement === 'split'
      ? `The two checks disagreed (stated fix vs. points to it); the lower reading shown: “${clip(oneLine(firstQuote || ''), 150)}”`
      : `The text points to the exact place to change: “${clip(oneLine(firstQuote || ''), 170)}”`;
  if (agreement === 'split') return splitNoneSentence(!!firstQuote);
  return 'No quoted evidence found. This is not proof the task is clean; see the methodology.';
}

export function tiebreakVerdict(d, tier, firstQuote) {
  if (!d.decided) return 'Three checks did not settle on one reading, so this task stays disputed; the quoted text each found is on this page.';
  const q = clip(oneLine(firstQuote || ''), 160);
  return tier === 'A'
    ? `A third check settled an earlier disagreement. The text states the fix: “${q}”`
    : `A third check settled an earlier disagreement. The text points to the exact place to change: “${q}”`;
}

// ---------- final tier, state and verdict (shared by the CLI and the hosted audit) ----------
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

export function verdictOf(tier, state, j, ov, link) {
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
