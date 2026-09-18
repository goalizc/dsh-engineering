# 设计：输出语言跟随界面语言（preset 本地 output-language 插件）

日期：2026-09-17
状态：待实施（本文件是 spec，实施计划由 `writing-plans` 产出）

## 1. 问题

界面是中文（`~/.dsh/settings.yaml` 的 `locale.preference: zh`），但模型经常用英文作答，流程产物（plan/spec/评审）中英混杂。

根因不是模型偏好，而是**这条设置根本没有到达模型**：

- `locale` 是 host 用户设置的一个 namespace，由 `@deepseek-ai/dsh-client-locale/lib/index.js:23` 通过 `settings.register("locale", LocaleSettingsSchema)` 注册，字段 `preference`，取值 `zh`/`en`（`lib/index.js:11`），缺省表示"跟随浏览器"。
- 全库检索 `locale` 的消费者，**只有浏览器客户端**（`dsh-client-locale/lib/client.js`）。提示词侧没有任何一处读它。
- 提示词里现存的"运行时上下文"只有沙箱策略、审批策略、子代理委派三类（`dsh-system-prompt/lib/index.js:43` 的 `CONTEXT_ORDERS`），没有语言位。
- persona（`preset/agent.cordis.yml`）与注入的 `preset/bootstrap.md` 都是英文净内容，且都没有语言规则 → 默认输出语言事实上由提示词语种决定。

## 2. 约束（决定了落点）

1. **不改 harness 安装**：`/usr/lib/node_modules/@deepseek-ai/dsh` 的改动会在 DSH 升级时丢失；本需求只在 preset 内落地。
2. **preset 插件必须自包含**：不得 `import` 任何 `@deepseek-ai/*` 包（用户 home 下的 preset 没有可达的 `node_modules` 回溯），这是 `preset/plugins/bootstrap/index.js` 已经遵守的约束，沿用。
3. 组合行用 **preset 相对 specifier**（`./plugins/...`），由 preset 加载器按本 preset 目录解析——`bootstrap` 行是现成先例（`preset/agent.cordis.yml`）。
4. 语言规则必须**动态**：`settings` 文档由 `@deepseek-ai/dsh-settings-file` 热重载（chokidar watch），中途改界面语言应当下一条回复即生效，不做会话启动快照。
5. `systemPrompt.context()` 的 `text` 接受 `(context) => string`，**每次组装提示词都求值**——`dsh-sandbox-policy/lib/index.js:121` 是现成先例。这是"动态"的实现依据。
6. `CONTEXT_ORDERS` 只有 `SANDBOX_POLICY 110`、`APPROVAL_POLICY 115`、`SUBAGENT_DELEGATION 120`，没有语言位；order 只能取数值（`context()` 只校验有限数）。
7. 子代理由**同一个 preset** 组装，故规则自动覆盖子代理；不额外接线。
8. 注入文本面向**任意工作区**，不得出现本仓库专有名词。
9. **分发不需要改打包清单**：`preset/` 整目录随包走，`scripts/plant-core.mjs` 的清单只排除 `.manifest.json` 与 `node_modules`，新增 `preset/plugins/output-language/**` 自动入列；`scripts/verify-composition.mjs` 会校验 preset 相对行指向的文件真实存在。

## 3. 目标与非目标

**目标**

- 界面 `zh` → 默认中文；界面 `en` → 默认英文；用户在同一条消息里换语言 → 该条跟随用户。
- 规则覆盖回复正文**与**流程产物（plan、spec、评审意见、TDD red/green 说明、todo 文本）。
- 代码、标识符、命令、文件路径、错误原文一律不翻译。
- 界面语言改动的生效延迟 ≤ 1 条回复（下一轮组装即读到新值）。
- 读不到 `locale` 时不猜：退化为"跟随用户消息语言"。
- 有守卫测试防漂移；随 `@goalizc/dsh-engineering` 分发，重装/升级不丢。

**非目标**

- 不改 `/usr/lib/node_modules` 下的 harness；不新增 harness 侧插件。
- 不改 `preset/bootstrap.md`（生成物）与 persona 文本；不引入 `{{uiLanguage}}` 变量替换方案。
- 不新增用户命令（如 `/language`）、不新增设置项、不新增技能。
- 不做"强制一律用界面语言"模式：语义由用户拍定为"界面语言为默认，跟随用户切换"。
- 不动 preset id、显示名、bundle 形态与安装布局。

## 4. 语义决策（用户已确认）

