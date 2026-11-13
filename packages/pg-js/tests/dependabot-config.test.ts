/**
 * `.github/dependabot.yml` at the repo root. It replaced `renovate.json` when
 * the repo moved to privacybydesign and took over the shared pipelines.
 *
 * One decision carried over from the Renovate setup has to survive that move:
 * no bot bumps an `@e4a/*` package. `@e4a/pg-wasm` is the wire-compatibility
 * reader, bumped by hand together with the compat gate. A rule that tells a
 * bot to leave something alone needs a check that fails when the rule is
 * removed, or the removal is silent until the bot acts on it weeks later
 * (postguard#419).
 */

import { readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/** Repo root, found by walking up to the directory that holds the workspace file. */
const repoRoot = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      if (statSync(join(dir, 'pnpm-workspace.yaml')).isFile()) return dir;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no pnpm-workspace.yaml above ${fileURLToPath(import.meta.url)}`);
})();

const config = readFileSync(join(repoRoot, '.github', 'dependabot.yml'), 'utf8');

/** The `- package-ecosystem: <name>` entry, up to the next entry or the end. */
const entry = (ecosystem: string) => {
  const entries = config.split(/^\s*- package-ecosystem:/m).slice(1);
  return entries.find((body) => body.trimStart().startsWith(ecosystem)) ?? null;
};

describe('dependabot.yml', () => {
  it('still covers the pnpm workspace, the workflows and the Dockerfiles', () => {
    for (const ecosystem of ['npm', 'github-actions', 'docker']) {
      expect(entry(ecosystem), `dependabot.yml has no ${ecosystem} entry`).not.toBeNull();
    }
  });

  it('never bumps an @e4a/* package', () => {
    expect(
      entry('npm'),
      'the npm entry no longer ignores @e4a/*, so Dependabot would bump @e4a/pg-wasm, the ' +
        'wire-compatibility reader, without the compat gate'
    ).toMatch(/ignore:\s*\n\s*- dependency-name: '@e4a\/\*'/);
  });

  it('watches the directories the Dockerfiles are actually in', () => {
    const dirs = (entry('docker')?.match(/directories:\s*\[(.*)\]/)?.[1] ?? '')
      .split(',')
      .map((dir) => dir.trim());
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      expect(
        statSync(join(repoRoot, dir, 'Dockerfile')).isFile(),
        `dependabot.yml watches ${dir}, which holds no Dockerfile`
      ).toBe(true);
    }
  });
});
