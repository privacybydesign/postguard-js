// Propagate package.json's version into manifest.json and updates.json.
//
// changesets bumps package.json only. Thunderbird reads manifest.json and the
// update channel reads updates.json, so all three have to agree — the release
// workflow refuses a tag whose version does not match all three, which is the
// check that would otherwise fail after every version bump.
//
// Run from apps/tb-addon: `node scripts/sync-version.mjs [--check]`
// `--check` reports and exits non-zero instead of writing, for CI.

import { readFileSync, writeFileSync } from "node:fs";

const check = process.argv.includes("--check");
const ADDON_ID = "pg4tb@e4a.org";
const REPO = "privacybydesign/postguard-js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { version } = pkg;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const updates = JSON.parse(readFileSync("updates.json", "utf8"));
const strictMin = manifest.browser_specific_settings.gecko.strict_min_version;

const problems = [];
if (manifest.version !== version) {
  problems.push(`manifest.json says ${manifest.version}, package.json says ${version}`);
}
// Membership, not position: Thunderbird does not care about entry order, and
// asserting on the last element made --check fail unfixably when an entry existed
// but was not last (a re-release, or a hotfix after a higher version landed) —
// the remedy it printed, `sync-version`, takes the existing-entry branch and
// exits without writing.
if (!updates.addons[ADDON_ID].updates.some((u) => u.version === version)) {
  problems.push(`updates.json has no entry for ${version} (package.json says ${version})`);
}

if (check) {
  if (problems.length > 0) {
    console.error(`versions are out of sync:\n  ${problems.join("\n  ")}`);
    console.error("\nRun `pnpm --filter postguard-tb-addon sync-version` and commit the result.");
    process.exit(1);
  }
  console.log(`manifest.json, updates.json and package.json all say ${version}`);
  process.exit(0);
}

manifest.version = version;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// An entry that already exists is historical fact: that version was published,
// and its update_link points at wherever it was published from. Rewriting it
// would repoint a shipped version at a release that does not exist — the
// pre-monorepo entries legitimately live under postguard-tb-addon.
const existing = updates.addons[ADDON_ID].updates.find((u) => u.version === version);
if (existing) {
  console.log(
    `synced manifest.json to ${version}; updates.json already has that entry, left as-is`
  );
} else {
  // Tag names carry an app-scoped prefix: this repo's tags are shared with
  // @e4a/pg-js's changesets releases, so a bare `v<version>` would be ambiguous.
  updates.addons[ADDON_ID].updates.push({
    version,
    update_link: `https://github.com/${REPO}/releases/download/tb-addon-v${version}/postguard-tb-addon-${version}.xpi`,
    applications: { gecko: { strict_min_version: strictMin } },
  });
  writeFileSync("updates.json", `${JSON.stringify(updates, null, 2)}\n`);
  console.log(`synced manifest.json and added ${version} to updates.json`);
}
