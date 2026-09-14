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

export async function plant({ source, destRoot, name = PRESET_ID, policy = 'copy' }) {
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
    return { action: 'planted', changed: 0, kept: 0, reason: null };
  }

  const manifest = JSON.parse(await readFile(join(source, '.manifest.json'), 'utf8')).files;

  if (!installed) {
    let hadNonEmpty = false;
    try { hadNonEmpty = (await readdir(destDir)).length > 0; } catch { hadNonEmpty = false; }
    if (hadNonEmpty) throw new Error(`destination ${destDir} exists without .installed.json; refusing to touch`);
  }

  await mkdir(destDir, { recursive: true });
  const newFiles = Object.keys(manifest);
  const next = {};
  let changed = 0, kept = 0;

  for (const rel of newFiles) {
    const dst = join(destDir, rel);
    const newSha = manifest[rel];
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
    return { action: 'planted', changed, kept, reason: null };
  }
  const action = (kept === 0 && changed === 0) ? 'unchanged' : (kept > 0 ? 'partial' : 'updated');
  await writeFileAtomic(installedPath, JSON.stringify(record, null, 2));
  return { action, changed, kept, reason: null };
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