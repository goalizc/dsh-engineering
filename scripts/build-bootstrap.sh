#!/usr/bin/env bash
# Assemble preset/bootstrap.md from the vendored parts.
#
# bootstrap.md is generated, never hand-edited: it is the vendored
# `using-superpowers` skill body plus this harness's tool mapping plus the
# precedence note. Run this after syncing skills.
#
# Usage: scripts/build-bootstrap.sh
set -euo pipefail

PRESET="$(cd "$(dirname "$0")/.." && pwd)/preset"
SKILL="$PRESET/skills/using-superpowers/SKILL.md"
TOOLS="$PRESET/skills/using-superpowers/references/dsh-tools.md"
OUT="$PRESET/bootstrap.md"

for f in "$SKILL" "$TOOLS"; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

# Strip YAML frontmatter only when the file actually opens with it, so a body
# containing a Markdown horizontal rule is never mistaken for frontmatter.
strip_frontmatter() {
  awk 'NR==1 && $0=="---" { fm=1; next } fm==1 { if ($0=="---") fm=0; next } { print }' "$1"
}

{
  cat <<'HEADER'
<EXTREMELY_IMPORTANT>
You have superpowers.

**Below is the full content of your `using-superpowers` skill — your
introduction to using skills. It is ALREADY ACTIVE: do not try to load
`using-superpowers` again with the `skill` tool.**

**For every other skill, use the `skill` tool with the exact skill name before
acting.**
HEADER
  echo; echo "---"; echo
  strip_frontmatter "$SKILL"
  echo; echo "---"; echo
  echo "## DeepSeek Harness tool mapping"; echo
  echo "The skills describe *actions*, not tools. These are the harness's real tool names."; echo
  strip_frontmatter "$TOOLS"
  echo; echo "---"; echo
  cat <<'FOOTER'
## Repository rules take precedence

The workspace's own instruction files (`AGENTS.md`, `CLAUDE.md`, local overlays)
and any direct human instruction override every skill in this library. When a
repository rule conflicts with generic skill advice — commit message format, one
subsystem per commit, AI-assistance disclosure, no fabricated test evidence,
no unattended push or PR — **the repository rule wins**.
</EXTREMELY_IMPORTANT>
FOOTER
} > "$OUT"

# Self-check: every section that must survive assembly.
fail=0
for pat in 'The Rule' 'Red Flags' 'DeepSeek Harness tool mapping' 'Dispatch a subagent' 'subagent_fork' 'Repository rules take precedence'; do
  if ! grep -q -- "$pat" "$OUT"; then echo "build-bootstrap: missing section: $pat" >&2; fail=1; fi
done

# Caveman vendored skills must survive assembly; fail loudly if a sync or
# removal dropped one (same rule as the dsh-tools.md mis-delete lesson).
for c in caveman caveman-commit caveman-review; do
  [ -f "$PRESET/skills/$c/SKILL.md" ] || { echo "build-bootstrap: missing caveman skill: $c" >&2; exit 1; }
done
[ "$fail" -eq 0 ] || exit 1

printf 'built %s (%s bytes, %s lines)\n' "$OUT" "$(wc -c < "$OUT")" "$(wc -l < "$OUT")"

# 让发布包的逐文件内容戳与本次构建保持同步。
node "$(dirname "$0")/build-manifest.mjs" "$PRESET" >/dev/null
