---
name: leaklens
description: Check a SWE-bench-style coding benchmark for tasks whose own text hands over the fix, and rescore a SWE-bench run without those tasks. Use before releasing, citing or relying on a coding benchmark, or when asked whether a benchmark's issue text or comments leak the solution. Runs on the user's machine.
---

# Leaklens: solution-leakage check for coding benchmarks

Use it before releasing or citing a SWE-bench-style benchmark, or when the user asks whether a benchmark's tasks give the fix away in the issue, the comments or the patch. It writes one row per task with the sentence quoted and the tier. Nothing is uploaded by this skill.

## Get the tool

The skill needs the open-source CLI (Node 18.17 or later, no dependencies, MIT). If `bin/leaklens.mjs` is not in the working copy, clone it once and use that folder:

```sh
git clone --depth 1 https://github.com/Vyls42/leaklens leaklens
```

Below, `LEAKLENS` means `node leaklens/bin/leaklens.mjs` (adjust the path to where the clone is).

## Commands

1. Check the install on the bundled fixture (no network, no model). It must print the same result as `fixtures/expected`:
   ```sh
   cd leaklens && node bin/leaklens.mjs check fixtures/swe-bench-verified-10.jsonl --out out && diff -r out fixtures/expected && echo "same as fixtures/expected"
   ```
2. Check the user's benchmark. The file has one task per line (JSONL), or is a JSON array or CSV, with `instance_id`, `problem_statement` and `patch`; `repo`, `hints_text` and `created_at` are used when present:
   ```sh
   LEAKLENS check tasks.jsonl --out leaklens-out
   ```
   This runs Tier C only: lines of the gold patch that reappear in the issue or discussion. No network, no model.
   Rows without an `instance_id`, `problem_statement` or `patch` are listed under "Rejected rows" in the summary, with line and reason, and the rest are checked: tell the user how many were left out and why. If the summary says "this looks like a construction diff", the file's `patch` strips the feature out of the repo (the solution is on the removed side): run the same command again with `--reverse-patch` and report that run.
3. Add the fix commit date from local clones of the upstream repositories: `--repos <folder containing the clones>`.
4. Add Tier A and B, the stated fix, with the published m1.1 procedure. It needs a model and costs two or three model calls per task. Ask the user which endpoint to use. The CLI takes its API credential from the user's own environment variable (`LEAKLENS_API_KEY` or `OPENAI_API_KEY`); never read, print or store it yourself.
   ```sh
   LEAKLENS check tasks.jsonl --out leaklens-out --judge --model "<the user's model>"
   LEAKLENS check tasks.jsonl --out leaklens-out --judge --base-url http://localhost:11434/v1 --model "<local model>"
   ```
   Tell the user how many model calls the run will make and get their go-ahead before starting it.
5. Score a SWE-bench Verified or Lite run without the flagged tasks (local, no model):
   ```sh
   LEAKLENS rescore results.json --label "<agent name>"
   ```

## Reading the result

`leaklens-out/summary.md` has the headline and the tasks to look at; `leaklens-out/results.jsonl` has the evidence per task.

- Tier A: the issue or discussion states the change that fixes the problem. Two differently worded model checks agreed.
- Tier B: the text names the exact file, function or line to change, without giving the change. Reported apart from A.
- Tier C: added lines of the gold patch appear in the issue or discussion. A string match, no model.
- Links the fix PR: the text links the pull request that is the fix. A separate signal.
- Fix commit date: context only. It never makes a flag.
- A task where the checks differ is `disputed`, never `clear`. A task without a flag is not shown to be clean; say "no flag found".

Without `--judge` the headline counts Tier C only. Say that Tier A/B was not read; do not present it as a full check.

## Wording rule

A flag is a finding about the task text: say "flagged" or "the text hands over the fix". Never say a task or model is "contaminated", and never say a model was trained on or memorised a task. A fix commit date shows the fix was public from that date, nothing more. Quote the sentence with the task ID so the user can check it by hand.

Methodology and tier definitions: https://leaklens.grain64.com/methodology. For unreleased tasks keep everything on the user's machine, run the steps above, and do not paste task text into any web service.
