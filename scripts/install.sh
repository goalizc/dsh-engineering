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

# The id changed superpowers -> engineering. An install that predates the rename
# keeps working: its rows still resolve (they symlink back into this checkout),
# so the picker lists TWO identically named 工程模式 and a `settings.yaml`
# default of `superpowers` still resolves to the OLD directory. Report that and
# stop there — deleting a directory under the user's DSH home is theirs to do.
LEGACY="$DEST_ROOT/superpowers"
if [ -d "$LEGACY" ]; then
  echo
  echo "WARNING: legacy preset directory still installed: $LEGACY" >&2
  echo "         the preset id changed (superpowers -> engineering). Both directories" >&2
  echo "         now show up as 工程模式 in the picker, and 'agent-presets.default:" >&2
  echo "         superpowers' in settings.yaml still resolves to the old copy." >&2
  echo "         This script never deletes it. After checking nothing else needs it:" >&2
  echo "             rm -rf \"$LEGACY\"" >&2
  echo "         and change settings.yaml to 'agent-presets.default: engineering'." >&2
fi

# Cheap porting-contract checks; fail loudly instead of silently shipping a
# broken preset to a new machine. The gate covers EVERY preset-local plugin by
# iterating the directory — never a hand-written list, which is how a newly
# added plugin gets skipped in silence (the silent-degradation class this gate
# exists to stop). A plugin without its `<name>.test.mjs` therefore fails the
# install: shipping a self-test is part of adding a plugin.
echo
[ -d "$SRC/plugins" ] || { echo "missing preset plugins directory: $SRC/plugins" >&2; exit 1; }
plugins_checked=0
for dir in "$SRC"/plugins/*/; do
  [ -d "$dir" ] || continue
  plugin="$(basename "$dir")"
  test_file="$dir$plugin.test.mjs"
  if [ ! -f "$test_file" ]; then
    echo "self-test missing: $test_file — every preset-local plugin must ship one" >&2
    exit 1
  fi
  if (cd "$dir" && node "$plugin.test.mjs"); then
    echo "self-test: $plugin OK"
  else
    echo "self-test: $plugin FAILED — see output above" >&2
    exit 1
  fi
  plugins_checked=$((plugins_checked + 1))
done
[ "$plugins_checked" -gt 0 ] || { echo "no preset-local plugins found under $SRC/plugins" >&2; exit 1; }
echo "self-tests: $plugins_checked plugin(s) OK"