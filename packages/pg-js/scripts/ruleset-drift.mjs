// Checks that `main`'s LIVE ruleset still requires the contexts and review
// count pinned in .github/required-rules.json (postguard-js#274).
//
// Deliberately not a blocking check: what this reads changes out of band — an
// admin edits repo settings, with no commit and no pull request — so wiring it
// into the required-status-checks list would hold the next unrelated PR
// hostage, and would block every merge whenever the API is briefly
// unreachable. Instead, .github/workflows/ruleset-drift.yml runs this on push
// to main and on a daily schedule and files an issue on drift. See that file's
// own header for why it stays out of required-rules.json and out of the
// ruleset itself.
//
// The comparison logic is pure and lives in lib/ruleset-drift.mjs, unit-tested
// offline in ../tests/ruleset-drift.test.ts; this file is only network and
// process I/O, run directly:
//
//   node scripts/ruleset-drift.mjs
//
// Exit codes — see lib/ruleset-drift.mjs's header for the full contract:
//   0  no drift
//   1  drift
//   2  undetermined (could not read the live rules) — NOT drift

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareRules } from './lib/ruleset-drift.mjs';

const REPO = 'privacybydesign/postguard-js';
const RULES_URL = `https://api.github.com/repos/${REPO}/rules/branches/main`;

/** Walked up from this file, the same way ci-wiring.test.ts finds `.github`. */
function findRequiredRulesPath() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, '.github', 'required-rules.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`no .github/required-rules.json found above ${import.meta.url}`);
    }
    dir = parent;
  }
}

async function fetchEffectiveRules() {
  const headers = { Accept: 'application/vnd.github+json' };
  // Read needs no credential on a public repo, but the runner's anonymous
  // budget is 60/hour per shared IP — CI passes GITHUB_TOKEN so exhausting
  // that budget lands on 2, not on every job sharing the runner's IP failing.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(RULES_URL, { headers });
  if (!response.ok) {
    throw new Error(`GET ${RULES_URL} answered ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const expected = JSON.parse(readFileSync(findRequiredRulesPath(), 'utf8'));

  let effectiveRules;
  try {
    effectiveRules = await fetchEffectiveRules();
  } catch (err) {
    console.error(`ruleset-drift: could not read the live rules: ${err.message}`);
    process.exit(2);
  }

  const { code, report } = compareRules(expected, effectiveRules);
  console.log(report);
  process.exit(code);
}

main();
