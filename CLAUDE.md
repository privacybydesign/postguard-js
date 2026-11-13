# postguard-js

PostGuard is end-to-end encrypted email and file sending built on Identity-Based
Encryption: a sender needs only the recipient's identity (an email address) plus a
master public key, so no key exchange happens; the recipient proves who they are to
a Private Key Generator and receives a decryption key. This repo is the JS monorepo
— pnpm workspaces, releases by changesets.

## Parts

- `packages/pg-js` — `@e4a/pg-js`, the browser+Node SDK, and the only thing here
  that is published to npm.
- `apps/website` — the SvelteKit app where people encrypt files and send them using
  Yivi identity attributes. `website.yml` publishes
  `ghcr.io/privacybydesign/postguard-website` from here; the app's history is in the
  archived `encryption4all/postguard-website` and not in this repo's log.
- `apps/tb-addon`, `apps/outlook-addon` — the Thunderbird and Outlook mail addons,
  imported from their own repos per postguard-js#123, which is still open.
- `examples/` — the samples docs.postguard.eu renders.

## Which repos a change here touches

- **`encryption4all/postguard` (Rust) is the hub** and every other PostGuard tool
  depends on it, but the dependency runs through npm rather than through the repo:
  `@e4a/pg-js` depends on `@e4a/pg-wasm ^0.6.1`, published from postguard's
  `pg-wasm` crate. A core change reaches this repo only on a release.
- **Yivi, across orgs.** `@e4a/pg-js` pulls `@privacybydesign/yivi-client`,
  `yivi-core`, `yivi-web` and `yivi-css` from
  `privacybydesign/yivi-frontend-packages`. That edge is separate from the
  PKG↔yivi-server one.
- **`postguard-e2e` is what catches the breakage.** It sweeps the newest release of
  the last two `@e4a/pg-js` majors against a target server, so a major here has a
  two-release tail.

## The public type surface is a gate, not a doc

`packages/pg-js/etc/pg-js.api.md` pins the published type surface, and `pnpm build`
fails when the build no longer matches it — so a compatibility change always lands
as a reviewable diff. `pnpm api:update`, from `packages/pg-js`, refreshes it.
Regenerating that file to get a red build green changes the contract silently.

## Where the operational knowledge is

Not in this file. It is in the checks that hold it, each carrying its own header
comment: `packages/pg-js/tests/ci-wiring.test.ts` for what `main`'s required
contexts are wired to, `tests/envelope-forward.test.ts` and
`tests/envelope-archival.test.ts` plus `scripts/check-envelope-fixtures.mjs` for the
append-only envelope corpus, `scripts/api-report.mjs` for the surface gate above. A
container that learns something durable files a binding rule with the host, which
lands it in the next container at `~/dobby-rules.md`; it does not write it here.
This file is orientation, and `packages/pg-js/tests/claude-md-orientation.test.ts`
holds it to 4,000 bytes.

The corpus this file used to be is in git history: 29,921 bytes at `7767706`, the
last revision carrying it (`git show 7767706:CLAUDE.md`). That cut is this file
only — `apps/*` and `examples/` keep their own `CLAUDE.md` files, still corpus.
