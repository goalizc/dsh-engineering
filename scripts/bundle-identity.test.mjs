// scripts/bundle-identity.test.mjs
//
// Guards the cross-file values that make this repository a dsh bundle. Nothing
// links them: package.json#name and the self-referential rows in
// cordis.patch.yml must agree or the composed profile silently loses the preset
// layer; the `files` whitelist must carry what those rows need at runtime (the
// preset tree, and for harness ≤0.1.5 the plant engine) or the installed package
// is broken on arrival.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the patch declares an agent preset whose rows name the package', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const patch = await read('../cordis.patch.yml');
  assert.match(patch, /^\s+- id: preset-engineering$/m, 'the 0.2 declaration row is missing');
  assert.match(
    patch,
    /^\s+name: "@deepseek-ai\/dsh-agent-preset"$/m,
    'the declaration must be a @deepseek-ai/dsh-agent-preset row: that is how 0.2 ' +
      'registers a preset (the ≤0.1.5 $DSH_HOME/.agent-presets scan is gone)',
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
        `(${JSON.stringify(pkg.name)}), got ${JSON.stringify(name)}. A relative './' row ` +
        `resolves against the profile directory on 0.2, not the preset directory.`,
    );
  }
});

test('the legacy directory-planter row is not wired into the 0.2 patch', async () => {
  const patch = await read('../cordis.patch.yml');
  assert.doesNotMatch(
    patch,
    /engineering-installer/,
    'index.js plants into $DSH_HOME/.agent-presets, a directory harness 0.2 never reads: ' +
      'the row must not be inserted (the ≤0.1.5 path is the published v0.1.0 tag).',
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
