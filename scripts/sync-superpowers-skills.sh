#!/usr/bin/env bash
# Sync the vendored Superpowers skills from an upstream checkout.
#
# Superpowers skills are the upstream source of truth and are reused verbatim;
# this repository never edits a skill body. The only exception is the pointer
# line in `using-superpowers/SKILL.md`'s "Platform Adaptation" section that
# names this harness's tool-mapping reference — the one edit the upstream
# porting guide sanctions. It is re-applied here after every sync.
#
# Usage: scripts/sync-superpowers-skills.sh <path-to-superpowers-checkout>
set -euo pipefail

UPSTREAM="${1:?usage: sync-superpowers-skills.sh <path-to-superpowers-checkout>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"

[ -d "$UPSTREAM/skills" ] || { echo "not a superpowers checkout: $UPSTREAM" >&2; exit 1; }

echo "syncing skills from $UPSTREAM"
rm -rf "$PRESET/skills"
mkdir -p "$PRESET/skills"
cp -R "$UPSTREAM/skills/." "$PRESET/skills/"

# Re-apply the sanctioned Platform Adaptation pointer.
SKILL="$PRESET/skills/using-superpowers/SKILL.md"
if ! grep -q 'references/dsh-tools.md' "$SKILL"; then
  printf '%s\n' '- DeepSeek Harness: `references/dsh-tools.md`' >> "$SKILL"
fi

# The full-directory replace above deletes repo-local files under skills/;
# upstream never carries this harness's tool mapping, so restore it from the
# repo (tracked) when the copy did not bring it back.
TOOLS_REL="preset/skills/using-superpowers/references/dsh-tools.md"
if [ ! -f "$ROOT/$TOOLS_REL" ] && git -C "$ROOT" rev-parse --verify --quiet "HEAD:$TOOLS_REL" >/dev/null; then
  git -C "$ROOT" restore -- "$TOOLS_REL"
  echo "restored $ROOT/$TOOLS_REL (repo-local tool mapping)"
fi

{
  echo "# 上游同步记录"
  echo
  echo "- 上游仓库: $(git -C "$UPSTREAM" remote get-url origin 2>/dev/null || echo unknown)"
  echo "- 本地检出: $UPSTREAM"
  git -C "$UPSTREAM" log -1 --format='- commit: %H%n- date: %ad%n- subject: %s' --date=short
  grep -m1 '"version"' "$UPSTREAM/package.json" | sed 's/^ */- package.json version: /'
  echo "- 同步时间: $(date -Iseconds)"
} > "$PRESET/SYNC.md"

echo "skills: $(find "$PRESET/skills" -name SKILL.md | wc -l) skills, $(find "$PRESET/skills" -type f | wc -l) files"
echo "wrote $PRESET/SYNC.md"
