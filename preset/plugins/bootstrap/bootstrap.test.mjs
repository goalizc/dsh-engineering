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
 * The payload shape matters here. `agent/pre-step` carries
 * `{ agent, messages, step, signal }`, and `messages` is only the batch this
 * step claims from the inbox — never the admitted history. A test that feeds
 * the previously injected message back in `messages` models a payload the
 * harness never sends and therefore cannot see a per-step re-injection. So this
 * file keeps the two apart: `messages` stays the claimed batch, the history is
 * modelled separately through the same `session.deriveMessages()` the plugin
 * reads, and a synthetic compaction replaces it the way a `replace` surface
 * rewrite does.
 *
 * Usage: node preset/plugins/bootstrap/bootstrap.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'

import {
  BOOTSTRAP_MARKER,
  alreadyPresent,
  apply,
  createUserMessage,
  historyHasBootstrap,
  name,
} from './index.js'

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
assert.equal(typeof alreadyPresent, 'function', 'exports the marker scan')
assert.equal(typeof historyHasBootstrap, 'function', 'exports the history probe')

const listener = listeners[0].listener

/**
 * One fake session with a mutable derived history.
 *
 * `admit` mirrors what the harness does with the messages a pre-step decision
 * returns; `compact` mirrors a compaction `replace`, after which the shadowed
 * nodes are gone from the derivation and the plugin must no longer find its own
 * marker.
 */
function fakeSession(initial = []) {
  let history = [...initial]
  return {
    deriveMessages: () => [...history],
    admit: (message) => history.push(message),
    compact: (summary) => {
      history = [...summary]
    },
  }
}

/** A session the plugin cannot read, to exercise the fallback path. */
function opaqueSession(throwing = false) {
  if (!throwing) return {}
  return {
    deriveMessages: () => {
      throw new Error('no derivation here')
    },
  }
}

/**
 * Drive the listener with the harness's payload shape, then admit whatever it
 * returned — the harness appends the injected message to the session, which is
 * what the NEXT pre-step's history read must observe.
 */
async function preStep({ agent, messages, step = 2, kind = 'enter', aborted = false }) {
  const decision = await listener(
    { agent, messages, step, signal: { aborted } },
    async () => ({ kind, messages }),
  )
  if (decision.kind === 'enter' && agent?.session?.admit !== undefined) {
    for (const message of decision.messages.slice(messages.length)) agent.session.admit(message)
  }
  return decision
}

const textOf = (message) =>
  message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')

const claimedUserMessage = (text) =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

// 1. A first step with no claimed input still receives the bootstrap.
const sessionA = fakeSession()
const first = await preStep({ agent: { session: sessionA }, messages: [], step: 1 })
assert.equal(first.kind, 'enter')
assert.equal(first.messages.length, 1, 'step 1 injects exactly one message')
assert.equal(first.messages[0].role, 'user', 'injected message is user-role')
assert.match(textOf(first.messages[0]), /<EXTREMELY_IMPORTANT>/, 'bootstrap marker present')
assert.ok(textOf(first.messages[0]).includes('DeepSeek Harness tool mapping'), 'tool mapping present')
assert.ok(textOf(first.messages[0]).includes('Repository rules take precedence'), 'precedence note present')
assert.equal(first.messages[0].source.kind, 'plugin', 'message source is plugin-owned')
assert.equal(first.messages[0].source.plugin, name, 'message source names this plugin')

// 2. THE REGRESSION THIS FILE EXISTS FOR: the next turn claims only its own
//    input (the real payload), while the session history still carries the
//    bootstrap injected in step 1. The plugin must NOT add a second copy — an
//    implementation that dedups against the claimed batch injects 11.7 KB on
//    every input-claiming step instead.
const turnTwo = await preStep({
  agent: { session: sessionA },
  messages: [claimedUserMessage('继续')],
  step: 1,
})
assert.equal(turnTwo.messages.length, 1, 'no re-injection while the history still carries the bootstrap')
assert.equal(turnTwo.messages[0].source.kind, 'user', 'the claimed message is the only one admitted')
assert.ok(!alreadyPresent(turnTwo.messages), 'no bootstrap copy rides along')

// 3. A mid-turn step that claims input is not a new session either.
const midTurn = await preStep({
  agent: { session: sessionA },
  messages: [claimedUserMessage('background job bash-1 finished')],
  step: 7,
})
assert.equal(midTurn.messages.length, 1, 'a later step in the same session never re-injects')

// 3b. A step that claims nothing and is not the first is still left alone, even
//     though the history is what decides now.
const emptyMidTurn = await preStep({ agent: { session: sessionA }, messages: [], step: 8 })
assert.equal(emptyMidTurn.messages.length, 0, 'empty non-first step is left alone')

