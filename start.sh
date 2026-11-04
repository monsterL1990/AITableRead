#!/usr/bin/env bash
# WeiDu local launcher. Same steps as start.bat / start.ps1 on Windows.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js LTS is not installed, so WeiDu cannot start."
  echo "Install Node.js LTS (20.9 or newer; 22, 24, or 26) from https://nodejs.org/"
  echo "Then run ./start.sh again."
  exit 1
fi

node scripts/check-node.mjs

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Reinstall Node.js LTS from https://nodejs.org/ so npm is included."
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo ".env is missing and .env.example is not in this folder, so WeiDu cannot create one."
    exit 1
  fi
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "Empty OPENAI_BASE_URL and OPENAI_API_KEY are fine. The page will ask you to configure an API."
  echo "No login on this machine. Set WEIDU_AUTH=on in .env only if you want APP_PASSWORD."
fi

need_install=0
if [[ ! -f node_modules/next/package.json ]]; then
  need_install=1
fi
if [[ -f package-lock.json ]]; then
  if [[ ! -f node_modules/.package-lock.json ]]; then
    need_install=1
  elif [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
    need_install=1
  fi
fi
if [[ "$need_install" -eq 1 ]]; then
  echo "Installing dependencies (npm install)..."
  npm install
fi

url="$(node --input-type=module -e "import { readListenTarget } from './scripts/listen.mjs'; const t = readListenTarget(process.cwd()); process.stdout.write(t.url);")"
echo "Starting WeiDu at ${url}"
echo "Leave this window open. Press Ctrl+C to stop WeiDu."

hostport="${url#http://}"
host="${hostport%%:*}"
port="${hostport##*:}"
host="${host#[}"
host="${host%]}"

set -m
node scripts/serve.mjs dev &
server_pid=$!

cleanup() {
  if kill -0 "$server_pid" >/dev/null 2>&1; then
    kill -- -"$server_pid" >/dev/null 2>&1 || kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "${WEIDU_NO_BROWSER:-}" != "1" ]]; then
  (
    ready=0
    for _ in $(seq 1 180); do
      if ! kill -0 "$server_pid" >/dev/null 2>&1; then
        echo "WeiDu did not start. See the log above."
        exit 1
      fi
      if node -e 'const net = require("net"); const host = process.argv[1]; const port = Number(process.argv[2]); const socket = net.connect(port, host, () => { socket.end(); process.exit(0); }); socket.on("error", () => process.exit(1));' "$host" "$port"; then
        ready=1
        break
      fi
      sleep 1
    done
    if [[ "$ready" -ne 1 ]]; then
      echo "WeiDu did not open ${url}. Check the log above."
      exit 1
    fi
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$url" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
      open "$url" >/dev/null 2>&1 || true
    else
      echo "Open ${url} in your browser."
    fi
  ) &
fi

wait "$server_pid"
