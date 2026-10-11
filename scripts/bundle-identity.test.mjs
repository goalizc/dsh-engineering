// scripts/bundle-identity.test.mjs
//
// Guards the cross-file values that make this repository a dsh bundle. Nothing
// links them: package.json#name and the self-referential rows in
// cordis.patch.yml must agree or the composed profile silently loses the preset
// layer; the `files` whitelist must carry what those rows resolve at runtime
// (the patch and the preset tree) or the installed package mounts nothing.
//
// The assertions are deliberately structural: they must fail when somebody
// re-adds a `$DSH_HOME/.agent-presets` planter, a second declaration row, or a
// `files` entry that only the deleted legacy channel needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 去掉注释行，避免把文档里点名的陷阱当成违规。 */
const body = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

test('the patch declares an agent preset whose rows name the package', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const patch = await read('../cordis.patch.yml');
  assert.match(patch, /^\s+- id: preset-engineering$/m, 'the declaration row is missing');
  assert.match(
    patch,
    /^\s+name: "@deepseek-ai\/dsh-agent-preset"$/m,
    'the declaration must be a @deepseek-ai/dsh-agent-preset row: that is how the ' +
      'harness registers a preset (a $DSH_HOME/.agent-presets directory is not read)',
  );
  const local = [...patch.matchAll(/^\s+name: '([^']*\/preset\/plugins\/[^']+)'$/gm)].map(
    (m) => m[1],
  );
  assert.equal(
    local.length,
    3,
    `every preset-local plugin row must be a package subpath; got:\n${local.join('\n')}`,
  );
  for (const name of local) {
    assert.ok(
      name.startsWith(`${pkg.name}/preset/plugins/`),
      `preset-local plugin rows must resolve inside the installed package ` +
        `(${JSON.stringify(pkg.name)}), got ${JSON.stringify(name)}: a './' row resolves ` +
        `against the profile directory, not the preset directory.`,
    );
  }
});

test('the patch is exactly one insert row', async () => {
  const patch = body(await read('../cordis.patch.yml'));
  assert.equal((patch.match(/^- insert:$/gm) ?? []).length, 1, 'exactly one patch entry');
  assert.equal((patch.match(/^ {4}- id: /gm) ?? []).length, 1, 'exactly one inserted row');
  assert.doesNotMatch(
    patch,
    /engineering-installer|@goalizc\/dsh-engineering'$/m,
    'no self-mounting installer row: the legacy directory planter is gone, the bundle ' +
      'contributes only the preset declaration',
  );
});

test('dsh.bundle.patch points at a file that exists', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const rel = pkg.dsh?.bundle?.patch;
  assert.ok(rel, 'package.json must declare dsh.bundle.patch');
  const abs = fileURLToPath(new URL(`../${rel.replace(/^\.\//, '')}`, import.meta.url));
  assert.ok(existsSync(abs), `dsh.bundle.patch points at a missing file: ${rel}`);
});

test('the files whitelist carries the patch and the preset tree', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  for (const must of ['cordis.patch.yml', 'preset']) {
    assert.ok(
      pkg.files.includes(must),
      `package.json#files must list ${JSON.stringify(must)}: the first is the mount layer, ` +
        `the second carries every plugin and skill the declaration resolves.`,
    );
  }
});

test('the packaging carries nothing from the deleted legacy channel', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.equal(pkg.main, undefined, 'no entry module is left to mount');
  for (const gone of ['index.js', 'preset/.manifest.json', 'scripts/plant-core.mjs']) {
    assert.ok(!pkg.files.includes(gone), `files must not list the removed ${gone}`);
    assert.ok(
      !existsSync(fileURLToPath(new URL(`../${gone}`, import.meta.url))),
      `${gone} was removed with the legacy channel but is back on disk`,
    );
  }
  for (const script of ['build:manifest', 'pretest']) {
    assert.equal(pkg.scripts[script], undefined, `npm script ${script} belonged to the manifest`);
  }
});