// 4. A different session gets its own injection: dedup is per session, not global.
const sessionB = fakeSession()
const otherSession = await preStep({
  agent: { session: sessionB },
  messages: [claimedUserMessage('计划下一阶段工作内容')],
  step: 1,
})
assert.equal(otherSession.messages.length, 2, 'a second session gets exactly one bootstrap')
assert.match(textOf(otherSession.messages[1]), /<EXTREMELY_IMPORTANT>/, 'bootstrap follows the claimed message')

// 5. Compaction drops the marker from the derived history, so the next step
//    injects again. This is the "re-injected after compaction" property, driven
//    by the same history read as the dedup above.
const summary = createUserMessage({
  content: [{ type: 'text', text: '<compacted-summary>earlier work …</compacted-summary>' }],
  source: { kind: 'plugin', plugin: 'compaction' },
})
sessionA.compact([summary])
const resumed = claimedUserMessage('继续')
const afterCompaction = await preStep({
  agent: { session: sessionA },
  messages: [resumed],
  step: 1,
})
assert.equal(afterCompaction.messages.length, 2, 're-injected after compaction dropped it')
assert.equal(afterCompaction.messages[0], resumed, 'the claimed message still leads the batch')
assert.match(textOf(afterCompaction.messages[1]), /<EXTREMELY_IMPORTANT>/, 'bootstrap follows the claimed message')

// 6. A batch that already carries the marker is left alone (a compaction summary
//    that quoted the bootstrap, for instance): the in-batch check still runs.
const quoted = [
  createUserMessage({
    content: [{ type: 'text', text: `${BOOTSTRAP_MARKER} quoted` }],
    source: { kind: 'plugin', plugin: 'compaction' },
  }),
]
const withMarker = await preStep({ agent: { session: fakeSession() }, messages: quoted, step: 1 })
assert.equal(withMarker.messages.length, 1, 'a batch already carrying the marker is not duplicated')

// 7. A rejected step is left untouched.
const rejected = await preStep({ agent: { session: fakeSession() }, messages: [], step: 9, kind: 'reject' })
assert.equal(rejected.kind, 'reject')
assert.equal(rejected.messages.length, 0, 'rejected step is untouched')
const aborted = await preStep({ agent: { session: fakeSession() }, messages: [], step: 1, aborted: true })
assert.equal(aborted.messages.length, 0, 'aborted step is untouched')

// 8. An unrelated claimed message still gets the bootstrap appended after it,
//    and the claimed message stays first.
const unrelated = createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'test' } })
const withInput = await preStep({ agent: { session: fakeSession() }, messages: [unrelated], step: 4 })
assert.equal(withInput.messages.length, 2, 'existing claimed message preserved')
assert.match(textOf(withInput.messages[0]), /^hello$/, 'claimed message untouched and first')
assert.match(textOf(withInput.messages[1]), /<EXTREMELY_IMPORTANT>/, 'bootstrap appended after claimed messages')

// 9. Unreadable history degrades to one injection per session object, not one
//    per step: a session that cannot answer must not resurrect the old spam.
const opaque = opaqueSession()
const opaqueFirst = await preStep({ agent: { session: opaque }, messages: [], step: 1 })
assert.equal(opaqueFirst.messages.length, 1, 'an unreadable session still gets its bootstrap')
const opaqueSecond = await preStep({
  agent: { session: opaque },
  messages: [claimedUserMessage('继续')],
  step: 1,
})
assert.equal(opaqueSecond.messages.length, 1, 'the fallback injects once per session')

// 9b. A derivation that throws takes the same fallback and never propagates.
const throwing = opaqueSession(true)
assert.equal(historyHasBootstrap({ session: throwing }), undefined, 'a throwing derivation reports "unknown"')
const throwingFirst = await preStep({ agent: { session: throwing }, messages: [], step: 1 })
assert.equal(throwingFirst.messages.length, 1, 'a throwing derivation still gets its bootstrap')

// 9c. No agent/session at all: the plugin must not throw, and must still inject.
const noAgent = await preStep({ messages: [], step: 1 })
assert.equal(noAgent.messages.length, 1, 'a payload without an agent still gets the bootstrap')

// 10. The marker the plugin looks for is the one it writes; identities are fresh.
assert.ok(textOf(first.messages[0]).includes(BOOTSTRAP_MARKER), 'marker constant matches emitted text')
assert.notEqual(
  createUserMessage({ content: [], source: { kind: 'plugin', plugin: name } }).id,
  createUserMessage({ content: [], source: { kind: 'plugin', plugin: name } }).id,
  'each injected message gets a fresh identity',
)
assert.ok(Object.isFrozen(first.messages[0]), 'the injected message is frozen')

console.log('selftest OK: 10 assertion groups passed')
console.log('bootstrap bytes:', textOf(first.messages[0]).length)
