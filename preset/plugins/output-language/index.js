/**
 * Output-language context for the engineering preset.
 *
 * The browser's interface language lives in the host user-settings document
 * (`locale.preference`, registered by the harness's own locale row) and nothing
 * on the prompt side reads it. This plugin turns it into one dynamic
 * system-prompt context line, so replies and workflow artifacts follow the
 * interface language.
 *
 * Three properties this plugin keeps:
 *
 * 1. **Dynamic, not a snapshot.** `systemPrompt.context()` evaluates `text` on
 *    every prompt assembly, so changing the interface language applies to the
 *    next reply — no session restart, no event subscription.
 * 2. **Self-contained.** A preset under the user's home has no `node_modules`
 *    walk that reaches harness packages, so this module imports only Node
 *    built-ins and declares no harness dependency.
 * 3. **Never fatal.** Prompt assembly must not be interrupted by this plugin:
 *    every failure path degrades to the "interface language not set" text.
 *
 * @module dsh-output-language
 */

/** Cordis plugin name. */
const name = 'output-language'

/** The host settings namespace and field this plugin reads. */
const LOCALE_NAMESPACE = 'locale'
const LOCALE_FIELD = 'preference'

/** Accepted BCP 47-style language ids, re-declared: harness imports are banned. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/** Prompt-context placement: identity-adjacent, ahead of the policy contexts. */
const CONTEXT_NAME = 'output-language'
const CONTEXT_ORDER = 105

/** Fixed closing clause: translation may never touch code, paths, or errors. */
const VERBATIM_CLAUSE =
  'Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.'

/** What the rule covers, as one shared phrase so the branches cannot drift. */
const COVERED =
  'your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items —'

/** Language names we can name confidently; every other tag speaks for itself. */
const LANGUAGE_NAMES = { zh: 'Chinese', en: 'English' }

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
 * Render the language rule for one interface-language tag.
 *
 * Pure and total: an absent or malformed tag renders the "not set" branch, which
 * delegates to the user's own language. Never returns an empty string — an empty
 * contribution would drop the line and leave the model unconstrained.
 *
 * @param tag - the `locale.preference` value, or undefined when unreadable.
 * @returns the context line.
 */
function renderLanguageContext(tag) {
  if (!isValidTag(tag)) {
    return `Interface language: not set. Write ${COVERED} in the language of the user's message, and switch whenever the user switches language. ${VERBATIM_CLAUSE}`
  }
  const named = LANGUAGE_NAMES[tag.toLowerCase()]
  const label = named === undefined ? tag : `${tag} (${named})`
  const target = named ?? tag
  return `Interface language: ${label}. Write ${COVERED} in ${target}. If the user writes in another language, answer that message in the user's language instead. ${VERBATIM_CLAUSE}`
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
 * Install the language context for every agent composed from this preset.
 *
 * @param ctx - the mounting agent-scope context.
 */
function apply(ctx) {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: () => renderLanguageContext(resolveLanguageTag(ctx)),
    })
  })
}

export { CONTEXT_ORDER, LANGUAGE_TAG, name, apply, renderLanguageContext, resolveLanguageTag }
