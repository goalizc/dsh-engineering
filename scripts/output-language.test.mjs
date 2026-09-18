// scripts/output-language.test.mjs
//
// Guards the preset-level half of the output-language feature: the composition
// row that mounts the plugin, and the plugin's exported surface. The plugin's
// own self-test (preset/plugins/output-language/output-language.test.mjs) owns
// the rendering contract; this file owns the facts whose drift would silently
// drop the interface-language rule from every session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the composition mounts the output-language plugin', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  assert.ok(
    composition.includes("name: './plugins/output-language/index.js'"),
    "preset/agent.cordis.yml must mount './plugins/output-language/index.js'. " +
      'Losing that row silently removes the interface-language rule from every session.',
  );
});

test('the plugin module exports the surface the composition row needs', async () => {
  const plugin = await import('../preset/plugins/output-language/index.js');
  for (const key of ['name', 'apply', 'renderLanguageContext', 'resolveLanguageTag']) {
    assert.ok(key in plugin, `plugin must export ${key}`);
  }
  assert.equal(plugin.name, 'output-language');
});
