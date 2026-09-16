// scripts/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { doInstall, formatResult, formatError } from '../index.js';

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

// The log line is how a human tells an npm install (manifest shipped) from a
// git install (manifest computed). Losing the marker makes the two
// indistinguishable in a boot log, which is exactly how the git path failed
// silently before.
test('formatResult marks a computed manifest and stays quiet for a shipped one', () => {
  const computed = formatResult({ action: 'planted', changed: 65, manifestSource: 'computed' });
  assert.match(computed, /^engineering: preset planted \(65 changed\) \(manifest computed\)$/);
  const shipped = formatResult({ action: 'planted', changed: 65, manifestSource: 'file' });
  assert.equal(shipped, 'engineering: preset planted (65 changed)');
});

// The old message was `engineering: ` + e.message, which named neither the
// preset nor what to check. A silent-looking install is the failure mode this
// whole change exists to remove.
test('formatError names the preset, the original error and what to check', () => {
  const msg = formatError(new Error('ENOENT: no such file or directory'));
  assert.match(msg, /^engineering: preset NOT installed/);
  assert.match(msg, /ENOENT: no such file or directory/);
  assert.match(msg, /preset\/\.manifest\.json/);
});

test('doInstall reports where its manifest came from', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.manifestSource, 'file');
});

test('apply() warns instead of throwing when planting cannot proceed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-fail-'));
  const notADir = join(dir, 'not-a-dir');
  await writeFile(notADir, 'x'); // DSH_HOME pointing at a file: mkdir must fail
  const prevHome = process.env.DSH_HOME;
  const prevWarn = console.warn;
  let warned = '';
  process.env.DSH_HOME = notADir;
  console.warn = (m) => { warned += String(m); };
  try {
    await assert.doesNotReject(plugin.apply());
  } finally {
    console.warn = prevWarn;
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  }
  assert.match(warned, /^engineering: preset NOT installed/);
});
