/**
 * What this repo's required checks are actually wired to (postguard-js#222).
 *
 * `main` pins eighteen contexts by DISPLAY NAME, spread over the workflow files
 * here, and until this file existed
 * nothing in the repo read any of those names. That is the
 * encryption4all/postguard#299 vector eighteen times over: branch protection
 * matches a required check by its name, so renaming a job does not break its
 * gate — it silently
 * *disarms* it, leaving a context that no job produces.
 *
 * Where the eighteen live is worth measuring rather than assuming, because it is
 * not where the sibling repo keeps its one. Classic protection here requires **no
 * status checks at all** — only one approving review, with `enforce_admins:
 * false`. All of the repo's own come from the ruleset `main` (id 14326269), and that ruleset
 * grants the `developers` team `bypass_mode: always`, so for anyone on that team
 * every one of them is advisory. That does not weaken the case for this file, it
 * is the case for it: a test runs on its own merits whether or not the
 * enforcement behind it binds.
 *
 * A second vector is specific to this repo. `Integration complete` is an
 * aggregate whose coverage is exactly its `needs:` list, and the workflow said
 * so in a comment — "Adding a lane above? Add it to `needs` here too, or it is
 * not covered by the required check no matter how loudly it fails". A comment
 * is a convention. "the aggregate covers every lane in the file" below derives
 * that set from the file instead, so a lane added and not covered fails here
 * rather than running, reporting, and counting for nothing.
 *
 * ## Where this lives, and why it cannot be skipped by what it catches
 *
 * `pg-core/tests/ci_wiring.rs` in the sibling repo had to dodge a path filter:
 * the gate it guards runs its own tests, so a guard beside the gate is deleted
 * along with it. Here the shape is different. **No workflow in this repo is
 * path-filtered** — every one of them says so in a header comment, deliberately,
 * because the point of the monorepo is that an SDK change is tested against its
 * consumers in the same PR. So "which lane is unconditional" has the answer
 * "all of them", and the real question is which lane this file is a hostage of.
 *
 * It lives in `packages/pg-js`, whose vitest suite runs in three separate lanes
 * of `integration.yml` — `Node 22`/`Node 24` (via `pnpm -r test`), `Bun 1.3.14`
 * and `Deno 2.8.0`. Consequences worth keeping:
 *
 * - It is in a different *file* from six of the seven workflows that carry a
 *   required context — `website.yml`, `outlook-addon.yml`, `tb-addon.yml`,
 *   `pr-title.yml`, `examples.yml` and `sdk-canary.yml`, all but
 *   `integration.yml` — so a job renamed or deleted in any of those cannot skip
 *   its own guard. A guard living in `apps/website` would be run by `Svelte
 *   Check`'s workflow, which is exactly the file whose renames it is supposed to
 *   notice.
 * - No single lane deletion silences it, because three lanes run it.
 * - It is not run by the aggregate itself, so `Integration complete` losing a
 *   `needs` entry still turns something red.
 *
 * What that placement does *not* cover: removing all three SDK lanes from
 * `needs` in one change would leave this file red in jobs nothing requires. The
 * guard still fails loudly and visibly — the point of the map is silent drift,
 * and that is not silent — but it is `Envelope compatibility` and `API surface`,
 * required by name in their own right, that would still block.
 *
 * ## What no test can reach
 *
 * That the ruleset still lists these contexts, and who may still bypass them,
 * lives in GitHub's API:
 *
 *     gh api repos/privacybydesign/postguard-js/rules/branches/main
 *
 * No test runner can call it. `REQUIRED_CONTEXTS` below is this side of that
 * link; keep the two in step, and when you rename a job, rename the context in
 * the same change.
 *
 * ## On reading YAML as text
 *
 * There is no YAML parser in this workspace and this needs none: the assertions
 * are about literal names and literal commands. The reader detects the file's
 * indent rather than assuming it, and throws when it finds no jobs — a reformat
 * that defeats it fails here loudly instead of quietly asserting nothing.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * Job-level `if:` expressions a required job may carry.
 *
 * GitHub reports a skipped job as a *passing* required check, so an `if:` on a
 * required job is a way to make a gate that cannot fail. These three are the
 * ones that are still true on a pull request: `always()`/`!cancelled()` make an
 * aggregate report rather than skip, and the event-name guard is how a
 * PR-only job says so.
 */
