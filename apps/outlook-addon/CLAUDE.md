# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PostGuard end-to-end email encryption as an Office Add-in for the new Outlook on Windows + macOS. It is a taskpane-only mail add-in (`<Host Name="Mailbox">`) that runs in both Compose and Read modes; encryption/decryption uses the `@e4a/pg-js` SDK with Yivi-based identity-based encryption (IBE). There is no backend in this repo — the PKG and Cryptify services are external.

## Commands

- `pnpm build` / `pnpm build:dev` — production / development webpack build into `dist/`.
- `pnpm watch` — webpack in watch mode.
- `pnpm dev-server` — webpack-dev-server on `https://localhost:3000` with the dev cert from `office-addin-dev-certs`.
- `npm start` — `office-addin-debugging start manifest.xml`. Sideloads the manifest and launches the configured Outlook host. Use `npm stop` to unload.
- `pnpm validate` / `pnpm validate:dist` — validates the source `manifest.xml` / the built `dist/manifest.xml` against the Office Add-in schema. Run `validate` after manifest edits, `validate:dist` after a build. CI and the release job use `validate:dist`, because the source still carries the `localhost:3000` URLs that webpack rewrites, so it is the built copy that admins actually sideload. Two things about it are easy to be caught by: it is a **network call** to Microsoft's acceptance-test service (an outage there fails the command with nothing wrong locally, so keep it off any step whose failure would leave something half-published), and it **rejects a `<Version>` below 1.0** with "Manifest Version Too Low", which is why this app is versioned from `1.0.0` instead of continuing the pre-monorepo `0.y.z` line.
- `pnpm lint` / `pnpm lint:fix` / `pnpm prettier` — `office-addin-lint` wrappers (ESLint + Prettier with the office-addins config).
- `pnpm signin` / `pnpm signout` — manage the M365 dev account used by the debugging tools.
- `npm test` — the `node:test` suites under `test/`. Needs Node >= 22.6 for `--experimental-strip-types`.

## Build-time configuration

Four URLs are baked into the bundle via webpack `DefinePlugin` (see `webpack.config.js`):

- `PKG_URL` — PostGuard Key Generation server.
- `CRYPTIFY_URL` — Cryptify file-share service.
- `POSTGUARD_WEBSITE_URL` — used by the SDK envelope for the browser fallback link.
- `ADDIN_PUBLIC_URL` — the add-in's own public origin (e.g. `https://addin.postguard.eu/`). Used by `launchevent.ts` to build the Yivi dialog URL; `window.location` is unreliable in the launchevent runtime on New Outlook for Mac. Webpack picks `urlDev` in dev mode and `urlProd` (overridable via this env var) otherwise.

These are read from `.env` (copy `.env.example`) or fall back to staging defaults. They are accessed through `src/lib/pkg-client.ts` — do not read `process.env` elsewhere.

The webpack config also rewrites `https://localhost:3000/` → `ADDIN_PUBLIC_URL` (default `https://addin.postguard.eu/`) inside `manifest.xml` when building in non-development mode, so the _same_ manifest is used for dev sideloading and production hosting.

That rewrite is the only gate on the shipped manifest's origins, so it asserts its own result in `scripts/rewrite-manifest-urls.mjs` and fails the build on a no-match (#257). Nothing downstream would catch one: `validate:dist` approves a `localhost` manifest (a localhost URL is valid HTTPS), `scopeAppDomains()`'s `missing` check passes because `manifest.xml` lists the production origin as its own `<AppDomain>` entry and then drops the unrewritten `localhost` one as unused, and the `Baked URLs resolve` job never reads `dist/manifest.xml`. Note `urlDev` hardcodes port 3000 while `devServer.port` reads `npm_package_config_dev_server_port`, so changing that config without changing `urlDev` is one way in. When editing a dev URL in `manifest.xml`, keep one spelling: the guard also refuses a manifest where some entry spells the dev origin differently (a bare origin with no trailing slash) and so escapes the replace.

## Architecture

### Entry points and bundles

Webpack builds three entries:

- `polyfill` — `core-js` + `regenerator-runtime`, prepended to both HTML pages.
- `taskpane` — `src/taskpane/taskpane.ts` plus the HTML template; this is where almost all UI logic lives.
- `commands` — `src/commands/commands.ts`. Required by the manifest's `<FunctionFile>` but currently a no-op. Every user action goes through the taskpane.

### Taskpane dispatch

