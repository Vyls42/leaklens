// Writes DEFINITIONS.md from src/definitions.mjs (the same file the Leaklens /methodology tier table is built from).
// usage: node scripts/gen-definitions.mjs [--check]   (--check exits 1 when DEFINITIONS.md is out of date)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TIERS, STATES, WORDING, PRECEDENCE, METHODOLOGY_VERSION } from '../src/definitions.mjs';

export function render() {
  const cell = (s) => s.replace(/\|/g, '\\|');
  return [
    `# Tier and state definitions (methodology ${METHODOLOGY_VERSION})`,
    '',
    'Generated from `src/definitions.mjs` by `node scripts/gen-definitions.mjs`. The tier table on https://leaklens.grain64.com/methodology is built from the same file.',
    '',
    '## Tiers',
    '',
    '| Tier | Meaning | How it is produced | Needs `--judge` |',
    '|---|---|---|---|',
    ...TIERS.map((t) => `| ${cell(t.label)} | ${cell(t.meaning)} | ${cell(t.how)} | ${t.model ? 'yes' : 'no'} |`),
    '',
    PRECEDENCE,
    '',
    '## States',
    '',
    'Each task in `results.jsonl` has exactly one `state`.',
    '',
    '| State | Meaning |',
    '|---|---|',
    ...STATES.map((s) => `| \`${s.id}\` | ${cell(s.meaning)} |`),
    '',
    '## Wording',
    '',
    WORDING,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL('../DEFINITIONS.md', import.meta.url);
  const want = render();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (have !== want) { console.error('DEFINITIONS.md is out of date: run node scripts/gen-definitions.mjs'); process.exit(1); }
    console.log('DEFINITIONS.md is up to date');
  } else {
    fs.writeFileSync(target, want);
    console.log('wrote DEFINITIONS.md');
  }
}
