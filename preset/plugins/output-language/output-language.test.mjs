/**
 * Self-test for the output-language plugin.
 *
 * No test framework: it asserts and exits non-zero, so it runs standalone under
 * the harness's own Node, and `npm test`'s plugin glob collects it (every
 * preset-local plugin ships one; there is no install-time gate any more).
 * Named `output-language.test.mjs` for that glob.
 *
 * The plugin imports nothing from the harness, so this file needs no
 * `node_modules` link. It never starts an agent: the renderers are pure
 * functions and the settings read is driven with fake contexts. The section
 * registration and the pre-step injection are pinned by later assertion groups
 * appended to this file.
 *
 * Usage: node preset/plugins/output-language/output-language.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  DIRECTIVE_VERBATIM,
  LANGUAGE_TAG,
  REMINDER_VERBATIM,
  SECTION_NAME,
  SECTION_ORDER,
  apply,
  createUserMessage,
  hasHumanMessage,
  name,
  renderLanguageDirective,
  renderLanguageReminder,
  resolveLanguageTag,
} from './index.js'

/**
 * Independent goldens: both frozen lines for each of the four states, copied
 * verbatim out of spec §6
 * (`docs/superpowers/specs/2026-09-23-output-language-v2-design.md`).
 *
 * Whole lines on purpose, never assembled from the sentences the implementation
 * also names: a part-wise helper proves "each sentence I asked for came back",
 * while a whole-line golden proves "the line is exactly what the spec froze" —
 * and goes red the moment any one part is dropped, reordered, or reworded.
 * `scripts/output-language.test.mjs` cross-checks these lines against the spec
 * file itself; these literals stay independent of both plugin and spec.
 */
const DIRECTIVE = {
  zh: "Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in 中文 (zh). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  en: "Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in English (en). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in English on every single call — not only when the surrounding command or path happens to be in English. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  ja: "Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in ja (ja). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in ja on every single call — not only when the surrounding command or path happens to be in ja. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.",
  unset: "Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in 中文 (zh). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.",
}

const REMINDER = {
  zh: "Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.",
  en: "Language: English (en). Reason, reply, narrate, and write every artifact in English only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.",
  ja: "Language: ja (ja). Reason, reply, narrate, and write every artifact in ja only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.",
  unset: "Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.",
}

assert.equal(name, 'output-language', 'plugin name')

// 1. The directive names the interface language for the three readable states,
//    and the unreadable state falls back to Chinese (the owner's decision):
//    identical to the zh line, never a "not set / never assume" branch.
for (const [tag, expected, label] of [
  ['zh', DIRECTIVE.zh, 'zh'],
  ['en', DIRECTIVE.en, 'en'],
  ['ja', DIRECTIVE.ja, 'unmapped tag used as its own label'],
  [undefined, DIRECTIVE.unset, 'unreadable -> Chinese fallback'],
]) {
  assert.equal(
    renderLanguageDirective(tag),
    expected,
    `renderLanguageDirective(${String(tag)}) must equal the frozen spec §6 line (${label})`,
  )
}

// 2. Same four states for the per-message reminder.
for (const [tag, expected, label] of [
  ['zh', REMINDER.zh, 'zh'],
  ['en', REMINDER.en, 'en'],
  ['ja', REMINDER.ja, 'unmapped tag used as its own label'],
  [undefined, REMINDER.unset, 'unreadable -> Chinese fallback'],
]) {
  assert.equal(
    renderLanguageReminder(tag),
    expected,
    `renderLanguageReminder(${String(tag)}) must equal the frozen spec §6 line (${label})`,
  )
}

// 3. Malformed input is treated exactly like unreadable input, in both
//    renderers; neither ever returns an empty string (an empty contribution
//    would drop the constraint entirely).
for (const bad of [null, '', '中文', 'zh_CN', 'zh ', 123, {}]) {
  assert.equal(renderLanguageDirective(bad), DIRECTIVE.unset, `directive fallback for ${JSON.stringify(bad)}`)
  assert.equal(renderLanguageReminder(bad), REMINDER.unset, `reminder fallback for ${JSON.stringify(bad)}`)
}
for (const tag of ['zh', 'en', 'ja', undefined]) {
  assert.ok(renderLanguageDirective(tag).length > 0, `directive never empty (${String(tag)})`)
  assert.ok(renderLanguageReminder(tag).length > 0, `reminder never empty (${String(tag)})`)
}

