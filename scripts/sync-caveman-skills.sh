#!/usr/bin/env bash
# Sync the vendored Caveman skills (whitelist) from an upstream checkout.
#
# Only the whitelisted skills below are vendored into this preset. Unlike
# Superpowers (which owns the whole skills tree), Caveman is a partial vendee:
# a full `rm -rf preset/skills` would delete the 14 Superpowers skills. Sync
# therefore overwrites exactly the whitelisted directories and nothing else.
#
# Usage: scripts/sync-caveman-skills.sh <path-to-caveman-checkout>
set -euo pipefail

UPSTREAM="${1:?usage: sync-caveman-skills.sh <path-to-caveman-checkout>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"

CAVEMAN_IDS=(caveman caveman-commit caveman-review)

[ -d "$UPSTREAM/skills" ] || { echo "not a caveman checkout: $UPSTREAM" >&2; exit 1; }

echo "syncing ${#CAVEMAN_IDS[@]} caveman skills from $UPSTREAM"
for id in "${CAVEMAN_IDS[@]}"; do
  [ -f "$UPSTREAM/skills/$id/SKILL.md" ] || { echo "missing upstream skill: $id" >&2; exit 1; }
  rm -rf "$PRESET/skills/$id"
  cp -R "$UPSTREAM/skills/$id" "$PRESET/skills/"
done

# Keep the per-file content stamp in sync with this sync; this also runs the
# new caveman presence assertions (Task 1) and fails loudly on drift.
bash "$ROOT/scripts/build-bootstrap.sh" >/dev/null

echo "caveman skills: ${#CAVEMAN_IDS[@]} synced -> $PRESET/skills/{${CAVEMAN_IDS[*]}}"