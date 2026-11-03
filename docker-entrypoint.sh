#!/bin/sh
# Docker injects HOSTNAME as the container id. Next standalone would then
# listen only on that interface, so other containers (Caddy) could not connect.
set -eu
mkdir -p /app/data 2>/dev/null || true
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
exec node server.js
