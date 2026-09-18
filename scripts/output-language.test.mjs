// scripts/output-language.test.mjs
//
// Guards the preset-level half of the output-language feature: the composition
// row that mounts the plugin, the plugin's exported surface, and the frozen
// clauses the docs publish. The plugin's own self-test
// (preset/plugins/output-language/output-language.test.mjs) owns the rendering
// contract; this file owns the facts whose drift would silently drop the
// interface-language rule from every session, or silently fork the frozen text.
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
  assert.match(
    composition,
    /- id: output-language\n\s+name: '\.\/plugins\/output-language\/index\.js'/,
    'preset/agent.cordis.yml must keep the id `output-language` on the row that ' +
      'mounts the plugin, directly beside its name row. The id is what the mount is ' +
      'addressed by; a name-only match would still pass if the id were dropped.',
  );
});

test('the plugin module exports the surface the composition row needs', async () => {
  const plugin = await import('../preset/plugins/output-language/index.js');
  for (const key of ['apply', 'renderLanguageContext', 'resolveLanguageTag']) {
    assert.equal(typeof plugin[key], 'function', `plugin must export ${key} as a function`);
  }
  assert.equal(plugin.name, 'output-language', 'plugin name');
});

test('the frozen clauses in spec section 6 still match the rendered output', async () => {
  const spec = await read('../docs/superpowers/specs/2026-09-17-output-language-design.md');
  const section6 = spec.split(/^## 6\./m)[1]?.split(/^## 7\./m)[0];
  assert.ok(section6, 'spec must still have a section 6 (渲染规则)');
  // The rows are paired positionally with zh / en / ja / not-set, which is the
  // order the spec declares. Reordering the rows makes these assertions fail
  // loudly (each clause is checked against its own tag's output), never pass.
  const clauses = [
    ...section6.matchAll(/^\|\s*[^|]+?\s*\|\s*`(Interface language: [^`]+)`\s*\|\s*$/gm),
  ].map((match) => match[1]);
  assert.equal(clauses.length, 4, 'spec section 6 must list exactly four interface-language clauses');
  const [zh, en, ja, unset] = clauses;
  const { renderLanguageContext } = await import('../preset/plugins/output-language/index.js');
  for (const [tag, clause] of [['zh', zh], ['en', en], ['ja', ja], [undefined, unset]]) {
    assert.ok(
      renderLanguageContext(tag).includes(clause),
      `spec section 6 clause for ${String(tag)} must appear verbatim in the rendered ` +
        `output; spec says: ${clause}`,
    );
  }
});
