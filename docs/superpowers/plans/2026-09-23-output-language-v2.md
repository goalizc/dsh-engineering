# 输出语言 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 写出的每一段文本（思考流、可见回复、过程旁白、流程产物）都跟随 host 设置 `locale.preference`，读不到时兜底中文。

**Architecture:** 三层落点。L1 把语言断言注册成 `systemPrompt` 的 **section**（`order: -1`，每步随 system 重发，优先级高于 persona）；L2 在 `agent/pre-step` 里紧随**本步 claim 到的人类用户消息**追加一条短提醒（近因锚定，不查历史）；L3 删除 v1 那条 user 角色的运行时上下文行。渲染是同一套语言标签解析上的两个纯函数。

**Tech Stack:** Node.js ESM（`node --test` + 无框架 plain-assert 自测）、Cordis 插件（`ctx.inject(['systemPrompt'])`、`ctx.on('agent/pre-step')`）、DeepSeek Harness preset 组合（`preset/agent.cordis.yml` 的 preset 相对行）。

设计来源：`docs/superpowers/specs/2026-09-23-output-language-v2-design.md`（下称 v2 spec）。

## Global Constraints

- **不得 `import` 任何 `@deepseek-ai/*` 包**：preset 插件必须自包含（用户 home 下的 preset 没有可达的 `node_modules` 回溯）。只用 Node 内建模块。
- **组合行用 preset 相对 specifier**：`./plugins/output-language/index.js`，由 preset 加载器按本 preset 目录解析。
- **语言规则必须动态**：`text` 是函数，每次组装提示词都求值；不得在注册时快照设置值。
- **`order` 只能是数值**；同一 scope 内重名 section 会被拒绝。
- **`createUserMessage` / `deepFreeze` 三份拷贝必须一致**：`preset/plugins/bootstrap/index.js`、`preset/plugins/caveman-command/index.js`、`preset/plugins/output-language/index.js`。本计划是第三份；改消息形状必须同提交改三处。
- **冻结文本的权威副本是 v2 spec §6**：`renderLanguageDirective` / `renderLanguageReminder` 的输出必须与那里逐字相同。
- **不改** `preset/bootstrap.md`、`scripts/build-bootstrap.sh`、persona `prefix`/`suffix`、`preset/plugins/bootstrap/index.js`、`preset/plugins/caveman-command/index.js`。
- **提交信息格式**：`<type>(<scope>): 中文摘要`；本仓库近期提交无 AI 披露尾行，照此执行。
- **每个任务结束都要提交**，且每个任务的验证命令必须真实跑过、贴真实输出。
- **本计划不含探针、也不需要为探针重启宿主**：`systemPrompt.section()` 在 preset realm 的可调用性已由三条代码级证据关闭（见 Task 5 的 evidence 一节与 v2 spec §3 约束 1）。唯一需要重启宿主的是最后的端到端实测（Task 6），那一步本来就要在新会话里跑。

## File Structure

| 路径 | 职责 | 本计划中的变化 |
|---|---|---|
| `preset/plugins/output-language/index.js` | 语言插件的全部逻辑：标签解析、两段渲染、section 注册、pre-step 注入 | 重写 |
| `preset/plugins/output-language/output-language.test.mjs` | 插件的无框架自测（渲染 golden、注册形状、注入行为、自包含扫描） | 重写 |
| `preset/plugins/output-language/package.json` | 插件包元数据 | 只改 `description` |
| `scripts/output-language.test.mjs` | preset 层守卫：组合挂载行、导出面、README 冻结行、v2 spec §6 交叉校验 | 重写守卫体 |
| `preset/agent.cordis.yml` | 组合：把 `output-language` 行接上 | 只改该行注释 |
| `README.md` | 面向人的事实：行为表、注入文本、生效边界、目录树、测试清单 | 改「输出语言」节与相关计数 |
| `evidence/VERIFICATION.md` | 历史验证记录 | 追加 2026-09-23 一节 |
| `docs/superpowers/specs/2026-09-17-output-language-design.md` | v1 spec（已标注被取代） | 仅在 §6 加一行"文本已作废"的指引 |

---

### Task 1: 重写渲染纯函数（TDD）

把 v1 的四段拼装（规则句 + 界面语言子句 + 覆盖句 + 固定尾句）换成 v2 的两条独立模板，并在同一次重写里清掉 v1 的导出面，免得留下"看起来还生效"的死代码。

**Files:**
- Modify: `preset/plugins/output-language/index.js`（整文件重写）
- Modify: `preset/plugins/output-language/output-language.test.mjs`（整文件重写）
- Modify: `preset/plugins/output-language/package.json`（`description`）

