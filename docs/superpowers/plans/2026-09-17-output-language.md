# 输出语言跟随界面语言 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工程模式的模型输出语言跟随 host 界面语言设置（`locale.preference`）：界面 `zh` 默认中文、`en` 默认英文，用户改用别的语言时跟随用户，代码/命令/错误原文永不翻译。

**Architecture:** 新增一个 preset 本地 Cordis 插件 `preset/plugins/output-language/`，在 preset 组合里以 preset 相对行挂载。插件用 `ctx.inject(['systemPrompt'])` + `scope.systemPrompt.context({ order: 105, text: provider })` 注册**一条动态运行时上下文行**：`text` 是零参函数，每次组装提示词都重新读 `ctx.get('settings').get('locale').preference` 并渲染，所以改设置下一条回复即生效（无需重启会话、无需事件订阅）。插件自包含（只用 `node:*` 内置模块），失败路径一律降级为"界面语言未设置 → 跟随用户"文本，绝不打断提示词组装。

**Tech Stack:** Node ESM 插件（无框架自测，`node:assert`）、`node:test`（scripts 层守卫）、YAML（组合行）、Markdown（README 与验证记录）、Bash（既有 `scripts/install.sh`）。

**Spec:** `docs/superpowers/specs/2026-09-17-output-language-design.md`

## Global Constraints

- **插件自包含**：`preset/plugins/output-language/index.js` 与它的自测**不得 import 任何 `@deepseek-ai/*` 包**，只用 Node 内置模块。用户家目录下的 preset 没有可达的 `node_modules` 回溯，`--copy` 安装模式连链接都没有。
- **不改 harness 安装**：`/usr/lib/node_modules/@deepseek-ai/dsh/**` 一行都不动；本需求只在 `$REPO` 内落地。
- **文案逐字固定**（spec §6）：四个分支的文本，含 `—`（em dash）与句末句号，**不得改写标点或语序**。渲染**永不返回空串**。
- **固定标识**：context `name: 'output-language'`、`order: 105`、插件 `name: 'output-language'`、settings namespace `locale`、字段 `preference`。
- **每个插件目录必须带同名自测**：`preset/plugins/output-language/output-language.test.mjs`。这是 `scripts/install.sh` 安装门禁的硬性要求（缺同名测试即中止安装），不是可选项。
- **生成物只经脚本更新**：`preset/.manifest.json` 被 `.gitignore` 忽略，**永不 `git add`**（`npm test` 的 `pretest` 会重建它）。
- **生效边界是新建会话**：preset 组合在会话启动时定死，装完必须**新建**一个会话才看得到；当前会话不受影响。
- **提交约定**：Conventional Commits + 中文主题；一个子系统一个 commit；不 `push`。
- **验证证据必须真实**：粘贴实测输出与从会话日志里取到的模型原文，禁止编造；跑不到的场景要如实写"未跑"。
- **测试终值**：`npm test` → `tests 36`、`pass 36`、`fail 0`。口径（Task 1 实测校正）：`node --test` 把**每个** `*.test.mjs` 文件计为 1 个测试，基线 33 已含 `bootstrap.test.mjs` 与 `caveman-command.test.mjs` 各 1 个；Task 1 新增插件自测 +1 → **34**；Task 4 新增 `scripts/output-language.test.mjs` 的 2 个子测试 +2 → **36**。实测若与 36 不同，以实测为准并回填 README。

## File Structure

| 文件 | 责任 | 本次动作 |
|---|---|---|
| `preset/plugins/output-language/index.js` | 语言规则的全部逻辑：纯渲染、读设置、注册上下文行 | 新建 |
| `preset/plugins/output-language/package.json` | 与 `bootstrap` 同构的最小包描述 | 新建 |
| `preset/plugins/output-language/output-language.test.mjs` | 无框架自测：渲染四态、非法输入、读取不抛、注册形状、自包含扫描（**安装门禁要求**） | 新建 |
| `scripts/output-language.test.mjs` | `node:test` 守卫：组合挂载行 + 插件导出面 | 新建 |
| `preset/agent.cordis.yml` | 组合：在 `bootstrap` 行之后挂载新插件行 | 修改 |
| `README.md` | 用户文档：「四件事」升五件、目录树、测试计数、新增「输出语言」节 | 修改 |
| `evidence/VERIFICATION.md` | 验证记录（真实输出 + 四场景实测证据） | 修改 |
| `docs/superpowers/specs/2026-09-17-output-language-design.md` | spec 的文件表补上插件自测这一必需文件 | 修改（与计划同 commit） |

