#!/usr/bin/env bash
# Render the master. The Chromium flags are this container's, not Remotion's
# defaults: it ships no browser here (the download host is off the allowlist)
# and the bundled one needs the newer headless mode.
set -euo pipefail
exec npx remotion "$@" \
  --chrome-mode=chrome-for-testing \
  --browser-executable="${CHROMIUM_PATH:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}" \
  --enable-multiprocess-on-linux
