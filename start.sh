#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$PWD"
PORT="${PORT:-3000}"
WEB_DIR="${OPENCODE_WEB_DIR:-$ROOT/.omgithub-runtime}"
DIST="$ROOT/dist"

run() {
  /usr/bin/time -p "$@"
}

run mkdir -p "$WEB_DIR"

if [[ -f package.json ]]; then
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      run npm ci --no-audit --no-fund
    else
      run npm install --no-audit --no-fund
    fi
  fi
  if node -e 'const p=require("./package.json");process.exit(p.scripts&&p.scripts.build?0:1)' 2>/dev/null; then
    run npm run build
  fi
  if [[ -f "$DIST/index.html" ]]; then
    BUILD_DIR="$DIST"
  elif [[ -f "$ROOT/build/index.html" ]]; then
    BUILD_DIR="$ROOT/build"
  elif [[ -f "$ROOT/index.html" ]]; then
    BUILD_DIR="$ROOT"
  else
    echo "No static build output found (expected dist/index.html)." >&2
    exit 1
  fi
else
  BUILD_DIR="$DIST"
  run rm -rf "$BUILD_DIR"
  run mkdir -p "$BUILD_DIR"
  if [[ -d site ]]; then
    run cp -R site/. "$BUILD_DIR"/
  elif [[ -f index.html ]]; then
    run cp -R ./*.html ./*.css ./*.js ./*.svg ./*.png ./*.jpg ./*.webp "$BUILD_DIR"/ 2>/dev/null || true
  else
    echo "No site/ directory or index.html found to build." >&2
    exit 1
  fi
fi

if [[ ! -f "$BUILD_DIR/index.html" ]]; then
  echo "Static directory $BUILD_DIR does not contain index.html." >&2
  exit 1
fi

run node -e '
const fs = require("node:fs")
const path = require("node:path")
const [web, project, directory] = process.argv.slice(1)
fs.mkdirSync(web, { recursive: true })
fs.writeFileSync(path.join(web, "deployment-output.json"), JSON.stringify({
  project: path.resolve(project),
  directory: path.resolve(directory)
}))
' "$WEB_DIR" "$ROOT" "$BUILD_DIR"

echo "Starting static server on port $PORT from $BUILD_DIR"
exec /usr/bin/time -p node "$ROOT/server.mjs" "$BUILD_DIR" "$PORT"
