// scripts/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { doInstall } from '../index.js';

test('default export is a cordis plugin', () => {
  assert.equal(typeof plugin, 'object');
  assert.equal(typeof plugin.apply, 'function');
});

test('doInstall plants bundled preset to destRoot/superpowers', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.action, 'planted');
  const comp = await readFile(join(destRoot, 'superpowers', 'agent.cordis.yml'), 'utf8');
  assert.ok(comp.includes('superpowers-bootstrap'));
});