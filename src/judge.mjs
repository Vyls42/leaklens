// The judged tier: Tier A/B from two differently worded checks (and, with --tiebreak, the m1.1 third check),
// sent to the user's own OpenAI-compatible endpoint. Every quote is checked word for word against the task text.
import { SCHEMA, SYSTEM_1, SYSTEM_2, SYSTEM_3, userPrompt } from './prompts.mjs';
import { verify, combine, decide } from './rules.mjs';

export class JudgeError extends Error {}

// Extracts the first JSON object from a model answer (some local servers wrap it in prose or code fences).
export function parseAnswer(content) {
  if (content && typeof content === 'object') return content;
  const s = String(content || '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new JudgeError('the model answer is not JSON');
}

export function makeClient({ baseUrl, model, apiKey, effort = false, timeoutMs = 120000, fetchImpl = fetch }) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let mode = 'json_schema'; // falls back to json_object, then to plain text, if the server rejects the format
  async function call(system, user, reasoning) {
    for (;;) {
      const sent = mode; // calls run concurrently: step down from the format this request used, not a later one
      const body = {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 1500,
      };
      if (sent === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'leak_verdict', schema: SCHEMA, strict: true } };
      else if (sent === 'json_object') body.response_format = { type: 'json_object' };
      if (effort) body.reasoning_effort = reasoning;
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = 'Bearer ' + apiKey;
      let res;
      try {
        res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new JudgeError(`cannot reach ${url}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
      }
      const text = await res.text();
      if (res.status === 400 && sent !== 'text' && /response_format|json_schema|json_object/i.test(text)) {
        const down = sent === 'json_schema' ? 'json_object' : 'text';
        if (mode === sent) mode = down;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new JudgeError(`${url} refused the key (HTTP ${res.status}); set LEAKLENS_API_KEY or OPENAI_API_KEY`);
      if (!res.ok) throw new JudgeError(`${url} answered HTTP ${res.status}: ${text.slice(0, 200)}`);
      let j;
      try { j = JSON.parse(text); } catch { throw new JudgeError(`${url} did not return JSON`); }
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      if (!msg) throw new JudgeError(`${url} returned no choices`);
      return parseAnswer(msg.parsed || msg.content);
    }
  }
  return { call, describe: () => ({ base_url: baseUrl, model }) };
}

const runOut = (r) => ({ tier: r.tier, rationale: r.rationale, dropped: r.dropped, quotes: r.quotes.map((q) => ({ source: q.source === 'hints' ? 'discussion' : 'issue', start: q.start, end: q.end, kind: q.kind, text: q.text })) });

// Judges one task. Returns the combined model reading plus every run, for the report.
export async function judgeTask(client, task, { tiebreak = false } = {}) {
  const user = userPrompt(task.issue, task.hints, task.patch);
  const [a1, a2] = await Promise.all([client.call(SYSTEM_1, user, 'low'), client.call(SYSTEM_2, user, 'medium')]);
  const r1 = verify(a1, task.issue, task.hints);
  const r2 = verify(a2, task.issue, task.hints);
  const c = combine(r1, r2);
  const anyRunFlag = r1.tier === 'A' || r2.tier === 'A' ? 'A' : r1.tier === 'B' || r2.tier === 'B' ? 'B' : null;
  const out = { modelTier: c.tier, agreement: c.agreement, anyRunFlag, runs: [r1, r2], shown: c.tier === 'none' ? [] : r1.quotes.length ? r1.quotes : r2.quotes, decision: null };
  if (tiebreak && c.agreement === 'split') {
    const r3 = verify(await client.call(SYSTEM_3, user, 'medium'), task.issue, task.hints);
    const d = decide(r1, r2, r3);
    out.runs.push(r3);
    out.decision = d;
    if (d.decided) {
      out.modelTier = d.tier;
      out.agreement = 'tiebreak';
      out.shown = r3.quotes.filter((_, i) => d.shared3.has(i));
    }
  }
  out.runsOut = out.runs.map(runOut);
  return out;
}
