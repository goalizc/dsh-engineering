#!/usr/bin/env bash
# Sync the vendored Caveman skills (whitelist) from a self-managed cache.
#
# Only the whitelisted skills below are vendored into this preset. Unlike
# Superpowers (which owns the whole skills tree), Caveman is a partial vendee:
# a full `rm -rf preset/skills` would delete the 14 Superpowers skills. Sync
# therefore overwrites exactly the whitelisted directories and nothing else.
#
# Usage: scripts/sync-caveman-skills.sh
#   CACHE_ROOT overrides where the upstream cache lives (default: <repo>/.cache)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"
CACHE_ROOT="${CACHE_ROOT:-$ROOT/.cache}"
UPSTREAM="$CACHE_ROOT/caveman"
REPO_URL="https://github.com/JuliusBrussee/caveman.git"
PIN="15581d14007fd01fb3f132016741962f34936ca2"

CAVEMAN_IDS=(caveman caveman-commit caveman-review)

if [ ! -d "$UPSTREAM/.git" ]; then
  mkdir -p "$CACHE_ROOT"
  git clone --filter=blob:none "$REPO_URL" "$UPSTREAM"
fi
git -C "$UPSTREAM" fetch --tags --quiet origin
git -C "$UPSTREAM" checkout --quiet "$PIN"

[ -d "$UPSTREAM/skills" ] || { echo "not a caveman checkout: $UPSTREAM" >&2; exit 1; }

# shellcheck source=scripts/sync-lib.sh
. "$ROOT/scripts/sync-lib.sh"

echo "syncing ${#CAVEMAN_IDS[@]} caveman skills from $UPSTREAM at $PIN"
for id in "${CAVEMAN_IDS[@]}"; do
  [ -f "$UPSTREAM/skills/$id/SKILL.md" ] || { echo "missing upstream skill: $id" >&2; exit 1; }
  rm -rf "$PRESET/skills/$id"
  cp -R "$UPSTREAM/skills/$id" "$PRESET/skills/"
done

# Caveman gets its own provenance block; do not clobber the Superpowers one.
write_sync_section "Caveman" "$UPSTREAM" "$REPO_URL"

# Keep the per-file content stamp in sync; this also runs the caveman presence
# assertions in build-bootstrap.sh and fails loudly on drift.
bash "$ROOT/scripts/build-bootstrap.sh" >/dev/null

echo "caveman skills: ${#CAVEMAN_IDS[@]} synced -> $PRESET/skills/{${CAVEMAN_IDS[*]}}"
