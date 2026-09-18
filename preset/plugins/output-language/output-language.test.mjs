/**
 * Self-test for the output-language plugin.
 *
 * No test framework: it asserts and exits non-zero, so it runs standalone under
 * the harness's own Node — `scripts/install.sh` runs every preset-local plugin's
 * same-named self-test as an install gate, and a plugin without one fails the
 * install. Named `output-language.test.mjs` so `npm test`'s plugin glob collects
 * it too.
 *
 * The plugin imports nothing from the harness, so this file needs no
 * `node_modules` link. It never starts an agent: rendering is a pure function,
 * and the settings read is driven with fake contexts.
 *
 * Usage: node preset/plugins/output-language/output-language.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { LANGUAGE_TAG, apply, name, renderLanguageContext, resolveLanguageTag } from './index.js'

/** The fixed closing clause every branch must carry. */
const VERBATIM =
  'Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.'

/** The shared phrase naming what the rule covers. */
const COVERED =
  'your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items —'

assert.equal(name, 'output-language', 'plugin name')

// 1. zh renders the frozen spec text verbatim — punctuation included.
assert.equal(
  renderLanguageContext('zh'),
  `Interface language: zh (Chinese). Write ${COVERED} in Chinese. If the user writes in another language, answer that message in the user's language instead. ${VERBATIM}`,
  'zh renders the Chinese rule verbatim',
)

// 2. en names English and targets it.
const en = renderLanguageContext('en')
assert.ok(en.startsWith('Interface language: en (English). Write '), 'en names English')
assert.ok(en.includes(' in English.'), 'en targets English')

// 3. An unmapped but well-formed tag is used as-is, never guessed at.
const ja = renderLanguageContext('ja')
assert.ok(ja.startsWith('Interface language: ja. Write '), 'unmapped tag is not labelled with a guessed name')
assert.ok(ja.includes('in ja.'), 'unmapped tag is its own target language')

// 4. Unreadable or malformed input delegates to the user, and is never empty.
for (const bad of [undefined, null, '', '中文', 'zh_CN', 'zh ', 123, {}]) {
  const text = renderLanguageContext(bad)
  assert.ok(
    text.startsWith('Interface language: not set. Write '),
    `not-set branch for ${JSON.stringify(bad)}`,
  )
  assert.ok(
    text.includes("in the language of the user's message"),
    `delegates to the user's language for ${JSON.stringify(bad)}`,
  )
  assert.ok(text.includes(VERBATIM), `verbatim clause present for ${JSON.stringify(bad)}`)
  assert.ok(text.length > 0, 'never renders an empty contribution')
}

// 5. The tag shape matches the harness's own BCP 47-style ids.
for (const good of ['zh', 'en', 'zh-Hans', 'pt-BR']) assert.ok(LANGUAGE_TAG.test(good), good)
for (const bad of ['zh_CN', '中文', 'z', '']) assert.ok(!LANGUAGE_TAG.test(bad), bad)

// 6. Reading the setting never throws, with or without a settings service.
assert.equal(resolveLanguageTag(undefined), undefined, 'no ctx -> undefined')
assert.equal(resolveLanguageTag({}), undefined, 'no service -> undefined')
assert.equal(
  resolveLanguageTag({ get: () => ({ get: () => ({ preference: 'zh' }) }) }),
  'zh',
  'service value is read',
)
assert.equal(
  resolveLanguageTag({ get: () => ({ get: () => ({ preference: ' zh ' }) }) }),
  'zh',
  'surrounding whitespace is trimmed',
)
assert.equal(
  resolveLanguageTag({ get: () => ({ get: () => ({ preference: 'zh_CN' }) }) }),
  undefined,
  'malformed value -> undefined',
)
assert.equal(
  resolveLanguageTag({ get: () => { throw new Error('boom') } }),
  undefined,
  'throwing ctx -> undefined',
)

// 7. The plugin registers exactly one dynamic context line, and re-evaluates it.
const registered = []
const injected = []
const fakeCtx = {
  get: () => ({ get: () => ({ preference: 'en' }) }),
  inject(services, callback) {
    injected.push(services)
    callback({ systemPrompt: { context: (entry) => registered.push(entry) } })
  },
  logger: { warn: () => {} },
}
apply(fakeCtx)
assert.deepEqual(injected, [['systemPrompt']], 'injects the systemPrompt service')
assert.equal(registered.length, 1, 'registers exactly one context')
assert.equal(registered[0].name, 'output-language', 'context name')
assert.equal(registered[0].order, 105, 'context order')
assert.equal(typeof registered[0].text, 'function', 'text is a provider, not a frozen string')
assert.ok(
  registered[0].text().startsWith('Interface language: en (English).'),
  'provider renders the live setting',
)

// 8. Self-contained: the plugin source imports nothing from the harness.
const source = await readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
assert.ok(!source.includes('@deepseek-ai/'), 'plugin must not import harness packages')

console.log('selftest OK: output-language')