const PR_SAFE_CONDITIONS = [
  'always()',
  '${{ always() }}',
  '!cancelled()',
  '${{ !cancelled() }}',
  "github.event_name == 'pull_request'",
  "${{ github.event_name == 'pull_request' }}",
];

/** Repo root, found by walking up to the directory that holds the workflows. */
const workflowDir = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, '.github', 'workflows');
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no .github/workflows above ${fileURLToPath(import.meta.url)}`);
})();

/**
 * The contexts the ruleset `main` requires, by display name, plus the floor on
 * its approving review count — read from `.github/required-rules.json`, the
 * one place the names live (postguard-js#274). That file is
 * byte-sorted, not ordered the way the API returns them, so every comparison
 * against it (here, and in `scripts/ruleset-drift.mjs`, which reads the same
 * file to catch drift in the *live* ruleset) is against a set, never a
 * sequence:
 *
 *     gh api repos/privacybydesign/postguard-js/rules/branches/main \
 *       -q '.[] | select(.type=="required_status_checks")
 *            | .parameters.required_status_checks[].context'
 *
 * Note `Unit tests` (outlook-addon) and `Unit Tests` (website) differ only in
 * case, and `nginx config test (…)` is qualified per app: a required check is
 * matched by name across the WHOLE repo, so two jobs sharing one name are
 * indistinguishable to branch protection. `everyRequiredContextHasExactlyOneJob`
 * is what stops that recurring.
 */
const REQUIRED_CONTEXTS: string[] = JSON.parse(
  readFileSync(join(dirname(workflowDir), 'required-rules.json'), 'utf8')
).contexts;

const indentOf = (line: string) => line.length - line.trimStart().length;

const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');

interface Job {
  /** The YAML key, e.g. `integration-complete`. */
  id: string;
  file: string;
  /** Every line of the job below its own key. */
  body: string;
  /** Job-level `name:`, or the id — which is what GitHub falls back to. */
  name: string;
  /** `name` with `${{ matrix.* }}` resolved: the check names this job reports. */
  contexts: string[];
  /** Job-level `needs:`, or null when absent. */
  needs: string[] | null;
  /** Job-level `if:`, or null when absent. */
  condition: string | null;
}

interface Workflow {
  file: string;
  /** Everything above `jobs:` — the `on:`, `env:` and `permissions:` blocks. */
  triggers: string;
  jobs: Job[];
}

/** Lines of `body` indented past `head`, stopping at the first that is not. */
const blockUnder = (lines: string[], head: number) => {
  const base = indentOf(lines[head]);
  const block: string[] = [];
  for (const line of lines.slice(head + 1)) {
    if (line.trim() === '') continue;
    if (indentOf(line) <= base) break;
    block.push(line);
  }
  return block;
};

/**
 * The matrix rows a job expands into: one `Record` per combination, so a name
 * template can be resolved per row.
 *
 * Both spellings this repo uses are handled — flow lists (`node: ['22', '24']`,
 * combined as a product) and `include:` entries (one row each).
 */
const matrixRows = (body: string): Array<Record<string, string>> => {
  const lines = body.split('\n');
  const head = lines.findIndex((line) => line.trim() === 'matrix:');
  if (head < 0) return [];
  const block = blockUnder(lines, head);

  const includeAt = block.findIndex((line) => line.trim() === 'include:');
  if (includeAt >= 0) {
    const rows: Array<Record<string, string>> = [];
    for (const line of block.slice(includeAt + 1)) {
      const isEntry = line.trimStart().startsWith('- ');
      const pair = (isEntry ? line.trim().slice(2) : line.trim()).match(
        /^([A-Za-z0-9_-]+):\s*(.+)$/
      );
      if (isEntry) rows.push({});
      if (!pair || rows.length === 0) continue;
      rows[rows.length - 1][pair[1]] = unquote(pair[2]);
    }
    return rows;
  }

  let rows: Array<Record<string, string>> = [{}];
  for (const line of block) {
    const axis = line.trim().match(/^([A-Za-z0-9_-]+):\s*\[(.*)\]$/);
    if (!axis) continue;
    const values = axis[2]
      .split(',')
      .map(unquote)
      .filter((value) => value !== '');
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [axis[1]]: value })));
  }
  return rows;
};

/** A job's display name with its matrix references resolved. */
const expandName = (template: string, rows: Array<Record<string, string>>) => {
  if (!/\$\{\{\s*matrix\./.test(template) || rows.length === 0) return [template];
  const names = rows.map((row) =>
    template.replace(/\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g, (whole, key: string) =>
      key in row ? row[key] : whole
    )
  );
  return [...new Set(names)];
};

const parseWorkflow = (file: string): Workflow => {
  const text = `\n${readFileSync(join(workflowDir, file), 'utf8').replace(/\r\n/g, '\n')}`;
  const at = text.indexOf('\njobs:\n');
  if (at < 0) throw new Error(`${file}: no top-level \`jobs:\``);

  const triggers = text.slice(0, at + 1);
  const lines = text.slice(at + '\njobs:\n'.length).split('\n');

  const first = lines.find((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const step = first ? indentOf(first) : 0;
  if (step === 0) {
    throw new Error(`${file}: no indented key under \`jobs:\`, so this reader found no jobs`);
  }

  const isHeader = (line: string) =>
    indentOf(line) === step && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim());

  const jobs: Job[] = [];
  for (const [index, line] of lines.entries()) {
    if (!isHeader(line)) continue;
    const body = blockUnder(lines, index).join('\n');

    // Job-level keys sit at exactly one step past the job id. Step-level keys
    // are deeper and behind a `- `, so `name:` here is never a step's.
    const field = (key: string) => {
      const match = body
        .split('\n')
        .filter((l) => indentOf(l) === step * 2 && !l.trimStart().startsWith('- '))
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${key}:`));
      return match ? match.slice(key.length + 1).trim() : null;
    };

    const needs = field('needs');
    const name = field('name');
    jobs.push({
      id: line.trim().slice(0, -1),
      file,
      body,
      name: name ?? line.trim().slice(0, -1),
      contexts: expandName(name ?? line.trim().slice(0, -1), matrixRows(body)),
      needs:
        needs === null
          ? null
          : needs
              .replace(/^\[|\]$/g, '')
              .split(',')
              .map((entry) => entry.trim())
              .filter((entry) => entry !== ''),
      condition: field('if'),
    });
  }
  return { file, triggers, jobs };
};

/** Every workflow in the directory, so a new one cannot be missed. */
const workflows: Workflow[] = readdirSync(workflowDir)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort()
  .map(parseWorkflow);

const workflow = (file: string) => {
  const found = workflows.find((candidate) => candidate.file === file);
  if (!found) throw new Error(`no ${file} in ${workflowDir}`);
  return found;
};

const job = (file: string, id: string) => {
  const found = workflow(file).jobs.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`${file} has no job \`${id}\`, so anything asserted about it is vacuous`);
  }
  return found;
};

