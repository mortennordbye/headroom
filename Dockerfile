# syntax=docker/dockerfile:1

# Node 24 "Krypton" is the active LTS line (security-supported into 2028). Both
# stages share one base so a build pulls a single image and Dependabot has a
# single digest to keep fresh. Dependabot is pinned off Docker major bumps
# (.github/dependabot.yml) so this can't drift onto a non-LTS release.
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base

# Stage 1: build frontend
FROM base AS frontend-build
WORKDIR /app
COPY package*.json ./
# Cache-mount the npm download dir so a rebuild (or a lockfile change) reuses
# already-fetched tarballs instead of re-downloading them.
RUN --mount=type=cache,target=/root/.npm npm ci
# Copy ONLY the frontend build inputs (not `.`), so editing server/, mcp/ or docs
# doesn't invalidate this layer and force a full `npm run build` every time. The
# build reads src/, public/, index.html, the tsconfigs and the vite config.
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# Stage 2: production
FROM base
WORKDIR /app
# su-exec lets the entrypoint drop from root to `node` after fixing volume perms.
RUN apk add --no-cache su-exec
COPY server/package*.json ./
# better-sqlite3 >=13 ships prebuilt musl binaries for both arches we build, so
# `--ignore-scripts` skips the node-gyp rebuild npm would otherwise trigger for
# any package with a binding.gyp. That drops the python3/make/g++ toolchain layer
# entirely — faster builds, smaller attack surface. None of the four runtime
# dependencies needs an install script for anything else.
#
# The prune then drops what only a from-source build would have needed: the other
# seven platforms' prebuilt binaries and the bundled SQLite amalgamation, about
# 24 MB that nothing can reach at runtime.
#
# The trade-off in both is that a mistake would surface at runtime rather than at
# build time, so the last step loads the addon: if the prebuild is missing or the
# prune took too much, the build breaks loudly right here.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
  && keep="$(node -p "require('node:path').basename(require('/app/node_modules/better-sqlite3/lib/binding').getPrebuildPath())")" \
  && find node_modules/better-sqlite3/prebuilds -name '*.node' ! -name "$keep" -delete \
  && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
  && node -e "require('better-sqlite3')"
# Wildcard rather than a file-per-line list, so adding a server module doesn't
# silently ship an image missing it. `*.js` can't match server/node_modules (the
# glob doesn't cross `/`) and .dockerignore keeps *.test.js out of the context.
COPY server/*.js server/docker-entrypoint.sh ./
# postnummer.js reads ./data/postnummer.tsv relative to its own dir (/app).
COPY server/data ./data
COPY --from=frontend-build /app/dist ./dist
RUN chmod +x docker-entrypoint.sh && mkdir -p /data && chown -R node:node /app /data
ENV DATA_DIR=/data
# Commit SHA baked at build time (CI passes --build-arg BUILD_SHA=<sha>); surfaced
# via /api/version. Defaults to 'dev' for local `docker build` without the arg.
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
EXPOSE 3001
# The entrypoint fixes /data ownership (root → node) then execs the app as the
# non-root `node` user. It is the only code that runs as root, briefly, at start.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "index.js"]
