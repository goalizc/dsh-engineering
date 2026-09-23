// scripts/output-language.test.mjs
//
// Guards the preset-level half of the output-language feature: the composition
// row that mounts the plugin, the plugin's exported surface, and the frozen
// clauses the docs publish. The plugin's own self-test
// (preset/plugins/output-language/output-language.test.mjs) owns the rendering
// contract; this file owns the facts whose drift would silently drop the
// interface-language directive from every session, or silently fork the frozen
// text.
//
// The authoritative frozen copy is spec §6 of the v2 design document. The v1
// document's clauses are superseded and are NOT asserted here — two documents
// claiming to be the frozen source is exactly the ambiguity this guard removes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SPEC = '../docs/superpowers/specs/2026-09-23-output-language-v2-design.md';
const README_RULE_PREFIXES = ['Output-language directive: ', 'Language: '];

test('the composition mounts the output-language plugin', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  assert.ok(
    composition.includes("name: './plugins/output-language/index.js'"),
    "preset/agent.cordis.yml must mount './plugins/output-language/index.js'. " +
      'Losing that row silently removes the interface-language directive from every session.',
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
  for (const key of [
    'apply',
    'renderLanguageDirective',
    'renderLanguageReminder',
    'resolveLanguageTag',
    'hasHumanMessage',
  ]) {
    assert.equal(typeof plugin[key], 'function', `plugin must export ${key} as a function`);
  }
  assert.equal(plugin.name, 'output-language', 'plugin name');
  assert.equal(plugin.SECTION_ORDER, -1, 'the section sits between identity (-1000) and persona (0)');
  assert.ok(!('renderLanguageContext' in plugin), 'the v1 renderer must be gone, not kept as an alias');
});

/**
 * Extract the frozen lines from spec §6.
 *
 * The spec deliberately prints the eight state lines WITHOUT code fences and
 * keeps the two templates fenced. Extraction therefore has a sharp shape: each
 * prefix yields exactly five lines (one template + four states), the template is
 * the one carrying `{language}`, and exactly four state lines must remain.
 *
 * Ambiguity is fatal on purpose: zero or extra lines mean the coupling between
 * spec and implementation is no longer knowable, and the guard must refuse to
 * guess rather than pass on the first hit.
 */
function frozenStateLines(section, prefix) {
  const lines = section.split('\n').filter((line) => line.startsWith(prefix));
  assert.equal(
    lines.length,
    5,
    `spec §6 must carry exactly one ${JSON.stringify(prefix)} template plus four state lines, found ${lines.length}`,
  );
  const states = lines.filter((line) => !line.includes('{language}'));
  assert.equal(
    states.length,
    4,
    `spec §6 must carry exactly four ${JSON.stringify(prefix)} state lines, found ${states.length}`,
  );
  return states;
}

test('spec section 6 freezes both renderers for all four states', async () => {
  const spec = await read(SPEC);
  const section6 = spec.split(/^## 6\./m)[1]?.split(/^## 7\./m)[0];
  assert.ok(section6, 'the v2 spec must still have a section 6 (渲染规则)');
  const plugin = await import('../preset/plugins/output-language/index.js');

  const directives = frozenStateLines(section6, 'Output-language directive: ');
  const reminders = frozenStateLines(section6, 'Language: ');

  // Position, not membership: the spec fixes the order zh / en / ja / fallback,
  // and each line must equal the renderer's output for that same state.
  const states = [
    ['zh', '中文 (zh)'],
    ['en', 'English (en)'],
    ['ja', 'ja (ja)'],
    [undefined, '中文 (zh)'],
  ];
  states.forEach(([tag, label], index) => {
    assert.equal(
      plugin.renderLanguageDirective(tag),
      directives[index],
      `renderLanguageDirective(${String(tag)}) must equal spec §6's ${label} line verbatim — ` +
        'a missing, reordered, or reworded clause fails here',
    );
    assert.equal(
      plugin.renderLanguageReminder(tag),
      reminders[index],
      `renderLanguageReminder(${String(tag)}) must equal spec §6's ${label} line verbatim`,
    );
  });
});

test('the README publishes both zh lines verbatim, so the examples cannot fork', async () => {
  const readme = await read('../README.md');
  assert.ok(readme.includes('## 输出语言'), 'README must still carry a 输出语言 section');
  const section = readme.split(/^## 输出语言$/m)[1]?.split(/^## /m)[0];
  assert.ok(section, 'README must still have a 输出语言 section');
  const plugin = await import('../preset/plugins/output-language/index.js');

  for (const prefix of README_RULE_PREFIXES) {
    const found = section.split('\n').filter((line) => line.startsWith(prefix));
    assert.equal(
      found.length,
      1,
      `the 输出语言 section must publish exactly one line starting with ${JSON.stringify(prefix)}; found ${found.length}`,
    );
  }
  const directiveLine = section.split('\n').find((line) => line.startsWith('Output-language directive: '));
  const reminderLine = section.split('\n').find((line) => line.startsWith('Language: '));
  assert.equal(
    directiveLine,
    plugin.renderLanguageDirective('zh'),
    "README's L1 example must equal renderLanguageDirective('zh') character for character — " +
      'it is one of the frozen copies, so a fork here silently publishes a line no session renders',
  );
  assert.equal(
    reminderLine,
    plugin.renderLanguageReminder('zh'),
    "README's L2 example must equal renderLanguageReminder('zh') character for character",
  );
});