| 问题 | 决定 |
|---|---|
| 语义 | 界面语言为**默认**；用户改用别的语言提问 → 该条**跟随用户** |
| 覆盖范围 | 只本 preset（工程模式）；子代理同规则 |
| 管哪些输出 | 回复正文 + 流程产物；代码/命令/错误原文保持原样 |
| 读不到 `locale` | 退化为"跟随用户消息语言" |

## 5. 架构与落点

新增 3 个文件、改 1 处组合：

| 路径 | 内容 |
|---|---|
| `preset/plugins/output-language/index.js` | 插件本体；导出 `name`、`apply`、纯函数 `renderLanguageContext(tag)`、`resolveLanguageTag(ctx)` |
| `preset/plugins/output-language/package.json` | 与 `preset/plugins/bootstrap/package.json` 同构：`name: dsh-output-language`、`private: true`、`type: module`、`main: index.js`、`peerDependencies: {"@deepseek-ai/cordis": "^4.0.2"}` |
| `preset/plugins/output-language/output-language.test.mjs` | 插件自测（无框架 plain-assert：渲染四态、非法输入、读取不抛、注册形状、自包含扫描）。`scripts/install.sh` 的安装门禁要求每个插件目录带同名自测，缺则中止安装——这不是可选项 |
| `scripts/output-language.test.mjs` | preset 层守卫：组合挂载行 + 插件导出面（见 §9） |
| `preset/agent.cordis.yml` | 增一行 preset 相对行，紧邻现有 `bootstrap` 行 |

插件 `apply(ctx)` 形态：

```js
ctx.inject(['systemPrompt'], (scope) => {
  scope.systemPrompt.context({
    name: 'output-language',
    order: 105,                       // 见下
    text: () => renderLanguageContext(resolveLanguageTag(ctx)),
  })
})
```

- **order 105**：`CONTEXT_ORDERS` 无语言槽位，取 105 使其紧跟 persona 身份、排在沙箱策略（110）之前；源码注释写明该取值的理由与"若上游新增语言槽位则改用 `getContextOrder`"的条件。
- `text` 传入的是**零参箭头函数**：每次组装求值一次，实现动态；不订阅任何事件。
- `resolveLanguageTag(ctx)`：`ctx.get('settings')?.get('locale')?.preference`，整段 try/catch；非法值按"读不到"处理。
- `renderLanguageContext(tag)` 是**纯函数**，不依赖 ctx —— 单测直接调它，不需要起 harness。

**不改**：`preset/bootstrap.md`、`scripts/build-bootstrap.sh`、persona 的 `prefix`/`suffix` 文本。

## 6. 渲染规则（决策完备）

模板 = 前导语言子句 + 固定尾句。固定尾句恒定，只有前导子句随 tag 变：

固定尾句（逐字）：

```
Keep code, identifiers, commands, file paths, and error text verbatim: never translate them.
```

| `preference` | 前导语言子句（逐字） |
|---|---|
| `zh` | `Interface language: zh (Chinese). Write your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items — in Chinese. If the user writes in another language, answer that message in the user's language instead.` |
| `en` | `Interface language: en (English). Write your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items — in English. If the user writes in another language, answer that message in the user's language instead.` |
| 其他合法 tag（如 `ja`） | `Interface language: ja. Write your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items — in ja. If the user writes in another language, answer that message in the user's language instead.` |
| 读不到 / 非法 | `Interface language: not set. Write your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items — in the language of the user's message, and switch whenever the user switches language.` |

- tag 合法性沿用 DSH 的 BCP 47 风格形状（`/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/`），但**在本仓库内重新声明**，不 import harness。
- 未知 tag **不猜**语言名，直接把它当作目标语言标签写进句子（用户以后在设置里加语言时无需改插件）。
- 渲染**永不返回空串**：空串会让整行消失，模型就没有语言约束了。

## 7. 数据流与时效

```
提示词组装（每次请求）
  → resolveLanguageTag(ctx)
      → ctx.get('settings').get('locale').preference        # 热重载后的内存值
  → renderLanguageContext(tag)
  → systemPrompt 运行时上下文块中的一行（order 105）
```

- 同 locale 下渲染结果逐字恒定 → 不引起提示词前缀抖动、不影响缓存命中。
- 改 `settings.yaml`（或 GUI 语言开关）→ `dsh-settings-file` 热重载 → 下一轮组装读到新值。**不重启会话、不重开会话**。
- 无 per-request 文件 IO。

## 8. 失败模式与降级

