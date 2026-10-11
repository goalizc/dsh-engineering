/**
 * Output-language plugin for the engineering preset (v2).
 *
 * The browser's interface language lives in the host user-settings document
 * (`locale.preference`, registered by the harness's own locale row) and nothing
 * on the prompt side reads it. This plugin turns it into two things:
 *
 * 1. **L1 — a system-prompt SECTION (order -1).** Placed between the harness
 *    identity (-1000) and the persona prefix (0), it sits above the persona's
 *    own style instructions and is re-sent on every step. v1 shipped the rule
 *    as a runtime CONTEXT line instead, which the harness delivers as a
 *    user-role history message: a real session measured 18/18 reasoning blocks
 *    opening in English with the rule present in that position.
 * 2. **L2 — a short reminder injected on `agent/pre-step`.** Appended after the
 *    human message this step claimed, so the language requirement sits next to
 *    the request instead of behind an 11 KB English bootstrap. Its condition is
 *    the claimed batch, NOT the derived history (see `apply`).
 *
 * Three properties this plugin keeps:
 *
 * 1. **Dynamic, not a snapshot.** Both `text` and the reminder evaluate the
 *    setting at the moment they are used, so a settings change applies to the
 *    next assembly — no session restart, no event subscription.
 * 2. **Self-contained.** A preset under the user's home has no `node_modules`
 *    walk that reaches harness packages, so this module imports only Node
 *    built-ins and declares no harness dependency.
 * 3. **Never fatal.** Prompt assembly and the pre-step must not be interrupted
 *    by this plugin: every failure path degrades (the section silently drops
 *    out, the setting read falls back to Chinese).
 *
 * @module dsh-output-language
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name. */
const name = 'output-language'

/** The host settings namespace and field this plugin reads. */
const LOCALE_NAMESPACE = 'locale'
const LOCALE_FIELD = 'preference'

/** Accepted BCP 47-style language ids, re-declared: harness imports are banned. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/** Prompt-section placement: identity is -1000, persona prefix is 0. */
const SECTION_NAME = 'output-language'
const SECTION_ORDER = -1

/** The language the owner asked for when the setting cannot be read. */
const FALLBACK_TAG = 'zh'

/** Language names we can name confidently; every other tag speaks for itself. */
const LANGUAGE_NAMES = { zh: '中文', en: 'English' }

/**
 * Fixed closing clause: translation may never touch code, paths, or errors.
 *
 * It also names tool names and enum values, because the strengthened tool-field
 * sentence invites over-translation in the other direction: a model told to
 * localize `description` fields must not conclude that `sandbox_permissions:
 * workspace-write` is prose.
 */
const DIRECTIVE_VERBATIM =
  'Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.'

/** The reminder's shorter verbatim clause. */
const REMINDER_VERBATIM = 'Keep code, commands, paths, and errors verbatim.'

/** One warning per process: a missing service must not spam every assembly. */
let warned = false

/** Report an unreadable setting once, without ever throwing. */
function warnOnce(ctx, error) {
  if (warned) return
  warned = true
  ctx?.logger?.warn?.(`${name}: cannot read "${LOCALE_NAMESPACE}.${LOCALE_FIELD}": ${String(error)}`)
}

/** Whether a value is a well-formed language tag. */
function isValidTag(value) {
  return typeof value === 'string' && LANGUAGE_TAG.test(value)
}

/**
 * Resolve the tag to render, in the fallback-aware form both renderers share.
 *
 * A readable tag is used as-is; an unreadable or malformed one becomes the
 * fallback tag. The two renderers therefore cannot disagree about which
 * language is being demanded.
 *
 * @param tag - the `locale.preference` value, or undefined when unreadable.
 * @returns a well-formed tag, never undefined.
 */
function tagOrFallback(tag) {
  return isValidTag(tag) ? tag : FALLBACK_TAG
}

/**
 * Name the language for a well-formed tag: `中文` for a language we can name,
 * the tag itself for any other one.
 *
 * This is both the display name and the target the model is told to write in,
 * which is why it is a function and not a `{language} ({tag})` assembly: the
 * reminder reads `Language: ja` for an unmapped tag, never `Language: ja (ja)`.
 *
 * @param tag - a well-formed tag.
 * @returns the language name, e.g. `中文`.
 */
function languageName(tag) {
  return LANGUAGE_NAMES[tag.toLowerCase()] ?? tag
}

/**
 * Render the L1 system-prompt section: the standing hard directive.
 *
 * Pure and total: every branch returns a non-empty string, and there is no
 * throw path (only `typeof` checks, one regex `test`, and literal
 * interpolation). An empty contribution would drop the constraint entirely.
 *
 * @param tag - the `locale.preference` value, or undefined when unreadable.
 * @returns the section text.
 */
