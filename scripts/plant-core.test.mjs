// scripts/plant-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, walkFiles, buildManifestMap, plant, PRESET_ID, MANIFEST_EXCLUDES } from './plant-core.mjs';

test('PRESET_ID is the documented preset id', () => {
  assert.equal(PRESET_ID, 'engineering');
});

async function fixture() {
  const d = await mkdtemp(join(tmpdir(), 'plant-core-'));
  await mkdir(join(d, 'skills'));
  await writeFile(join(d, 'bootstrap.md'), 'hello');
  await writeFile(join(d, 'skills', 'SKILL.md'), 'skill body');
  await writeFile(join(d, '.manifest.json'), '{}');
  return d;
}

test('hashFile returns sha256 hex', async () => {
  const d = await fixture();
  const h = await hashFile(join(d, 'bootstrap.md'));
  assert.match(h, /^[0-9a-f]{64}$/);
  const h2 = await hashFile(join(d, 'bootstrap.md'));
  assert.equal(h, h2);
});

test('walkFiles lists rel paths sorted, excluding top-level excludes', async () => {
  const d = await fixture();
  const rows = await walkFiles(d, { exclude: ['.manifest.json'] });
  assert.deepEqual(rows, ['bootstrap.md', 'skills/SKILL.md']);
});

test('buildManifestMap maps rel to hash', async () => {
  const d = await fixture();
  const m = await buildManifestMap(d, { exclude: ['.manifest.json'] });
  assert.deepEqual(Object.keys(m), ['bootstrap.md', 'skills/SKILL.md']);
  assert.match(m['bootstrap.md'], /^[0-9a-f]{64}$/);
});

async function sourceWithManifest() {
  const d = await fixture();
  const files = {};
  for (const rel of ['bootstrap.md', 'skills/SKILL.md']) files[rel] = await hashFile(join(d, rel));
  await writeFile(join(d, '.manifest.json'), JSON.stringify({ version: 1, files }));
  return d;
}

test('plant first install -> planted, files landed', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'planted');
  assert.equal(await readFile(join(destRoot, PRESET_ID, 'bootstrap.md'), 'utf8'), 'hello');
  const inst = JSON.parse(await readFile(join(destRoot, PRESET_ID, '.installed.json'), 'utf8'));
  assert.equal(inst.files['bootstrap.md'], await hashFile(join(src, 'bootstrap.md')));
});

test('plant unchanged rerun -> unchanged', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'unchanged');
});

test('plant keeps user-modified file (partial) and lands new file', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  const userFile = join(destRoot, PRESET_ID, 'bootstrap.md');
  await writeFile(userFile, 'user edit');
  await writeFile(join(src, 'skills', 'NEW.md'), 'new body');
  const rebuilt = {};
  for (const rel of ['bootstrap.md', 'skills/SKILL.md', 'skills/NEW.md']) rebuilt[rel] = await hashFile(join(src, rel));
  await writeFile(join(src, '.manifest.json'), JSON.stringify({ version: 1, files: rebuilt }));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'partial');
  assert.equal(await readFile(userFile, 'utf8'), 'user edit');
  assert.equal(await readFile(join(destRoot, PRESET_ID, 'skills', 'NEW.md'), 'utf8'), 'new body');
  assert.equal(r.kept, 1);
});

test('plant bundle update overwrites untouched file (updated)', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  await writeFile(join(src, 'bootstrap.md'), 'bundle v2');
  const rebuilt = {};
  for (const rel of ['bootstrap.md', 'skills/SKILL.md']) rebuilt[rel] = await hashFile(join(src, rel));
  await writeFile(join(src, '.manifest.json'), JSON.stringify({ version: 1, files: rebuilt }));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'updated');
  assert.equal(await readFile(join(destRoot, PRESET_ID, 'bootstrap.md'), 'utf8'), 'bundle v2');
});

test('plant refuses non-empty dest without our marker (skipped)', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await mkdir(join(destRoot, PRESET_ID), { recursive: true });
  await writeFile(join(destRoot, PRESET_ID, 'user.txt'), 'x');
  await assert.rejects(plant({ source: src, destRoot, policy: 'copy' }));
});

test('plant link policy creates real dir + per-entry symlinks, no manifest link', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-link-'));
  const r = await plant({ source: src, destRoot, policy: 'link' });
  assert.equal(r.action, 'planted');
  assert.equal(r.manifestSource, 'n/a');
  const dest = join(destRoot, PRESET_ID);
  const { lstat, readlink } = await import('node:fs/promises');
  const st = await lstat(join(dest, 'bootstrap.md'));
  assert.ok(st.isSymbolicLink());
  assert.equal(await readlink(join(dest, 'bootstrap.md')), join(src, 'bootstrap.md'));
  await assert.rejects(readFile(join(dest, '.manifest.json')));
});

// A git checkout has no preset/.manifest.json: the file is gitignored and only
// enters the npm tarball because package.json#files lists it explicitly. The
// copy policy used to hard-require it, so `dsh plugin add github:...` installed
// the package and then planted nothing, silently.
async function sourceWithoutManifest() {
  const d = await fixture();
  await rm(join(d, '.manifest.json'));
  return d;
}

test('plant computes the manifest when the source has none (git checkout)', async () => {
  const src = await sourceWithoutManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'planted');
  assert.equal(r.manifestSource, 'computed');
  assert.equal(await readFile(join(destRoot, PRESET_ID, 'bootstrap.md'), 'utf8'), 'hello');
  const inst = JSON.parse(await readFile(join(destRoot, PRESET_ID, '.installed.json'), 'utf8'));
  assert.deepEqual(Object.keys(inst.files), ['bootstrap.md', 'skills/SKILL.md']);
  for (const rel of Object.keys(inst.files)) {
    assert.equal(inst.files[rel], await hashFile(join(src, rel)));
  }
});

// The fallback must equal the generated manifest key for key, or the same tree
// plants different file sets depending on how it was installed. `npm test`'s
// pretest regenerates preset/.manifest.json, so this compares live values.
test('MANIFEST_EXCLUDES reproduces the shipped manifest exactly', async () => {
  const preset = fileURLToPath(new URL('../preset', import.meta.url));
  const shipped = JSON.parse(await readFile(join(preset, '.manifest.json'), 'utf8'));
  const computed = await buildManifestMap(preset, { exclude: MANIFEST_EXCLUDES });
  assert.deepEqual(computed, shipped.files);
});

test('an explicit manifest wins over the file', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const only = { 'bootstrap.md': await hashFile(join(src, 'bootstrap.md')) };
  const r = await plant({ source: src, destRoot, policy: 'copy', manifest: only });
  assert.equal(r.manifestSource, 'provided');
  const inst = JSON.parse(await readFile(join(destRoot, PRESET_ID, '.installed.json'), 'utf8'));
  assert.deepEqual(Object.keys(inst.files), ['bootstrap.md']);
});

// Only ENOENT justifies recomputing: a corrupt manifest is a real fault and
// must surface, not get papered over by hashing the tree.
test('a corrupt manifest still throws instead of silently recomputing', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await writeFile(join(src, '.manifest.json'), '{ not json');
  await assert.rejects(plant({ source: src, destRoot, policy: 'copy' }));
});