| 失败 | 行为 |
|---|---|
| preset realm 解析不到 `settings` 服务（**唯一未验证点**） | `resolveLanguageTag` 返回 `undefined` → 用"未设置"分支；`ctx.logger.warn` 一次，不刷屏 |
| `locale` namespace 未注册（`get` 返回 `undefined`） | 同上 |
| `get` 抛错（只读 provider、解析失败等） | try/catch 吞掉，按"读不到"处理 |
| `preference` 为空串 / 非法 tag | 按"读不到"处理 |
| `renderLanguageContext` 内部任何异常 | 返回"未设置"分支文本；**绝不向上抛**（提示词组装不能被插件打断） |
| 文本为空 | 不可能：四个分支都返回非空串（测试断言） |

**探针任务**：实施计划在挂载组合行之后立即起一个真会话，确认 `settings` 是否可从 preset realm 解析（由模型逐字贴出那条 `Interface language:` 行，不以推断代替取证）。若不能，则同一计划内的降级任务把 `resolveLanguageTag` 的数据源换成读 `$DSH_HOME/settings.yaml`（`dsh-settings-file` 的文档路径，hot-reload 由 chokidar 负责），其余设计不变；换源后必须重跑 §9 的全部断言与实测。

## 9. 测试与验证

**单测分两处**（都在 `npm test` 的 glob 内）：

`preset/plugins/output-language/output-language.test.mjs` —— 插件自测（无框架 plain-assert，可 standalone 跑；安装门禁要求）：

1. `renderLanguageContext` 四态：`'zh'`、`'en'`、`undefined`、`'ja'` —— 断言目标语言子句、**跟随用户**句、**术语不翻译**句各就各位；四态返回值均非空。
2. 非法输入（`''`、`'中文'`、`'zh_CN'`、`123`、`null`）→ 与 `undefined` 同文本。
3. `resolveLanguageTag` 在无 ctx / 无服务 / 服务抛错 / 服务值非法时都返回 `undefined`，不抛。
4. `apply` 只 `inject(['systemPrompt'])` 并注册**恰好一条** `name: 'output-language'`、`order: 105` 的 context，其 `text` 是函数且渲染当时的设置值。
5. 插件源码**不含 `@deepseek-ai/` import**（守住 §2 约束 2）。

`scripts/output-language.test.mjs` —— preset 层守卫（`node:test`，对齐 `scripts/task-sizing.test.mjs` 惯例）：

6. `preset/agent.cordis.yml` 含 `./plugins/output-language/index.js` 挂载行（掉行即 fail）。
7. 插件模块可 `import` 且导出 `name`/`apply`/`renderLanguageContext`/`resolveLanguageTag`。

**命令与证据**：`cd /home/goalizc/dsh-engineering && npm test`（`pretest` 会重建 `preset/.manifest.json`），贴真实输出；另跑 `node scripts/verify-composition.mjs`（第 2a 层组合健康检查，preset 相对行指向的文件缺失会被判 `broken`），贴真实输出。

**端到端实测**（需求的真正验收，逐条贴证据；任一条不过即不算完成）：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 界面 zh，新会话提问 | 中文答复 |
| 2 | 会话中途把 `settings.yaml` 的 `preference` 改为 `en`（热重载） | 下一条英文答复，无需重启会话 |
| 3 | 界面 zh，贴一段英文提问 | 该条跟随英文 |
| 4 | 派一个子代理执行一段任务 | 子代理报告同规则（中文） |

## 10. 未验证点与风险

- **`settings` 服务在 preset realm 的可解析性**：未实测。设计已给出等价降级（读 settings 文件），并把探测放在计划首任务；这是本设计唯一的架构性未知。
- **子代理在同 preset 下的组装路径**：按组合事实推断（子代理默认用同 preset，persona 行对子代理同样生效），实测场景 4 覆盖。
- **模型遵从度**：规则是提示词级约束，不是强制。措辞采用"Identity 之后、策略之前"的固定行，与既有 `sandbox:policy` 行同级，遵从度与现有策略行一致；不做额外加固（YAGNI）。

## 11. 明确不做

- 不改 `preset/bootstrap.md` / `scripts/build-bootstrap.sh`：本规则来源是 host 设置，不是静态文本，放进生成物只能得到启动快照。
- 不加 persona `{{uiLanguage}}` 变量：变量替换发生在 section 内，缺省时无法干净表达"跟随用户"分支，收益不抵风险。
- 不写 harness 侧补丁：升级即丢，且把用户设置契约固化进 harness 不是本仓库的职责。
