# Leaklens check: swe-bench-verified-10.jsonl

Methodology m1.1 · 10 tasks · deterministic rules only, no network and no model (add `--judge` for Tier A/B)

**5 of 10 tasks (50%): gold-patch lines in the issue or discussion (Tier C). Tier A/B not read.**

Leaklens public table for these 10 tasks: 6 flagged (Tier A where both checks agreed, or Tier C), methodology m1.1, as of 2026-11-08: https://leaklens.grain64.com/benchmarks/swe-bench-verified

| Signal | Tasks |
|---|---|
| Tier C: gold-patch lines appear in the issue or discussion | 5 |
| Links the fix PR | 3 |
| Fix commit date | not checked (pass `--repos <dir>` with local clones) |

## Tasks to look at

| Task | Tier | State | Evidence |
|---|---|---|---|
| astropy__astropy-14539 | C | flag | 1 of 1 added patch lines appear in the issue or discussion. |
| astropy__astropy-14995 | C | flag | 1 of 1 added patch lines appear in the issue or discussion. |
| django__django-10097 | none | link | The issue text links the pull request that is the fix. |
| django__django-12273 | C | flag | 2 of 3 added patch lines appear in the issue or discussion. |
| django__django-13012 | C | flag | 2 of 2 added patch lines appear in the issue or discussion. |
| django__django-14539 | none | link | The discussion links the pull request that is the fix. |
| django__django-15525 | C | flag | 3 of 3 added patch lines appear in the issue or discussion. |

A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.

Tier and state definitions: DEFINITIONS.md, or https://leaklens.grain64.com/methodology. Per-task evidence (matched lines, quotes with offsets, every check) is in results.jsonl.