**Interfaces:**
- Consumes: 无（本任务不依赖任何前置任务的代码；`section()` 可调用的证据已由 spec §3 约束 1 关闭）。
- Produces（Task 2、Task 3、Task 4 依赖这些确切的导出）：
  - `name: 'output-language'`
  - `LANGUAGE_TAG: RegExp`
  - `LANGUAGE_NAMES: { zh: '中文', en: 'English' }`
  - `renderLanguageDirective(tag: string | undefined): string` —— 永不空、不抛
  - `renderLanguageReminder(tag: string | undefined): string` —— 永不空、不抛
  - `resolveLanguageTag(ctx): string | undefined` —— 不抛
  - `apply(ctx): void`

- [ ] **Step 1: 写失败的测试（整文件替换 `output-language.test.mjs`）**

```js
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
 * `node_modules` link. It never starts an agent: both renderers are pure
 * functions, and the settings read is driven with fake contexts.
 *
 * Usage: node preset/plugins/output-language/output-language.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  LANGUAGE_TAG,
  apply,
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
  zh: 'Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in 中文 (zh). Never write any of it in another language. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.',
  en: 'Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in English (en). Never write any of it in another language. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.',
  ja: 'Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in ja (ja). Never write any of it in another language. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.',
  unset: 'Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in 中文 (zh). Never write any of it in another language. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.',
}

const REMINDER = {
  zh: 'Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only. Keep code, commands, paths, and errors verbatim.',
  en: 'Language: English (en). Reason, reply, narrate, and write every artifact in English only. Keep code, commands, paths, and errors verbatim.',
  ja: 'Language: ja (ja). Reason, reply, narrate, and write every artifact in ja only. Keep code, commands, paths, and errors verbatim.',
  unset: 'Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only. Keep code, commands, paths, and errors verbatim.',
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
//    clause: these are the two properties a rewording could silently drop.
for (const tag of ['zh', 'en', 'ja', undefined]) {
  const directive = renderLanguageDirective(tag)
  assert.ok(directive.includes('Never write any of it in another language.'), 'directive forbids other languages')
  assert.ok(
    directive.includes('Keep code, identifiers, commands, file paths, and error text verbatim'),
    'directive keeps code verbatim',
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
const source = await readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
assert.ok(!source.includes('@deepseek-ai/'), 'plugin must not import harness packages')

console.log('selftest OK: output-language (renderers)')
```

（本步骤只放渲染相关的断言；注册与注入的断言在 Task 2、Task 3 追加到本文件末尾。删掉本文件的 `console.log` 之前的部分只在上面这一处，追加时保持单一 `console.log` 收尾。）

- [ ] **Step 2: 跑测试确认失败**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: FAIL —— `SyntaxError: The requested module './index.js' does not provide an export named 'renderLanguageDirective'`（当前 index.js 仍导出 `renderLanguageContext`）。

- [ ] **Step 3: 实现（整文件替换 `preset/plugins/output-language/index.js`）**

```js
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

/** Fixed closing clause: translation may never touch code, paths, or errors. */
const DIRECTIVE_VERBATIM =
  'Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.'

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
  return `Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in ${label} (${resolved}). Never write any of it in another language. ${DIRECTIVE_VERBATIM}`
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
  return `Language: ${label} (${resolved}). Reason, reply, narrate, and write every artifact in ${label} only. ${REMINDER_VERBATIM}`
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

/** Durable message source tag: this plugin owns every message it injects. */
const REMINDER_SOURCE = Object.freeze({ kind: 'plugin', plugin: name })

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
```

同时把 `preset/plugins/output-language/package.json` 的 `description` 改为：

```json
  "description": "Renders the interface language as a standing system-prompt section plus a per-message reminder for agents on this preset.",
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: PASS，最后一行 `selftest OK: output-language (renderers)`。若某条 golden 不等，**不要改 golden**——改实现去匹配 v2 spec §6 的逐字文本。

- [ ] **Step 5: 跑组合健康检查**

Run:

```sh
cd /home/goalizc/dsh-engineering && node scripts/verify-composition.mjs
```

Expected: 打印 `engineering` 可加载（`broken: null`）。

- [ ] **Step 6: 提交**

```sh
cd /home/goalizc/dsh-engineering
git add preset/plugins/output-language/index.js preset/plugins/output-language/output-language.test.mjs preset/plugins/output-language/package.json
git commit -m "feat: 输出语言 v2 渲染层（system 段文本 + 每轮提醒文本，中文兜底）"
```

---

### Task 2: 注册 L1 system 段，删除 v1 上下文行

**Files:**
- Modify: `preset/plugins/output-language/output-language.test.mjs`（追加"注册形状"断言组）
- Modify: `preset/agent.cordis.yml`（只改 `output-language` 行的注释）

**Interfaces:**
- Consumes: Task 1 的 `apply`、`renderLanguageDirective`、`resolveLanguageTag`、`SECTION_NAME`、`SECTION_ORDER`。
- Produces: `apply(ctx)` 注册**恰好一条** system section 且**零条** context —— Task 4 的守卫会断言组合行仍指向本插件；Task 3 在同一次 `apply` 里追加 L2。

- [ ] **Step 1: 追加失败的测试**

把 `preset/plugins/output-language/output-language.test.mjs` 末尾的 `console.log('selftest OK: output-language (renderers)')` 换成下面这段（替换掉那一行，保持本文件只有一处 `console.log` 收尾）：

```js
// 11. `apply` registers exactly one dynamic SECTION and NO runtime context.
//     The context assertion is the regression for the v1 delivery layer: a
//     leftover `context()` call would publish a second, weaker copy of the rule
//     as a user-role history message, which is precisely what v2 replaces.
const injected = []
const sectionCalls = []
const contextCalls = []
// Mutable settings document on purpose: both the section provider and the
// reminder must read it at use time. A snapshot taken at registration would
// pass a one-shot assertion and silently break "a settings change applies to
// the next turn", so the second read must follow the change.
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