// 4. Both texts name the language twice (label + target) and carry the verbatim
//    clause: these are the two properties a rewording could silently drop. The
//    "never another language" check spans the terminating punctuation on purpose
//    — the clause grew an `, including those tool-call fields …` tail, and the
//    guard is about the prohibition, not about which mark ends it.
for (const tag of ['zh', 'en', 'ja', undefined]) {
  const directive = renderLanguageDirective(tag)
  assert.match(
    directive,
    /Never write any of it in another language[.,]/,
    'directive forbids other languages',
  )
  assert.ok(
    directive.endsWith(DIRECTIVE_VERBATIM),
    'directive closes with the verbatim clause (tool names and enum values included)',
  )
  assert.ok(
    renderLanguageReminder(tag).includes('Keep code, commands, paths, and errors verbatim.'),
    'reminder keeps code verbatim',
  )
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

// 7. In v2 the renderers, not the resolver, own the Chinese fallback: the
//    resolver's contract is unchanged (undefined means "unreadable"), and
//    `undefined` renders the zh line. This is the deliberate behaviour change
//    from v1, where `undefined` rendered a "never assume one" branch.
assert.equal(renderLanguageDirective(undefined), DIRECTIVE.zh, 'unreadable directive == zh directive')
assert.equal(renderLanguageReminder(undefined), REMINDER.zh, 'unreadable reminder == zh reminder')

// 8. A throwing context degrades to undefined and warns at most once per
//    process. `warned` is module state, so this asks for a *fresh* module
//    instance (`?warn-once`): the once-per-process contract is then observable
//    here no matter how many other cases above already tripped the guard.
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

// 9. A throwing ctx with NO logger: still never throws, still returns undefined
//    (`ctx?.logger?.warn?.` must stay optional-chained end to end).
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

// 10. Self-contained: the plugin source imports nothing from the harness.
//
//     The pattern matches a real import specifier (a quoted `@deepseek-ai/…`),
//     not the bare string: the module's own JSDoc states the rule — "must not
//     import any `@deepseek-ai/*` package" — and a plain `includes` check would
//     fail on that documentation while proving nothing about the imports.
const source = await readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
assert.ok(
  !/(?:from|import)\s*\(?\s*['"]@deepseek-ai\//.test(source),
  'plugin must not import harness packages',
)

// 11. `apply` registers exactly one dynamic SECTION and NO runtime context.
//     The context assertion is the regression for the v1 delivery layer: a
//     leftover `context()` call would publish a second, weaker copy of the rule
//     as a user-role history message, which is precisely what v2 replaces.
const injected = []
const sectionCalls = []
const contextCalls = []
// Mutable settings document on purpose: the section provider must read it at
// use time. A snapshot taken at registration would pass a one-shot assertion
// and silently break "a settings change applies to the next turn", so the
// second read must follow the change.
const liveSettings = { preference: 'en' }
const fakeCtx = {
  get: () => ({ get: () => liveSettings }),
  inject(services, callback) {
    injected.push(services)
    callback({
      systemPrompt: {
        section: (entry) => sectionCalls.push(entry),
        context: (entry) => contextCalls.push(entry),
      },
    })
  },
  on: () => () => {},
  logger: { warn: () => {} },
}
apply(fakeCtx)
assert.deepEqual(injected, [['systemPrompt']], 'injects the systemPrompt service')
assert.equal(sectionCalls.length, 1, 'registers exactly one system-prompt section')
assert.equal(sectionCalls[0].name, SECTION_NAME, 'section name')
assert.equal(sectionCalls[0].order, SECTION_ORDER, 'section order sits above the persona prefix')
assert.equal(sectionCalls[0].order, -1, 'section order is -1')
assert.equal(typeof sectionCalls[0].text, 'function', 'section text is a provider, not a frozen string')
assert.equal(contextCalls.length, 0, 'v2 registers no runtime context: the user-role delivery layer is gone')
assert.equal(sectionCalls[0].text(), DIRECTIVE.en, 'provider renders the live setting')
liveSettings.preference = 'zh'
assert.equal(
  sectionCalls[0].text(),
  DIRECTIVE.zh,
  'provider re-reads the setting on every assembly (dynamic, not a snapshot)',
)

// 12. A harness whose systemPrompt has no `section()` must lose L1 only: the
//     failure is swallowed, warned once, and never reaches the session start.
const noSectionWarnings = []
const legacyCtx = {
  get: () => ({ get: () => liveSettings }),
  inject(services, callback) {
    callback({ systemPrompt: { context: () => {} } })
  },
  on: () => () => {},
  logger: { warn: (message) => noSectionWarnings.push(message) },
}
assert.doesNotThrow(() => apply(legacyCtx), 'a missing section() must not break the mount')
assert.equal(noSectionWarnings.length, 1, 'the degraded mount warns exactly once')
assert.match(
  noSectionWarnings[0],
  /output-language: systemPrompt\.section\(\) unavailable/,
  'the warning names the lost capability',
)

// 13. The pre-step listener appends exactly one reminder after the human
//     message it is answering, and stays silent on every other batch shape.
const listeners = []
const reminderSettings = { preference: 'zh' }
const reminderCtx = {
  get: () => ({ get: () => reminderSettings }),
  inject: (services, callback) => callback({ systemPrompt: { section: () => {}, context: () => {} } }),
  on(event, listener) {
    listeners.push({ event, listener })
    return () => {}
  },
  logger: { warn: () => {} },
}
apply(reminderCtx)
assert.equal(listeners.length, 1, 'installs exactly one pre-step listener')
assert.equal(listeners[0].event, 'agent/pre-step', 'listens on agent/pre-step')

const reminderListener = listeners[0].listener
const textOf = (message) =>
  message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')

async function preStep({ messages, kind = 'enter', aborted = false }) {
  return reminderListener({ signal: { aborted } }, async () => ({ kind, messages }))
}

const humanMessage = createUserMessage({
  content: [{ type: 'text', text: '审查一下agents.md' }],
  source: { kind: 'user' },
})
const engineMessage = createUserMessage({
  content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes …' }],
  source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
})

// 13a. A step answering the human gets the reminder appended after the batch.
const answered = await preStep({ messages: [humanMessage] })
assert.equal(answered.kind, 'enter')
assert.equal(answered.messages.length, 2, 'reminder appended after the claimed message')
assert.equal(answered.messages[0], humanMessage, 'the claimed message still leads the batch')
assert.equal(answered.messages[1].role, 'user', 'reminder is user-role')
assert.equal(answered.messages[1].source.plugin, name, 'reminder source names this plugin')
assert.equal(answered.messages[1].source.kind, 'plugin', 'reminder source is plugin-owned')
assert.equal(textOf(answered.messages[1]), REMINDER.zh, 'reminder renders the live setting')
assert.ok(Object.isFrozen(answered.messages[1]), 'the injected message is frozen')
assert.notEqual(answered.messages[1].id, humanMessage.id, 'reminder gets a fresh identity')

// 13b. THE POINT OF L2: the reminder follows EVERY human message, not the first
//      one. A history-based dedup would inject once per session and lose the
//      recency anchor this layer exists for.
const again = await preStep({
  messages: [createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } })],
})
assert.equal(again.messages.length, 2, 'a second human message gets its own reminder')

