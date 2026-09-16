// scripts/bundle-identity.test.mjs
//
// Guards the cross-file values that make this repository a dsh bundle. Nothing
// links them: package.json#name and the self-referential insert row in
// cordis.patch.yml must agree or the composed profile silently loses the
// installer layer; the `files` whitelist must carry what the installer needs at
// runtime or the installed package is broken on arrival.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the patch self-reference names the package', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const patch = await read('../cordis.patch.yml');
  const rowName = /^\s*name:\s*'([^']+)'\s*$/m.exec(patch)?.[1];
  assert.equal(
    rowName,
    pkg.name,
    `cordis.patch.yml must insert a row named ${JSON.stringify(pkg.name)}, the ` +
      `installed package name; got ${JSON.stringify(rowName)}. The row is how the ` +
      `bundle mounts itself, so a mismatch drops the installer from the composition.`,
  );
});

test('dsh.bundle.patch points at a file that exists', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const rel = pkg.dsh?.bundle?.patch;
  assert.ok(rel, 'package.json must declare dsh.bundle.patch');
  const abs = fileURLToPath(new URL(`../${rel.replace(/^\.\//, '')}`, import.meta.url));
  assert.ok(existsSync(abs), `dsh.bundle.patch points at a missing file: ${rel}`);
});

test('the files whitelist carries the patch and the manifest', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  for (const must of ['cordis.patch.yml', 'preset/.manifest.json']) {
    assert.ok(
      pkg.files.includes(must),
      `package.json#files must list ${JSON.stringify(must)}: the first is the ` +
        `mount layer, the second is what the copy policy reads before planting. ` +
        `npm honours this list for gitignored files, which is why a published ` +
        `tarball carries the manifest while a git checkout does not.`,
    );
  }
});

test('the files whitelist carries the plant engine index.js imports', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.ok(
    pkg.files.includes('scripts/plant-core.mjs'),
    'package.json#files must list scripts/plant-core.mjs: index.js imports it, ' +
      'so an installed package without it cannot plant at all.',
  );
});
