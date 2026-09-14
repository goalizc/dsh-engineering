#!/usr/bin/env node
/**
 * Composition health of an INSTALLED preset, judged by the harness's own
 * roster check (layer 2a of this project's verification).
 *
 * This runs the same `discoverPresets` the harness's preset picker reads, with
 * the caller's own harness base as the resolution root. It catches the class of
 * rot a per-task review cannot see, because a clean checkout says nothing about
 * the installed copy:
 *
 *   - the composition is not valid YAML under the loader's own dialect
 *     (including `!!js` rows);
 *   - a row names a package that was renamed or uninstalled (`@deepseek-ai/*`);
 *   - a preset-relative row (`./plugins/bootstrap/index.js`) names a file the
 *     installed directory does not carry;
 *   - the directory is not a usable preset id, or carries no composition at
 *     all — the row comes back `broken` instead of being skipped silently.
 *
 * What it does NOT prove, and must not be read as proving: discovery stops
 * short of importing anything, so this is not a mount. It does not run
 * `standingKeyFor`, does not apply row configs, does not check that services
 * publish into the right realm, and does not assert the skills catalog. Those
 * are layer 2b (`sp_probe validate=engineering` / `sp_verify`), which needs a
 * probe outside this repository. See README "验证".
 *
 * Usage:
 *   node scripts/verify-composition.mjs [--root <dir>] [--preset <id>]
 *                                       [--harness-base <dir-or-url>]
 *
 * Defaults: --root "${DSH_HOME:-$HOME/.dsh}/.agent-presets" (the harness's own
 * user preset root), --preset engineering, --harness-base discovered from the
 * `dsh` launcher, then from the well-known global install path, then from this
 * checkout's own `preset/node_modules` link.
 *
 * Exit status: 0 when the named preset is a discoverable, unbroken roster row;
 * 1 otherwise (with the reason printed).
 */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** This repository's root, so a repo-local run works without any argument. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where the `dsh-agent-presets` package lives inside an installed harness. */
const PRESETS_SUBPATH = join('node_modules', '@deepseek-ai', 'dsh-agent-presets')

/**
 * Importable entries of `dsh-agent-presets`, in preference order.
 *
 * `lib/index.js` is the package's own `main` (and what a bare
 * `@deepseek-ai/dsh-agent-presets` import resolves to), so the first entry
 * imports exactly what the harness imports. The second is the module behind
 * that re-export, kept as a fallback for a layout where the barrel moved.
 */
const DISCOVERY_ENTRIES = [
  join(PRESETS_SUBPATH, 'lib', 'index.js'),
  join(PRESETS_SUBPATH, 'lib', 'types', 'discovery.js'),
];

/**
 * One `--flag value` argument.
 *
 * @param argv - the raw arguments.
 * @param flag - the flag to look for, without its leading dashes.
 * @returns the value, or undefined when the flag is absent.
 */