/** A job's steps, one block of text each. */
const stepsOf = (target: Job) => {
  const lines = target.body.split('\n');
  const head = lines.findIndex((line) => line.trim() === 'steps:');
  if (head < 0) return [];
  const base = indentOf(lines[head]);

  const steps: string[] = [];
  let itemIndent = -1;
  for (const line of lines.slice(head + 1)) {
    if (line.trim() !== '' && indentOf(line) <= base) break;
    const isItem = line.trimStart().startsWith('- ');
    if (isItem && itemIndent < 0) itemIndent = indentOf(line);
    if (isItem && indentOf(line) === itemIndent) steps.push('');
    if (steps.length > 0) steps[steps.length - 1] += `${line}\n`;
  }
  return steps;
};

/**
 * The single step containing `needle`. Requiring exactly one is what stops a
 * duplicated step from letting one of two copies drift unchecked.
 */
const stepWith = (target: Job, needle: string) => {
  const found = stepsOf(target).filter((step) => step.includes(needle));
  expect(
    found,
    `expected exactly one step containing ${JSON.stringify(needle)} in ${target.file}'s \`${target.id}\``
  ).toHaveLength(1);
  return found[0];
};

/** The `on:` block of a workflow, as text. */
const triggerBlock = (target: Workflow, event: string) => {
  const lines = target.triggers.split('\n');
  const onAt = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (onAt < 0) return null;
  const block = blockUnder(lines, onAt);
  const head = block.findIndex((line) => line.trim() === `${event}:`);
  return head < 0 ? null : blockUnder(block, head).join('\n');
};

