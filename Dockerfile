# Stage 1: build frontend
FROM node:22-slim AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production
FROM node:22-alpine
WORKDIR /app
# su-exec lets the entrypoint drop from root to `node` after fixing volume perms.
RUN apk add --no-cache su-exec
COPY server/package*.json ./
# better-sqlite3 compiles a native addon; install the toolchain only for the
# duration of `npm ci`, then drop it so it doesn't bloat the image or widen the
# attack surface (the compiled .node binary persists).
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev \
  && apk del .build-deps
COPY server/index.js ./
COPY server/seed.js ./
COPY server/ssb.js ./
COPY server/bank.js ./
COPY server/backup.js ./
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
