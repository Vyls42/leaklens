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

// BEN-620: a reply with no verdict (not an object, no tier in A/B/none, no rationale) is a failed read, never "none".
// Returns the reason, or null when the reply carries a verdict.
export const NO_VERDICT = 'no verdict';
export function noVerdict(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${NO_VERDICT}: the reply held no JSON object`;
  if (raw.tier !== 'A' && raw.tier !== 'B' && raw.tier !== 'none') return `${NO_VERDICT}: the reply's tier is missing or not A, B or none`;
  if (typeof raw.rationale !== 'string' || !raw.rationale.trim()) return `${NO_VERDICT}: the reply has no rationale`;
  return null;
}
export const isNoVerdict = (msg) => String(msg || '').startsWith(NO_VERDICT);

// Keeps only quotes found word for word in the issue or hints; an A/B left without one reads as "none".
// A reply with no verdict comes back with `error` set (BEN-620): callers retry once, then count it as an error.
export function verify(raw, issue, hints) {
  const missing = noVerdict(raw);
  if (missing) return { tier: 'none', rationale: '', quotes: [], dropped: 0, error: missing };
  const tier = raw.tier === 'A' || raw.tier === 'B' ? raw.tier : 'none';
  const rationale = String((raw && raw.rationale) || '').slice(0, 600);
  const quotes = [];
  let dropped = 0;
  for (const q of (raw && Array.isArray(raw.quotes) ? raw.quotes : []).slice(0, 3)) {
    const source = q && q.source === 'hints' ? 'hints' : 'issue';
    let text = String((q && q.text) || '');
    // BEN-537: a code quote sometimes comes back with its newlines still escaped ("\\n" as two characters); unescape before matching
    if (/\\[nt"]/.test(text) && !/\n/.test(text) && !locate(source === 'hints' ? hints : issue, text) && !locate(source === 'hints' ? issue : hints, text)) {
      text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
    }
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

// ---------- what a quote shows and how it is labelled (BEN-537, M9 pass 2 defect 1) ----------
// A lead-in that ends in a colon right before a fenced code block ("I was able to fix this by patching ...:" then ```...```)
// is shown with that block: the block is what the lead-in introduces, often the fix itself. Applied after the runs are
// compared (combine/decide see the spans the model quoted), so it never changes a tier.
const FENCED_AFTER = /^[ \t]*\r?\n(?:[ \t]*\r?\n)?[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*(?=\r?\n|$)/;
const MAX_WITH_BLOCK = 2000;
const FIX_LEAD = /\b(fix|fixed|fixes|fixing|patch|patched|patching|solution|solved|solves|workaround|changing|changed|change it|replac(e|ed|ing))\b/i;
export function withBlock(q, issue, hints) {
  if (!q || !/:\s*$/.test(q.text || '')) return q;
  const hay = q.source === 'hints' ? hints : issue;
  if (typeof hay !== 'string' || hay.slice(q.start, q.end) !== q.text) return q;
  const m = FENCED_AFTER.exec(hay.slice(q.end));
  if (!m || q.end + m[0].length - q.start > MAX_WITH_BLOCK) return q;
  const end = q.end + m[0].length;
  return { ...q, end, text: hay.slice(q.start, end), block: true };
}

// A quote's label comes from its own run's reading: a run that read B (points to the fix) shows no "States the fix" quote, and
// in a run that read A a lead-in that says it fixes/patches, shown with its code block, states the fix. `runTiers[i]` is the
// tier of run i+1 (unknown runs leave the stored kind). Mutates nothing; returns new quote objects.
export function labelQuotes(quotes, runTiers, issue, hints) {
  return (quotes || []).map((q) => {
    let out = issue != null || hints != null ? withBlock(q, issue, hints) : q;
    const tier = runTiers ? runTiers[(out.run || 1) - 1] : null;
    if (tier === 'B' && out.kind === 'stated_fix') out = { ...out, kind: 'points_to' };
    else if (tier === 'A' && out.block && out.kind === 'points_to' && FIX_LEAD.test(q.text)) out = { ...out, kind: 'stated_fix' };
    return out;
  });
}

// What a disputed row says its checks found, from the quotes it shows: "a stated fix" only when a shown quote states it.
export function disputedFound(anyRunFlag, quotes) {
  if (anyRunFlag !== 'A' || !quotes || !quotes.length) return anyRunFlag;
  return quotes.some((q) => q.kind === 'stated_fix') ? 'A' : 'B';
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

// BEN-635 (QA on BEN-632, pandas-dev__pandas-49486): a long stated_fix quote can open on a pointer ("the right starting point
// is here: <url>") and state the change only further down ("I only changed from `len(pat) > 1` to `len(pat) > 0`"). Clipping
// its head then quotes the pointer as the fix. When no sentence the clipped head shows states a change and a later sentence
// does, a Tier A verdict quotes that sentence, with "…" before it. Short quotes, and heads that state the change, are unchanged.
const FIX_WORDS = [
  [/\bchang(?:e|ed|es|ing)\b.{0,80}?\bfrom\b.{1,80}?\bto\b/i, 4],
  [/\breplac(?:e|ed|es|ing)\b.{1,80}?\bwith\b/i, 3],
  [/\b(?:should|must|needs? to) (?:be|use|call|return|pass|check)\b/i, 3],
  [/\binstead\b/i, 2],
  [/\b(?:the )?fix (?:is|would be)\b/i, 3],
  [/\b(?:changed?|use|set|add|remove|swap)\b/i, 1],
  [/`[^`]+`/, 1],
];
const POINTER_WORDS = /https?:\/\/|\bstarting point\b|\b(?:take a )?look (?:at|into)\b|\bcontributing guide\b/i;
export function fixScore(sentence) {
  let n = 0;
  for (const [re, w] of FIX_WORDS) if (re.test(sentence)) n += w;
  return POINTER_WORDS.test(sentence) ? n - 3 : n;
}
// the sentences of a one-line quote with their start; a fenced code block is a piece of its own, so prose after it starts one
export function sentencesOf(s) {
  const out = [];
  const re = /```[\s\S]*?(?:```|$)/g;
  let last = 0;
  const prose = (from, to) => {
    const part = s.slice(from, to);
    const sp = /(?<=[.!?])\s+(?=[A-Z0-9@`("'])/g;
    let i = 0, m;
    const push = (a, b) => { const raw = part.slice(a, b); const t = raw.trim(); if (t.length >= 8) out.push({ text: t, start: from + a + raw.indexOf(t) }); };
    while ((m = sp.exec(part))) { push(i, m.index); i = m.index + m[0].length; }
    push(i, part.length);
  };
  let m;
  while ((m = re.exec(s))) { prose(last, m.index); last = m.index + m[0].length; }
  prose(last, s.length);
  return out;
}
export function fixClip(s, n) {
  if (s.length <= n) return s;
  const shown = n - 1;
  const parts = sentencesOf(s);
  const headBest = Math.max(0, ...parts.filter((p) => p.start < shown).map((p) => fixScore(p.text.slice(0, shown - p.start))));
  let best = null;
  for (const p of parts) { const sc = fixScore(p.text); if (sc >= 3 && (!best || sc > best.sc)) best = { ...p, sc }; }
  if (!best || headBest >= 3 || best.start + best.text.length <= shown) return clip(s, n);
  return '…' + clip(best.text, n - 1);
}

export function splitNoneSentence(hasQuote) {
  return hasQuote
    ? 'The two checks disagreed on this task: one run found the quoted text, the other found nothing. Not counted as a flag.'
    : 'The two checks disagreed on this task; no quoted evidence is shown for it.';
}

// BEN-624: a two-check disputed task whose other check got no reply from the model (run json noReply, or an empty rationale)
// must not read "the other found nothing". Shared by the public table (shape), the BEN-621 repair and audit rows.
export function noReplySentence(anyRunFlag, where) {
  const found = anyRunFlag === 'A' ? 'a stated fix' : 'a pointer to the fix';
  return `Disputed: one of the two checks found ${found}; the model gave no answer for the other, so that check is not counted as finding nothing. Not counted as a flag until the task is read again${where ? '; the quote is ' + where : ''}.`;
}

// BEN-624: two checks that both found something (B and B) but quoted text that does not overlap step down to "none" and read
// as disputed (django__django-12325); neither found nothing.
export function bothFoundSentence(tier, where) {
  const found = tier === 'A' ? 'a stated fix' : 'a pointer to the fix';
  return `Disputed: both checks found ${found}, but they quoted different text, so they do not agree on one reading. Not counted as a flag${where ? '; the quotes are ' + where : ''}.`;
}

// Critic note on BEN-623: three checks where the model gave no answer for one and the other two both found something (A / no reply
// / A, astropy__astropy-13398). Two that answered on the same tier with overlapping text would have settled the task, so the text
// they quoted differs; neither found nothing and the unanswered one did not disagree.
export function twoNoReplySentence(tier, where) {
  const found = tier === 'A' ? 'a stated fix' : 'a pointer to the fix';
  return `Disputed after three checks: the two that answered both found ${found}, but they quoted different text, so they do not agree on one reading. The model gave no answer for the other check, so it is not counted as finding nothing. Not counted as a flag${where ? '; the quotes are ' + where : ''}.`;
}
const isFound = (x) => x === 'A' || x === 'B';
// [the two answered tiers] when exactly one of three runs is unanswered and the other two both found something, else null
function twoAnsweredFound(t) {
  if (!t[2] || t.filter((x) => x === 'noreply').length !== 1) return null;
  const a = t.filter((x) => x !== 'noreply');
  return a.length === 2 && a.every(isFound) ? a : null;
}

// BEN-624: the one choice of disputed sentence. tiers: each stored run's tier, 'noreply' for a run the model did not answer, null
// for a run not made. Three checks: the three-check sentence; two with one unanswered: no reply; two that both found something:
// both found; otherwise one found something and the other found nothing.
export function disputedVerdict(anyRunFlag, tiers, where) {
  const t = (tiers || []).slice(0, 3);
  const two = twoAnsweredFound(t);
  if (two) return twoNoReplySentence(two[0] === two[1] && anyRunFlag === 'A' ? two[0] : 'B', where);
  if (t[2]) return disputedSentence(anyRunFlag, 3, where);
  if (t[0] === 'noreply' || t[1] === 'noreply') return noReplySentence(anyRunFlag, where);
  const found = (x) => x === 'A' || x === 'B';
  if (found(t[0]) && found(t[1])) return bothFoundSentence(t[0] === t[1] ? t[0] : 'B', where);
  return disputedSentence(anyRunFlag, 2, where);
}
// which of disputedVerdict's sentences applies, for badges and page titles: 'two_no_reply' | 'three' | 'no_reply' | 'both' | 'one'
export function disputedReading(tiers) {
  const t = (tiers || []).slice(0, 3);
  if (twoAnsweredFound(t)) return 'two_no_reply';
  if (t[2]) return 'three';
  if (t[0] === 'noreply' || t[1] === 'noreply') return 'no_reply';
  const found = (x) => x === 'A' || x === 'B';
  return found(t[0]) && found(t[1]) ? 'both' : 'one';
}
// a stored run json (string or object) as disputedVerdict reads it
export function runTier(r) {
  if (!r) return null;
  const x = typeof r === 'string' ? JSON.parse(r) : r;
  if (x.noReply === true || (typeof x.rationale === 'string' && !x.rationale.trim())) return 'noreply';
  return x.tier || null;
}

// The words a person reads for a quote's kind (stored as stated_fix | points_to). site-src/js/app.js L.KIND holds the same words.
export const KIND_LABEL = { stated_fix: 'States the fix', points_to: 'Points to the file or function', pointer: 'Points to the file or function' };

// M9 pass 1 item 2: the one sentence for a disputed task (one check found something, the other nothing), shared by the CLI,
// the public table, every audit row (reused rows included, decided at read time) and the sample. `where` says where the quote is.
export function disputedSentence(anyRunFlag, nChecks, where) {
  const found = anyRunFlag === 'A' ? 'a stated fix' : 'a pointer to the fix';
  return nChecks >= 3
    ? `Disputed after three checks: they did not agree on one reading, and at least one found ${found}. Not counted as a flag${where ? '; the quotes are ' + where : ''}.`
    : `Disputed: one of the two checks found ${found}, the other found nothing. Not counted as a flag${where ? '; the quote is ' + where : ''}.`;
}

// G8 pass 1 item 2: a Tier A verdict quotes a sentence the checks read as stating the fix (kind stated_fix), never the
// lead-in before it. Other tiers keep the first quote shown. Shared by the CLI, the hosted audit and the public table.
// BEN-492: after a tiebreak `shown` is only run 3's quotes that overlap an earlier run; when none of those states the fix,
// `pool` (tiebreakPool: run 3's own quotes, then the agreeing run's quotes that overlap them) supplies the stated_fix quote.
export function verdictQuote(tier, shown, pool) {
  if (!shown || !shown.length) return null;
  if (tier === 'A') {
    const s = shown.find((q) => q.kind === 'stated_fix') || (pool || []).find((q) => q.kind === 'stated_fix');
    if (s) return s.text;
  }
  return shown[0].text;
}

// BEN-492: the quotes a tiebreak verdict may quote, in order: every quote of run 3 (django__django-11179), then the quotes of
// the run it agreed with that overlap run 3's (django__django-16256: run 3 quoted only a path inside run 1's stated_fix sentence).
export function tiebreakPool(d, runs) {
  const r3 = (runs && runs[2] && runs[2].quotes) || [];
  const w = d && d.decided && d.with ? runs[d.with - 1] : null;
  const agreed = w ? w.quotes.filter((q, j) => (d.sharedWith && d.sharedWith.has ? d.sharedWith.has(j) : false) || r3.some((a) => spansOverlap(a, q))) : [];
  return [...r3, ...agreed];
}

export function verdictSentence(tier, agreement, firstQuote, ov) {
  if (tier === 'A') return `The text states the fix: “${fixClip(oneLine(firstQuote || ''), 170)}”`;
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
  const q = (tier === 'A' ? fixClip : clip)(oneLine(firstQuote || ''), 160);
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
    v = disputedVerdict(disputedFound(j.anyRunFlag, j.runs.flatMap((x) => x.quotes)), j.runs.map((x) => x.tier), 'in the runs');
  } else if (state === 'rule_clear') {
    v = 'No rule matched: no added patch line appears in the text and the fix pull request is not linked. The text was not read by a model (add --judge for Tier A/B).';
  } else if (state === 'link') {
    v = '';
  } else if (j && j.agreement === 'tiebreak' && (tier === 'A' || tier === 'B')) {
    v = tiebreakVerdict(j.decision, tier, verdictQuote(tier, j.shown, tiebreakPool(j.decision, j.runs)));
  } else {
    v = verdictSentence(tier, j ? j.agreement : 'n/a', j ? verdictQuote(tier, j.shown) : null, { matched: ov.matched_line_count, total: ov.patch_line_count });
  }
  if (link && (state === 'link' || state === 'disputed')) v = (v ? v + ' ' : '') + `${SOURCE_WORD[link.source]} links the pull request that is the fix.`;
  return v;
}
