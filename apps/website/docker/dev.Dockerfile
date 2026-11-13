# Dev image for `docker compose up`. Build context is the REPO ROOT, not
# apps/website: the site depends on @e4a/pg-js as `workspace:*`, so the whole
# workspace has to be installed for that link to resolve (same reason as
# docker/Dockerfile).
FROM node:25-alpine

RUN corepack enable
WORKDIR /repo

# Manifests first so a source-only change reuses the install layer. Scripts are
# skipped here: pg-js's `prepare` builds it, and compose bind-mounts the host
# tree over /repo at runtime, so anything built now would be shadowed anyway.
# The build happens in CMD instead, against the mounted sources.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/pg-js/package.json packages/pg-js/
COPY apps/website/package.json apps/website/
RUN pnpm install --frozen-lockfile --ignore-scripts

# pg-js is built at start, not baked in, for two reasons: `packages/pg-js/dist`
# is gitignored so a fresh clone has none, and the bind mount would shadow an
# image-built copy regardless. Without it the dev server boots and `/` is 200,
# but the site's `@e4a/pg-js` import 500s — the package resolves through
# `exports: {".": "./dist/index.mjs"}`, which does not exist yet.
#
# No `--` before `--host`: pnpm forwards the separator verbatim, vite reads it
# as end-of-options, and the flag is silently dropped — leaving vite on
# 127.0.0.1 inside the container and nginx's proxy_pass getting refused.
EXPOSE 5173
CMD ["sh", "-c", "pnpm --filter @e4a/pg-js build && pnpm --filter postguard-website dev --host"]
