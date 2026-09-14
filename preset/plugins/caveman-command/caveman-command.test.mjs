// preset/plugins/caveman-command/caveman-command.test.mjs
// Drives the plugin's apply() with a fake ctx — no harness, no agent needed.
// Named `caveman-command.test.mjs` so `npm test` collects it (the glob covers
// every plugin directory's `*.test.mjs`); it also runs standalone:
// node preset/plugins/caveman-command/caveman-command.test.mjs
import assert from 'node:assert/strict'
import { apply, inject, name, CAVEMAN_LEVELS, DEFAULT_LEVEL, parseLevel } from './index.js'

let groups = 0
const report = (label) => { groups += 1; console.log(`ok ${groups} - ${label}`) }

/** A stand-in for the harness's live agent: one stable id, one message sink. */
const makeAgent = (id) => {
  const messages = []
  return { id, messages, followup: (m) => messages.push(m) }
}

// 1. plugin shape
assert.equal(name, 'caveman-command')
assert.deepEqual(inject, ['commands'])
report('exports name and inject')

// 2. level parsing
assert.deepEqual(parseLevel(''), { kind: 'show' })
assert.deepEqual(parseLevel('   '), { kind: 'show' })
assert.deepEqual(parseLevel('ultra'), { kind: 'set', level: 'ultra' })
assert.deepEqual(parseLevel('  OFF '), { kind: 'set', level: 'off' })
assert.deepEqual(parseLevel('bogus'), { kind: 'invalid', input: 'bogus' })
report('parseLevel handles show/set/invalid')

// 3. the advertised vocabulary is the literal set the `caveman` skill defines.
// Pinned to literals on purpose: comparing CAVEMAN_LEVELS with itself only
// restates the module and cannot catch the skill and the plugin drifting apart
// (which is the drift this guard exists for).
const SKILL_LEVELS = ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra', 'off']
assert.deepEqual([...CAVEMAN_LEVELS], SKILL_LEVELS)
for (const level of SKILL_LEVELS) {
  assert.equal(parseLevel(level).level, level)
}
report('level vocabulary is exactly the skill\'s 7 names, each round-trips')

// 4. registration + followup injection
const registered = []
const ctx = {
  commands: { register: (def) => registered.push(def) },
}
apply(ctx)
assert.equal(registered.length, 1)
const def = registered[0]
assert.equal(def.name, 'caveman')
assert.ok(typeof def.description === 'string' && def.description.length > 0)
assert.ok(typeof def.input?.hint === 'string')

const agent = makeAgent('session-a')
const result = def.handler({ rawInput: 'ultra', attachments: [], agent })
assert.equal(result.kind, 'success')
assert.equal(agent.messages.length, 1)
assert.equal(agent.messages[0].role, 'user')
assert.equal(agent.messages[0].source.plugin, 'caveman-command')
assert.ok(typeof agent.messages[0].id === 'string' && agent.messages[0].id.length > 0)
assert.ok(agent.messages[0].content[0].text.includes('ultra'))
report('handler registers, injects one user message naming the level')

// The reported level is the FIRST line; the usage line below it lists every
// level name, so a loose `includes(level)` would pass no matter what was shown.
const shownLevel = (text) => text.split('\n')[0]

// 5. bare /caveman reports the level THIS agent is currently on, and injects
// nothing. A fresh agent is on the injected default.
const fresh = def.handler({ rawInput: '', attachments: [], agent: makeAgent('session-untouched') })
assert.equal(fresh.kind, 'success')
assert.equal(shownLevel(fresh.text), `Caveman output style: ${DEFAULT_LEVEL} (default)`)

const shown = def.handler({ rawInput: '', attachments: [], agent })
assert.equal(shown.kind, 'success')
assert.equal(agent.messages.length, 1)
assert.equal(
  shownLevel(shown.text),
  'Caveman output style: ultra',
  `bare /caveman must report the current level, got: ${shown.text}`,
)
report('bare /caveman reports the level this agent just set')

// 5b. an explicit set to the default level is a setting, not "the default"
def.handler({ rawInput: DEFAULT_LEVEL, attachments: [], agent })
const explicit = def.handler({ rawInput: '', attachments: [], agent })
assert.equal(shownLevel(explicit.text), `Caveman output style: ${DEFAULT_LEVEL}`)
report('an explicitly set default level is reported without the default marker')

// 5c. one agent's level never leaks into another session
const other = def.handler({ rawInput: '', attachments: [], agent: makeAgent('session-b') })
assert.equal(shownLevel(other.text), `Caveman output style: ${DEFAULT_LEVEL} (default)`)
report('levels are keyed per agent, not process-global')

// 6. invalid level is an error and injects nothing
const badAgent = makeAgent('session-c')
const bad = def.handler({ rawInput: 'bogus', attachments: [], agent: badAgent })
assert.equal(bad.kind, 'error')
assert.equal(badAgent.messages.length, 0)
assert.ok(bad.text.includes('ultra'))
report('invalid level errors, lists valid levels, injects nothing')

console.log(`selftest OK: ${groups} assertions groups passed`)