`src/taskpane/taskpane.ts` is the single runtime entry. After `Office.onReady`, it inspects the item via `isComposeMode()` (which probes for `subject.setAsync` because compose items have no `itemId` until first save) and routes to either `mountComposeView()` or `mountReadView()`. All views are sibling `<section>`s inside `taskpane.html`; `showView(name)` toggles `hidden` on each. There is no router and no framework — everything is plain TS + `getElementById`.

### Compose flow (`compose-view.ts`)

State (`encrypt` toggle, per-recipient `Policy`, sender `signAttributes`) is held in a module-local `state` object. The "Encrypt & Send" button:

1. Refreshes recipients from Office.js (Outlook compose has no recipient-changed event, so we re-pull on every action).
2. Builds a MIME blob with `buildMime` from `@e4a/pg-js`, including all readable attachments (cloud attachments are skipped — Office.js cannot read their bytes).
3. Switches to the Yivi view, instantiates `PostGuard`, and calls `pg.encrypt({ sign: pg.sign.yivi(...), recipients, data })` mounting the Yivi widget at `#yivi-web-form`.
4. Calls `pg.email.createEnvelope(...)` which yields `{ subject, htmlBody, attachment }`. We `setSubject` / `setBody` on the draft, remove the original plaintext attachments, and add the encrypted blob as `postguard.encrypted`.

BCC is unsupported and the UI hard-blocks Encrypt & Send when BCC is present (the PostGuard envelope cannot represent BCC because all recipients are encrypted _to_ and visible to each other in the policy).

### Read flow (`read-view.ts`)

Two ciphertext sources are tried in order: a `postguard.encrypted` attachment, then an ASCII-armored block (`-----BEGIN POSTGUARD MESSAGE-----`) inside the HTML body (for forward compatibility with text-only emails). On Decrypt, `pg.open({ data }).decrypt({ element, recipient })` runs the Yivi disclosure flow and returns `{ plaintext, sender }`. Plaintext is rendered into a sandboxed iframe via `iframe.srcdoc`; sender attributes become badges.

Outlook does not allow an add-in to mutate the displayed message in read mode, so the decrypted view is _only_ visible inside the taskpane. A persistent `notificationMessages` banner is added to the message itself.

### `src/lib/` boundaries

- `office-helpers.ts` — promisified wrappers around the callback-based Office.js mailbox API. Anything touching `Office.context.mailbox.item` should go through here.
- `auth.ts` + `graph-client.ts` — Graph SSO via `OfficeRuntime.auth.getAccessToken({ forMSGraphAccess: true })`. **Currently dormant**: the manifest has no `<WebApplicationInfo>` block, so `getGraphToken` will reject and Graph-dependent features (sent-copy, in-place message replacement) are skipped. Wiring requires registering an Azure AD app and adding the manifest block.
- `mime.ts` — minimal MIME helpers, deliberately not a full RFC 5322 parser.
- `storage.ts` — `Office.context.roamingSettings` (~32KB JSON budget per mailbox).
- `pkg-client.ts` — exports the build-time URLs and a `clientHeaders()` helper that stamps `X-PostGuard-Client-Version`.
- `attributes.ts`, `i18n.ts`, `types.ts`, `encoding.ts` — data shapes and small utilities. `i18n.t()` is an inline lookup (no `browser.i18n` in Office Add-ins).

### WASM loading

`@e4a/pg-js` (≥ 0.10.0) inlines the `pg-wasm` binary as a base64 string at _its_ prebuild (see `postguard-js/scripts/generate-wasm-base64.mjs` and `src/util/wasm.ts`) and calls `init({ module_or_path: decodeBase64(WASM_BASE64) })` at runtime. There is no separate `index_bg.wasm` file to ship.

However, the wasm-bindgen-generated `__wbg_init` function inside the inlined shim _also_ contains a dead default-value branch — `if (module_or_path === undefined) module_or_path = new URL("index_bg.wasm", import.meta.url)` — that's never taken at runtime but webpack 5 statically analyzes and tries to resolve. We work around it in `webpack.config.js` with a `parser: { url: false }` rule scoped to `node_modules/@e4a/pg-js/`. Tracked upstream at [encryption4all/postguard#153](https://github.com/encryption4all/postguard/issues/153) and [encryption4all/postguard-js#30](https://github.com/encryption4all/postguard-js/issues/30); remove the rule once those ship.

Older `pg-js` releases (≤ ~0.9.x) used the `new URL("index_bg.wasm", ...)` lookup as the _real_ load path and required a postinstall hook to copy the wasm next to the bundle. That hook has been removed. If you ever pin to one of those older versions you'll need to restore it.

Webpack still has `experiments.asyncWebAssembly` + `syncWebAssembly` and a `\.wasm$` asset rule. They're harmless with the inlined-base64 SDK and would be needed again if the SDK ever switches back to URL-based loading.

