#!/usr/bin/env bash
# preview.sh — same-stack UI preview: run dev server + print openable URL.
set -euo pipefail
cd "$(dirname "$0")"

if   [ -f pnpm-lock.yaml ]; then PM=pnpm
elif [ -f yarn.lock ];      then PM=yarn
else                             PM=npm; fi

if [ ! -d node_modules ]; then
  echo "[preview] installing dependencies with $PM install ..." >&2
  $PM install >&2
fi

if [ -z "${PORT:-}" ]; then
  PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})')"
fi
export PORT

echo "PREVIEW_URL=http://localhost:${PORT}/"
echo "[preview] dev server on ${PORT}; Ctrl-C to stop" >&2

exec $PM run dev -- --port "$PORT" --strictPort --host 127.0.0.1
