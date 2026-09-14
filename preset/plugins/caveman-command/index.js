/**
 * The `/caveman` command for this preset.
 *
 * The `caveman` skill declares its activation contract as
 * `/caveman lite|full|ultra|wenyan-*|off`, but that syntax comes from the
 * upstream project's Claude Code slash command, which this harness does not
 * have. Without a registered command the contract is unreachable, so this
 * plugin supplies it.
 *
 * The command does NOT reimplement the level rules: it only announces the
 * chosen level as a durable user message. The `caveman` skill remains the
 * single home of the rule text and stays loadable through the `skill` tool —
 * see the "Caveman output style" section of `bootstrap.md`.
 *
 * Self-contained by the same rule as the bootstrap plugin: a preset under the
 * user's home has no `node_modules` walk that reaches the harness's packages,
 * and a `--copy` install has no such link at all. The message shape below
 * replicates `@deepseek-ai/dsh-llm`'s `createUserMessage` using only Node's
 * own UUID.
 *
 * @module dsh-caveman-command
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name. */
const name = 'caveman-command'

/** The `commands` service is host-plane; a preset row resolves it. */
const inject = ['commands']

/** Levels the `caveman` skill defines. Kept as names only; rules stay in the skill. */
const CAVEMAN_LEVELS = Object.freeze([
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan-full',
  'wenyan-ultra',
  'off',
])

/** The level a session starts at, matching the injected default. */
const DEFAULT_LEVEL = 'full'

/**
 * Deep-freeze a message the way the harness publishes its own messages.
 *
 * INTENTIONAL DUPLICATION (ruled by the plan, verified by review): `deepFreeze`
 * and `createUserMessage` below are kept verbatim-identical to the copies in
 * `preset/plugins/superpowers-bootstrap/index.js` (see its matching note). A
 * preset-local plugin must stay self-contained and must not import any
 * `@deepseek-ai/*` package, so neither the harness's helper nor a shared
 * sibling module is available across install layouts. If you change the message
 * shape here, change it there in the same commit — the two must not drift.
 */
function deepFreeze(value) {
  if (value instanceof Object && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
  }
  return value
}

/** Build one immutable user-role message with a fresh identity. */
function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))
}

/**
 * Parse the command's own grammar. Arbitrary other input is an invalid level,
 * never a silent no-op.
 *
 * @param rawInput - the text after `/caveman`.
 * @returns a discriminated result the handler can render.
 */
function parseLevel(rawInput) {
  const input = String(rawInput ?? '').trim()
  if (input.length === 0) return { kind: 'show' }
  const level = input.toLowerCase()
  if (CAVEMAN_LEVELS.includes(level)) return { kind: 'set', level }
  return { kind: 'invalid', input }
}

/** Human-readable usage line. */
const USAGE = `Usage: /caveman [${CAVEMAN_LEVELS.join('|')}]`

/**
 * Execute one `/caveman` invocation.
 *
 * @param invocation - the harness's command invocation.
 * @returns a command result the UI renders.
 */
function executeCavemanCommand(invocation) {
  const command = parseLevel(invocation.rawInput)

  if (command.kind === 'show') {
    return {
      kind: 'success',
      text: [`Caveman output style: ${DEFAULT_LEVEL} (default)`, '', USAGE].join('\n'),
    }
  }

  if (command.kind === 'invalid') {
    return {
      kind: 'error',
      text: [`Unknown level: ${command.input}`, '', USAGE].join('\n'),
    }
  }

  // Durable announcement: the next model turn reads the level from the
  // conversation, exactly as the injected default does.
  const announcement =
    command.level === 'off'
      ? 'Caveman output style: off. Answer in normal prose from now on, and do not load the `caveman` skill.'
      : `Caveman output style: ${command.level}. Load the \`caveman\` skill with the \`skill\` tool and apply its \`${command.level}\` level to every response. Superpowers workflow artifacts stay complete and structured, and take priority over compression.`

  invocation.agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: announcement }],
      source: { kind: 'plugin', plugin: name },
    }),
  )

  return {
    kind: 'success',
    text: `Caveman output style set to ${command.level}.`,
  }
}

/**
 * Register `/caveman` for every composed command adapter.
 *
 * @param ctx - the mounting context.
 */
function apply(ctx) {
  ctx.commands.register({
    name: 'caveman',
    description: "set this session's output compression level",
    input: { hint: `[${CAVEMAN_LEVELS.join('|')}]` },
    handler: (invocation) => executeCavemanCommand(invocation),
  })
}

export { CAVEMAN_LEVELS, DEFAULT_LEVEL, apply, createUserMessage, inject, name, parseLevel }
