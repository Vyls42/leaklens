# Leaklens

Leaklens checks a coding benchmark for tasks whose own text hands over the fix: the issue or its comments state the change, or lines of the gold patch reappear in the text. It writes one row per task, with the sentence quoted, the tier and, if you point it at a local clone, the date of the upstream fix commit. It runs on your machine. The patch-overlap tier needs no network and no model; the quoted-sentence tier uses your own API key or a local endpoint. "Flagged" means the task text hands over the fix. It says nothing about what any model did.

## Quickstart

Clone this repository and run these from its folder. Node 18.17 or later; there is nothing to install (no dependencies).

```sh
node bin/leaklens.mjs check fixtures/swe-bench-verified-10.jsonl --out out    # 10 SWE-bench Verified tasks: no network, no model
diff -r out fixtures/expected && echo "same as fixtures/expected"            # byte-for-byte the checked-in result
node bin/leaklens.mjs check tasks.jsonl --out my-out                          # your benchmark file (SWE-bench JSONL or a JSON array)
node bin/leaklens.mjs check tasks.jsonl --out my-out --repos ~/src            # adds the upstream fix commit and its date from your clones
LEAKLENS_API_KEY="$YOUR_KEY" node bin/leaklens.mjs check tasks.jsonl --out my-out --judge --model "$MODEL"   # Tier A/B on your key
node bin/leaklens.mjs check tasks.jsonl --out my-out --judge --base-url http://localhost:11434/v1 --model "$MODEL"   # or a local model
```

The first line prints this (also written to `out/summary.md`; per-task evidence is in `out/results.jsonl`):

```markdown
# Leaklens check: swe-bench-verified-10.jsonl

Methodology m1.1 · 10 tasks · deterministic rules only, no network and no model (add `--judge` for Tier A/B)

**5 of 10 tasks flagged (50%).**

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
```

`npm install -g .` gives you a `leaklens` command instead of `node bin/leaklens.mjs`. `node bin/leaklens.mjs --help` lists every option.

## Your score, on the unflagged tasks

`rescore` takes your SWE-bench per-instance results and prints your score on all tasks and on the tasks whose text does not hand over the fix. It also lists the flagged tasks your model solved, a markdown table row and a citation line. It runs locally, with no network and no model. The flags are the Leaklens headline flags for SWE-bench Verified and Lite (`data/headline-flags.json`, the same flags as the Leaklens dataset and https://leaklens.grain64.com/rescore).

```sh
node bin/leaklens.mjs rescore fixtures/rescore/20251205_sonar-foundation-agent_claude-opus-4-5.json   # a public leaderboard entry
node bin/leaklens.mjs rescore results.json --label "my-agent"       # results.json ("resolved"), sb-cli report ("resolved_ids"), report.json, JSONL or an ID list
node bin/leaklens.mjs rescore lite-ids.txt --benchmark lite --json  # Lite; numbers as JSON
```

The first line prints (flagged task list shortened):

```text
SWE-bench Verified (Leaklens headline flags, methodology m1.1, as of 2026-11-08)

  All 500 tasks                 79.2%  (396 resolved)
  351 unflagged tasks           74.1%  (260 resolved)   change −5.1 points
  149 flagged tasks             91.3%  (136 resolved)
```

IDs that are not in the benchmark are listed and left out of every count. A fix commit dated before a cutoff shows that exposure was possible, not that a model trained on it.

## What a flag is and is not

- **Tier A**: the issue or discussion states the change that fixes the problem (replacement code, a diff, or a sentence naming the exact edit).
- **Tier B**: the text names the exact file, function or line to change, without giving the change. Shown apart from Tier A.
- **Tier C**: added lines of the gold patch appear in the issue or discussion. A deterministic string match; no model.
- **Links the fix PR**: the text links the pull request whose change is the gold patch. Its own signal; it does not change the tier.
- **Fix commit date** (`--repos`): when the upstream fix was committed. Shown, never scored.

Tier A and B come from two differently worded model checks (`--judge`). Every quote is checked word for word against the task text, and a tier counts only when both checks agree; with `--tiebreak` a third check settles splits. Tasks where the checks differ are marked `disputed`, never `clear`. A flag is a finding about the text and history. It never says a model was trained on a task or memorised it.

[DEFINITIONS.md](DEFINITIONS.md) has every tier and state. It is generated from `src/definitions.mjs`, the same file the tier table on https://leaklens.grain64.com/methodology is built from; the judge prompts (`src/prompts.mjs`) and rules (`src/rules.mjs`) are the ones the hosted tables run.

## How far to trust it

From https://leaklens.grain64.com/validation, SWE-bench Verified, as of methodology m1.1, 8 Nov 2026. Each sampled task was labelled once by a language model, reading the quoted text beside the gold patch, with no second labeller, so the figures measure agreement with that reading:

- Tier A: 39 of 39 sampled flags held up (95% interval 91 to 100%).
- Tier C: 17 of 18 held up (95% interval 74 to 99%).
- Unflagged is not clean: 4 of 47 unflagged tasks read were found to leak (9%, 95% interval 3 to 20%).

## Input and output

Input: one task per line (or a JSON array) with `instance_id`, `problem_statement` and `patch`; `repo`, `hints_text` and `created_at` are used when present (`repo` defaults from the SWE-bench id, `owner__name-1234`). Bad rows are rejected with their line numbers and nothing is checked.

Output, in `--out` (default `leaklens-out`): `results.jsonl`, one row per task in input order (tier, state, verdict, matched patch lines, fix-PR link with offsets, fix commit, every judge check with its quotes and offsets), and `summary.md`. No timestamps or paths, so the same input gives the same bytes.

`--judge` makes two model calls per task (a third on splits with `--tiebreak`; never on Tier C tasks), four tasks at a time (`--concurrency`). The key is read from `LEAKLENS_API_KEY` or `OPENAI_API_KEY` and only sent to the endpoint you choose; a local server needs none. If a call fails, finished tasks are kept in `results.jsonl` and the next run resumes from them.

## Tests

`npm test` runs the CLI end to end: the fixture byte for byte, `--judge` against a local stub serving the answers the hosted tables recorded for the same 10 tasks (`fixtures/judge-recorded.json`), resume after a failure, input errors, and a fix-commit lookup in a throwaway git repository. No test calls a model or the network.

`fixtures/stored-verdicts.csv` is the 10 fixture tasks' rows from the public per-task CSV download (https://leaklens.grain64.com/api/export.csv?benchmark=swe-bench-verified), cut to 8 of its columns. The tests check that the CLI gives the same Tier C matches and fix-PR links (and, with `--judge` on the recorded answers, the same tier, state and agreement) as the hosted table.

## What is not here

The hosted site's code, its database, the API and accounts stay closed. The per-task verdicts themselves are public: SWE-bench Verified is downloadable as CSV from https://leaklens.grain64.com/benchmarks/swe-bench-verified.

## Licence

MIT, for the code. The 10 fixture tasks (`fixtures/`) are copied from SWE-bench Verified: issue text from GitHub, and patches from astropy (BSD-3-Clause), django (BSD-3-Clause) and requests (Apache-2.0), which stay under their own licences. The SWE-bench Verified dataset card states no licence of its own.
