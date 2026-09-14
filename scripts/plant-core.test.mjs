// scripts/plant-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile, walkFiles, buildManifestMap, plant, PRESET_ID } from './plant-core.mjs';

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
  const dest = join(destRoot, PRESET_ID);
  const { lstat, readlink } = await import('node:fs/promises');
  const st = await lstat(join(dest, 'bootstrap.md'));
  assert.ok(st.isSymbolicLink());
  assert.equal(await readlink(join(dest, 'bootstrap.md')), join(src, 'bootstrap.md'));
  await assert.rejects(readFile(join(dest, '.manifest.json')));
});