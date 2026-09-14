#!/usr/bin/env bash
# Shared helpers for the sync scripts. Sourced, never executed.

# Append one provenance section to preset/SYNC.md under a stable heading.
# Called once per upstream so each keeps its own block; the Superpowers call
# initialises the file, later calls append.
write_sync_section() {
  local label="$1" upstream="$2" url="$3"
  local file="$PRESET/SYNC.md"
  # preset/ ships in the published package (package.json "files"), so no
  # machine-specific path may be baked into this generated file. A cache inside
  # the checkout (the default: <repo>/.cache/<upstream>) is shown relative to the
  # repository root, which is portable and still tells a reader where to look.
  #
  # Relativizing against the user's home directory was the earlier attempt and is
  # deliberately NOT used: it leaked a home-relative absolute path into a release
  # artifact, because the home directory happens to repeat this checkout's
  # directory name — local fact, not something the file should carry. A cache
  # outside the repository has no portable spelling, so it falls back to the
  # placeholder the file carried before the cache became script-managed.
  local repo_root shown_upstream note
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  case "$upstream" in
    "$repo_root"/*)
      shown_upstream="${upstream#"$repo_root"/}"
      note='（相对仓库根）'
      ;;
    *)
      shown_upstream='$UPSTREAM'
      note='（占位符：缓存位于本仓库之外，公开分发时不泄漏本机路径）'
      ;;
  esac

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
    printf -- '- 本地缓存: %s%s\n' "$shown_upstream" "$note"
    git -C "$upstream" log -1 --format='- commit: %H%n- date: %ad%n- subject: %s' --date=short
    if [ -f "$upstream/package.json" ]; then
      # Value only: the label already names the field, and keeping the raw JSON
      # key printed `- package.json version: "version": "6.1.1",`.
      sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/- package.json version: \1/p' \
        "$upstream/package.json" | head -n 1
    fi
    printf -- '- 同步时间: %s\n' "$(date -Iseconds)"
  } >> "$file"
}
