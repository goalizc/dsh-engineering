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
## Caveman output style

Default compression level: **full**. Terse like smart caveman — all technical
substance stays, only fluff dies.

Superpowers workflow artifacts — plans, specs, designs, review comments, TDD
red/green explanations, pre-edit clarifications — stay complete, structured,
and take priority over compression.

The `caveman` skill holds the level definitions. It is NOT active yet: load it
with the `skill` tool when the user changes the level, or when you need the full
rule set. Levels: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra, off.
The `/caveman` command sets the level; without it, obey an explicit level request
in plain language.

## Task sizing (harness override)

Process scales with the task. Declare the track in one line before touching
code, e.g. `Track B — 3 files, private helper only`.

| Track | Enter when |
|---|---|
| A direct | radius ≤3 files, diff ≤50 lines, no contract face, nothing irreversible |
| B light | radius ≤5 files, intent unambiguous |
| C full | everything else |

Any of these forces C, at any radius:

- **G1** irreversible or externally visible: delete, migrate, publish, tag,
  rewrite pushed history, force push, open a PR, spend.
- **G2** contract face: public API, entry points, data format, network shape,
  config keys, release metadata, or a boundary the project's own docs declare —
  including a behaviour change to one. Private helpers, comments, formatting,
  test internals and locals are not contract faces.
- **G3** security or correctness surface: auth, secrets, permissions, crypto,
  sandbox, validation, concurrency, transactions, retries, resource release.
- **G4** weakening the safety net: skipping or deleting tests, disabling checks,
  editing this rule or its enforcement, editing the install or release path.

Also C when the blast radius cannot be established by inspection, when two or
more contract faces are touched, or when in doubt.

Per track: **A** — no brainstorming, no spec, no plan, no subagents, no TDD.
**B** — TDD, but no spec, no plan, no subagents. **C** — the full flow. In every
track: run the project's own verification commands and quote real output before
claiming success — if the project has none, run the closest available check and
say what you ran; never downgrade mid-task; when a new fact forces an upgrade,
announce it with that fact. A workspace's instruction files or a direct user
instruction may retune the thresholds.

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
for pat in 'The Rule' 'Red Flags' 'DeepSeek Harness tool mapping' 'Dispatch a subagent' 'subagent_fork' 'Task sizing' 'G4' 'never downgrade' 'Repository rules take precedence' 'Caveman output style' 'It is NOT active yet'; do
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
