# Tier and state definitions (methodology m1.1)

Generated from `src/definitions.mjs` by `node scripts/gen-definitions.mjs`. The tier table on https://leaklens.grain64.com/methodology is built from the same file.

## Tiers

| Tier | Meaning | How it is produced | Needs `--judge` |
|---|---|---|---|
| Tier A | The issue or discussion states the change that fixes the problem: replacement code, a diff, or a sentence naming the exact edit. | Model verdict, with every quote checked as a word-for-word substring of the text. | yes |
| Tier B | The text names the exact file, function or line to change, without giving the change. | Model verdict with the same quote check. Shown separately from Tier A. | yes |
| Tier C | Added lines of the gold patch appear in the issue or discussion. | Deterministic string match after whitespace normalisation. No model. | no |
| Links the fix PR | The issue text or the discussion links the pull request whose change is the gold patch. | Deterministic: a link to the instance’s own pull-request number, found by string match. Shown as its own signal; it does not change the tier. | no |
| No quoted evidence | Nothing in the text states or points to the fix. | A finding about the text only, not proof that the task is clean. | no |

Each task is counted under one tier, in the order A, then C, then B. A task whose text repeats added lines of the gold patch (the Tier C rule) and also states the fix is counted as Tier A, so a table’s Tier C count is the tasks that are Tier C only. A run without `--judge` reads no Tier A, so it reports every task the rule matches as Tier C.

## States

Each task in `results.jsonl` has exactly one `state`.

| State | Meaning |
|---|---|
| `flag` | Tier A, B or C: the text hands over the fix or its exact place. Tier A and B count only when both checks agree (or a third check settles them). |
| `disputed` | The checks differ and at least one found a quote. Not counted as a flag, never read as clear; the quote is shown. |
| `link` | No tier, but the issue or discussion links the fix pull request. |
| `clear` | Both checks found no quoted evidence and no rule matched. Not proof the task is clean. |
| `rule_clear` | Checked by the deterministic rules only (no --judge): no Tier C match and no fix-PR link. The text was not read by a model. |

## Wording

A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.
