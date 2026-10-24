#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

: "${CAPTURE_URL:?Set CAPTURE_URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR.}"

exec /usr/bin/time -p node ./capture.mjs
