#!/usr/bin/env bash
# Sync the vendored Superpowers skills from a self-managed upstream cache.
#
# Skills are the upstream source of truth and are reused verbatim; this
# repository never edits a skill body. The only exception is the pointer line in
# `using-superpowers/SKILL.md`'s "Platform Adaptation" section that names this
# harness's tool-mapping reference — the one edit the upstream porting guide
# sanctions. It is re-applied here after every sync.
#
# Usage: scripts/sync-superpowers-skills.sh
#   CACHE_ROOT overrides where the upstream cache lives (default: <repo>/.cache)
#
# NOTE: this script REPLACES preset/skills wholesale. Caveman skills are a
# partial vendee living in the same directory, so they are re-synced at the end
# to avoid silently deleting them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"
CACHE_ROOT="${CACHE_ROOT:-$ROOT/.cache}"
UPSTREAM="$CACHE_ROOT/superpowers"
REPO_URL="https://github.com/obra/superpowers.git"
PIN="d884ae04edebef577e82ff7c4e143debd0bbec99"

# Fetch-or-update the cache, then check out the pinned commit. Never tracks a
# moving branch: a sync must be reproducible.
if [ ! -d "$UPSTREAM/.git" ]; then
  mkdir -p "$CACHE_ROOT"
  git clone --filter=blob:none "$REPO_URL" "$UPSTREAM"
fi
git -C "$UPSTREAM" fetch --tags --quiet origin
git -C "$UPSTREAM" checkout --quiet "$PIN"

[ -d "$UPSTREAM/skills" ] || { echo "not a superpowers checkout: $UPSTREAM" >&2; exit 1; }

# shellcheck source=scripts/sync-lib.sh
. "$ROOT/scripts/sync-lib.sh"

echo "syncing skills from $UPSTREAM at $PIN"
rm -rf "$PRESET/skills"
mkdir -p "$PRESET/skills"
cp -R "$UPSTREAM/skills/." "$PRESET/skills/"

# Re-apply the sanctioned Platform Adaptation pointer.
#
# The upstream body does not carry this line, so it must be inserted — but it
# must land inside "## Platform Adaptation", right after the Antigravity entry.
# A plain append to EOF once put it under "## User Instructions" instead. The
# pass below is idempotent and repairs a misplaced line as well as a missing
# one: it drops any pointer outside that section, then inserts one after the
# Antigravity line unless the very next line already is the pointer.
SKILL="$PRESET/skills/using-superpowers/SKILL.md"
awk '
  /^## /      { sec = $0 }
  /^- Antigravity: / {
    if (getline nxt > 0) {
      if (nxt == "- DeepSeek Harness: `references/dsh-tools.md`") {
        print; print nxt; next
      }
      print
      print "- DeepSeek Harness: `references/dsh-tools.md`"
      if (nxt ~ /^- DeepSeek Harness: / && sec != "## Platform Adaptation") next
      print nxt
      next
    }
    print; print "- DeepSeek Harness: `references/dsh-tools.md`"; next
  }
  /^- DeepSeek Harness: / && sec != "## Platform Adaptation" { next }
  { print }
' "$SKILL" > "$SKILL.tmp" && mv "$SKILL.tmp" "$SKILL"
POINTER_SEC="$(awk '/^## /{sec=$0} /^- DeepSeek Harness:/{print sec}' "$SKILL")"
if [ "$(grep -c '^- DeepSeek Harness: ' "$SKILL" || true)" -ne 1 ] \
  || [ "$POINTER_SEC" != "## Platform Adaptation" ]; then
  echo "pointer not anchored in ## Platform Adaptation (found: ${POINTER_SEC:-none})" >&2
  exit 1
fi

# The full-directory replace above deletes repo-local files under skills/;
# upstream never carries this harness's tool mapping, so restore it from the
# repo (tracked) when the copy did not bring it back.
TOOLS_REL="preset/skills/using-superpowers/references/dsh-tools.md"
if [ ! -f "$ROOT/$TOOLS_REL" ] && git -C "$ROOT" rev-parse --verify --quiet "HEAD:$TOOLS_REL" >/dev/null; then
  git -C "$ROOT" restore -- "$TOOLS_REL"
  echo "restored $ROOT/$TOOLS_REL (repo-local tool mapping)"
fi

write_sync_section "Superpowers" "$UPSTREAM" "$REPO_URL"
echo "wrote $PRESET/SYNC.md"

# The wholesale replace dropped the caveman skills; bring them back. That call
# also runs build-bootstrap.sh, so bootstrap.md is rebuilt for this sync too.
# Rebuilding here as well would only run the same generated-file step twice, so
# this script deliberately relies on the caveman path — the final rebuild in
# this sync is always a function of the completed skills tree either way.
bash "$ROOT/scripts/sync-caveman-skills.sh"

echo "skills: $(find "$PRESET/skills" -name SKILL.md | wc -l) skills, $(find "$PRESET/skills" -type f | wc -l) files"
