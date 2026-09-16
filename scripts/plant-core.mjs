// scripts/plant-core.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, copyFile, symlink, rm, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function hashFile(absPath) {
  return createHash('sha256').update(await readFile(absPath)).digest('hex');
}

export async function walkFiles(dir, { exclude = [] } = {}) {
  const out = [];
  async function rec(d, rel) {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (rel === '' && exclude.includes(ent.name)) continue;
      const full = join(d, ent.name);
      if (ent.isDirectory()) await rec(full, r);
      else if (ent.isFile()) out.push(r);
    }
  }
  await rec(dir, '');
  return out.sort();
}

export async function buildManifestMap(dir, { exclude }) {
  const map = {};
  for (const rel of await walkFiles(dir, { exclude })) map[rel] = await hashFile(join(dir, rel));
  return map;
}

async function ensureParent(p) { await mkdir(dirname(p), { recursive: true }); }
async function writeFileAtomic(p, data) {
  const t = p + '.tmp';
  await writeFile(t, data);
  await rename(t, p);
}
async function copyAtomic(src, dst) {
  await ensureParent(dst);
  const t = dst + '.tmp';
  await copyFile(src, t);
  await rename(t, dst);
}

/** The preset id this bundle installs under. Single source of truth. */
export const PRESET_ID = 'engineering';

/**
 * The exclude set shared by the generated manifest and the runtime fallback.
 * Both must exclude exactly these, or the same tree plants different file sets
 * depending on whether preset/.manifest.json happened to ship with it.
 */
export const MANIFEST_EXCLUDES = ['.manifest.json', 'node_modules'];

/**
 * Resolve the file map to plant, from the most explicit source available.
 *
 * A git checkout has no preset/.manifest.json: the file is gitignored and only
 * enters the npm tarball because package.json#files lists it explicitly. So the
 * absence of that file is expected, not an error — but only ENOENT is: a
 * corrupt or unreadable manifest is a real fault and must surface.
 */
async function resolveManifest({ source, manifest }) {
  if (manifest) return { files: manifest, manifestSource: 'provided' };
  try {
    const parsed = JSON.parse(await readFile(join(source, '.manifest.json'), 'utf8'));
    return { files: parsed.files, manifestSource: 'file' };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return {
      files: await buildManifestMap(source, { exclude: MANIFEST_EXCLUDES }),
      manifestSource: 'computed',
    };
  }
}

export async function plant({ source, destRoot, name = PRESET_ID, policy = 'copy', manifest } = {}) {
  const destDir = join(destRoot, name);
  const installedPath = join(destDir, '.installed.json');
  let installed = null;
  try { installed = JSON.parse(await readFile(installedPath, 'utf8')); } catch { installed = null; }

  if (policy === 'link') {
    await mkdir(destDir, { recursive: true });
    for (const ent of await readdir(destDir, { withFileTypes: true })) {
      await rm(join(destDir, ent.name), { recursive: true, force: true });
    }
    for (const ent of await readdir(source, { withFileTypes: true })) {
      if (ent.name === '.manifest.json') continue;
      await symlink(join(source, ent.name), join(destDir, ent.name));
    }
    return { action: 'planted', changed: 0, kept: 0, reason: null, manifestSource: 'n/a' };
  }

  // NOTE: `manifestFiles`, not `manifest` — a top-level `const manifest` in the
  // function body would collide with the parameter of the same name.
  const { files: manifestFiles, manifestSource } = await resolveManifest({ source, manifest });

  if (!installed) {
    let hadNonEmpty = false;
    try { hadNonEmpty = (await readdir(destDir)).length > 0; } catch { hadNonEmpty = false; }
    if (hadNonEmpty) throw new Error(`destination ${destDir} exists without .installed.json; refusing to touch`);
  }

  await mkdir(destDir, { recursive: true });
  const newFiles = Object.keys(manifestFiles);
  const next = {};
  let changed = 0, kept = 0;

  for (const rel of newFiles) {
    const dst = join(destDir, rel);
    const newSha = manifestFiles[rel];
    if (!existsSync(dst)) {
      await copyAtomic(join(source, rel), dst);
      next[rel] = newSha; changed++;
      continue;
    }
    const cur = await hashFile(dst);
    if (cur === newSha) { next[rel] = newSha; continue; }
    const installedSha = installed && installed.files ? installed.files[rel] : null;
    if (installedSha === cur) { await copyAtomic(join(source, rel), dst); next[rel] = newSha; changed++; }
    else { next[rel] = newSha; kept++; }
  }

  const record = { name, installedAt: new Date().toISOString(), files: next };
  if (!installed) {
    await writeFileAtomic(installedPath, JSON.stringify(record, null, 2));
    return { action: 'planted', changed, kept, reason: null, manifestSource };
  }
  const action = (kept === 0 && changed === 0) ? 'unchanged' : (kept > 0 ? 'partial' : 'updated');
  await writeFileAtomic(installedPath, JSON.stringify(record, null, 2));
  return { action, changed, kept, reason: null, manifestSource };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , cmd, source, destRoot, ...rest] = process.argv;
  if (cmd !== 'install' || !source || !destRoot) {
    console.error(`usage: node scripts/plant-core.mjs install <source> <destRoot> [--name ${PRESET_ID}] [--policy copy|link]`);
    process.exit(2);
  }
  const arg = (k) => rest[rest.indexOf(k) + 1];
  const name = arg('--name') ?? PRESET_ID;
  const policy = arg('--policy') ?? 'copy';
  const r = await plant({ source, destRoot, name, policy }).catch((e) => {
    console.error('engineering: ' + e.message);
    process.exit(1);
  });
  let line = `engineering: ${r.action}`;
  if (r.changed) line += ` (${r.changed} changed)`;
  if (r.kept) line += ` (${r.kept} kept user files)`;
  console.log(line);
  if (r.action === 'skipped') process.exit(1);
}
