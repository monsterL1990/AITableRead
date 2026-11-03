#!/bin/sh
# Local `npm run dev` / `npm run start` bind 127.0.0.1 unless WEIDU_HOST is set.
# Inside a container that published port must be reachable from outside the
# network namespace, so this entrypoint overrides the listen address on purpose.
# Docker also injects HOSTNAME as the container id. Next standalone would then
# listen only on that name, and the published port would not connect.
set -eu
mkdir -p /app/data 2>/dev/null || true
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
exec node server.js
