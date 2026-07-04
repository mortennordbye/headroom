#!/bin/sh
set -e

# DATA_DIR must be writable by the runtime user — SQLite fails hard (CANTOPEN)
# otherwise. Ensure it exists first (harmless if the volume already has it).
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  # Running as root: the /data volume may be root-owned (older images ran as
  # root) or a bind mount. Fix ownership, then drop to the unprivileged `node`
  # user — but ONLY if `node` can actually write there. On some hosts (certain
  # bind mounts, userns-remap, rootless) the chown can't take effect; in that
  # case stay root so the app still runs instead of crashing with CANTOPEN.
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  if su-exec node:node sh -c "test -w \"$DATA_DIR\""; then
    exec su-exec node:node "$@"
  fi
  echo "[entrypoint] WARN: '$DATA_DIR' not writable by user 'node' after chown; running as root." >&2
  exec "$@"
fi

# Started as a non-root user (e.g. compose 'user:' or rootless). We can't chown;
# just warn clearly if the volume isn't writable, then hand off.
if [ ! -w "$DATA_DIR" ]; then
  echo "[entrypoint] ERROR: '$DATA_DIR' is not writable by uid $(id -u). Fix the volume ownership (chown it to this uid) or run the container as root." >&2
fi
exec "$@"