/** Which file/job each context string comes from. */
const producers = new Map<string, string[]>();
for (const candidate of workflows) {
  for (const target of candidate.jobs) {
    for (const context of target.contexts) {
      producers.set(context, [...(producers.get(context) ?? []), `${candidate.file}#${target.id}`]);
    }
  }
}

const requiredJobs = () =>
  workflows.flatMap((candidate) =>
    candidate.jobs.filter((target) =>
      target.contexts.some((context) => REQUIRED_CONTEXTS.includes(context))
    )
  );

describe('required contexts', () => {
  /**
   * Written from the required NAME inwards, not from a job id outwards. The
   * dangerous edit is not "this job lost its name" but "this name now belongs to
   * something else, or to nothing": branch protection matches on the string, so
   * a context no job produces blocks nothing and a context two jobs produce is
   * ambiguous to it.
   */
  it('every context the ruleset requires is produced by exactly one job', () => {
    for (const context of REQUIRED_CONTEXTS) {
      expect(
        producers.get(context) ?? [],
        `\`main\`'s ruleset requires the context ${JSON.stringify(context)}, and the ` +
          `workflows in ${workflowDir} produce it ${(producers.get(context) ?? []).length} ` +
          'time(s). A required context no job produces blocks nothing, so renaming a job ' +
          'disarms its gate instead of breaking it; two jobs producing one context are ' +
          'indistinguishable to branch protection. Rename the context in the same change ' +
          '(`gh api repos/privacybydesign/postguard-js/rules/branches/main`).'
      ).toHaveLength(1);
    }
  });

  /**
   * A skipped check counts as PASSING for branch protection, so an `if:` on a
   * required job is how a gate stops being able to fail without ever going red.
   */
  it('no required job can skip itself on a pull request', () => {
    for (const target of requiredJobs()) {
      if (target.condition === null) continue;
      expect(
        PR_SAFE_CONDITIONS,
        `${target.file}'s \`${target.id}\` reports a required context and carries ` +
          `\`if: ${target.condition}\`. GitHub counts a skipped check as passing, so a ` +
          'condition that is false on a pull request makes this gate unable to fail. If the ' +
          'condition really is PR-safe, add it to PR_SAFE_CONDITIONS and say why.'
      ).toContain(target.condition);
    }
  });

  /**
   * The other half of the same failure: a required context whose workflow does
   * not run on the pull request never reports at all. A `paths:` filter is the
   * usual way that happens, and this repo has decided against it everywhere —
   * see the header comment on any of these files, and the note on
   * `envelope-compat` about a path-filtered required check blocking PRs that
   * miss the filter.
   */
  it('no workflow carrying a required context filters itself off a pull request', () => {
    const files = [...new Set(requiredJobs().map((target) => target.file))];
    for (const file of files) {
      const block = triggerBlock(workflow(file), 'pull_request');
      expect(
        block,
        `${file} carries a required context but has no \`pull_request:\` trigger`
      ).not.toBeNull();
      expect(
        block,
        `${file}'s \`pull_request:\` trigger declares a paths filter. A path-filtered ` +
          'required check does not report on a PR that misses the filter, and branch ' +
          'protection then blocks that PR with nothing to run.'
      ).not.toMatch(/^\s*paths(-ignore)?:/m);
      if (/^\s*branches:/m.test(block ?? '')) {
        expect(block, `${file}'s \`pull_request:\` trigger no longer covers \`main\``).toMatch(
          /branches:.*main/
        );
      }
    }
  });
});

