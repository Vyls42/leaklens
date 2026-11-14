// The one source of the tier and state definitions. DEFINITIONS.md in this repository and the tier table on
// https://leaklens.grain64.com/methodology are both generated from this file.

export const METHODOLOGY_VERSION = 'm1.1';

// Evidence tiers, strongest first. `model: true` means the tier needs the judge (--judge); the others are deterministic.
export const TIERS = [
  {
    id: 'A',
    label: 'Tier A',
    meaning: 'The issue or discussion states the change that fixes the problem: replacement code, a diff, or a sentence naming the exact edit.',
    how: 'Model verdict, with every quote checked as a word-for-word substring of the text.',
    model: true,
  },
  {
    id: 'B',
    label: 'Tier B',
    meaning: 'The text names the exact file, function or line to change, without giving the change.',
    how: 'Model verdict with the same quote check. Shown separately from Tier A.',
    model: true,
  },
  {
    id: 'C',
    label: 'Tier C',
    meaning: 'Added lines of the gold patch appear in the issue or discussion.',
    how: 'Deterministic string match after whitespace normalisation. No model.',
    model: false,
  },
  {
    id: 'link',
    label: 'Links the fix PR',
    meaning: 'The issue text or the discussion links the pull request whose change is the gold patch.',
    how: 'Deterministic: a link to the instance’s own pull-request number, found by string match. Shown as its own signal; it does not change the tier.',
    model: false,
  },
  {
    id: 'none',
    label: 'No quoted evidence',
    meaning: 'Nothing in the text states or points to the fix.',
    how: 'A finding about the text only, not proof that the task is clean.',
    model: false,
  },
];

// How a task reads in a report. Exactly one state per task.
export const STATES = [
  { id: 'flag', meaning: 'Tier A, B or C: the text hands over the fix or its exact place. Tier A and B count only when both checks agree (or a third check settles them).' },
  { id: 'disputed', meaning: 'The checks differ and at least one found a quote. Not counted as a flag, never read as clear; the quote is shown.' },
  { id: 'link', meaning: 'No tier, but the issue or discussion links the fix pull request.' },
  { id: 'clear', meaning: 'Both checks found no quoted evidence and no rule matched. Not proof the task is clean.' },
  { id: 'rule_clear', meaning: 'Checked by the deterministic rules only (no --judge): no Tier C match and no fix-PR link. The text was not read by a model.' },
];

// Wording rule for every output: what the public text and history contain, never a claim about training.
export const WORDING = 'A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.';
