// scripts/plant-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile, walkFiles, buildManifestMap } from './plant-core.mjs';

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