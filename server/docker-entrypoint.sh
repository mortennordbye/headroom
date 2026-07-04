#!/bin/sh
set -e

# The /data volume may pre-date the switch to a non-root runtime (older images
# ran as root, so the volume and its database.sqlite are root-owned). Fix the
# ownership while we still have root, then drop to the unprivileged `node` user
# to run the app — so any RCE in the Node stack lands as `node`, not root.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data 2>/dev/null || true
  exec su-exec node:node "$@"
fi

exec "$@"
