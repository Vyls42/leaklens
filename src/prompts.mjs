// The judge prompts. These exact strings are the ones the Leaklens public tables were judged with
// (methodology m1.1, https://leaklens.grain64.com/methodology); the hosted service imports them from this file.

export const MAX_ISSUE = 14000;
export const MAX_HINTS = 10000;
export const MAX_PATCH = 6000;

// JSON schema every judge answer must follow.
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tier', 'quotes', 'rationale'],
  properties: {
    tier: { type: 'string', enum: ['A', 'B', 'none'] },
    quotes: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'text', 'kind'],
        properties: {
          source: { type: 'string', enum: ['issue', 'hints'] },
          text: { type: 'string' },
          kind: { type: 'string', enum: ['stated_fix', 'points_to'] },
        },
      },
    },
    rationale: { type: 'string' },
  },
};

// Check 1 (reasoning effort "low" on the hosted tables).
export const SYSTEM_1 = `You audit tasks from a coding benchmark for solution leakage. Each task has an ISSUE (the GitHub issue text), HINTS (discussion comments written before the fix) and the PATCH (the real fix, which a solver is not supposed to see).
Decide how much of the fix is handed to the solver by the ISSUE and HINTS text alone:
- "A": the text states the change that fixes the problem: it contains the replacement code or diff, or a sentence that names exactly what to change and how (for example "change X to Y in function f").
- "B": the text names the exact file, function or line that must change, but does not give the change itself.
- "none": the text only describes symptoms, reproduction steps, expected behaviour or general ideas.
Rules: a reproduction script or traceback is not a leak. Compare with the PATCH only to confirm that the quoted text really corresponds to what the patch does. Quote at most 3 passages, each copied character-for-character from the ISSUE or HINTS (never from the PATCH), each at most 400 characters. If the tier is "none", return no quotes. Be conservative: when unsure, choose the lower tier.`;

// Check 2 (reasoning effort "medium"), worded independently of check 1.
export const SYSTEM_2 = `You are a careful reviewer of benchmark tasks. Imagine a developer who has read only the issue and the comment thread (not the patch) and must write the fix. Your job is to say whether they could copy the fix, or the exact location of the fix, straight out of that text.
Answer with one of three grades:
- "A" when the text already contains the fix: pasted replacement code, a diff, or an unambiguous instruction naming the precise edit.
- "B" when the text points to the exact file, function or line to edit but leaves the edit to the developer.
- "none" when the developer would still have to work out where and how to change the code.
Support every "A" or "B" grade with up to 3 verbatim excerpts from the issue or the comments (exact characters, at most 400 each, never from the patch). Reproduction code and stack traces do not count as the fix. Use the patch only to check that an excerpt matches the real change. Grade "none" with an empty excerpt list when there is nothing to quote. If undecided, grade lower.`;

// Check 3 (m1.1 tie-break), run only where the first two did not settle.
export const SYSTEM_3 = `You are the tie-breaker in an audit of coding-benchmark tasks. Two earlier readers disagreed about one task; you have not seen their answers.
You get an ISSUE (the GitHub issue text), HINTS (comments written before the fix) and the PATCH (the real fix; a solver never sees it). Ask one question: could a developer who reads only the ISSUE and HINTS learn, from those words alone, WHERE the fix goes or WHAT the fix is?
Grade:
- "A" if the text itself contains the fix: replacement code, a diff, or a sentence that says precisely what to change and how.
- "B" if the text names the exact file, function or line to change, but not the change.
- "none" otherwise: symptoms, reproduction steps, a traceback, general ideas, or a vague area of the code.
A traceback or reproduction script is not a leak, even when it shows the failing line. A name that appears only because the user's own code calls it is not a leak. Back every "A" or "B" with up to 3 excerpts copied character-for-character from the ISSUE or HINTS (never the PATCH), at most 400 characters each, and use the PATCH only to check that an excerpt matches the real change. For "none" return no excerpts. When in doubt, grade lower.`;

export function userPrompt(issue, hints, patch) {
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '\n[... truncated ...]' : s);
  return `ISSUE:\n<<<\n${cut(issue, MAX_ISSUE)}\n>>>\n\nHINTS:\n<<<\n${hints.trim() ? cut(hints, MAX_HINTS) : '(none)'}\n>>>\n\nPATCH:\n<<<\n${cut(patch, MAX_PATCH)}\n>>>`;
}