---

### Task 1: 渲染纯函数与插件自测（TDD，不需要 harness）

**Files:**
- Create: `preset/plugins/output-language/index.js`
- Create: `preset/plugins/output-language/package.json`
- Test: `preset/plugins/output-language/output-language.test.mjs`

**Interfaces:**
- Consumes: 无（本任务不读 host 设置，纯函数）
- Produces:
  - `renderLanguageContext(tag: string | undefined): string` —— 纯、全函数；非法/缺失一律渲染 "not set" 分支；永不返回空串
  - 常量 `LANGUAGE_TAG: RegExp`（BCP 47 风格形状）、`name = 'output-language'`
  - Task 2 将在同一文件续写 `resolveLanguageTag(ctx)` 与 `apply(ctx)`

- [ ] **Step 1: 写失败的自测**

创建 `preset/plugins/output-language/output-language.test.mjs`，内容逐字如下：

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
 * `node_modules` link. It never starts an agent: rendering is a pure function,
 * and the settings read is driven with fake contexts.
 *
 * Usage: node preset/plugins/output-language/output-language.test.mjs   (or: npm test)
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { LANGUAGE_TAG, apply, name, renderLanguageContext, resolveLanguageTag } from './index.js'

/** The fixed closing clause every branch must carry. */
const VERBATIM =
  'Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.'

/** The shared phrase naming what the rule covers. */
const COVERED =
  'your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items —'

assert.equal(name, 'output-language', 'plugin name')

// 1. zh renders the frozen spec text verbatim — punctuation included.
assert.equal(
  renderLanguageContext('zh'),
  `Interface language: zh (Chinese). Write ${COVERED} in Chinese. If the user writes in another language, answer that message in the user's language instead. ${VERBATIM}`,
  'zh renders the Chinese rule verbatim',
)

// 2. en names English and targets it.
const en = renderLanguageContext('en')
assert.ok(en.startsWith('Interface language: en (English). Write '), 'en names English')
assert.ok(en.includes(' in English.'), 'en targets English')

// 3. An unmapped but well-formed tag is used as-is, never guessed at.
const ja = renderLanguageContext('ja')
assert.ok(ja.startsWith('Interface language: ja. Write '), 'unmapped tag is not labelled with a guessed name')
assert.ok(ja.includes('in ja.'), 'unmapped tag is its own target language')