// 13c. Batches with no human message are left alone: maintenance steps, pure
//      tool continuations, and the bootstrap's own injection.
const engineOnly = await preStep({ messages: [engineMessage] })
assert.equal(engineOnly.messages.length, 1, 'a plugin-only batch is untouched')
const empty = await preStep({ messages: [] })
assert.equal(empty.messages.length, 0, 'an empty batch is untouched')

// 13d. A human message with no text block does not count.
const imageless = createUserMessage({ content: [], source: { kind: 'user' } })
const noText = await preStep({ messages: [imageless] })
assert.equal(noText.messages.length, 1, 'a text-less human message is not a language cue')

// 13e. Rejected and aborted steps are untouched.
const rejected = await preStep({ messages: [humanMessage], kind: 'reject' })
assert.equal(rejected.kind, 'reject')
assert.equal(rejected.messages.length, 1, 'a rejected step is untouched')
const aborted = await preStep({ messages: [humanMessage], aborted: true })
assert.equal(aborted.messages.length, 1, 'an aborted step is untouched')

// 13f. A batch where the human message is not last still gets the reminder
//      appended at the end (the harness appends injected messages).
const mixed = await preStep({ messages: [engineMessage, humanMessage] })
assert.equal(mixed.messages.length, 3, 'reminder appended at the end of the batch')
assert.equal(textOf(mixed.messages[2]), REMINDER.zh, 'reminder is last')

// 13g. The reminder is dynamic too: a settings change applies to the next one.
reminderSettings.preference = 'en'
const inEnglish = await preStep({ messages: [humanMessage] })
assert.equal(textOf(inEnglish.messages[1]), REMINDER.en, 'the reminder re-reads the setting')

// 14. `hasHumanMessage` is the whole condition, so pin it directly.
assert.equal(hasHumanMessage([humanMessage]), true, 'a human text message counts')
assert.equal(hasHumanMessage([engineMessage]), false, 'a plugin message does not')
assert.equal(hasHumanMessage([]), false, 'an empty batch does not')
assert.equal(hasHumanMessage(undefined), false, 'a missing batch does not')
assert.equal(hasHumanMessage('nope'), false, 'a non-array does not')
assert.equal(
  hasHumanMessage([createUserMessage({ content: [{ type: 'text', text: '' }], source: { kind: 'user' } })]),
  false,
  'an empty text block does not count',
)

console.log('selftest OK: output-language')