## Conventions in this codebase

- TypeScript `strict: true`; `noEmitOnError: true`. Babel does the actual TS transform via `@babel/preset-typescript`.
- The `@e4a/pg-js` types are loose in places — the code uses `as never` casts at SDK boundaries deliberately. Don't try to "fix" these without verifying against the SDK source.
- `console`/global lint warnings are silenced by `office-addin-lint` defaults; keep error surfaces user-visible via `showError` / `setStatus` instead.

## Permission tier

The manifest requests `ReadWriteItem`, which is the highest tier any Office.js member reachable from `src/` needs (`Body.setAsync`, `removeAttachmentAsync`, `addFileAttachmentFromBase64Async`, `saveAsync`, `InternetHeaders.setAsync` / `removeAsync`). Don't widen it to `ReadWriteMailbox` for convenience: that tier can only be installed by an administrator, so it takes self-install away from individual users, and certification policy §1100.5 lets a reviewer reject an add-in for asking for more than it needs.

`test/manifest-permission.test.ts` guards both halves — the declared tier, and that no member needing the mailbox tier is reachable from `src/`. It derives the mailbox-tier member set from the `Minimum permission level` annotations in `@types/office-js` rather than a hand-written list, so it survives a types bump; it only uses names annotated at that tier and no lower one, because `subject`, `getAsync` and `removeAsync` exist at several tiers at once, and it then drops names that only exist on an object another set member hands you (`SelectedItemDetails.hasAttachment` and `.itemMode`, reachable only via `getSelectedItemsAsync`) — those add no reach and collide with ordinary locals. What survives is the five gates, and the test names them rather than counting the set: a count is satisfied by members that gate nothing, so it cannot notice the derivation going blind to EWS or send. It strips comments from `src/` before scanning, by walking the source rather than with a regex pair: a whole-file `/\/\*[\s\S]*?\*\//g` pairs a `/*` that opens inside a `//` comment with the next `*/` and deletes the real code between them, and stripping per line instead leaves the continuation lines of a JSDoc block standing. The first direction loses a real call, the second invents one. If a feature genuinely needs EWS, REST or `sendAsync`, widening the manifest is a deliberate change with a changeset, not a test edit — per #240 a changed permission freezes existing installations until an admin re-consents.

`apps/website/static/downloads/postguard-outlook-manifest.xml` is a mirror of the manifest attached to the last `outlook-addin-v*` release, written by `apps/website/scripts/sync-addons.mjs`. It will still show the old tier until a release ships; never hand-edit it.

## Outlook Add-in quirks

`docs/outlook-quirks.md` is a running log of platform behaviors that surprised us during development — Smart Alerts / launchevent dispatch oddities, cross-runtime state-sharing issues (`customProperties` vs `internetHeaders`), CSS interactions with `[hidden]`, debugging via `--devtools`, etc. Read it before debugging anything that "should work" but doesn't, and add to it whenever you discover a new surprise.

---

## Agent notes (migrated from the dobby memory repo)

### Overview

Outlook add-in (Office.js). Lives at `apps/outlook-addon` in the postguard-js monorepo; default branch `main`. Separate from `postguard-tb-addon` (MV3 WebExtension for Thunderbird). Release: changesets bumps the version from the monorepo root; pushing an `outlook-addin-v<version>` tag then publishes the image and attaches the sideloadable manifest.xml to the release. Never a bare `v*` tag — the namespace is shared with @e4a/pg-js.

### Build

- `npm install` works cleanly, no `--legacy-peer-deps` needed.
- `pnpm build` compiles; there's a pre-existing size-limit warning on the `taskpane.js` (~1.03 MiB) and `yivi-dialog.js` (~1 MiB) entrypoint bundles, which embed the bundled WASM (no standalone `.wasm` is emitted to `dist/`). Baseline, not a regression.
- The workspace lockfile at the repo root is the one that counts; this app has no package-lock.json.
- CI: `.github/workflows/outlook-addon.yml` runs lint, prettier, typecheck, a build and manifest validation for both the edge and production origin sets, unit tests, nginx validation, a no-push image build, and a check that every URL baked into the bundle resolves. The root `Integration` workflow additionally builds and tests this app as part of the workspace.
- The CI lint and prettier globs enumerate `scripts/**/*.mjs`, not `scripts/**/*.js`, so a build-time helper added there as `.js` is checked by the pre-commit hook and by nothing in CI. Write new `scripts/` modules as ESM `.mjs`. `webpack.config.js` is CommonJS and reaches one through `await import()` inside the async config factory, because `require()` of ESM needs node >=22.12 while the root `engines` only asks for >=22.

