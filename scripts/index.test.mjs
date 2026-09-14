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

test('doInstall plants bundled preset to destRoot/engineering', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.action, 'planted');
  const comp = await readFile(join(destRoot, 'engineering', 'agent.cordis.yml'), 'utf8');
  // The exact mount line, not a substring: the composition's own prose also
  // names `plugins/bootstrap` (in a comment above the row), so a bare
  // `includes('plugins/bootstrap')` still passed with the row deleted.
  assert.match(
    comp,
    /^\s*name: '\.\/plugins\/bootstrap\/index\.js'$/m,
    `the composition must carry the bootstrap mount row; got:\n${comp}`,
  );
});