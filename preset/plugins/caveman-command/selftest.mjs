// preset/plugins/caveman-command/selftest.mjs
// Drives the installed apply() with a fake ctx — no harness, no agent needed.
import assert from 'node:assert/strict'
import { apply, inject, name, CAVEMAN_LEVELS, parseLevel } from './index.js'

let groups = 0
const report = (label) => { groups += 1; console.log(`ok ${groups} - ${label}`) }

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

// 3. every advertised level round-trips
for (const level of CAVEMAN_LEVELS) {
  assert.equal(parseLevel(level).level, level)
}
report('all advertised levels parse')

// 4. registration + followup injection
const registered = []
const followed = []
const ctx = {
  commands: { register: (def) => registered.push(def) },
}
apply(ctx)
assert.equal(registered.length, 1)
const def = registered[0]
assert.equal(def.name, 'caveman')
assert.ok(typeof def.description === 'string' && def.description.length > 0)
assert.ok(typeof def.input?.hint === 'string')

const invocation = {
  rawInput: 'ultra',
  attachments: [],
  agent: { followup: (m) => followed.push(m) },
}
const result = def.handler(invocation)
assert.equal(result.kind, 'success')
assert.equal(followed.length, 1)
assert.equal(followed[0].role, 'user')
assert.equal(followed[0].source.plugin, 'caveman-command')
assert.ok(typeof followed[0].id === 'string' && followed[0].id.length > 0)
assert.ok(followed[0].content[0].text.includes('ultra'))
report('handler registers, injects one user message naming the level')

// 5. show path injects nothing
followed.length = 0
const shown = def.handler({ rawInput: '', attachments: [], agent: { followup: (m) => followed.push(m) } })
assert.equal(shown.kind, 'success')
assert.equal(followed.length, 0)
assert.ok(shown.text.includes('full'))
report('bare /caveman shows current level and injects nothing')

// 6. invalid level is an error and injects nothing
followed.length = 0
const bad = def.handler({ rawInput: 'bogus', attachments: [], agent: { followup: (m) => followed.push(m) } })
assert.equal(bad.kind, 'error')
assert.equal(followed.length, 0)
assert.ok(bad.text.includes('ultra'))
report('invalid level errors, lists valid levels, injects nothing')

console.log(`selftest OK: ${groups} assertions groups passed`)
