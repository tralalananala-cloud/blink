#!/usr/bin/env bash
# Faza 1.6 — poarta „SAFE TO BUILD".
# Verde la capăt = type-check + teste + build-ul web compilează curat. Roșu = NU construi APK.
# Rulează ce a fi gata înainte de orice release. Forțează Node 20 (Expo SDK 52 crapă pe Node 26).
set -euo pipefail

export PATH="$HOME/.local/node20/bin:$PATH"
cd "$(dirname "$0")/.."

node_ver="$(node --version)"
case "$node_ver" in
  v20.*) ;;
  *) echo "✗ Node $node_ver — necesar Node 20 (~/.local/node20). Oprire."; exit 1 ;;
esac
echo "▶ Node $node_ver"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

step "1/3 tsc --noEmit (type-check)"
npx tsc --noEmit

step "2/3 jest (teste)"
npx jest --ci

step "3/3 expo export --platform web (build compilează?)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
npx expo export --platform web --output-dir "$out" >/dev/null
test -f "$out/index.html" || { echo "✗ export fără index.html"; exit 1; }
echo "  export OK ($(du -sh "$out" | cut -f1))"

printf '\n\033[1;32m✅ SAFE TO BUILD\033[0m — tsc + jest + expo export web verzi.\n'