function arg(argv, flag) {
  const index = argv.indexOf(`--${flag}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** Resolve a filesystem path or a file URL into a directory URL. */
function asDirUrl(value) {
  const url = value.startsWith('file:') ? new URL(value) : pathToFileURL(resolve(value));
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

/**
 * Candidate harness bases, most specific first.
 *
 * The roster resolves every non-relative row the way {@link packageInstalled}
 * does: an upward `node_modules` walk from this base. A deployment's own `dsh`
 * launcher points at its harness root, which is the value the harness passes as
 * `ctx.baseUrl`; the repo-local fallback (`preset/`) resolves through this
 * checkout's `preset/node_modules/@deepseek-ai` link, which `install.sh`
 * rebuilds — same packages, different route.
 *
 * @returns candidate directory URLs, or none when `dsh` is not on PATH.
 */
function harnessBaseCandidates() {
  const found = [];
  if (process.env.DSH_HARNESS_BASE) found.push(asDirUrl(process.env.DSH_HARNESS_BASE));
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue;
    const launcher = join(dir, 'dsh');
    if (!existsSync(launcher)) continue;
    try {
      // <harness>/lib/bin.js -> <harness>
      found.push(asDirUrl(dirname(dirname(realpathSync(launcher)))));
    } catch {
      // An unreadable launcher simply contributes no candidate.
    }
  }
  found.push(asDirUrl('/usr/lib/node_modules/@deepseek-ai/dsh'));
  found.push(asDirUrl(join(REPO_ROOT, 'preset')));
  return found;
}

/**
 * Candidate `dsh-agent-presets` entry files for one base URL.
 *
 * The upward walk mirrors the one discovery itself uses for a row's package
 * name, so the module this script imports is the one that base would judge rows
 * with.
 *
 * @param baseUrl - a directory URL to walk up from.
 * @returns existing entry-file paths, most preferred first.
 */
function discoveryEntries(baseUrl) {
  const found = [];
  let dir = fileURLToPath(baseUrl);
  for (;;) {
    for (const entry of DISCOVERY_ENTRIES) {
      const candidate = join(dir, entry);
      if (existsSync(candidate)) found.push(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

/**
 * Judge one preset root with the harness's own roster check.
 *
 * @returns the process exit status.
 */
async function main() {
  const argv = process.argv.slice(2);
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const root = resolve(arg(argv, 'root') ?? join(dshHome, '.agent-presets'));
  const presetId = arg(argv, 'preset') ?? 'engineering';

  const requested = arg(argv, 'harness-base');
  const candidates = requested === undefined ? harnessBaseCandidates() : [asDirUrl(requested)];
  let harnessBase;
  let discoverPresets;
  let discoveryPath;
  let lastError;
  for (const candidate of candidates) {
    for (const entry of discoveryEntries(candidate)) {
      try {
        // The harness's own function, not a reimplementation of it.
        const module = await import(pathToFileURL(entry).href);
        if (typeof module.discoverPresets === 'function') {
          harnessBase = candidate;
          discoverPresets = module.discoverPresets;
          discoveryPath = entry;
        }
      } catch (error) {
        lastError = error;
      }
      if (discoverPresets !== undefined) break;
    }
    if (discoverPresets !== undefined) break;
  }
  if (discoverPresets === undefined) {
    console.error(
      'verify-composition: no usable harness install found. Pass --harness-base ' +
        '<dsh-root> or set DSH_HARNESS_BASE to the directory holding the installed ' +
        'harness (the value `dsh` itself runs from).',
    );
    if (lastError !== undefined) console.error(`last import error: ${String(lastError)}`);
    return 1;
  }

  const roots = [{ path: root, trust: 'user' }];
  const rows = await discoverPresets(roots, harnessBase);

  console.log('composition health (layer 2a, harness discoverPresets)');
  console.log(`  preset root  : ${root} (trust: user)`);
  console.log(`  harness base : ${harnessBase}`);
  console.log(`  discovery    : ${discoveryPath}`);
  console.log(
    `  roster       : ${JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        name: row.name ?? null,
        order: row.order ?? null,
        broken: row.broken ?? null,
        path: row.path,
      })),
    )}`,
  );

  const row = rows.find((candidate) => candidate.id === presetId);
  if (row === undefined) {
    console.error(
      `\n2a FAIL: no "${presetId}" preset under ${root}. Install it first: ` +
        'scripts/install.sh (or pass --root for a different preset root).',
    );
    return 1;
  }
  if (row.broken !== undefined) {
    console.error(`\n2a FAIL: "${presetId}" is a broken roster row: ${row.broken}`);
    return 1;
  }
  console.log(
    `\n2a OK: "${presetId}" is a loadable roster row (broken: null) — every row ` +
      'specifier resolves. Mounting, row configs, realms and the skills catalog ' +
      'are layer 2b.',
  );
  return 0;
}

process.exitCode = await main();
