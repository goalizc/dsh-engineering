/**
 * Self-test for the Superpowers bootstrap plugin.
 *
 * Runs with the harness's own Node, from this preset's plugin directory. The
 * plugin imports nothing from the harness — the `createUserMessage` helper it
 * uses is self-contained — so this test needs no `node_modules` link and passes
 * with no harness packages on the resolution path. No test framework: it
 * asserts and exits non-zero. Named `bootstrap.test.mjs` so `npm test` collects
 * it (the glob covers every plugin directory's `*.test.mjs`); it also runs
 * standalone.
 *
 * The test does not run a real agent. It drives the plugin's `agent/pre-step`
 * listener with synthetic decisions and asserts the three porting-contract
 * properties: a durable user-role message is added once, is not duplicated, and
 * is added again after a compaction that drops it.
 *
 * Usage: node preset/plugins/bootstrap/bootstrap.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'

import { BOOTSTRAP_MARKER, apply, createUserMessage, name } from './index.js'

/** Capture the single listener the plugin installs. */
const listeners = []
const fakeCtx = {
  on(event, listener) {
    listeners.push({ event, listener })
    return () => {}
  },
  logger: { warn: (...args) => console.error('[warn]', ...args) },
}

apply(fakeCtx)

assert.equal(name, 'bootstrap', 'plugin name')
assert.equal(listeners.length, 1, 'installs exactly one listener')
assert.equal(listeners[0].event, 'agent/pre-step', 'listens on agent/pre-step')

const listener = listeners[0].listener

/** Invoke the listener with a synthetic pre-step decision. */
async function preStep({ messages, step = 2, kind = 'enter', aborted = false }) {
  return await listener(
    { messages, step, signal: { aborted } },
    async () => ({ kind, messages }),
  )
}

const textOf = (message) =>
  message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')

// 1. A first step with no claimed input still receives the bootstrap.
const first = await preStep({ messages: [], step: 1 })
assert.equal(first.kind, 'enter')
assert.equal(first.messages.length, 1, 'step 1 injects exactly one message')
assert.equal(first.messages[0].role, 'user', 'injected message is user-role')
assert.match(textOf(first.messages[0]), /<EXTREMELY_IMPORTANT>/, 'bootstrap marker present')
assert.ok(textOf(first.messages[0]).includes('DeepSeek Harness tool mapping'), 'tool mapping present')
assert.ok(textOf(first.messages[0]).includes('Repository rules take precedence'), 'precedence note present')
assert.equal(first.messages[0].source.kind, 'plugin', 'message source is plugin-owned')
assert.equal(first.messages[0].source.plugin, name, 'message source names this plugin')

// 2. A step that already admits the bootstrap does not add a second copy.
const second = await preStep({ messages: first.messages, step: 2 })
assert.equal(second.messages.length, 1, 'no duplicate injection')

// 3. A later step whose admitted history lost the bootstrap (its content was
//    replaced by a compaction summary) gets it again.
const summary = createUserMessage({
  content: [{ type: 'text', text: '<compacted-summary>earlier work …</compacted-summary>' }],
  source: { kind: 'plugin', plugin: 'compaction' },
})
const afterCompaction = await preStep({ messages: [summary], step: 9 })
assert.equal(afterCompaction.messages.length, 2, 're-injected after compaction dropped it')
assert.equal(afterCompaction.messages[0], summary, 'compaction summary still leads')
assert.match(textOf(afterCompaction.messages[1]), /<EXTREMELY_IMPORTANT>/, 'bootstrap follows the summary')

// 4. A rejected step is left untouched, and an empty non-first step is not a
//    place to add context.
const rejected = await preStep({ messages: [], step: 9, kind: 'reject' })
assert.equal(rejected.kind, 'reject')
assert.equal(rejected.messages.length, 0, 'rejected step is untouched')
const emptyLaterStep = await preStep({ messages: [], step: 9 })
assert.equal(emptyLaterStep.messages.length, 0, 'empty non-first step is left alone')

// 5. An unrelated admitted message still gets the bootstrap appended after it.
const unrelated = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'test' } })
const withInput = await preStep({ messages: [unrelated], step: 4 })
assert.equal(withInput.messages.length, 2, 'existing admitted message preserved')
assert.match(textOf(withInput.messages[0]), /^hello$/, 'claimed message untouched and first')
assert.match(textOf(withInput.messages[1]), /<EXTREMELY_IMPORTANT>/, 'bootstrap appended after claimed messages')

// 6. The marker the plugin looks for is the one it writes.
assert.ok(textOf(first.messages[0]).includes(BOOTSTRAP_MARKER), 'marker constant matches emitted text')

console.log('selftest OK: 6 assertions groups passed')
console.log('bootstrap bytes:', textOf(first.messages[0]).length)
