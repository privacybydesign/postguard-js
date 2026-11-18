# Build context is the REPO ROOT, not apps/outlook-addon: the add-in depends on
# @e4a/pg-js as `workspace:*`, so the whole workspace has to be installed for
# that link to resolve.
## Build stage ##############################################################
FROM node:25-alpine AS build

WORKDIR /repo

RUN corepack enable

# Manifests first so a source-only change reuses the install layer. Scripts are
# skipped because pg-js's `prepare` builds it and its sources are not here yet.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/pg-js/package.json packages/pg-js/
COPY apps/outlook-addon/package.json apps/outlook-addon/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/pg-js/ packages/pg-js/
COPY apps/outlook-addon/ apps/outlook-addon/

# Build-time configuration baked into the bundle and manifest.
#
# Declared here rather than at the top of the stage: a build arg participates in
# the cache key of every instruction after the ARG that declares it, so with
# these above `pnpm install` the edge and tag builds — which differ only in
# these four values — could never share the install layer, the one layer
# `cache-from: type=gha` most wants to hit.
ARG ADDIN_PUBLIC_URL=https://addin.postguard.eu/
ARG PKG_URL=https://postguard.eu/pkg
ARG CRYPTIFY_URL=https://storage.postguard.eu
ARG POSTGUARD_WEBSITE_URL=https://postguard.eu

ENV ADDIN_PUBLIC_URL=${ADDIN_PUBLIC_URL} \
    PKG_URL=${PKG_URL} \
    CRYPTIFY_URL=${CRYPTIFY_URL} \
    POSTGUARD_WEBSITE_URL=${POSTGUARD_WEBSITE_URL}

# pg-js first: the add-in imports it through the workspace link, so its dist/
# must exist. webpack refuses the staging fallbacks in production mode, so the
# four ARGs above are load-bearing rather than decorative.
#
# `build` rather than `exec webpack --mode production`: the same command, but the
# package's own script is then the single definition, so the image cannot drift
# from what CI and the release job build.
RUN pnpm --filter @e4a/pg-js build \
 && pnpm --filter postguard-outlook-addin build

## Runtime stage ############################################################
FROM nginx:1.30-alpine AS runtime

# Take the security updates published since the base image was built. The
# shared publish workflow scans the image and refuses one with a fixable
# critical vulnerability.
RUN apk upgrade --no-cache

COPY apps/outlook-addon/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/outlook-addon/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
