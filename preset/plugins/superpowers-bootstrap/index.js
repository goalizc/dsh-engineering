/**
 * Superpowers bootstrap injection for one agent preset.
 *
 * Shape B of the Superpowers harness-porting contract: an in-process plugin
 * that puts the `using-superpowers` bootstrap plus this harness's tool mapping
 * in front of the model at the start of every session, with no per-session
 * opt-in by the human.
 *
 * Three properties the porting guide requires, and how each is met here:
 *
 * 1. **Durable user-role message, never a system message.** The bootstrap is
 *    returned from the `agent/pre-step` waterfall as an additional admitted
 *    `UserMessage`, which is how the harness records durable context. It is
 *    appended after the messages this step already claimed.
 * 2. **Idempotent.** The injected text carries a stable marker. Before injecting,
 *    the listener scans the messages this step would enter; if the marker is
 *    present the bootstrap is already in context and nothing is added.
 * 3. **Re-injected after compaction.** History compaction replaces the older
 *    transcript with a summary, so the marker disappears from the admitted
 *    messages and the next pre-step re-injects automatically. There is no
 *    compaction event to subscribe to, and none is needed: presence in the
 *    admitted batch is the whole condition.
 *
 * The content comes from `bootstrap.md` beside the preset — that file is the
 * vendored `using-superpowers` skill plus the harness tool mapping. It is read
 * once per mount and cached; editing it requires restarting the session, the
 * same as editing the composition.
 *
 * @module dsh-superpowers-bootstrap
 */

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/**
 * Cordis plugin that injects one user-role message during `agent/pre-step`.
 *
 * This preset ships standalone: it must not import the harness's own packages
 * (`@deepseek-ai/dsh-llm`), because a preset under the user's home has no
 * `node_modules` walk that reaches them. The two helpers below replicate the
 * shape `@deepseek-ai/dsh-llm`'s `createUserMessage` produces — `role`,
 * `content`, `source`, and a fresh `id` — so the injected message stays wire-
 * compatible without any runtime dependency on the harness.
 */

/** Cordis plugin name. */
const name = 'superpowers-bootstrap'

/**
 * Deep-freeze a message the way the harness publishes its own messages.
 *
 * INTENTIONAL DUPLICATION (ruled by the plan, verified by review): `deepFreeze`
 * and `createUserMessage` below are kept verbatim-identical to the copies in
 * `preset/plugins/caveman-command/index.js` (see its matching note). A
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

/**
 * Build one immutable user-role message with a fresh identity, matching the
 * harness's `createUserMessage`. Uses Node's own UUID so no harness package is
 * imported.
 */
function createUserMessage(input) {
  return deepFreeze(
    structuredClone({
      ...input,
      role: 'user',
      id: randomUUID(),
    }),
  )
}

/**
 * The stable marker of an injected bootstrap.
 *
 * The porting guide's references key dedup off the `EXTREMELY_IMPORTANT` tag,
 * which is more robust than a harness-specific constant because the marker and
 * the payload cannot drift apart.
 */
const BOOTSTRAP_MARKER = '<EXTREMELY_IMPORTANT>'

/** Durable message source tag: this plugin owns every message it injects. */
const BOOTSTRAP_SOURCE = Object.freeze({ kind: 'plugin', plugin: name })

/**
 * Absolute path of the shipped bootstrap text.
 *
 * This module sits at `<preset>/plugins/superpowers-bootstrap/index.js` and the
 * text at `<preset>/bootstrap.md`, so the specifier climbs two levels.
 */
const DEFAULT_BOOTSTRAP_URL = new URL('../../bootstrap.md', import.meta.url)

/** Read once per mount: the bootstrap text, or a lazily reported failure. */
let cachedBootstrap

/**
 * The bootstrap text, read from disk on first use.
 *
 * A read failure is not fatal to the session: the plugin reports it once and
 * contributes nothing, so a missing file degrades to "no superpowers" rather
 * than to a session that cannot start.
 *
 * @returns the assembled bootstrap text, or undefined when unreadable.
 */
function loadBootstrap(ctx) {
  if (cachedBootstrap !== undefined) return cachedBootstrap
  try {
    cachedBootstrap = readFileSync(fileURLToPath(DEFAULT_BOOTSTRAP_URL), 'utf8').trim()
  } catch (error) {
    cachedBootstrap = undefined
    ctx.logger?.warn?.(
      `superpowers-bootstrap: cannot read ${fileURLToPath(DEFAULT_BOOTSTRAP_URL)}: ${String(error)}`,
    )
  }
  return cachedBootstrap
}

/**
 * Whether a bootstrap is already among the messages this step would admit.
 *
 * @param messages - admitted user messages for the proposed step.
 * @returns true when the marker is present.
 */
function alreadyPresent(messages) {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.includes(BOOTSTRAP_MARKER)) return true
    }
  }
  return false
}

/**
 * Install the bootstrap injection for every agent composed from this preset.
 *
 * @param ctx - the mounting agent-scope context.
 */
function apply(ctx) {
  ctx.on('agent/pre-step', async ({ messages, signal, step }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (alreadyPresent(decision.messages)) return decision

    // `step === 1` admits the bootstrap on a fresh session even when the step
    // claimed no input of its own; later steps require an admitted batch, so an
    // empty maintenance step is left alone. Mirrors the condition the harness's
    // own notice listeners use.
    if (decision.messages.length === 0 && step !== 1) return decision

    const text = loadBootstrap(ctx)
    if (text === undefined) return decision

    const message = createUserMessage({ content: [{ type: 'text', text }], source: BOOTSTRAP_SOURCE })
    return {
      ...decision,
      messages: [...decision.messages, message],
    }
  })
}

export { BOOTSTRAP_MARKER, apply, createUserMessage, name }