console.log('selftest OK: output-language')
```

并在文件顶部的 import 列表里补上 `SECTION_NAME`、`SECTION_ORDER`：

```js
import {
  LANGUAGE_TAG,
  SECTION_NAME,
  SECTION_ORDER,
  apply,
  name,
  renderLanguageDirective,
  renderLanguageReminder,
  resolveLanguageTag,
} from './index.js'
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: FAIL —— `SyntaxError: The requested module './index.js' does not provide an export named 'SECTION_NAME'`。

- [ ] **Step 3: 实现**

Task 1 的 `index.js` 已包含 L1 的 `section()` 注册与 try/catch。本步只做一件事：把这两个名字加进导出表（Task 1 的导出表已含 `SECTION_NAME`、`SECTION_ORDER`；若上一步跑测试时发现缺了，就在 `export { … }` 里补上）。用编辑工具确认导出表包含：

```js
export {
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
```

然后更新 `preset/agent.cordis.yml` 里 `output-language` 行的注释（**挂载行与 id 不动**）。把原注释整块替换为：

```yaml
# 输出语言（v2）：把 host 用户设置里的 `locale.preference` 落成两处——一条
# `order: -1` 的 system-prompt 段（每步重发、排在 persona 之前），以及一条紧跟
# 本步人类用户消息的短提醒（agent/pre-step，近因锚定）。读不到设置时兜底中文。
# 与 bootstrap 同构：自包含、不 import harness 包、preset 相对行。
- id: output-language
  name: './plugins/output-language/index.js'
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: PASS，最后一行 `selftest OK: output-language`。

- [ ] **Step 5: 跑组合健康检查**

Run:

```sh
cd /home/goalizc/dsh-engineering && node scripts/verify-composition.mjs
```

Expected: `engineering` 行可加载（`broken: null`）。

- [ ] **Step 6: 提交**

```sh
cd /home/goalizc/dsh-engineering
git add preset/plugins/output-language/index.js preset/plugins/output-language/output-language.test.mjs preset/agent.cordis.yml
git commit -m "feat: 语言规则升级为 system-prompt 段（order -1），删除 v1 运行时上下文行"
```

---

### Task 3: L2 —— 每条用户消息后的提醒注入

**Files:**
- Modify: `preset/plugins/output-language/output-language.test.mjs`（追加"注入行为"断言组）

**Interfaces:**
- Consumes: Task 1 的 `createUserMessage`、`hasHumanMessage`、`renderLanguageReminder`、`REMINDER_VERBATIM`；Task 2 的 `apply`（L2 已装在其中）。
- Produces: 一条 `agent/pre-step` 监听器。行为契约（README 与 evidence 会引用）：**每个 claim 到人类消息的步，追加恰好一条 `source.plugin === 'output-language'` 的 user 消息**；无人类消息、`reject`、`aborted` 三种情况不追加。

- [ ] **Step 1: 追加失败的测试**

在 `preset/plugins/output-language/output-language.test.mjs` 的 `console.log('selftest OK: output-language')` **之前**插入：

```js
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

