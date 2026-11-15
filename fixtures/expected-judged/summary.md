# Leaklens check: swe-bench-verified-10.jsonl

Methodology m1.1 · 10 tasks · judged by `recorded` with the published m1.1 procedure: two checks (reasoning effort low, then medium) and a third on splits, as on the Leaklens tables

**7 of 10 tasks flagged (70%): Tier A or B read by `recorded`, or Tier C by rule.**

Leaklens public table for these 10 tasks: 6 flagged (Tier A where both checks agreed, or Tier C), methodology m1.1, as of 2026-11-08: https://leaklens.grain64.com/benchmarks/swe-bench-verified

| Signal | Tasks |
|---|---|
| Tier A: the text states the fix | 2 |
| Tier B: the text points to the exact place | 1 |
| Tier C: gold-patch lines appear in the issue or discussion | 4 |
| Links the fix PR | 3 |
| Disputed (checks differ, one found a quote) | 1 |
| Clear (no quoted evidence) | 1 |
| Fix commit date | not checked (pass `--repos <dir>` with local clones) |

## Tasks to look at

| Task | Tier | State | Evidence |
|---|---|---|---|
| astropy__astropy-13236 | A | flag | The text states the fix: “Thinking more, maybe since the NdarrayMixin is/was somewhat crippled (I/O and the repr within table), and any functionality is compatible with Column (both ndarray subcl…” |
| astropy__astropy-14096 | B | flag | The text points to the exact place to change: “Would it possible modify the `__getattr__` method in `SkyCoord` to raise the original `AttributeError`?” |
| astropy__astropy-14539 | C | flag | 1 of 1 added patch lines appear in the issue or discussion. |
| astropy__astropy-14995 | A | flag | The text states the fix: “So it looks like somebody accidentally turned the lines ``` elif operand.mask is None: return deepcopy(self.mask) ``` into ``` elif operand is None: return deepcopy(self…” |
| django__django-10097 | none | disputed | Disputed after three checks: they did not agree on one reading, and at least one found a pointer to the fix. Not counted as a flag; the quotes are in the runs. The issue text links the pull request that is the fix. |
| django__django-12273 | C | flag | 2 of 3 added patch lines appear in the issue or discussion. |
| django__django-13012 | C | flag | 2 of 2 added patch lines appear in the issue or discussion. |
| django__django-14539 | none | link | The discussion links the pull request that is the fix. |
| django__django-15525 | C | flag | 3 of 3 added patch lines appear in the issue or discussion. |

A flag means the task text hands over the fix. The fix commit date, when shown, is context and never makes a flag. A flag never says a model was trained on a task or memorised it.

Tier and state definitions: DEFINITIONS.md, or https://leaklens.grain64.com/methodology. Per-task evidence (matched lines, quotes with offsets, every check) is in results.jsonl.