describe('integration.yml', () => {
  /**
   * The comment this replaces: "Adding a lane above? Add it to `needs` here too,
   * or it is not covered by the required check no matter how loudly it fails."
   *
   * Derived from the file, so a new lane fails here until it is covered rather
   * than running, reporting, and counting for nothing.
   */
  it('the aggregate covers every lane in the file', () => {
    const named = workflow('integration.yml').jobs.filter((target) =>
      target.contexts.includes('Integration complete')
    );
    expect(named, 'no job in integration.yml is named `Integration complete`').toHaveLength(1);
    const aggregate = named[0];

    const lanes = workflow('integration.yml')
      .jobs.filter((target) => target.id !== aggregate.id)
      .map((target) => target.id);

    expect(
      [...(aggregate.needs ?? [])].sort(),
      `\`${aggregate.id}\` is the single required check for integration.yml and its coverage ` +
        'is exactly its `needs:`. A lane in this file but not in that list runs, reports, and ' +
        'counts for nothing. Add it there, or say here why it is deliberately uncovered.'
    ).toEqual([...lanes].sort());
  });

  /**
   * `needs` only makes the lanes' results available; `if: always()` is what makes
   * the aggregate report at all, and the assert step is what makes it able to
   * fail. Without the first the job is SKIPPED when a lane fails, and a skipped
   * required check passes. Without the second it needs every lane, reads none,
   * and goes green however they ended — worse than a rename, because a rename
   * disarms a gate while this certifies a failure as a pass.
   */
  it('the aggregate reports on a red lane, and can go red itself', () => {
    const aggregate = job('integration.yml', 'integration-complete');

    expect(
      aggregate.condition,
      'without `if: always()` the aggregate is skipped when a lane fails, and branch ' +
        'protection counts a skipped check as passing'
    ).toBe('always()');

    const assertion = stepWith(aggregate, 'needs.*.result');

    // One regex rather than a `success` check and an `exit 1` check, because
    // separately each passes on a step the other has already gutted: the
    // empty-results guard below supplies an `exit 1` all on its own, so a lane
    // loop whose failure branch only *logs* still contains one. What has to hold
    // is that the comparison and the non-zero exit are still connected.
    expect(
      assertion,
      'the aggregate reads the lane results and then either never compares them against ' +
        '`success` or never exits non-zero when the comparison fails. Either way it reports ' +
        'green however the lanes ended, which is worse than a rename: a rename disarms a gate, ' +
        'this one certifies a failure as a pass.'
    ).toMatch(/success[\s\S]{0,400}exit 1/);
    expect(
      assertion,
      'the aggregate does not guard the empty case: with no results the loop runs zero times ' +
        'and the step exits 0 having checked nothing'
    ).toMatch(/-z\s+"\$\{RESULTS/);
  });

  /**
   * `edited` is not a default `pull_request` type. `envelope-compat` and
   * `api-surface` both derive their verdict from the MERGE BASE of the base
   * branch and HEAD, so retargeting a PR — which fires only `edited` — otherwise
   * leaves a stale check-run attached to an unchanged head sha, and GitHub
   * reports it as current. `Conventional Commit` has the same dependency on the
   * title, which only `edited` re-reads.
   */
  it('a retitled or retargeted PR still re-runs the gates that read the base', () => {
    for (const file of ['integration.yml', 'pr-title.yml']) {
      const block = triggerBlock(workflow(file), 'pull_request') ?? '';
      const types = (block.match(/types:\s*\[(.*)\]/)?.[1] ?? '').split(',').map(unquote);
      expect(
        types,
        `${file}'s \`pull_request\` trigger no longer lists \`edited\`, which is not a ` +
          'default type. Without it a retarget or retitle leaves a verdict attached to the ' +
          'base or title it was computed from.'
      ).toContain('edited');
    }
  });

  /** The two gates in this workflow are only gates while they run their command. */
  it('the two merge-base gates still run what they claim to', () => {
    const surface = job('integration.yml', 'api-surface');
    stepWith(surface, 'pnpm api:gate');
    expect(
      surface.body,
      '`api-surface` compares against the merge base, which a shallow clone has no common ' +
        'ancestor for; without `fetch-depth: 0` the gate fails rather than gating'
    ).toContain('fetch-depth: 0');

    const envelope = job('integration.yml', 'envelope-compat');
    stepWith(envelope, 'pnpm envelope:check');
    for (const suite of ['tests/envelope-forward.test.ts', 'tests/envelope-archival.test.ts']) {
      expect(
        envelope.body,
        `\`envelope-compat\` no longer runs ${suite}, so one direction of ` +
          "COMPATIBILITY.md's envelope guarantee is unchecked"
      ).toContain(suite);
    }
    expect(
      envelope.body,
      'the append-only fixture check compares against the merge base and needs the history ' +
        'to find it'
    ).toContain('fetch-depth: 0');
  });
});

describe('release and publish wiring', () => {
  /**
   * This repo's tag namespace is shared three ways: changesets tags `@e4a/pg-js`
   * releases, the pre-monorepo `v2.3.3`-style pg-js tags are still here, and each
   * app tags its own. A bare `v*` trigger therefore fires on somebody else's
   * release — and the failure is silent in the direction that matters, since an
   * app release built from a tag that was never its own still publishes.
   */
  it('every release trigger is app-scoped, never a bare `v*`', () => {
    for (const candidate of workflows) {
      const push = triggerBlock(candidate, 'push');
      const tags = push?.match(/tags:\s*\[(.*)\]/)?.[1];
      if (!tags) continue;
      for (const pattern of tags.split(',').map(unquote)) {
        expect(
          pattern,
          `${candidate.file} triggers a release on the tag pattern ${JSON.stringify(pattern)}. ` +
            "This repo's tag namespace is shared with changesets and the pre-monorepo " +
            "pg-js tags, so an unscoped pattern fires on another product's release."
        ).toMatch(/^[a-z][a-z0-9-]*-v\*$/);
      }
    }
  });

  it('the tb-addon release stays behind its own tag prefix', () => {
    const push = triggerBlock(workflow('tb-addon.yml'), 'push') ?? '';
    expect(
      push,
      'tb-addon.yml no longer builds on its own release tags, so a tag push produces no ' +
        'artifact for the release job to attach'
    ).toContain("tags: ['tb-addon-v*']");
    expect(
      job('tb-addon.yml', 'release').condition,
      'the tb-addon release job no longer checks the tag prefix, so any tag on this repo — ' +
        'a changesets pg-js release included — would cut a Thunderbird add-on release'
    ).toBe("startsWith(github.ref, 'refs/tags/tb-addon-v')");
  });

  /**
   * The image names are hardcoded on purpose: `${{ github.repository }}` resolves
   * to `postguard-js` here, while postguard-ops pins the two names below in prod,
   * so deriving them would publish to a name nothing deploys.
   */
  it('the published image names are the ones ops deploys', () => {
    const published: Array<[string, string, string]> = [
      ['website.yml', 'image', 'ghcr.io/privacybydesign/postguard-website'],
      ['outlook-addon.yml', 'image', 'ghcr.io/privacybydesign/postguard-outlook-addon'],
      ['status-checks.yml', 'website-image', 'ghcr.io/privacybydesign/postguard-website'],
      [
        'status-checks.yml',
        'outlook-addon-image',
        'ghcr.io/privacybydesign/postguard-outlook-addon',
      ],
    ];
    for (const [file, id, image] of published) {
      // The shared workflow falls back to ghcr.io/<owner>/<repo> when no name is
      // given, which is the `postguard-js` name nothing deploys.
      expect(
        job(file, id).body,
        `${file}#${id} does not name its image, so the shared workflow would derive ` +
          'ghcr.io/privacybydesign/postguard-js — a name nothing deploys'
      ).toMatch(new RegExp(`^\\s*image-name: ${image}$`, 'm'));
    }
    // The release notes of the add-in name the image too.
    expect(workflow('outlook-addon.yml').triggers).toContain(
      'IMAGE: ghcr.io/privacybydesign/postguard-outlook-addon'
    );
  });

  /**
   * Every image job goes through the shared workflow, which builds once, scans,
   * and only then pushes. A job that builds and pushes on its own skips that
   * gate.
   */
  it('images are built and pushed only by the shared workflow', () => {
    for (const candidate of workflows) {
      for (const target of candidate.jobs) {
        expect(
          target.body,
          `${candidate.file}#${target.id} builds an image itself, outside the shared ` +
            'docker-publish workflow and its scan-before-push gate'
        ).not.toMatch(/docker\/build-push-action|docker buildx|docker push/);
      }
    }
    for (const [file, id] of [
      ['website.yml', 'image'],
      ['outlook-addon.yml', 'image'],
      ['status-checks.yml', 'website-image'],
      ['status-checks.yml', 'outlook-addon-image'],
    ]) {
      expect(job(file, id).body).toMatch(
        /uses: privacybydesign\/github-workflows\/\.github\/workflows\/docker-publish\.yml@/
      );
    }
  });

  /**
   * A pull request builds and scans both images (which is the part worth gating
   * on) without a registry write, and that build sits behind the one context
   * the organization requires. The publishing jobs run on a push only.
   */
  it('images are checked on a PR and pushed only on a push', () => {
    const passed = job('status-checks.yml', 'passed');
    for (const id of ['website-image', 'outlook-addon-image']) {
      const check = job('status-checks.yml', id);
      expect(
        check.body,
        `status-checks.yml#${id} can push, so a pull request would write to the registry`
      ).toMatch(/^\s*push-image: false$/m);
      expect(check.condition, `status-checks.yml#${id} is conditional, so it can skip`).toBeNull();
      expect(
        passed.needs,
        `\`Status checks passed\` does not wait for ${id}, so a broken image build would not block`
      ).toContain(id);
    }

    for (const file of ['website.yml', 'outlook-addon.yml']) {
      const image = job(file, 'image');
      // Against the body, not `condition`: the add-in's `if:` is a folded
      // scalar, which the line-oriented reader returns as `>-`.
      expect(image.condition, `${file}#image is unconditional`).not.toBeNull();
      expect(
        image.body,
        `${file}#image is not limited to pushes, so a pull request run would publish`
      ).toContain("github.event_name == 'push'");
      expect(image.body, `${file}#image cannot push at all`).not.toContain('push-image: false');
    }
    // The only pushes that reach the workflows are main and the app's own tags.
    expect(triggerBlock(workflow('website.yml'), 'push')).toContain('branches: [main]');
    expect(triggerBlock(workflow('website.yml'), 'push') ?? '').not.toContain('tags:');
  });

  /**
   * The add-in's version tag is cut by the shared workflow from the git tag. The
   * prefix is what keeps another product's release from publishing this image,
   * and what turns `outlook-addin-v1.2.0` into `:1.2.0`.
   */
  it('the add-in image release stays behind its own tag prefix', () => {
    const image = job('outlook-addon.yml', 'image');
    expect(image.body).toMatch(/^\s*tag-prefix: outlook-addin-$/m);
    expect(triggerBlock(workflow('outlook-addon.yml'), 'push') ?? '').toContain(
      "tags: ['outlook-addin-v*']"
    );
    expect(
      image.needs,
      'the add-in image no longer waits for its checks and the validated release manifest'
    ).toEqual(['check', 'test', 'urls', 'nginx', 'target', 'manifest']);
    for (const need of ['check', 'test', 'urls', 'nginx', 'target', 'manifest']) {
      expect(
        image.body,
        `the add-in image condition does not look at \`${need}\`: with \`!cancelled()\` a ` +
          'failed need no longer stops the publish on its own'
      ).toContain(`needs.${need}.result == 'success'`);
    }
    expect(job('outlook-addon.yml', 'release').needs).toEqual(['target', 'image']);
  });

  /**
   * The pull-request build of the add-in bakes in the production URLs, and it
   * lives in a different file from the PROD_* values the release uses. A
   * reusable workflow cannot read `env`, so the values are repeated; this holds
   * the two copies together.
   */
  it('the add-in image check bakes in the production URLs', () => {
    const env = workflow('outlook-addon.yml').triggers;
    const value = (key: string) => {
      const found = env.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
      if (!found) throw new Error(`outlook-addon.yml has no ${key}`);
      return found;
    };
    // Whole lines, so `https://postguard.eu` cannot pass for `https://postguard.eu/pkg`.
    const lines = job('status-checks.yml', 'outlook-addon-image')
      .body.split('\n')
      .map((line) => line.trim());
    expect(lines).toContain(`ADDIN_PUBLIC_URL=https://${value('PROD_ADDIN_HOST')}/`);
    expect(lines).toContain(`PKG_URL=${value('PROD_PKG_URL')}`);
    expect(lines).toContain(`CRYPTIFY_URL=${value('PROD_CRYPTIFY_URL')}`);
    expect(lines).toContain(`POSTGUARD_WEBSITE_URL=${value('PROD_WEBSITE_URL')}`);
  });
});

describe('ruleset-drift.yml', () => {
  /**
   * This is deliberately RED on this branch (postguard-js#274): `dobby-coder`
   * has no `workflows: write`, so `.github/workflows/ruleset-drift.yml` could
   * only be posted as a patch on the PR, not committed. Leaving this assertion
   * red is what keeps that patch from being forgotten — on this repo's
   * sibling, a posted-and-never-applied workflow patch merged silently twice
   * before this inversion (guard first, workflow second) was adopted. Do not
   * weaken, skip or delete it to make CI green; once a maintainer applies the
   * patch this goes green on its own.
   */
  it('main is watched by a scheduled ruleset-drift check', () => {
    const named = workflow('ruleset-drift.yml').jobs.filter(
      (target) => target.name === 'Ruleset still requires the gates'
    );
    expect(
      named,
      'no job named exactly `Ruleset still requires the gates` in ruleset-drift.yml'
    ).toHaveLength(1);
    stepWith(named[0], 'node scripts/ruleset-drift.mjs');
  });
});

/**
 * The reader above is line-oriented, so a reformat could leave it matching
 * nothing while every assertion still passed. This is the check that the
 * instrument itself still works.
 */
describe('the reader', () => {
  it('found jobs in every workflow', () => {
    expect(workflows.length).toBeGreaterThan(0);
    for (const candidate of workflows) {
      expect(candidate.jobs.length, `${candidate.file} read back with no jobs`).toBeGreaterThan(0);
      for (const target of candidate.jobs) {
        expect(target.name, `${candidate.file}#${target.id} read back with an empty name`).not.toBe(
          ''
        );
      }
    }
  });

  it('still expands both spellings of a matrix name', () => {
    // Nothing may read back with a matrix reference intact: an unexpanded name
    // silently matches no required context, which is the one way this reader
    // could report a gate missing that is really there — or miss one that is.
    for (const candidate of workflows) {
      for (const target of candidate.jobs) {
        for (const context of target.contexts) {
          expect(
            context,
            `${candidate.file}#${target.id} read back with an unresolved matrix reference, so ` +
              'this reader no longer understands the file'
          ).not.toMatch(/\$\{\{\s*matrix\./);
        }
      }
    }

    // The flow-list spelling (`node: ['22', '24']`), which no required context
    // exercises. Deliberately not pinned to the versions: the aggregate exists
    // precisely so a runtime bump is a one-line matrix edit and nothing else, and
    // a test that pinned `Node 22` here would take that back.
    const lane = job('integration.yml', 'node');
    expect(lane.contexts.length).toBeGreaterThan(0);
    for (const context of lane.contexts) expect(context).toMatch(/^Node \S+$/);
  });

  it('reads every job a required context depends on, with its steps', () => {
    for (const target of requiredJobs()) {
      expect(
        stepsOf(target).length,
        `${target.file}#${target.id} reports a required context but read back with no steps, ` +
          'so this reader no longer understands the file'
      ).toBeGreaterThan(0);
    }
  });
});
