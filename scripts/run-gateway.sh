#!/usr/bin/env bash
# run-gateway.sh — set up and start your own Blink ↔ Reticulum gateway.
#
# The gateway carries only opaque libsignal envelopes; it never sees message content. Running your
# own means the experimental Reticulum transport routes through a machine you control instead of
# someone else's. See GATEWAY.md for the full guide.
#
# Usage:
#   scripts/run-gateway.sh            # first run creates a venv, installs deps, then starts
#   GW_PORT=8090 scripts/run-gateway.sh
#
# Config via environment (all optional):
#   GW_PORT           HTTP port, bound to 127.0.0.1 (default 8090)
#   GW_STORE          state dir: identities + inbox tokens (default ~/.blink-gateway)
#   GW_RNS_CONFIGDIR  Reticulum config dir (default: the shared RNS instance)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GW_DIR="$(cd "$HERE/../gateway" && pwd)"
VENV="${GW_VENV:-$HOME/.blink-gateway/venv}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 not found — install Python 3.9+ first." >&2; exit 1
fi

# One-time setup: virtualenv + pinned dependencies.
if [ ! -x "$VENV/bin/python" ]; then
  echo "▶ creating virtualenv at $VENV …"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  echo "▶ installing dependencies (rns, lxmf, cryptography) …"
  "$VENV/bin/pip" install --quiet -r "$GW_DIR/requirements.txt"
fi

echo "▶ starting gateway on 127.0.0.1:${GW_PORT:-8090} (state in ${GW_STORE:-$HOME/.blink-gateway})"
echo "  health check:  curl -s http://127.0.0.1:${GW_PORT:-8090}/health"
echo "  stop:          Ctrl-C"
echo
cd "$GW_DIR"
exec "$VENV/bin/python" -u gateway.py