### Tests

Node's built-in test runner, zero extra deps: `npm test` runs `node --test --experimental-strip-types "test/**/*.test.ts"`. Tests live under `test/` and are covered by `tsc --noEmit`, and — since the CI globs were widened past `src/**` — by eslint and prettier as well, so a formatting slip in a test now fails `check`. Do NOT introduce Jest, the repo has already migrated a Jest-based test back to `node:test` + `node:assert/strict` once. Pattern file: `test/render-body.test.ts`.

Gotchas under `--experimental-strip-types`: imports of source modules must use the explicit `.ts` extension (`from "../src/lib/foo.ts"`), and type-only imports must use `import type { ... }`, a plain `import { SomeInterface }` makes Node try to resolve a non-existent runtime export and the whole file errors.

Those `.ts` import specifiers are why `tsconfig.json` sets `allowImportingTsExtensions` (and therefore `noEmit`, which the option requires). Nothing emits through `tsc` anyway, webpack + Babel do the build, so `outDir` / `sourceMap` / `noEmitOnError` are not set.

The suites import `node:test` / `node:assert/strict`, so `@types/node` is a declared devDependency and `node` is listed in the `types` compiler option. Both are needed: `types` is set explicitly, which switches off automatic inclusion of every `@types/*` package, so installing `@types/node` on its own does not put it in the program. Before `node` was added to that array the only thing pulling node types in was a `/// <reference types="node" />` deep inside the `office-addin-dev-certs` and `undici-types` declarations, reached through `webpack.config.js` (in the program via `allowJs`). That link would have broken on any unrelated dependency bump.

### Dependencies

- Webpack + `copy-webpack-plugin` + `webpack-dev-server`.
- `@privacybydesign/yivi-*`: stable `1.0.x` is current. Don't let automated bumps downgrade to `0.2.x`.
- `css-loader` and `style-loader` were removed from devDependencies in the v1 rewrite; they aren't used by the current `webpack.config.js`. Any PR reintroducing them is stale, drop those lines on merge.

### Dependency-scan overrides

Two recurring classes of transitive CVE need top-level overrides beyond direct bumps:

1. `webpack-dev-server` does not bump its own vulnerable transitives even when its own advisory is fixed. It still resolves vulnerable `http-proxy-middleware` and `launch-editor`. Override both to their advisory-clean versions.
2. The `office-addin-debugging` -> `office-addin-dev-settings` -> `@microsoft/m365agentstoolkit-cli` -> `@microsoft/teamsfx-core` chain drags in fresh CVEs as advisories publish (has included `form-data`, `hono` via `@modelcontextprotocol/sdk`, `tar`, `js-yaml` via both eslint and teamsfx).

On the next dep-scan run: run `npm audit`, then for each transitive finding check `npm ls <pkg>`; if it's under `webpack-dev-server` or the teamsfx chain, add a top-level override to the published advisory-clean version rather than trying to bump the direct dep. Always verify with `pnpm install --frozen-lockfile (from the repo root)` (not just `npm install`) before pushing, see the section below for why the lockfile can pass `npm install` but fail `pnpm install --frozen-lockfile (from the repo root)`.

