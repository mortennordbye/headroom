# syntax=docker/dockerfile:1

# Stage 1: build frontend
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS frontend-build
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
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
WORKDIR /app
# su-exec lets the entrypoint drop from root to `node` after fixing volume perms.
RUN apk add --no-cache su-exec
COPY server/package*.json ./
# better-sqlite3 compiles a native addon; install the toolchain only for the
# duration of `npm ci`, then drop it so it doesn't bloat the image or widen the
# attack surface (the compiled .node binary persists).
RUN --mount=type=cache,target=/root/.npm \
    apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps
COPY server/index.js ./
COPY server/auth.js ./
COPY server/seed.js ./
COPY server/ssb.js ./
COPY server/boligPrices.js ./
COPY server/wageStats.js ./
COPY server/norgesBank.js ./
COPY server/postnummer.js ./
# postnummer.js reads ./data/postnummer.tsv relative to its own dir (/app).
COPY server/data ./data
COPY server/bank.js ./
COPY server/backup.js ./
COPY server/bankSync.js ./
COPY server/docker-entrypoint.sh ./
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
