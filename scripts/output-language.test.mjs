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

/** The line that opens every branch. Doubles as the README example's anchor. */
const RULE_SENTENCE = "Output-language rule: write in the language of the user's message."

/**
 * Pull the one fenced line in `text` that matches `pattern`.
 *
 * `pattern` is an already-escaped regex fragment; it is anchored to a whole
 * fenced line here (`^`…`$` around the fences). Callers must pin their fragment
 * unambiguously, because the spec's full-line example legitimately begins with
 * the rule sentence: a prefix or a lazy `[^\n]*?` would match that example too
 * (the lazy tail backtracks past the sentence end and swallows the whole line),
 * and would even keep matching one fence after the sentence was rewritten —
 * exactly the drift this guard exists to catch.
 *
 * Ambiguity is fatal on purpose: the spec is the frozen copy, so zero matches
 * (the sentence was rewritten or unfenced) or more than one means the coupling
 * between spec and implementation is no longer knowable, and the guard must
 * refuse to guess rather than pass on the first hit.
 */
function fencedLine(text, pattern) {
  const matches = [
    ...text.matchAll(new RegExp('^```\\n(' + pattern + ')\\n```$', 'gm')),
  ].map((match) => match[1]);
  assert.equal(
    matches.length,
    1,
    `expected exactly one fenced line matching "${pattern.slice(0, 40)}…", found ${matches.length}`,
  );
  return matches[0];
}

test('the README publishes the zh line verbatim, so the example cannot fork', async () => {
  const readme = await read('../README.md');
  // The contract is that this example sits in the 输出语言 section; a README
  // that renames, splits, or moves the line changes the published facts.
  assert.ok(readme.includes('## 输出语言'), 'README must still carry a 输出语言 section');
  const section = readme.split(/^## 输出语言$/m)[1]?.split(/^## /m)[0];
  assert.ok(section, 'README must still have a 输出语言 section');
  const matches = section.split('\n').filter((line) => line.startsWith(RULE_SENTENCE));
  assert.equal(
    matches.length,
    1,
    'the 输出语言 section must publish exactly one full zh line, starting with the rule sentence; ' +
      `found ${matches.length}`,
  );
  const { renderLanguageContext } = await import('../preset/plugins/output-language/index.js');
  assert.equal(
    matches[0],
    renderLanguageContext('zh'),
    'README\'s zh example must equal renderLanguageContext(\'zh\') character for character — ' +
      'it is one of the three frozen copies, so a fork here silently publishes a line no session renders',
  );
});

test('the frozen clauses in spec section 6 still match the rendered output', async () => {
  const spec = await read('../docs/superpowers/specs/2026-09-17-output-language-design.md');
  const section6 = spec.split(/^## 6\./m)[1]?.split(/^## 7\./m)[0];
  assert.ok(section6, 'spec must still have a section 6 (渲染规则)');
  // Section 6 freezes four parts: the leading rule, one interface-language
  // clause per state, the coverage sentence, and the fixed closing sentence.
  // Each is pulled from its own fenced block or table row, so the extraction
  // survives prose edits around them — but every pattern pins the sentence's
  // own end (a literal tail, plus a negative lookahead where the full-line
  // example would otherwise also match), so a rewritten sentence fails
  // extraction instead of matching a lookalike. Ambiguity throws inside
  // `fencedLine`; the table row count is asserted below.
  const rule = fencedLine(
    section6,
    "Output-language rule: write in the language of the user's message\\.(?![^\\n]*Interface)",
  );
  const coverage = fencedLine(
    section6,
    'Apply this to your replies and every workflow artifact[^\\n]*?\\.(?![^\\n]*Keep code)',
  );
  const verbatim = fencedLine(
    section6,
    'Keep code, identifiers, commands, file paths, and error text[^\\n]*?\\.$',
  );
  const clauses = [
    ...section6.matchAll(/^\|\s*[^|]+?\s*\|\s*`(Interface language: [^`]+)`\s*\|\s*$/gm),
  ].map((match) => match[1]);
  assert.equal(clauses.length, 4, 'spec section 6 must list exactly four interface-language clauses');
  const [zh, en, ja, unset] = clauses;
  const { renderLanguageContext } = await import('../preset/plugins/output-language/index.js');
  // Whole-line equality, not `includes`: the four parts are reassembled in the
  // order the spec declares them (template = 规则句 + 界面语言子句 + 覆盖句 +
  // 固定尾句) and compared character for character. `includes` would still pass
  // if the implementation dropped the rule sentence entirely and kept only the
  // clause, or silently swapped two sentences; this cannot.
  const states = [
    ['zh', zh, 'zh (Chinese)'],
    ['en', en, 'en (English)'],
    ['ja', ja, 'ja'],
    [undefined, unset, 'not set'],
  ];
  for (const [tag, clause, label] of states) {
    const expected = `${rule} ${clause} ${coverage} ${verbatim}`;
    assert.equal(
      renderLanguageContext(tag),
      expected,
      `spec section 6's four frozen parts, reassembled for ${String(tag)} (${label}), must ` +
        'equal the rendered line verbatim — a missing, reordered, or reworded part fails here',
    );
  }
  // The spec's own full-line example is the fifth copy of the same text. Tying
  // it to the four parts proves the parts are being assembled in the spec's
  // declared order, not merely that each one appears somewhere in the output.
  const fullLines = [...section6.matchAll(/^Output-language rule:.*Interface language:.*$/gm)].map(
    (match) => match[0],
  );
  assert.equal(
    fullLines.length,
    1,
    `spec section 6 must publish exactly one full-line example; found ${fullLines.length}`,
  );
  assert.equal(
    fullLines[0],
    `${rule} ${zh} ${coverage} ${verbatim}`,
    "spec section 6's full-line example must equal its four frozen parts in the declared order",
  );
  assert.equal(
    fullLines[0],
    renderLanguageContext('zh'),
    "spec section 6's full-line example must equal renderLanguageContext('zh')",
  );
});
