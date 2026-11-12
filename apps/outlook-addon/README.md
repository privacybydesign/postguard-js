# <p align="center"><img src="./img/pg_logo.svg" height="128px" alt="PostGuard" /></p>

> For full documentation, visit [docs.postguard.eu](https://docs.postguard.eu/repos/postguard-outlook-addon).

Identity-based email encryption add-in for Microsoft Outlook. Users can send and receive encrypted email using [Yivi](https://yivi.app) identity verification, without needing to exchange keys. This is one of the main end-user clients for PostGuard, alongside the Thunderbird add-on.

Targets the new Outlook on Windows and Outlook for Mac as a taskpane mail add-in (Compose + Read).

## Development

Requires Node.js 20 or later.

```bash
pnpm install
pnpm dev-server     # https://localhost:3000 with the dev cert
npm start              # sideload manifest.xml into Outlook
```

Build, validate and lint:

```bash
pnpm build          # production webpack bundle into dist/
pnpm validate       # check manifest.xml against the Office Add-in schema
pnpm lint           # ESLint (flat config) + Prettier
```

CI on every PR runs the production build and the workspace test suite via the
root `Integration` workflow. Lint and `office-addin-manifest validate` are not
yet wired here — they ran in the standalone repo's `ci.yml`, which this app's
import deliberately left behind; B4 part two ports them (encryption4all/postguard-js#127).

## Releasing

Releases run from this workspace via `.github/workflows/outlook-addon.yml`, using
[changesets](https://github.com/changesets/changesets). The release-please flow this
section used to describe belonged to the standalone `encryption4all/postguard-outlook-addon`
repo, which is archived — there is no `master` branch and no `Release` workflow to run.

1. Add a changeset describing the change. It bumps `package.json` only, so
   `pnpm --filter postguard-outlook-addin sync-version` propagates the version into
   `manifest.xml`'s `<Version>`.
2. Merging the `Version Packages` PR lands the bumped version on `main`.
3. Pushing the app-scoped tag `outlook-addin-vX.Y.Z` builds and pushes the production
   Docker image to `ghcr.io/privacybydesign/postguard-outlook-addon:X.Y.Z`, and creates the
   GitHub Release carrying `manifest.xml` as a sideloadable asset.

The tag is `outlook-addin-v*`, never `vX.Y.Z`: this repo's tag namespace is shared with
`@e4a/pg-js`'s changesets releases and still holds the pre-monorepo `v2.3.3`-style pg-js
tags, so a bare `v*` would collide with another package's release.

Non-release pushes to `main` build a staging image tagged `:edge` (and `:sha-<commit>`)
hosted at `addin.staging.postguard.eu`.

Point any sideload or admin-center deployment at the `outlook-addin-v*` releases here. The
archived repo's `releases/latest/download/manifest.xml` still resolves and still serves
v0.5.0, and always will — an archived repo keeps serving its release assets.

## License

MIT