const humanMessage = createUserMessage({ content: [{ type: 'text', text: '审查一下agents.md' }], source: { kind: 'user' } })
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
```

并在文件顶部 import 列表里补上 `REMINDER_VERBATIM` 与 `createUserMessage`、`hasHumanMessage`：

```js
import {
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
```

并把第 4 组断言里的常量改用 import 的 `REMINDER_VERBATIM`（把
`assert.ok(renderLanguageReminder(tag).includes('Keep code, commands, paths, and errors verbatim.'), …)`
换成 `assert.ok(renderLanguageReminder(tag).includes(REMINDER_VERBATIM), …)`），
让"尾句只有一处字面量"。

- [ ] **Step 2: 跑测试确认失败**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: FAIL —— `SyntaxError: The requested module './index.js' does not provide an export named 'hasHumanMessage'`（若 Task 1 已导出全部名字，则失败点是 `assert.equal(listeners.length, 1)` → 得到 0：`apply` 还没挂监听器）。

- [ ] **Step 3: 实现**

Task 1 的 `index.js` 已包含 `hasHumanMessage`、`createUserMessage` 与 `ctx.on('agent/pre-step', …)` 的完整实现与导出。本步是**确认**而非重写：核对 `apply` 内监听器与下面逐字一致（缺哪段补哪段，不要另写一套）：

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```sh
cd /home/goalizc/dsh-engineering && node preset/plugins/output-language/output-language.test.mjs
```

Expected: PASS，最后一行 `selftest OK: output-language`。

- [ ] **Step 5: 提交**

```sh
cd /home/goalizc/dsh-engineering
git add preset/plugins/output-language/index.js preset/plugins/output-language/output-language.test.mjs
git commit -m "feat: 每条用户消息后注入语言提醒（判据是本步 claim 的批次，不查历史）"
```

---

### Task 4: preset 层守卫改读 v2 spec

`scripts/output-language.test.mjs` 现在断言的是 v1 的冻结文本与旧导出面，**必须先看到它红**，再把它改到 v2。这也是"两个 spec 都声称自己是冻结源"的防线：本任务把跨校验源钉死在 v2 文件上。

**Files:**
- Modify: `scripts/output-language.test.mjs`（整文件替换）

**Interfaces:**
- Consumes: Task 1 的 `renderLanguageDirective` / `renderLanguageReminder`；v2 spec §6 的八行冻结文本。
- Produces: 三条守卫（组合挂载行 / v2 spec §6 交叉校验 / README 冻结行）—— 后续任何文本改动漏改任一处即红。

- [ ] **Step 1: 跑现有守卫，确认它确实红**

Run:

```sh
cd /home/goalizc/dsh-engineering && node --test scripts/output-language.test.mjs
```

Expected: FAIL —— 至少两条：`the plugin module exports the surface …`（找不到 `renderLanguageContext`）与 `the frozen clauses in spec section 6 …`（v1 spec 与实现已解耦）。

- [ ] **Step 2: 整文件替换 `scripts/output-language.test.mjs`**

```js
// scripts/output-language.test.mjs
//
// Guards the preset-level half of the output-language feature: the composition
// row that mounts the plugin, the plugin's exported surface, and the frozen
// clauses the docs publish. The plugin's own self-test
// (preset/plugins/output-language/output-language.test.mjs) owns the rendering
// contract; this file owns the facts whose drift would silently drop the
// interface-language directive from every session, or silently fork the frozen
// text.
//
// The authoritative frozen copy is spec §6 of the v2 design document. The v1
// document's clauses are superseded and are NOT asserted here — two documents
// claiming to be the frozen source is exactly the ambiguity this guard removes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SPEC = '../docs/superpowers/specs/2026-09-23-output-language-v2-design.md';
const README_RULE_PREFIXES = ['Output-language directive: ', 'Language: '];

test('the composition mounts the output-language plugin', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  assert.ok(
    composition.includes("name: './plugins/output-language/index.js'"),
    "preset/agent.cordis.yml must mount './plugins/output-language/index.js'. " +
      'Losing that row silently removes the interface-language directive from every session.',
  );
  assert.match(
    composition,
    /- id: output-language\n\s+name: '\.\/plugins\/output-language\/index\.js'/,
    'preset/agent.cordis.yml must keep the id `output-language` on the row that ' +
      'mounts the plugin, directly beside its name row. The id is what the mount is ' +
      'addressed by; a name-only match would still pass if the id were dropped.',
  );
});

test('the plugin module exports the surface the composition row needs', async () => {
  const plugin = await import('../preset/plugins/output-language/index.js');
  for (const key of [
    'apply',
    'renderLanguageDirective',
    'renderLanguageReminder',
    'resolveLanguageTag',
    'hasHumanMessage',
  ]) {
    assert.equal(typeof plugin[key], 'function', `plugin must export ${key} as a function`);
  }
  assert.equal(plugin.name, 'output-language', 'plugin name');
  assert.equal(plugin.SECTION_ORDER, -1, 'the section sits between identity (-1000) and persona (0)');
  assert.ok(!('renderLanguageContext' in plugin), 'the v1 renderer must be gone, not kept as an alias');
});

/**
 * Extract the frozen lines from spec §6.
 *
 * The spec deliberately prints the eight state lines WITHOUT code fences and
 * keeps the two templates fenced. Extraction therefore has a sharp shape: each
 * prefix yields exactly five lines (one template + four states), the template is
 * the one carrying `{language}`, and exactly four state lines must remain.
 *
 * Ambiguity is fatal on purpose: zero or extra lines mean the coupling between
 * spec and implementation is no longer knowable, and the guard must refuse to
 * guess rather than pass on the first hit.
 */