// 4. Unreadable or malformed input delegates to the user, and is never empty.
for (const bad of [undefined, null, '', '中文', 'zh_CN', 'zh ', 123, {}]) {
  const text = renderLanguageContext(bad)
  assert.ok(
    text.startsWith('Interface language: not set. Write '),
    `not-set branch for ${JSON.stringify(bad)}`,
  )
  assert.ok(
    text.includes("in the language of the user's message"),
    `delegates to the user's language for ${JSON.stringify(bad)}`,
  )
  assert.ok(text.includes(VERBATIM), `verbatim clause present for ${JSON.stringify(bad)}`)
  assert.ok(text.length > 0, 'never renders an empty contribution')
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
assert.equal(
  resolveLanguageTag({ get: () => { throw new Error('boom') } }),
  undefined,
  'throwing ctx -> undefined',
)

// 7. The plugin registers exactly one dynamic context line, and re-evaluates it.
const registered = []
const injected = []
const fakeCtx = {
  get: () => ({ get: () => ({ preference: 'en' }) }),
  inject(services, callback) {
    injected.push(services)
    callback({ systemPrompt: { context: (entry) => registered.push(entry) } })
  },
  logger: { warn: () => {} },
}
apply(fakeCtx)
assert.deepEqual(injected, [['systemPrompt']], 'injects the systemPrompt service')
assert.equal(registered.length, 1, 'registers exactly one context')
assert.equal(registered[0].name, 'output-language', 'context name')
assert.equal(registered[0].order, 105, 'context order')
assert.equal(typeof registered[0].text, 'function', 'text is a provider, not a frozen string')
assert.ok(
  registered[0].text().startsWith('Interface language: en (English).'),
  'provider renders the live setting',
)

// 8. Self-contained: the plugin source imports nothing from the harness.
const source = await readFile(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
assert.ok(!source.includes('@deepseek-ai/'), 'plugin must not import harness packages')

console.log('selftest OK: output-language')
```

- [ ] **Step 2: 跑自测，确认它失败**

Run: `node preset/plugins/output-language/output-language.test.mjs`
Expected: FAIL — `Cannot find module .../output-language/index.js`（插件还不存在）

- [ ] **Step 3: 写最小实现**

创建 `preset/plugins/output-language/index.js`，内容逐字如下（本任务先写渲染与常量；`resolveLanguageTag`/`apply` 一并写入，Step 6 才在真 harness 上被验证）：

```js
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
```

创建 `preset/plugins/output-language/package.json`，内容逐字如下：

```json
{
  "name": "dsh-output-language",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Renders the interface language as a dynamic system-prompt context line for agents on this preset.",
  "main": "index.js",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2"
  }
}
```

- [ ] **Step 4: 跑自测，确认通过**

Run: `node preset/plugins/output-language/output-language.test.mjs`
Expected: PASS — 末行打印 `selftest OK: output-language`

- [ ] **Step 5: 跑全仓测试，确认没有回归**

Run: `npm test`
Expected: `tests 34`、`pass 34`、`fail 0`（基线 33 + 本任务新增的插件自测文件 1 个）

- [ ] **Step 6: 提交**

```bash
git add preset/plugins/output-language/index.js preset/plugins/output-language/package.json preset/plugins/output-language/output-language.test.mjs
git commit -m "feat: 新增 output-language 插件（按界面语言渲染运行时上下文行）"
```

---

### Task 2: 挂载组合行，并探针确认 `settings` 服务可达

**Files:**
- Modify: `preset/agent.cordis.yml`（`# ── bootstrap ──` 段内 `bootstrap` 行之后、`# ── skills ──` 分隔线之前）
- Modify: `preset/plugins/output-language/index.js`（无代码改动则跳过；本任务只做挂载与探针）
- Test: 真会话（人工新建）

**Interfaces:**
- Consumes: Task 1 的 `apply(ctx)` 与 `renderLanguageContext(tag)`
- Produces:
  - 组合里出现 `name: './plugins/output-language/index.js'` 的 preset 相对行
  - **探针结论**：preset realm 能否解析 host 的 `settings` 服务（决定 Task 3 是否执行）

- [ ] **Step 1: 在组合里加挂载行**

在 `preset/agent.cordis.yml` 的 `bootstrap` 行区块之后、`# ── skills ──` 分隔线之前插入：

```yaml
# 输出语言：把 host 用户设置里的 `locale.preference` 渲染成一条动态运行时
# 上下文行，让回复与流程产物跟随界面语言（界面语言为默认；用户改用别的语言
# 时跟随用户）。与 bootstrap 同构：自包含、不 import harness 包、preset 相对行。
- id: output-language
  name: './plugins/output-language/index.js'
```

- [ ] **Step 2: 刷新安装并确认组合健康**

```bash
scripts/install.sh
node scripts/verify-composition.mjs
```

Expected: `install.sh` 末尾打印**三个**预设本地插件自测通过（`bootstrap`、`caveman-command`、`output-language`），安装不中止；`verify-composition.mjs` 对 `engineering` 判 `MOUNT OK`，新行**不**出现在 `broken` 里。

- [ ] **Step 3: 新建会话跑探针**

**由用户在 GUI 里新建一个会话**（模式选 `工程模式`），发送这句：

```
逐字贴出你系统提示里那条以 "Interface language:" 开头的行的原文，不要改写、不要解释。
```

- [ ] **Step 4: 判定探针结论**

- 若贴出的行以 `Interface language: zh (Chinese).` 开头 → **`settings` 服务可达**：Task 3 不执行（直接跳到 Task 4），并在 Task 4 的记录里写明"服务路径，未启用文件降级"。
- 若贴出的行以 `Interface language: not set.` 开头 → **`settings` 服务在 preset realm 不可解析**：执行 Task 3。

判定依据必须来自模型贴出的原文（或从该会话日志里取到的原文），不能靠推断。

- [ ] **Step 5: 提交**

```bash
git add preset/agent.cordis.yml
git commit -m "feat: 组合挂载 output-language（界面语言跟随）"
```

---

### Task 3: 降级数据源 —— 读环境设置文件（**仅当 Task 2 探针判定 `settings` 不可达时执行**）

**Files:**
- Modify: `preset/plugins/output-language/index.js`（新增 `parseLanguageTag(yamlText)` 纯函数与文件读取路径）
- Modify: `preset/plugins/output-language/output-language.test.mjs`（新增解析器与降级分支断言）

**Interfaces:**
- Consumes: Task 1 的 `renderLanguageContext(tag)`、`isValidTag`、`LANGUAGE_TAG`
- Produces:
  - `parseLanguageTag(yamlText: string): string | undefined` —— 纯函数，从设置文档文本里取 `locale.preference`
  - `resolveLanguageTag(ctx)` 改为：先试 `ctx.get('settings')`，不可用则每次渲染读 `$DSH_HOME/settings.yaml`
  - `settingsDocumentPath(): string` —— `process.env.DSH_HOME ?? join(homedir(), '.dsh')` + `settings.yaml`

- [ ] **Step 1: 在自测里加失败断言**

在 `preset/plugins/output-language/output-language.test.mjs` 的 `import` 语句里加入 `parseLanguageTag`，并在第 8 段断言之前插入：

```js
// 7b. The settings document is parsed narrowly, without a YAML dependency.
assert.equal(
  parseLanguageTag('locale:\n  preference: zh\nagent-presets: { default: engineering }\n'),
  'zh',
  'reads the locale block',
)
assert.equal(
  parseLanguageTag('locale:\n  preference: "en"   # 界面语言\nother: 1\n'),
  'en',
  'strips quotes and comments',
)
assert.equal(parseLanguageTag('ui-theme:\n  preference: system\n'), undefined, 'does not read other blocks')
assert.equal(parseLanguageTag('locale:\n'), undefined, 'empty block -> undefined')
assert.equal(parseLanguageTag('locale:\n  preference: zh_CN\n'), undefined, 'malformed tag -> undefined')
assert.equal(parseLanguageTag(''), undefined, 'empty document -> undefined')
```

- [ ] **Step 2: 跑自测，确认失败**

Run: `node preset/plugins/output-language/output-language.test.mjs`
Expected: FAIL — `parseLanguageTag is not a function`（或 import 报错）

- [ ] **Step 3: 实现文件数据源**

在 `preset/plugins/output-language/index.js` 顶部加入内置模块 import：

```js
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
```

在 `resolveLanguageTag` 之前加入：

```js
/**
 * Where the file-backed settings provider keeps its user document.
 *
 * @returns the absolute path of `settings.yaml`.
 */
function settingsDocumentPath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'settings.yaml')
}

/**
 * Read `locale.preference` out of the settings document text.
 *
 * Deliberately a narrow block parse rather than a YAML parser: this module may
 * not import anything (least of all a dependency), and only this one two-line
 * block is needed. Anything unexpected yields undefined, which renders the
 * "not set" branch.
 *
 * @param yamlText - the settings document contents.
 * @returns the language tag, or undefined when absent or malformed.
 */
function parseLanguageTag(yamlText) {
  if (typeof yamlText !== 'string') return undefined
  const lines = yamlText.split(/\r?\n/)
  const start = lines.findIndex((line) => /^locale:\s*(?:#.*)?$/.test(line))
  if (start === -1) return undefined
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^\S/.test(line)) break
    const match = /^\s+preference:\s*("?)([^"#\s]+)\1\s*(?:#.*)?$/.exec(line)
    if (match !== null) {
      const tag = match[2]
      return isValidTag(tag) ? tag : undefined
    }
  }
  return undefined
}
```

把 `resolveLanguageTag` 改为服务优先、文件兜底（原函数体替换为）：

```js
function resolveLanguageTag(ctx) {
  try {
    const settings = ctx?.get?.('settings')
    if (settings !== undefined && settings !== null && typeof settings.get === 'function') {
      const raw = settings.get(LOCALE_NAMESPACE)?.[LOCALE_FIELD]
      const tag = typeof raw === 'string' ? raw.trim() : undefined
      if (isValidTag(tag)) return tag
    }
  } catch (error) {
    warnOnce(ctx, error)
  }
  try {
    return parseLanguageTag(readFileSync(settingsDocumentPath(), 'utf8'))
  } catch (error) {
    warnOnce(ctx, error)
    return undefined
  }
}
```

并把导出行改为包含 `parseLanguageTag`、`settingsDocumentPath`：

```js
export {
  CONTEXT_ORDER,
  LANGUAGE_TAG,
  name,
  apply,
  parseLanguageTag,
  renderLanguageContext,
  resolveLanguageTag,
  settingsDocumentPath,
}
```

- [ ] **Step 4: 跑自测与全仓测试**

Run: `node preset/plugins/output-language/output-language.test.mjs && npm test`
Expected: 自测 PASS；`npm test` → `tests 34`、`pass 34`、`fail 0`

- [ ] **Step 5: 重跑探针（同 Task 2 Step 3/4 的会话流程）**

**由用户新建会话**再问同一句。Expected: 贴出的行以 `Interface language: zh (Chinese).` 开头（文件路径生效）。
如实记录这次探针输出——它是 Task 3 的验收证据。

- [ ] **Step 6: 提交**

```bash
git add preset/plugins/output-language/index.js preset/plugins/output-language/output-language.test.mjs
git commit -m "fix: output-language 增加设置文件兜底数据源（settings 服务不可达时）"
```

---

### Task 4: scripts 层守卫 + 端到端四场景实测

**Files:**
- Create: `scripts/output-language.test.mjs`
- Test: 真会话（人工切换界面语言）

**Interfaces:**
- Consumes: Task 2 的挂载行、Task 1/3 的插件导出面
- Produces:
  - `scripts/output-language.test.mjs` 的两个子测试（组合挂载行、插件导出面）
  - 四个场景的**真实证据**（模型原文），Task 5 写进 `evidence/VERIFICATION.md`

- [ ] **Step 1: 写 scripts 层守卫测试**

创建 `scripts/output-language.test.mjs`，内容逐字如下：

```js
// scripts/output-language.test.mjs
//
// Guards the preset-level half of the output-language feature: the composition
// row that mounts the plugin, and the plugin's exported surface. The plugin's
// own self-test (preset/plugins/output-language/output-language.test.mjs) owns
// the rendering contract; this file owns the facts whose drift would silently
// drop the interface-language rule from every session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the composition mounts the output-language plugin', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  assert.ok(
    composition.includes("name: './plugins/output-language/index.js'"),
    "preset/agent.cordis.yml must mount './plugins/output-language/index.js'. " +
      'Losing that row silently removes the interface-language rule from every session.',
  );
});

test('the plugin module exports the surface the composition row needs', async () => {
  const plugin = await import('../preset/plugins/output-language/index.js');
  for (const key of ['name', 'apply', 'renderLanguageContext', 'resolveLanguageTag']) {
    assert.ok(key in plugin, `plugin must export ${key}`);
  }
  assert.equal(plugin.name, 'output-language');
});
```

- [ ] **Step 2: 跑全仓测试，确认新终值**

Run: `npm test`
Expected: `tests 36`、`pass 36`、`fail 0`（34 + 本文件 2 个子测试）

- [ ] **Step 3: 场景 1 —— 界面 zh 的默认语言**

**由用户**在界面语言为中文时新建会话（或复用 Task 2 探针那个会话），发送：

```
用一句话说明你现在默认的输出语言是哪一种。
```

Expected: 中文答复。记录该会话 id 与模型原文。

- [ ] **Step 4: 场景 2 —— 中途改界面语言，下一条就换**

**由用户**把 GUI 的界面语言切到 English（或把 `$DSH_HOME/settings.yaml` 的 `locale.preference` 改为 `en`；该文件热重载）。**不新建会话**，在同一个会话里发送：

```
State in one sentence which output language you now default to.
```

Expected: 英文答复（同一会话内、无需重启）。记录模型原文。

- [ ] **Step 5: 场景 3 —— 界面语言为默认，用户换语言时跟随用户**

**由用户**把界面语言切回中文，然后在**同一会话**里发送一段英文提问：

```
Please answer in the language you consider appropriate here, and name that language in the first line.
```

Expected: 该条跟随用户 → 英文答复。记录模型原文。

- [ ] **Step 6: 场景 4 —— 子代理同规则**

在界面语言为中文的会话里，**由用户**发送：

```
派一个子代理读 README.md 的前 10 行，用一句话总结（不要自己动手）。
```

Expected: 子代理返回的报告是中文。记录子代理会话 id 与报告原文。

- [ ] **Step 7: 取证（执行者从会话日志取原文）**

```bash
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ls -t "$DSH_HOME"/sessions/*/ | head          # 找到刚跑过的会话目录
zstd -dc "$DSH_HOME"/sessions/<workspace>/<session-id>/session.v3.jsonl.zstd | head -40
```

Expected: 能取到四个场景对应的 `assistant/message` 文本原文。
注意：本机 `/tmp` 跨 bash 调用不持久，临时脚本写在同一条命令里。

- [ ] **Step 8: 提交**

```bash
git add scripts/output-language.test.mjs
git commit -m "test: 守卫 output-language 组合挂载行与导出面"
```

---

### Task 5: 文档回填与最终验证

**Files:**
- Modify: `README.md`
- Modify: `evidence/VERIFICATION.md`

**Interfaces:**
- Consumes: Task 4 的实测证据与 `npm test` 终值
- Produces: 文档与实测一致；`npm test` 与 `verify-composition.mjs` 的真实输出落在验证记录里

- [ ] **Step 1: 更新 README**

三处改动：

1. `## 自动生效的四件事（其中一件刻意"不生效"）` 标题改为 `## 自动生效的五件事（其中一件刻意"不生效"）`，并在表格末行后追加一行：

```markdown
| **输出语言跟随界面语言** | 插件 `preset/plugins/output-language` 注册一条动态运行时上下文行，读 host 设置 `locale.preference`（界面 `zh` 默认中文、`en` 默认英文；用户换语言时跟随用户） |
```

2. 「目录结构」树里 `plugins/` 段追加：

```
│   │   └── output-language/         # 输出语言跟随界面语言（动态上下文行）
│   │       ├── index.js
│   │       ├── package.json
│   │       └── output-language.test.mjs
```

并把上一行 `│   │   └── caveman-command/` 的 `└──` 改成 `├──`（保持树形正确）。

3. 新增一节（放在 `## 任务分档（按规模缩放流程）` 之后）：

```markdown
## 输出语言

模型默认用界面语言作答，语言来自 host 用户设置 `locale.preference`（设置页的语言开关写它，也可以直接改 `$DSH_HOME/settings.yaml`）：

| `locale.preference` | 行为 |
|---|---|
| `zh` | 默认中文；用户改用别的语言提问时，该条跟随用户 |
| `en` | 默认英文；同上 |
| 未设置 / 非法值 | 不猜：跟随用户消息语言 |

规则覆盖回复正文与流程产物（plan、spec、评审、TDD 说明、todo）；代码、标识符、命令、路径、错误原文一律不翻译。改动**下一条回复即生效**（上下文行每次组装提示词都重新渲染），但**插件行本身**改动（改名、增删行）需要新建会话。

实现落在 `preset/plugins/output-language/index.js`：注册一条 `order: 105` 的 `systemPrompt.context`，`text` 是每次组装都重跑的 provider；插件自包含，失败路径降级为"跟随用户"，绝不打断提示词组装。
```

4. `## 验证` 一节里 `npm test          # 33 pass / 0 fail` 改为实测值（预期 `# 36 pass / 0 fail`）。

- [ ] **Step 2: 回填验证记录**

在 `evidence/VERIFICATION.md` 末尾追加一节（用既有的 `$REPO` / `$DSH_HOME` 占位符约定，数字与命令照抄实测）：

> **执行后说明（回填）**：下面这段骨架里的 `<...>` 是**原始计划的粘贴位**，已于 Task 5 用实测证据填充，
> 正文保留原样以存真。**落地成文的那一节**在 `$REPO/evidence/VERIFICATION.md`，标题为
> 「输出语言跟随界面语言（**2026-09-18**）」（计划里预填的 2026-09-17 是计划撰写日，实际取证日期是 09-18）。

```markdown
## 输出语言跟随界面语言（2026-09-17）

### 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-09-17 |
| DSH | <实测版本>，Web profile (`dsh web`) |
| Node | <实测版本> |
| 安装位置 | `$DSH_HOME/.agent-presets/engineering`（真实目录 + 逐项符号链接） |
| 源 | `$REPO/preset` |

### 1. 单元与守卫测试

```
<粘贴 npm test 的真实尾部输出>
```

### 2. 组合健康（第 2a 层）

```
<粘贴 node scripts/verify-composition.mjs 的真实输出>
```

### 3. 端到端四场景

| # | 场景 | 期望 | 实测 |
|---|---|---|---|
| 1 | 界面 zh，新会话 | 中文答复 | <模型原文> |
| 2 | 会话中途改 `en` | 下一条英文答复 | <模型原文> |
| 3 | 界面 zh，英文提问 | 跟随用户 → 英文 | <模型原文> |
| 4 | 子代理报告 | 中文 | <子代理原文> |

数据源路径：<`ctx.get('settings')` 服务路径 / `$DSH_HOME/settings.yaml` 文件降级路径>（由 Task 2 探针结论决定）。

### 未跑过的部分

<如实列出：例如未在 `--copy` 安装模式、未在其他 preset、未在非 Web profile 上验证>
```

- [ ] **Step 3: 最终验证（真实输出）**

```bash
npm test
node scripts/verify-composition.mjs
git status --short
```

Expected: `npm test` → `tests 36`、`pass 36`、`fail 0`；`verify-composition.mjs` → `MOUNT OK`；`git status --short` 只列出本次要提交的两个文档文件。

- [ ] **Step 4: 提交**

```bash
git add README.md evidence/VERIFICATION.md
git commit -m "docs: 回填输出语言跟随界面语言的实测与文档"
```

---

## Self-Review

**1. Spec coverage**

| spec 章节 | 覆盖任务 |
|---|---|
| §4 语义四决策 | Task 1（渲染分支）、Task 2（数据源） |
| §5 架构与落点（插件、行、order 105、纯函数导出） | Task 1、Task 2 |
| §5 文件表 3 文件 | Task 1、Task 2、Task 4；**新增插件自测**（安装门禁要求）在 Task 1，并已在计划 commit 内回填 spec §5 文件表 |
| §6 渲染规则四态逐字 | Task 1 Step 1/3 的断言与实现逐字固定 |
| §7 数据流与时效（每次组装重算、下一轮生效） | Task 1（provider）+ Task 4 场景 2 |
| §8 失败模式与降级 | Task 1 Step 3（`resolveLanguageTag` 的 try/catch、warnOnce、非空串；`renderLanguageContext` 本身是纯全函数、无 try/catch——见「执行后勘误」5）+ Task 3（文件降级、探针流程） |
| §9 单测 + 命令证据 | Task 1、Task 4、Task 5 Step 4 |
| §9 端到端四场景 | Task 4 Step 3-6 |
| §10 未验证点（settings 可达性） | Task 2 Step 3-4 探针 + Task 5 Step 2「未跑过的部分」 |
| §11 不做的事 | Global Constraints（不改 harness、不改 bootstrap、不加变量方案） |

**2. Placeholder scan**：无 TBD/TODO；Task 1/3/4 的代码与命令逐字给出；Task 5 的文档骨架里带 `<...>` 的位置**是留给实测输出的粘贴位**，由 Task 4 的真实证据填充，属"照抄实测"而非"待设计"。

**3. Type consistency**：`renderLanguageContext(tag)`、`resolveLanguageTag(ctx)`、`parseLanguageTag(yamlText)`、`settingsDocumentPath()`、`LANGUAGE_TAG`、`CONTEXT_ORDER`、`name` 在 Task 1/3 的实现、Task 1/3 的断言、Task 4 的导出面断言里同名同型；`isValidTag` 只在 Task 1 定义、Task 3 复用；Task 3 的导出行包含 Task 4 断言用到的全部键。

---

## 执行后勘误（本节为实施回填，非原始计划）

本计划已执行完毕（5 个任务；提交链 `f49a2ed`(插件) → `75ea80e`(挂载) → `edc3c8e`(守卫) →
`aeb15b6`(规则前置修复)）。执行期与评审期共发现 **5 处需要更正的地方**——正文保留原样以存真，
此处逐条列明。实测证据（环境、命令输出、会话 id 与模型原文）见 `$REPO/.superpowers/sdd/task-5-evidence.md`
与 `$REPO/evidence/VERIFICATION.md` 的「输出语言跟随界面语言（2026-09-18）」一节。

| # | 位置（本文件行号） | 原计划写的 | 执行期的正确做法 |
|---|---|---|---|
| 1 | `21`、`334`、`536`、`604` | 测试计数按「每个 `*.test.mjs` 文件计 1 个测试」推算（基线 33、Task 1 后 34、终值 36）——终值对，**口径错** | Node v26 的 `node --test` 按**每个 `test()` 调用**计数，**没有 `test()` 的文件各计 1**。基线 33 = 31 个 `test()` + 2 个插件自测文件；Task 1 后 34；Task 4 后 **36** = 33 个 `test()` + 3 个插件自测文件 |
| 2 | `21` | 「**生效边界是新建会话**」 | 分两种情况：`settings` 的**值**改动**热生效**（同会话 zh→en→zh 三次注入都跟着变，无需重启）；**插件 / 组合代码改动需要重启宿主**（`dsh web`）——运行中的 host 进程缓存了 preset 插件模块（Node ESM 模块缓存），**只新建会话不够** |
| 3 | Task 4 Step 5/6（约 `629`） | 场景 3 期望「跟随用户 → 英文答复」——计划假定一写就过 | 第一次实测**失败**（界面 zh + 英文提问 → 中文答，会话 `session-ea6960d6…`）。用户拍板**方案 A（规则前置）**：规则句 `Output-language rule: …` 置于行首，界面语言降为「消息无语言线索」时的回退；修复提交 `aeb15b6`，并在插件自测里加**顺序守卫**（旧文案下四态全红 → RED，修复后 GREEN）。重启宿主后复测通过（会话 `session-d6bca65a…`） |
| 4 | Task 3（整任务） | 「若 `settings` 不可达，则实现读 `$DSH_HOME/settings.yaml` 的文件降级」 | **Task 3 被跳过**：闸门 A 证明 settings 服务在 preset realm **可达**（探针会话 `session-37e7c308…` 注入行原文为 `Interface language: zh (Chinese). …`），降级数据源不实现。该任务本就是条件执行 |
| 5 | Self-Review「Spec coverage」`795` | 「Task 1 Step 3（try/catch、warnOnce、非空串）」——未区分两个函数 | try/catch 只在 `resolveLanguageTag`；`renderLanguageContext` 是**纯全函数、无 try/catch**（不抛是因为只做 `typeof` / 正则 / 字面量插值）。spec §8 对应行的措辞已按实现改正 |

### 计划未预见的既有仓库缺陷（**明确不属于本计划范围，本次未修**）

`scripts/plant-core.mjs` 的 `link` 分支（84-94 行）mkdir → 清空目标目录（连 `.installed.json` 一起删）
→ 只建符号链接 → return，**从不写 `.installed.json`**；宿主启动时 bundle 安装器走 copy 分支，命中
100-104 行守卫 `destination … exists without .installed.json; refusing to touch`，于是每次启动都刷这条警告，
且 bundle 安装器此后拒绝植入。诱因是本次按 `install.sh` 默认 `link` 策略重装（该路径正是 README 推荐的刷新路径）。

功能上不受影响（条目是符号链接，仓库改动即时可见），但它**预先存在**于 `plant-core.mjs`，与本计划的
输出语言能力无关；修它属于另一条工作线（植入引擎 / 安装路径），**本计划不修**。完整启动日志原文见
`$REPO/.superpowers/sdd/task-5-evidence.md` §5 第 4 条。
