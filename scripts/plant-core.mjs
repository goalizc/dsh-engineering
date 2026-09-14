// scripts/plant-core.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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