function renderLanguageDirective(tag) {
  const resolved = tagOrFallback(tag)
  const label = languageName(resolved)
  return `Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in ${label} (${resolved}). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in ${label} on every single call — not only when the surrounding command or path happens to be in ${label}. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. ${DIRECTIVE_VERBATIM}`
}

/**
 * Render the L2 per-message reminder: the same demand, short enough to repeat
 * after every human message.
 *
 * Pure and total, for the same reasons as {@link renderLanguageDirective}.
 *
 * @param tag - the `locale.preference` value, or undefined when unreadable.
 * @returns the reminder text.
 */
function renderLanguageReminder(tag) {
  const resolved = tagOrFallback(tag)
  const label = languageName(resolved)
  return `Language: ${label} (${resolved}). Reason, reply, narrate, and write every artifact in ${label} only — including what you put in tool-call fields and in a delegated prompt. ${REMINDER_VERBATIM}`
}

/**
 * Read `locale.preference` from the host settings service.
 *
 * @param ctx - the mounting context; `ctx.get` reaches host-plane services.
 * @returns the language tag, or undefined when unreadable or malformed.
 */
function resolveLanguageTag(ctx) {
  try {
    const settings = ctx?.get?.('settings')
    if (settings === undefined || settings === null || typeof settings.get !== 'function') {
      return undefined
    }
    const raw = settings.get(LOCALE_NAMESPACE)?.[LOCALE_FIELD]
    const tag = typeof raw === 'string' ? raw.trim() : undefined
    return isValidTag(tag) ? tag : undefined
  } catch (error) {
    warnOnce(ctx, error)
    return undefined
  }
}

/**
 * Deep-freeze a message the way the harness publishes its own messages.
 *
 * INTENTIONAL DUPLICATION (same note as `preset/plugins/bootstrap/index.js` and
 * `preset/plugins/caveman-command/index.js`): a preset-local plugin must stay
 * self-contained and must not import any `@deepseek-ai/*` package, so neither
 * the harness's helper nor a shared sibling module is available across install
 * layouts. If you change the message shape here, change it in both siblings in
 * the same commit — the three must not drift.
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
 * Durable message source tag: this plugin owns every message it injects.
 *
 * Session format v4 refuses the retired wrapper `{ kind: 'plugin', plugin }`
 * ("format v4 message requires a producer-owned source kind") and requires the
 * producer's own kind instead; `plugin:<name>` matches what the harness's
 * v3→v4 migration produced for this plugin's older messages.
 */
const REMINDER_SOURCE = Object.freeze({ kind: `plugin:${name}` })

/**
 * Whether this batch contains a message the human wrote.
 *
 * The pre-step hook hands the listener only the batch this step claimed from
 * the inbox (`ReactLoopInbox.claim`) — never the admitted history. That batch is
 * therefore the ONLY input that can answer "is this step answering the human?",
 * and it is exactly the condition the reminder wants: the same question asked
 * of the derived history would answer "has this session ever reminded?" and
 * collapse L2 back into a once-per-session injection.
 *
 * @param messages - the claimed batch; a non-array is treated as empty.
 * @returns true when at least one message is human-authored and carries text.
 */
function hasHumanMessage(messages) {
  if (!Array.isArray(messages)) return false
  for (const message of messages) {
    if (message?.source?.kind !== 'user') continue
    for (const block of message?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) return true
    }
  }
  return false
}

/**
 * Install the language directive for every agent composed from this preset.
 *
 * @param ctx - the mounting agent-scope context.
 */
function apply(ctx) {
  ctx.inject(['systemPrompt'], (scope) => {
    try {
      scope.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => renderLanguageDirective(resolveLanguageTag(ctx)),
      })
    } catch (error) {
      // A harness without `section()` loses L1 only; L2 is installed below and
      // the session still starts. Warn so the loss is observable.
      ctx?.logger?.warn?.(`${name}: systemPrompt.section() unavailable: ${String(error)}`)
    }
  })

  ctx.on('agent/pre-step', async ({ signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal?.aborted) return decision
    if (!hasHumanMessage(decision.messages)) return decision

    const text = renderLanguageReminder(resolveLanguageTag(ctx))
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: REMINDER_SOURCE,
    })
    return { ...decision, messages: [...decision.messages, message] }
  })
}

export {
  DIRECTIVE_VERBATIM,
  FALLBACK_TAG,
  LANGUAGE_NAMES,
  LANGUAGE_TAG,
  REMINDER_VERBATIM,
  SECTION_NAME,
  SECTION_ORDER,
  apply,
  createUserMessage,
  deepFreeze,
  hasHumanMessage,
  languageName,
  name,
  renderLanguageDirective,
  renderLanguageReminder,
  resolveLanguageTag,
  tagOrFallback,
}
