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

/**
 * Independent goldens: the frozen contribution for each of the four states,
 * copied verbatim out of spec §6
 * (`docs/superpowers/specs/2026-09-17-output-language-design.md`).
 *
 * Whole lines on purpose, never assembled from the sentences the implementation
 * also names: a part-wise helper proves "each sentence I asked for came back",
 * while a whole-line golden proves "the line is exactly what the spec froze" —
 * and goes red the moment any one sentence is dropped, reordered, or reworded.
 * `scripts/output-language.test.mjs` cross-checks these clauses against the spec
 * file itself; these literals stay independent of both plugin and spec.
 */
const GOLDEN = {
  zh: "Output-language rule: write in the language of the user's message. Interface language: zh (Chinese) — use Chinese only when the user's message gives no language cue. Apply this to your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  en: "Output-language rule: write in the language of the user's message. Interface language: en (English) — use English only when the user's message gives no language cue. Apply this to your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  ja: "Output-language rule: write in the language of the user's message. Interface language: ja — use ja only when the user's message gives no language cue. Apply this to your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  unset: "Output-language rule: write in the language of the user's message. Interface language: not set — never assume one; switch whenever the user switches language. Apply this to your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.",
}

/** The fixed closing clause every branch must carry. */
const VERBATIM =
  'Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.'

assert.equal(name, 'output-language', 'plugin name')

// 1. zh renders the frozen spec text verbatim — punctuation included.
assert.equal(
  renderLanguageContext('zh'),
  GOLDEN.zh,
  'zh renders the full frozen line verbatim (independent spec golden)',
)

// 2. en names English and rides the fallback clause.
assert.equal(
  renderLanguageContext('en'),
  GOLDEN.en,
  'en renders the full frozen line verbatim (independent spec golden)',
)

// 3. An unmapped but well-formed tag is used as-is, never guessed at.
assert.equal(
  renderLanguageContext('ja'),
  GOLDEN.ja,
  'unmapped tag is its own label and target, never guessed at',
)

// 4a. Unreadable or malformed input delegates to the user, and is never empty.
assert.equal(
  renderLanguageContext(undefined),
  GOLDEN.unset,
  'the not-set state renders its own full frozen line',
)
for (const bad of [null, '', '中文', 'zh_CN', 'zh ', 123, {}]) {
  const text = renderLanguageContext(bad)
  assert.equal(text, GOLDEN.unset, `not-set line for ${JSON.stringify(bad)}`)
  assert.ok(
    text.includes("language of the user's message"),
    `delegates to the user's language for ${JSON.stringify(bad)}`,
  )
  assert.ok(text.includes(VERBATIM), `verbatim clause present for ${JSON.stringify(bad)}`)
  assert.ok(text.length > 0, 'never renders an empty contribution')
}

// 4b. Rule order is the fix for the observed defect: the follow-the-user rule
//     must precede the interface-language clause in EVERY branch, or the model
//     executes the interface-language command and ignores the exception.
for (const tag of ['zh', 'en', 'ja', undefined]) {
  const text = renderLanguageContext(tag)
  const rule = text.indexOf("language of the user's message")
  const iface = text.indexOf('Interface language:')
  assert.ok(rule !== -1, `every branch states the user-language rule (${String(tag)})`)
  assert.ok(iface !== -1, `every branch still names the interface language (${String(tag)})`)
  assert.ok(rule < iface, `the user-language rule must precede the interface-language clause (${String(tag)})`)
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

// 6b. A throwing context degrades to undefined and warns at most once per
//     process. `warned` is module state, so this asks for a *fresh* module
//     instance (`?warn-once`): the once-per-process contract is then observable
//     here no matter how many other cases above already tripped the guard.
const fresh = await import('./index.js?warn-once')
const warnings = []
const throwingCtx = {
  get: () => {
    throw new Error('boom')
  },
  logger: { warn: (message) => warnings.push(message) },
}
assert.equal(fresh.resolveLanguageTag(throwingCtx), undefined, 'throwing settings -> undefined')
assert.equal(warnings.length, 1, 'the first failure warns')
assert.match(
  warnings[0],
  /output-language: cannot read "locale\.preference"/,
  'the warning names the plugin and the unreadable setting',
)
assert.equal(fresh.resolveLanguageTag(throwingCtx), undefined, 'the second throw still -> undefined')
assert.equal(warnings.length, 1, 'the second failure must not warn again (warnOnce)')

// 6c. A throwing ctx with NO logger: still never throws, still returns undefined
//     (`ctx?.logger?.warn?.` must stay optional-chained end to end).
const loggerlessCtx = {
  get: () => {
    throw new Error('boom')
  },
}
let loggerlessResult
assert.doesNotThrow(() => {
  loggerlessResult = resolveLanguageTag(loggerlessCtx)
}, 'a throwing ctx without a logger must not propagate the error')
assert.equal(loggerlessResult, undefined, 'throwing ctx without logger -> undefined')

// 7. The plugin registers exactly one dynamic context line, and re-evaluates it.
const registered = []
const injected = []
// Mutable settings document on purpose: the provider must read it on every
// call. A value snapshot taken at registration time would still pass the
// one-shot assertion below and silently break "a settings change applies to the
// next assembly", so the second read must follow the change.
const liveSettings = { preference: 'en' }
const fakeCtx = {
  get: () => ({ get: () => liveSettings }),
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
assert.equal(registered[0].text(), GOLDEN.en, 'provider renders the live setting')
liveSettings.preference = 'zh'
assert.equal(
  registered[0].text(),
  GOLDEN.zh,
  'provider re-reads the setting on every assembly (dynamic, not a snapshot)',
)

// 8. Self-contained: the plugin source imports nothing from the harness.
const source = await readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
assert.ok(!source.includes('@deepseek-ai/'), 'plugin must not import harness packages')

console.log('selftest OK: output-language')
