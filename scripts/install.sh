#!/usr/bin/env bash
# Install (or refresh) the engineering-mode preset into the DSH user preset root.
#
# The preset is self-contained: its bootstrap plugin imports nothing from the
# harness (the message id it needs comes from `node:crypto`), so it copies or
# links cleanly onto any machine with a compatible capacitor.
#
#     ${DSH_HOME:-$HOME/.dsh}/.agent-presets/engineering/
#
# IMPORTANT: the installed directory itself must be a REAL directory containing
# symlinks, not a symlink to this checkout. Preset discovery reads the root with
# `readdir(..., { withFileTypes: true })` and accepts only entries whose
# `isDirectory()` is true — a symlink to a directory reports false and the
# preset is silently skipped. Entries *inside* the directory may be symlinks,
# which is what keeps edits here live.
#
# Run `scripts/build-bootstrap.sh` first if the skills changed.
#
# Usage: scripts/install.sh [--copy]
#   default: real directory + per-entry symlinks into this checkout
#   --copy : deep copy instead (for a machine where the checkout may be removed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/preset"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DEST_ROOT="$DSH_HOME/.agent-presets"
DEST="$DEST_ROOT/engineering"
MODE="${1:-}"
POLICY="link"
[ "$MODE" != "--copy" ] || POLICY="copy"

[ -f "$SRC/agent.cordis.yml" ] || { echo "missing composition: $SRC/agent.cordis.yml" >&2; exit 1; }
[ -f "$SRC/bootstrap.md" ] || { echo "missing bootstrap: run scripts/build-bootstrap.sh first" >&2; exit 1; }

mkdir -p "$DEST_ROOT"

# 委托共享植入引擎；link=即时生效符号链接, copy=深拷贝(换机可移除检出)。
node "$(dirname "$0")/plant-core.mjs" install "$SRC" "$DEST_ROOT" --name engineering --policy "$POLICY"

echo
echo "installed preset id: engineering"
echo "composition: $DEST/agent.cordis.yml"
echo "verify:      sp_probe validate=engineering   (from a session with the probe mounted)"
echo "next:        start a new session and pick it in the agent-preset picker"

# Cheap porting-contract checks; fail loudly instead of silently shipping a
# broken preset to a new machine. Every preset-local plugin is covered: a plugin
# that fails to register degrades silently at runtime, so the install gate is the
# only place that can catch it before a human relies on it.
echo
for plugin in bootstrap caveman-command; do
  if (cd "$SRC/plugins/$plugin" && node "$plugin.test.mjs"); then
    echo "self-test: $plugin OK"
  else
    echo "self-test: $plugin FAILED — see output above" >&2
    exit 1
  fi
done