function frozenStateLines(section, prefix) {
  const lines = section.split('\n').filter((line) => line.startsWith(prefix));
  assert.equal(
    lines.length,
    5,
    `spec §6 must carry exactly one ${JSON.stringify(prefix)} template plus four state lines, found ${lines.length}`,
  );
  const states = lines.filter((line) => !line.includes('{language}'));
  assert.equal(states.length, 4, `spec §6 must carry exactly four ${JSON.stringify(prefix)} state lines, found ${states.length}`);
  return states;
}

test('spec section 6 freezes both renderers for all four states', async () => {
  const spec = await read(SPEC);
  const section6 = spec.split(/^## 6\./m)[1]?.split(/^## 7\./m)[0];
  assert.ok(section6, 'the v2 spec must still have a section 6 (渲染规则)');
  const plugin = await import('../preset/plugins/output-language/index.js');

  const directives = frozenStateLines(section6, 'Output-language directive: ');
  const reminders = frozenStateLines(section6, 'Language: ');

  // Position, not membership: the spec fixes the order zh / en / ja / fallback,
  // and each line must equal the renderer's output for that same state.
  const states = [
    ['zh', '中文 (zh)'],
    ['en', 'English (en)'],
    ['ja', 'ja (ja)'],
    [undefined, '中文 (zh)'],
  ];
  states.forEach(([tag, label], index) => {
    assert.equal(
      plugin.renderLanguageDirective(tag),
      directives[index],
      `renderLanguageDirective(${String(tag)}) must equal spec §6's ${label} line verbatim — ` +
        'a missing, reordered, or reworded clause fails here',
    );
    assert.equal(
      plugin.renderLanguageReminder(tag),
      reminders[index],
      `renderLanguageReminder(${String(tag)}) must equal spec §6's ${label} line verbatim`,
    );
  });
});

test('the README publishes both zh lines verbatim, so the examples cannot fork', async () => {
  const readme = await read('../README.md');
  assert.ok(readme.includes('## 输出语言'), 'README must still carry a 输出语言 section');
  const section = readme.split(/^## 输出语言$/m)[1]?.split(/^## /m)[0];
  assert.ok(section, 'README must still have a 输出语言 section');
  const plugin = await import('../preset/plugins/output-language/index.js');

  for (const prefix of README_RULE_PREFIXES) {
    const found = section.split('\n').filter((line) => line.startsWith(prefix));
    assert.equal(
      found.length,
      1,
      `the 输出语言 section must publish exactly one line starting with ${JSON.stringify(prefix)}; found ${found.length}`,
    );
  }
  const directiveLine = section.split('\n').find((line) => line.startsWith('Output-language directive: '));
  const reminderLine = section.split('\n').find((line) => line.startsWith('Language: '));
  assert.equal(
    directiveLine,
    plugin.renderLanguageDirective('zh'),
    "README's L1 example must equal renderLanguageDirective('zh') character for character — " +
      'it is one of the frozen copies, so a fork here silently publishes a line no session renders',
  );
  assert.equal(
    reminderLine,
    plugin.renderLanguageReminder('zh'),
    "README's L2 example must equal renderLanguageReminder('zh') character for character",
  );
});
```

- [ ] **Step 3: 跑测试确认通过**

Run:

```sh
cd /home/goalizc/dsh-engineering && node --test scripts/output-language.test.mjs
```

Expected: 3 个 test 全 PASS、0 fail。

**注意**：本步会失败在 `the README publishes both zh lines verbatim` —— 这是**预期内的红**，README 在 Task 5 才更新。此时可以先只跑前两个 test：

```sh
cd /home/goalizc/dsh-engineering && node --test --test-name-pattern="composition|module exports|spec section 6" scripts/output-language.test.mjs
```

Expected: 3 pass / 0 fail。README 那条留到 Task 5 Step 4 转绿。

- [ ] **Step 4: 提交**

```sh
cd /home/goalizc/dsh-engineering
git add scripts/output-language.test.mjs
git commit -m "test: 输出语言守卫改读 v2 spec §6，断言导出面与冻结行"
```

（本次提交故意让 README 守卫红着——它由 Task 5 关闭。提交信息里写明这一点。）

---

### Task 5: README 与证据文档

**Files:**
- Modify: `README.md`（「输出语言」节、顶部插件枚举、目录树注释）
- Modify: `evidence/VERIFICATION.md`（追加 2026-09-23 一节）

**Interfaces:**
- Consumes: Task 1 的两个渲染函数输出、Task 3 的注入行为契约、spec §3 约束 1 的代码级证据。
- Produces: Task 4 的第三条守卫转绿所需的 README 文本。

- [ ] **Step 1: 改写 README「输出语言」节**

把 `## 输出语言` 到下一个 `## ` 之间的整节替换为（**L1、L2 两行必须逐字等于 `renderLanguageDirective('zh')` 与 `renderLanguageReminder('zh')`**；下面两条代码块里的文本就是那个逐字文本）：

````markdown
## 输出语言

模型写出的**每一段文本**——思考流、可见回复、工具间隙旁白、流程产物（plan/spec/评审/TDD 说明/todo）——都跟随 host 用户设置 `locale.preference`：设置页的语言开关写它，也可以直接改 `$DSH_HOME/settings.yaml`。

| `locale.preference` | 行为 |
|---|---|
| `zh` | 中文（含思考） |
| `en` | 英文（含思考） |
| 其他合法 tag（如 `ja`） | 该 tag 自身，不猜语言名 |
| 未设置 / 非法值 | **兜底中文** |

规则落在两处，同一条断言、两种长度：

**L1——system-prompt 段（`order: -1`，每步随 system 重发，排在 persona 之前）**：

```
Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, and every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text) — in 中文 (zh). Never write any of it in another language. Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.
```

**L2——每条人类用户消息之后的提醒**（`agent/pre-step`，紧跟本步 claim 到的消息；判据是**本步的批次**，不查历史，所以每个回应人类的步都会得到一条）：

```
Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only. Keep code, commands, paths, and errors verbatim.
```

**代码、标识符、命令、路径、错误原文一律不翻译。**

为什么要两处（2026-09-23 实测驱动）：v1 只有一条 **user 角色**的运行时上下文行，规则文本已经点名 reasoning 与过程旁白，实测仍失守——一条 2 轮会话里思考块**首词 18/18 是英文**，剥掉引用块后思考 CJK 只有 `3.7%`（第 1 轮 `0.19%`），而可见正文 `37.3%`。诊断是投递层与近因：规则不在 system 里，且一轮英文锚定自我延续（T2 才升到 7.5%）。详见 `evidence/VERIFICATION.md` 的 2026-09-23 一节。

生效边界（实测，见 `evidence/VERIFICATION.md` 的 2026-09-18 与 2026-09-23 两节）：

- `locale.preference` 的**值**改动**热生效**——L1 下一步生效，L2 下一条生效；两条都是 provider，不做注册时快照。
- **插件 / 组合代码改动需要重启宿主**（`dsh web`）：运行中的 host 进程缓存 preset 插件模块（Node ESM 模块缓存），**只新建会话不够**。
- 安装/刷新 preset 后仍需**新建会话**（DSH 会话一旦开始不能切换模式）。
- **思考语种是提示词级引导，不是熔断**：v2 把它提到 system 层并加了每轮近因，仍不构成保证。
- **`settings` 服务不可达时没有界面信号**：降级静默生效（插件只 `warn` 一次），唯一判据是渲染出的文本——它会落到中文兜底那一支。
- 界面语言是 `en` 时，本规则要求**连思考也用英文**；不会跟随你自己消息的语言。

实现落在 `preset/plugins/output-language/index.js`：一个 `order: -1` 的 `systemPrompt.section`（provider 文本）+ 一个 `agent/pre-step` 监听器；插件自包含，`section()` 不可用时只丢 L1 并 warn 一次，绝不打断会话。
````

- [ ] **Step 2: 更新顶部插件枚举与目录树**

把 README 第 22 行那一格（`| **输出语言跟随界面语言** | …`）替换为：

```markdown
| **输出语言跟随界面语言** | 插件 `preset/plugins/output-language` 注册一条 `order: -1` 的 system-prompt 段（每步重发）与一条每条用户消息后的提醒，读 host 设置 `locale.preference`（界面 `zh` 默认中文、`en` 默认英文，读不到兜底中文；覆盖思考、回复、过程旁白与流程产物） |
```

把目录树里的一行替换为：

```
│   │   └── output-language/         # 输出语言：system 段（order -1）+ 每条用户消息提醒
```

- [ ] **Step 3: 追加 `evidence/VERIFICATION.md` 一节**

在文件末尾追加（把 `<npm test 输出>`、`<组合检查输出>` 换成真实粘贴，不要凭记忆写）：

````markdown
## 2026-09-23 输出语言 v2（system 段 + 每轮提醒）

**触发**：takisy 工作区会话 `session-d0c635f9-875d-4dc4-934d-fda5a2f3bbec`（`engineering`、界面 `zh`、用户全程中文、2 轮 18 步）的实测——v1 的语言行与 `8843205` 扩写的覆盖句**都已生效**（运行时上下文含 `your reasoning, your progress notes between tool calls`；bootstrap 注入 1 次），但思考仍是英文。

| 指标 | 实测 |
|---|---|
| 思考流 CJK（原始 / 剥引用后） | `6928/63609 = 10.9%` / `2097/56942 = 3.7%` |
| 思考块首词语言 | `18/18` 英文 |
| 第 1 轮 / 第 2 轮思考 CJK（剥引用后） | `0.19%` / `7.5%` |
| 可见正文 CJK | `1567/4206 = 37.3%` |
| bootstrap 注入次数 | `1`（幂等修复生效） |

**诊断**：规则投递在 user 角色的历史消息里（`source.kind: "plugin"`、`form: "snapshot"`、`systemPromptUpdate: "in-history"`），而 system 消息 8514 字符里只有 9 个 CJK 字符、完全没提语言；规则之后紧跟 3593 字符英文 skill 目录与 11662 字符英文 bootstrap。

**设计**：v2 spec `docs/superpowers/specs/2026-09-23-output-language-v2-design.md`。

**架构性未知的关闭方式（2026-09-23，未跑探针）**：原计划是起一条真会话实证 `systemPrompt.section()` 在 preset realm 可调用。实施时改用三条代码级证据，因此**没有**会话转录可贴：

1. `@deepseek-ai/dsh-agent-presets/lib/index.js` 的 `mount` 模块注释：every `ctx.tools` and `ctx.systemPrompt` registration inside the preset files into that agent's layer and unwinds with it。
2. 运行时内省 `@deepseek-ai/dsh-system-prompt` 的 `SystemPrompt.prototype`：`section` / `context` / `getSectionOrder` 同为 `function`，不存在只有 `context` 的宿主版本。
3. v1 的 `context()` 已实测在该 realm 跑通（语言行进了真会话转录 `session-d0c635f9`），同一次 `inject(['systemPrompt'])` 给的是同一个 `scope.systemPrompt` 对象。

仍未观察到的只剩观测量：新 L1 文本出现在渲染后的 system 消息里、且位于 persona 之前——它由 Task 6 的端到端实测覆盖。

**单测与守卫**：

```
<npm test 输出>
```

**组合健康检查**：

```
<组合检查输出>
```

**未验证（诚实清单）**：

- 生效后的真实会话**尚未观察**：需要人类重启宿主后新建会话跑一条中文多轮任务，按 v2 spec §9 的三条指标判定（思考流剥引用后 CJK ≥ 50%、可见正文 CJK ≥ 50%、每条消息首个思考块中文）。达标与否以实测为准；**不达标如实记失败，不修改门槛**。
- 界面 `en` 的热切换场景未跑。
- 子代理场景未跑。
````

- [ ] **Step 4: 跑全部测试，确认守卫转绿**

Run:

```sh
cd /home/goalizc/dsh-engineering && npm test
```

Expected: 全绿、`fail 0`。若 `the README publishes both zh lines verbatim` 仍红，说明 README 里的两行与 `renderLanguageDirective('zh')` / `renderLanguageReminder('zh')` 不完全一致——**从渲染器复制**，不要手打。

- [ ] **Step 5: 提交**

```sh
cd /home/goalizc/dsh-engineering
git add README.md evidence/VERIFICATION.md
git commit -m "docs: 回填输出语言 v2（system 段 + 每轮提醒）的行为、生效边界与实测记录"
```

---

### Task 6: 端到端实测（人类执行，唯一真证据）

自动化到 Task 1 为止，第 1–2a 层全绿也只证明"文本与注册形状对"。本任务由人类执行，**任一条不过即不算完成**。

**Files:**
- Modify: `evidence/VERIFICATION.md`（把 Task 1 Step 3 的"未验证清单"第一条改写成实测结果）

**Interfaces:**
- Consumes: Task 1–5 的全部产出（已安装的 preset）。
- Produces: 需求的最终验收记录。

- [ ] **Step 1: 重启宿主并重装 preset**

```sh
cd /home/goalizc/dsh-engineering && bash scripts/install.sh
```

然后人类重启 `dsh web`（插件代码改动必须重启宿主，只新建会话不够）。

- [ ] **Step 2: 新建会话跑一条中文多轮任务**

界面 `zh`、选「工程模式」、发一条会产生多轮工具调用的中文任务（例如「审查一下 README 的验证一节」），至少两轮。

- [ ] **Step 3: 测量三条指标**

用下面这段脚本（把 `<转录文件>` 换成该会话的 `session.v3.jsonl.zstd` 路径）：

```sh
zstdcat <转录文件> | python3 -c '
import json,sys,re
CJK=re.compile(r"[\u3400-\u9fff]")
raw=cjk=vis=vcjk=0
blocks=0      # reasoning blocks
block_zh=0    # blocks whose own prose opens in Chinese
messages=0    # assistant messages carrying at least one reasoning block
message_zh=0  # ... whose FIRST reasoning block opens in Chinese
for line in sys.stdin:
    try: d=json.loads(line)
    except: continue
    if d.get("type")!="assistant/message": continue
    seen_first=False
    for p in d["data"]["message"].get("content") or []:
        if not isinstance(p,dict): continue
        if p.get("type")=="reasoning":
            t=p["text"]
            stripped=re.sub(r"`[^`]*`","",t)
            stripped=re.sub(r"\"[^\"]*\"","",stripped)
            raw+=len(t); cjk+=len(CJK.findall(stripped))
            zh=bool(CJK.search(stripped[:40]))
            blocks+=1; block_zh+=zh
            if not seen_first:
                seen_first=True; messages+=1; message_zh+=zh
        elif p.get("type")=="text":
            t=p["text"]; vis+=len(t); vcjk+=len(CJK.findall(t))
print(f"思考剥引用后 CJK: {cjk}/{raw} = {cjk/raw:.1%}" if raw else "no reasoning")
print(f"可见正文 CJK:     {vcjk}/{vis} = {vcjk/vis:.1%}" if vis else "no visible text")
print(f"思考块首段含中文: {block_zh}/{blocks}")
print(f"每条消息首个思考块含中文: {message_zh}/{messages}")'
```

判据（v2 spec §9）：

| 指标 | 目标 |
|---|---|
| 思考剥引用后 CJK | ≥ 50% |
| 可见正文 CJK | ≥ 50% |
| 每条消息首个思考块 | 中文 |

- [ ] **Step 4: 界面语言热切换场景**

会话中途把 `$DSH_HOME/settings.yaml` 的 `locale.preference` 改为 `en`，发下一条消息。Expected: L1 与 L2 都变英文，无需重启。

- [ ] **Step 5: 子代理场景**

派一个子代理执行一小段任务。Expected: 子代理报告同规则（中文）。

- [ ] **Step 6: 回填实测结果并提交**

把 `evidence/VERIFICATION.md` 的"未验证清单"第一条替换为实测数字与逐字证据，然后：

```sh
cd /home/goalizc/dsh-engineering
git add evidence/VERIFICATION.md
git commit -m "docs: 回填输出语言 v2 端到端实测（思考/正文/轮首语言三项指标）"
```

Expected: 提交成功，**无论达标与否**——不达标就如实写"未达标，实测数字为 …"，并把下一步选项（更强措辞 / 更密的注入 / 承认提示词层上限）作为新问题记录下来，不修改门槛。

---

## Self-Review

**1. Spec coverage**（逐节对照 v2 spec）：

| spec 节 | 落在哪个任务 |
|---|---|
| §3 约束 1（section 可调用性） | 已用三条代码级证据关闭，无任务；证据写进 Task 5 的 evidence 一节 |
| §4 语义决策（界面语言 + 中文兜底） | Task 1 Step 1 第 3、7 组断言 + Task 1 Step 3 的 `tagOrFallback` |
| §5 L1（order -1、section、动态 provider） | Task 1 实现 + Task 1 Step 1 第 11 组断言 |
| §5 L2（pre-step、判据是本步批次、消息形状） | Task 1 Step 1 第 13 组断言 + Task 1 实现的 `hasHumanMessage` |
| §5 L3（删除 context） | Task 1 Step 1 的 `contextCalls.length === 0` |
| §6 渲染规则与八行冻结 | Task 1 Step 1 golden + Task 1 spec 交叉校验 |
| §7 数据流/时效（动态、无 per-request IO） | Task 1 Step 1 的动态重读断言 + Task 1 Step 1 第 13g 组 |
| §8 失败模式（兜底中文、section 缺失降级、reject/abort 不注入） | Task 1 Step 1 第 3 组 + Task 1 Step 1 第 12 组 + Task 1 Step 1 第 13e 组 |
| §9 测试与验证（单测/守卫/端到端/命令） | Task 1、3、4、5、6 |
| §9 端到端三条指标 | Task 1 Step 3 |
| §10 风险（三份 `createUserMessage`、成本） | Global Constraints + Task 1 Step 3 的源码注释 |
| §11 明确不做（不改 bootstrap/persona/工具描述） | Global Constraints 的"不改"清单 |
| §11 不删 v1 spec、冻结源唯一 | Task 1 的文件头注释 + v1 spec 里的取代指引（已在 spec 提交 `b55c217` 完成） |

无缺口。

**2. Placeholder scan**：计划中不出现 TBD/TODO/"自行补充"。`evidence/VERIFICATION.md` 一节里的 `<npm test 输出>`、`<组合检查输出>` 是**证据占位**，由执行者在对应 Step 粘贴真实输出——这是如实记录的要求，不是设计缺口。Task 6 的 `<转录文件>` 是运行时路径参数，同前。

**3. Type consistency**：本计划使用的名字与签名在 Task 1 的导出表里一次性定义，后续任务只引用不重命名——`renderLanguageDirective(tag)`、`renderLanguageReminder(tag)`、`resolveLanguageTag(ctx)`、`hasHumanMessage(messages)`、`createUserMessage(input)`、`apply(ctx)`、`SECTION_NAME`、`SECTION_ORDER`、`LANGUAGE_TAG`、`LANGUAGE_NAMES`、`FALLBACK_TAG`、`REMINDER_VERBATIM`。Task 1 与 Task 1 的 import 列表与 Task 1 的导出表逐字一致；`renderLanguageContext`（v1 名）在 Task 1 被删除，Task 1 的守卫显式断言它不存在，防止留成别名。
