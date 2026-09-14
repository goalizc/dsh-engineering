#!/usr/bin/env bash
# Install (or refresh) the Superpowers preset into the DSH user preset root.
#
# The preset is machine-local by design: `preset/node_modules` is a symlink into
# the installed harness, because a locally authored preset lives under the
# user's home, where Node's upward `node_modules` walk never reaches the
# harness's own packages.
#
#     ${DSH_HOME:-$HOME/.dsh}/.agent-presets/superpowers/
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
DEST="$DEST_ROOT/superpowers"
MODE="${1:-}"

# Locate the harness's own dependency tree (`@deepseek-ai/dsh-llm` and friends)
# so a fresh checkout can be linked against it without manual probing. Walks up
# from the real path of the `dsh` executable, then falls back to global roots.
find_harness_ai() {
  local bin pkg groot cand
  bin="$(command -v dsh 2>/dev/null || true)"
  if [ -n "$bin" ]; then
    bin="$(readlink -f "$bin" 2>/dev/null || true)"
    pkg="$(dirname "$bin")"
    while [ "$pkg" != "/" ] && [ "$pkg" != "." ]; do
      if [ -f "$pkg/package.json" ] && [ "$(basename "$pkg")" = "dsh" ]; then
        for cand in "$pkg/node_modules/@deepseek-ai" "$pkg/@deepseek-ai"; do
          if [ -e "$cand/dsh-llm/package.json" ]; then
            printf '%s\n' "$cand"
            return 0
          fi
        done
      fi
      pkg="$(dirname "$pkg")"
    done
  fi
  for groot in "$(npm root -g 2>/dev/null || true)" "$(pnpm root -g 2>/dev/null || true)"; do
    [ -n "$groot" ] || continue
    for cand in "$groot/@deepseek-ai/dsh/node_modules/@deepseek-ai" "$groot/@deepseek-ai"; do
      if [ -e "$cand/dsh-llm/package.json" ]; then
        printf '%s\n' "$cand"
        return 0
      fi
    done
  done
  return 1
}

[ -f "$SRC/agent.cordis.yml" ] || { echo "missing composition: $SRC/agent.cordis.yml" >&2; exit 1; }
[ -f "$SRC/bootstrap.md" ] || { echo "missing bootstrap: run scripts/build-bootstrap.sh first" >&2; exit 1; }

# Machine-local dependency link self-healing: the checkout's
# preset/node_modules/@deepseek-ai points into the installed harness and is
# gitignored, so a fresh clone has none. Rebuild it automatically here so a new
# machine only needs to re-run this script.
SRC_AI="$SRC/node_modules/@deepseek-ai"
if [ ! -e "$SRC_AI/dsh-llm/package.json" ]; then
  HARNESS_AI="$(find_harness_ai)" || {
    echo "error: cannot locate @deepseek-ai/dsh-llm in the installed harness; is dsh installed?" >&2
    exit 1
  }
  mkdir -p "$SRC/node_modules"
  ln -sfn "$HARNESS_AI" "$SRC_AI"
  echo "linked  $SRC_AI -> $HARNESS_AI"
fi

mkdir -p "$DEST_ROOT"
rm -rf "$DEST"
mkdir -p "$DEST"

if [ "$MODE" = "--copy" ]; then
  cp -R "$SRC/." "$DEST/"
  # A copied node_modules symlink may point through the checkout; re-point it
  # straight at the harness so a copied preset keeps working on its own.
  HARNESS_DEPS="$(readlink -f "$SRC/node_modules/@deepseek-ai")"
  rm -rf "$DEST/node_modules"
  mkdir -p "$DEST/node_modules"
  ln -sfn "$HARNESS_DEPS" "$DEST/node_modules/@deepseek-ai"
  echo "copied  $SRC -> $DEST"
else
  shopt -s dotglob nullglob
  for entry in "$SRC"/*; do
    base="$(basename "$entry")"
    case "$base" in
      node_modules)
        mkdir -p "$DEST/node_modules"
        ln -sfn "$(readlink -f "$entry/@deepseek-ai")" "$DEST/node_modules/@deepseek-ai"
        ;;
      *)
        ln -sfn "$entry" "$DEST/$base"
        ;;
    esac
  done
  echo "linked  $SRC/* -> $DEST"
fi

# The plugin's runtime imports resolve through the dependency link above. This
# check covers both modes.
DEPS="$DEST/node_modules/@deepseek-ai"
if [ ! -e "$DEPS/dsh-llm/package.json" ]; then
  echo "warning: $DEPS/dsh-llm is not resolvable; the bootstrap plugin cannot import @deepseek-ai/dsh-llm" >&2
fi

# The installed directory must be a real directory; a symlinked one is skipped
# by discovery without any diagnostic.
if [ -L "$DEST" ]; then
  echo "error: $DEST is a symlink; discovery will skip it" >&2
  exit 1
fi

echo
echo "installed preset id: superpowers"
echo "composition: $DEST/agent.cordis.yml"
echo "verify:      sp_probe validate=superpowers   (from a session with the probe mounted)"
echo "next:        start a new session and pick it in the agent-preset picker"

# Cheap porting-contract check; fail loudly instead of silently shipping a
# broken preset to a new machine.
echo
if (cd "$SRC/plugins/superpowers-bootstrap" && node selftest.mjs); then
  echo "self-test: OK"
else
  echo "self-test: FAILED — the preset will not bootstrap; see output above" >&2
  exit 1
fi