Deferred majors (handle in their own PRs, don't fold into a dep-scan sweep): `babel-loader` 9 to 10, `webpack-cli` 5 to 7, `@e4a/pg-js` 1.x to 2.x (core crypto lib, needs Outlook+PKG+Yivi integration testing), `@babel/{core,preset-env,preset-typescript}` 7 to 8.

### applicationinsights / opentelemetry override shape

For the `office-addin-debugging` -> `applicationinsights` advisory chain (GHSA-q7rr-3cgh-j5r3): overriding `applicationinsights` alone is not enough, it pulls an `@opentelemetry/sdk-node` + `@opentelemetry/otlp-transformer` -> `protobufjs` chain that carries its own advisories. Once clean versions of the whole otel chain are published, pin the full set (`sdk-node` + all the otlp exporters/transformers + `protobufjs`) at the top level, and keep `applicationinsights` scoped/nested under `office-addin-usage-data`. Pinning fewer packages in the otel chain leaves the audit dirty, since the otel packages are mutually version-consistent.

Top-level vs scoped matters here: putting the otel/protobufjs overrides in the same nested scope as `applicationinsights` produces a `package-lock.json` that `npm install` accepts but `pnpm install --frozen-lockfile (from the repo root)` rejects as missing-from-lockfile. `applicationinsights` itself must stay scoped (an unscoped override would break the older `office-addin-usage-data@1.x` branch pinned via teamsfx, which needs an older `applicationinsights` range).

When this advisory chain reappears: confirm the leaf advisory-clean versions are actually published (`npm view <pkg> version`) before adding overrides, don't guess. Verify with `pnpm install --frozen-lockfile (from the repo root)` locally before pushing.

### TypeScript 6

- `moduleResolution` is `"bundler"` (fits the webpack + `module: "esnext"` setup). Don't revert to `"node"`, it's deprecated in TS 6.
- `skipLibCheck: true` is required, without it a transitive build-tooling type issue errors. Keep it on.
- `baseUrl` is intentionally absent, no `paths` mapping is configured.
- `eslint-plugin-office-addins` and `office-addin-lint` still declare an older `typescript` peer, so a nested older TypeScript copy survives under their `node_modules`. Harmless, lint works through that copy; don't try to dedupe.

### stringifyError helper

`src/lib/stringify-error.ts` is the canonical way to coerce an unknown thrown/rejected value into a human-readable string. Outlook for Mac's WKWebView (and `Office.AsyncResult.error`) surfaces some failures as plain `{code, name, message}` objects rather than `Error` instances; a bare `String(err)` collapses those to `"[object Object]"`.

Use `stringifyError(...)` in any Office.js callback where errors land as `unknown` (`displayDialogAsync`, `addEventHandler` message bodies, `messageParent` payloads, generic `catch (e)` in launchevent/dialog code). If the value is already known to be a string, keep the string fast-path and only run non-strings through `stringifyError`. Don't add a duplicate helper.

**Security constraint:** `stringifyError` must return only `err.message` for `Error` instances, and must NOT fold `err.stack` into the returned string, stack traces must not leak into the Smart Alert dialog / taskpane UI (internal file paths, SDK internals). Log the stack via `console.error` for diagnostics instead. Anywhere an error string reaches the UI, prefer a generic localized message and keep the raw detail in logs only.

### X-POSTGUARD-CLIENT-VERSION header

Format: `Outlook,<host-ver>,pg4ol,<ext-ver>`. The PKG's metrics middleware keys its Prometheus counter on the third comma-separated field. Org convention: `pg4tb` for Thunderbird, `pg4ol` for Outlook. Any future client rewrite must preserve these exact tokens or dashboards lose continuity.

### Testing nginx config without Docker

The runtime image is `nginx:1.30-alpine`; `nginx/default.conf` is copied to `/etc/nginx/conf.d/default.conf`, so it's included inside `http{}` (which is why top-level `map` directives are valid there). When Docker isn't available (no daemon, rootless docker blocked, no `apt`), you can still exercise the config:

1. Build nginx from source to a user prefix, dropping modules that need PCRE/zlib dev headers (`--without-http_rewrite_module --without-http_gzip_module --without-http_upstream_zone_module`).
2. Caveat: those `--without-*` flags drop the `return` directive and regex-map matching, so `nginx -t` on the verbatim config fails on those lines. That's a build limitation, not a config bug: wrap only the parts under test (exact-match maps + `add_header` need neither module) in a minimal `http{}` config and drive it with curl.
3. Point `listen`/`root` at a temp dir with a dummy HTML file, set `*_temp_path` under a writable dir, then `curl -D -` with different `Origin:` headers.

Verified fact: nginx's `add_header X $var always;` omits the header entirely when `$var` resolves to empty (a non-allowlisted origin gets no `Access-Control-Allow-Origin`; an allowlisted origin gets it echoed back). This is the mechanism behind the map-based CORS allowlist pattern here.

## Baked URLs

webpack's DefinePlugin bakes `PKG_URL`, `CRYPTIFY_URL` and `POSTGUARD_WEBSITE_URL`
into the bundle, and production mode refuses the staging fallbacks rather than
silently shipping them. Cryptify is **`storage.postguard.eu`**, not
`fileshare.*` — the latter no longer resolves, and shipping it broke file sending
for every Outlook user (encryption4all/postguard-outlook-addon#132). The `Baked URLs resolve` CI job
asserts that every host reachable by the build resolves — the workflow's own env
plus **every** `https://` host hardcoded in `Dockerfile` and `webpack.config.js`,
since #132 was a wrong Dockerfile `ARG`. Not scoped to `*.postguard.eu`: that
pattern needs a subdomain label, so it missed the bare-apex defaults
(`https://postguard.eu`) and `yivi.app`, which the manifest transform refuses to
build without. It is a DNS check, not a reachability check: a host that resolves
but serves nothing still passes.
