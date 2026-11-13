# Multi-stage build: compile SvelteKit frontend, build Brotli modules,
# then assemble the final Nginx image with envsubst template support.

ARG NGINX_VERSION=1.30.2

# ============================================================
# Stage 1 — Build SvelteKit frontend
# ============================================================
# Build context is the REPO ROOT, not apps/website: the site depends on
# @e4a/pg-js as `workspace:*`, so the SDK has to be installed and built here
# rather than fetched from npm.
#
# Runs on the build platform, not the target: the output is static files, the
# same for every architecture, so the arm64 image does not need an emulated
# Node build.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend
RUN corepack enable
WORKDIR /repo

# Manifests first so a source-only change reuses the install layer. Scripts are
# skipped at install time because pg-js's `prepare` builds it, and its sources
# are not in the image yet.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/pg-js/package.json packages/pg-js/
COPY apps/website/package.json apps/website/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/pg-js/ packages/pg-js/
COPY apps/website/ apps/website/

# pg-js first: the website imports it through the workspace symlink, so its
# dist/ must exist. Its prebuild step runs the wasm/css/version generators.
RUN pnpm --filter @e4a/pg-js build \
 && pnpm --filter postguard-website exec svelte-kit sync \
 && pnpm --filter postguard-website build

# ============================================================
# Stage 2 — Build brotli dynamic modules
# ============================================================
# Same Debian release as the nginx image below, so the modules are built
# against the libraries they are loaded next to.
FROM debian:trixie-slim AS builder

ARG NGINX_VERSION
ARG NGX_BROTLI_COMMIT=a71f9312c2deb28875acc7bacfdd5695a111aa53

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libpcre2-dev libssl-dev zlib1g-dev wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Clone ngx_brotli and build its brotli C library
WORKDIR /usr/local/src
RUN git clone https://github.com/google/ngx_brotli.git \
  && cd ngx_brotli \
  && git checkout ${NGX_BROTLI_COMMIT} \
  && git submodule update --init --recursive

WORKDIR /usr/local/src/ngx_brotli/deps/brotli
RUN cmake -B out -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  && cmake --build out --config Release --target brotlienc -j$(nproc)

# Download nginx source and build only the brotli dynamic modules
WORKDIR /usr/local/src
RUN wget -q http://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz \
  && tar -xzf nginx-${NGINX_VERSION}.tar.gz

WORKDIR /usr/local/src/nginx-${NGINX_VERSION}
RUN ./configure --with-compat --add-dynamic-module=/usr/local/src/ngx_brotli \
  && make modules -j$(nproc)

RUN mkdir -p /tmp/modules \
  && cp objs/ngx_http_brotli_filter_module.so /tmp/modules/ \
  && cp objs/ngx_http_brotli_static_module.so /tmp/modules/

# ============================================================
# Stage 2 — Runtime
# ============================================================
FROM nginx:${NGINX_VERSION}

# Take the security updates published since the base image was built. The
# shared publish workflow scans the image and refuses one with a fixable
# critical vulnerability.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Install brotli modules
COPY --from=builder /tmp/modules/ngx_http_brotli_filter_module.so /usr/lib/nginx/modules/
COPY --from=builder /tmp/modules/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/

# Remove default nginx site config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx base config (global settings + brotli)
COPY apps/website/docker/nginx.conf /etc/nginx/nginx.conf

# Copy nginx server template (envsubst processes this at startup)
COPY apps/website/docker/default.conf.template /etc/nginx/templates/default.conf.template

# Copy entrypoint script for SPA env var replacement
COPY apps/website/docker/entrypoint.sh /docker-entrypoint.d/40-substitute-env-vars.sh
RUN chmod +x /docker-entrypoint.d/40-substitute-env-vars.sh

# Bundle the addon-sync script + a Node binary so the running container can
# self-refresh PostGuard addon downloads (see /docker-entrypoint.d/50-…).
# We pull the binary from node:24-slim. It is built for Debian bookworm and
# runs on the nginx image's trixie without an apt install.
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
COPY apps/website/scripts/sync-addons.mjs /opt/sync-addons/sync-addons.mjs
COPY apps/website/docker/sync-addons-loop.sh /docker-entrypoint.d/50-sync-addons.sh
RUN chmod +x /docker-entrypoint.d/50-sync-addons.sh

# Copy frontend built in Stage 1
COPY --from=frontend /repo/apps/website/build /usr/share/nginx/html/postguard

EXPOSE 80
