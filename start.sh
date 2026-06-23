#!/usr/bin/env bash
# Launcher Cipher — forteaza Node 20 (Expo SDK 52 nu merge pe Node 26 de sistem:
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Node 20 e in ~/.local/node20.
set -e
export PATH="$HOME/.local/node20/bin:$PATH"
cd "$(dirname "$0")"
echo "Node $(node --version) · pornesc Metro..."
exec npx expo start "$@"
