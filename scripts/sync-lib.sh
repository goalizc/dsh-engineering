#!/usr/bin/env bash
# Shared helpers for the sync scripts. Sourced, never executed.

# Append one provenance section to preset/SYNC.md under a stable heading.
# Called once per upstream so each keeps its own block; the Superpowers call
# initialises the file, later calls append.
write_sync_section() {
  local label="$1" upstream="$2" url="$3"
  local file="$PRESET/SYNC.md"
  # preset/ ships in the published package (package.json "files"), so the cache
  # path is written relative to $HOME: a contributor's absolute home directory
  # must never be baked into a released artifact. Falls back to the raw path
  # when the cache lives outside $HOME (only when CACHE_ROOT overrides it).
  local shown_upstream="${upstream/#$HOME/\~}"

  if [ ! -f "$file" ]; then
    printf '# 上游同步记录\n' > "$file"
  fi
  # Drop any previous block for this label so a re-sync replaces, not appends.
  if grep -q "^## $label$" "$file"; then
    awk -v h="## $label" '
      $0 == h { skip = 1; next }
      skip && /^## / { skip = 0 }
      !skip { print }
    ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  fi

  {
    printf '\n## %s\n\n' "$label"
    printf -- '- 上游仓库: %s\n' "$url"
    printf -- '- 本地缓存: %s\n' "$shown_upstream"
    git -C "$upstream" log -1 --format='- commit: %H%n- date: %ad%n- subject: %s' --date=short
    if [ -f "$upstream/package.json" ]; then
      grep -m1 '"version"' "$upstream/package.json" | sed 's/^ */- package.json version: /'
    fi
    printf -- '- 同步时间: %s\n' "$(date -Iseconds)"
  } >> "$file"
}
