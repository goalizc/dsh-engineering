# 设计：输出语言 v2 —— 系统段 + 每条用户消息提醒（严格版）

日期：2026-09-23
状态：待实施（本文件是 spec，实施计划由 `writing-plans` 产出）
取代：`docs/superpowers/specs/2026-09-17-output-language-design.md` 的 §5–§7 渲染与落点（该文件其余章节的实测、约束与教训继续有效，见 §11）

## 1. 问题：v1 修好了交付物，过程仍失守

`2026-09-17` 的 v1 已经上线：插件把 `locale.preference` 渲染成一条动态运行时上下文行，覆盖句在 `2026-09-23` 的 `8843205` 里扩到了 `your reasoning, your progress notes between tool calls`。**这两件事都在真会话里生效了**，但思考语种仍然不是中文。

takisy 工作区最新会话 `session-d0c635f9-875d-4dc4-934d-fda5a2f3bbec`（2026-09-23，`engineering` 预设，界面 `zh`，用户全程中文，2 轮 18 个步）的实测：

| 指标 | 实测 |
|---|---|
| 运行时上下文里的语言行 | **新版**（含 `your reasoning, your progress notes between tool calls`） |
| bootstrap 注入次数 | `1`（`8843205` 的幂等修复已生效） |
| 思考流 CJK 比例（原始） | `6928 / 63609 = 10.9%` |
| 思考流 CJK 比例（**剥掉引用块后**） | `2097 / 56942 = 3.7%` |
| 思考块首词的语言 | **18 / 18 英文** |
| 第 1 轮思考 CJK（剥引用后） | `58 / 29777 = 0.19%` |
| 第 2 轮思考 CJK（剥引用后） | `2039 / 27165 = 7.5%` |
| 可见正文 CJK 比例 | `1567 / 4206 = 37.3%` |

原始 10.9% 是假象：那些 CJK 字符几乎全是被引用的中文原文、`AGENTS.md` 片段、`中文摘要` 这类术语。**规则点名了 reasoning，模型仍用英文思考**——规则文本的覆盖范围不是瓶颈。

诊断（证据见 §2）：规则被投递在**错误的层**（user 角色的一条历史消息，不是 system），且**没有近因**（一轮英文锚定后自我延续：T1 九步 0.19%，T2 才升到 7.5%，首词 18/18 全英文）。

## 2. 诊断证据

1. **投递层是 user，不是 system。** 语言行的转录形状是 `role: "user"`、`source: {kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "snapshot"}`；`dsh-system-prompt/lib/index.js` 的 `joinContextSections()` 把它渲染成 `Current runtime context. …`，`request/context` 事件写的是 `systemPromptUpdate: "in-history"`。而该会话的 system 消息 `8514` 字符里只有 `9` 个 CJK 字符，**通篇英文且完全没提语言**。
2. **上下文分布压倒性英文——这才是语种的实际锚。** 同一会话的分类统计：

   | 来源 | 字符 | CJK 比例 |
   |---|---|---|
   | system 消息 | 8514 | 0.11% |
   | bootstrap（plugin 注入） | 12594 | 0.07% |
   | skill 目录 | 3593 | 0% |
   | 工具 schema（同请求 header） | 全部 | 英文 |
   | 规则所在的运行时上下文 | 932 | 45%（仅那一行） |
   | agent 指令（`AGENTS.md`） | 8987 | 52.3% |
   | 真实用户消息 | 23 | 60.9% |

   第 1 轮用户只给了 `13` 个汉字（「审查一下agents.md」），其余全是英文框架文本。
3. **近因位置被英文占据。** 规则之后紧跟 `3593` 字符英文 skill 目录与 `11662` 字符英文 bootstrap；每轮生成前最后一条消息是 bootstrap 的内容。
4. **轮首锚定自我延续。** T1 九个思考块比例 0.4%–0.6%（剥引用后）；T2 用户发「一条条提问我如何修改」后被迫规划中文问题，比例才升到 6.8%–14.9%，但**首词仍是英文**；落盘写 `AGENTS.md` 的那一步又跌回 0.7%。

## 3. 约束（决定了落点）

继承 v1 §2，全部继续成立：不改 harness 安装（`/usr/lib/node_modules/@deepseek-ai/dsh`）；preset 插件必须自包含（不得 `import` 任何 `@deepseek-ai/*` 包）；组合行用 preset 相对 specifier；语言规则必须动态（`settings` 文档由 `dsh-settings-file` 热重载）；插件源码不得出现本仓库专有名词（注入面向任意工作区）。

新增约束：

1. **`systemPrompt.section()` 在 preset realm 的可调用性：已用代码级证据关闭（2026-09-23）。** 原判为"唯一架构性未知"，实施时改用无需重启宿主的取证，三条证据合起来是决定性的：
   - **harness 自己的加载器文档**（`@deepseek-ai/dsh-agent-presets/lib/index.js` 的 `mount` 模块）逐字写着：entry contexts chain to the context the subtree was plugged into, so every `ctx.tools` and `ctx.systemPrompt` registration inside the preset files into **that agent's layer** and unwinds with it。
   - **该方法确实存在**：运行时内省 `dsh-system-prompt` 的 `SystemPrompt.prototype`，`section` / `context` / `getSectionOrder` 都在同一个类上（`typeof … === 'function'`）。**不存在"有 `context` 没有 `section`"的宿主版本**。
   - **该 realm 确实能拿到这个服务**：v1 的 `context()` 已在真会话里跑通（语言行进了转录），而同一次 `inject(['systemPrompt'])` 给的就是同一个 `scope.systemPrompt` 对象。

   因此不再安排运行时探针，**也不需要为此重启宿主**。仍未观察到的只剩"section 文本在渲染后的 system 消息里出现、且位于 persona 之前"这一**观测量**（不是未知项）——它由 §9 的端到端实测覆盖。
2. **`order` 只能取数值**，且同一 scope 内重名 section 会被 `NamedEntries` 拒绝。`SECTION_ORDERS` 里 `HARNESS_IDENTITY = -1000`、`DEPLOYMENT_PERSONA_PREFIX = 0`；本设计取 `-1`（见 §5）。
3. **L2 注入不得查历史。** bootstrap 的幂等靠 `agent.session.deriveMessages()` 扫标记，那是"每会话一次"的判据；L2 要"每条用户消息一次"，判据必须落在**本步 claim 到的消息**上（见 §7）。

## 4. 语义决策（用户已确认）

| 问题 | 决定 |
|---|---|
| 语言从哪来 | **只读 host 设置 `locale.preference`**；不去分析用户本条消息的语言 |
| 读不到 / 非法值 | **兜底中文**（这是相对 v1 的行为变更：v1 是"从不假设语言"） |
| 覆盖范围 | agent 写出的**全部文本**：思考流、可见回复、工具间隙旁白、流程产物（plan/spec/评审/TDD 说明/todo）、**工具调用参数里的可见字段**（见 §12 的清单）、**交给另一个 agent 的提示词/任务书**；代码、标识符、命令、路径、报错原文不译 |
| 落点 | 三层：L1 system 段（每步）+ L2 每条用户消息后的提醒 + 删除 L3 旧上下文行 |
| 频率 | L2 **每条用户消息都注入** |
| 范围 | 只本 preset（工程模式）；子代理由同一 preset 组装，自动覆盖 |

## 5. 架构与落点

共 6 处改动（新增 0 个文件）：

| 路径 | 内容 |
|---|---|
| `preset/plugins/output-language/index.js` | 重写渲染：新增纯函数 `renderLanguageDirective(tag)`（L1）与 `renderLanguageReminder(tag)`（L2）；`apply(ctx)` 改为注册 **section** + 挂 `agent/pre-step` 监听 |
| `preset/plugins/output-language/output-language.test.mjs` | 自测重写（§9） |
| `scripts/output-language.test.mjs` | preset 层守卫改读 v2 spec（§9） |
| `preset/agent.cordis.yml` | 只改 `output-language` 行的注释（挂载行与 id 不变） |
| `README.md` | 「输出语言」节、「插件」表、目录树、生效边界、测试计数 |
| `evidence/VERIFICATION.md` | 追加 2026-09-23 实测与本次变更 |

**不新增文件、不改插件目录结构**：`scripts/install.sh` 的门禁按 `<name>.test.mjs` 同名匹配，现有结构已满足。

### L1：system 段

```js
ctx.inject(['systemPrompt'], (scope) => {
  const register = () => scope.systemPrompt.section({
    name: 'output-language',
    order: -1,
    text: () => renderLanguageDirective(resolveLanguageTag(ctx)),
  })
  try { register() } catch (error) { /* 降级：只留 L2，见 §8 */ }
})
```

- **order `-1`**：`DEPLOYMENT_PERSONA_PREFIX` 就是 `0`（`preset/agent.cordis.yml` 的 `persona` 行用那个槽），同名同槽会被覆盖或冲突；`HARNESS_IDENTITY` 是 `-1000`。`-1` 是唯一空位，效果是"身份之后、persona 之前"的常驻硬声明——**在 persona 那句英文 `Output style: caveman, level full …` 之前**。
- `text` 是零参箭头函数：每次组装求值一次，实现动态；不订阅任何事件。
- **明确不用 `persona.prefix` 承载**：那会把一条动态事实冻成静态串，并让渲染逻辑在两处实现。

### L2：每条用户消息后的提醒

```js
ctx.on('agent/pre-step', async ({ messages, signal, step }, next) => {
  const decision = await next()
  if (decision.kind === 'reject' || signal.aborted) return decision
  if (!hasHumanMessage(decision.messages)) return decision
  return { ...decision, messages: [...decision.messages, createUserMessage({ ... })] }
})
```

- `hasHumanMessage(messages)`：任一消息满足 `source?.kind === 'user'` 且带非空文本块。
- **不查 `deriveMessages()`**（与 bootstrap 的判据正相反，理由见 §7）。
- `createUserMessage` / `deepFreeze` 照抄 `preset/plugins/bootstrap/index.js` 的实现（该文件已声明这是与 `caveman-command` 的有意重复；本次是第三份拷贝，同一提交内必须三份一致，见 §10）。
- 消息 `source: { kind: 'plugin', plugin: 'output-language' }`，`id` 由 `node:crypto` 的 `randomUUID()` 生成。

### L3：删除

`apply` 不再调用 `scope.systemPrompt.context()`。旧行与 L1 语义重复，且它在 user 层——正是 §2 诊断的缺陷层。

## 6. 渲染规则（决策完备）

两个函数，同一套语言标签解析。**L1 与 L2 是同一断言的两种长度**，不是两份可能漂移的文本：两者都由 `resolveLanguageTag(ctx)` 的同一个值渲染。

**语言名表**（沿用 v1，仅两个已知项）：

| 输入 `tag` | 渲染用的标签 | 语言名 |
|---|---|---|
| `'zh'` | `zh` | `中文` |
| `'en'` | `en` | `English` |
| `'ja'`（其他合法但未知的 tag） | `ja` | 标签自身：`ja` |
| `undefined`（读不到 / 非法 / 空串） | `zh` | `中文` |

即：**合法 tag 原样用，未知 tag 直接用标签自身当语言名**（用户以后在设置里加语言无需改插件）；**非合法输入一律按 `zh` 渲染**，不抛、不返回空串。

**L1 逐字模板**（`{language}` / `{tag}` 由语言名表代入）：

```
Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in {language} ({tag}). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.
```

**L2 逐字模板**：

```
Language: {language} ({tag}). Reason, reply, narrate, and write every artifact in {language} only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.
```

**四态逐字全行（冻结副本，两套守卫的跨校验源）**

以下八行是**裸行**，故意不放进代码围栏：守卫按行首 `Output-language directive: ` 与 `Language: ` 逐行抽取（各得五行：上面围栏里的**模板行** + 下面四行状态行），用"含 `{language}`"把模板行滤掉，剩下**恰好四行状态行**。围栏会让模板行与状态行形状相同，使抽取变歧义——这正是 v1 守卫用 `fencedLine()` 打的那个补丁，v2 用更简单的方式消除它。同一状态行在本文档中**只出现一次**。

L1（`renderLanguageDirective`）：

Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in 中文 (zh). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.

Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in English (en). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in English on every single call — not only when the surrounding command or path happens to be in English. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.

Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in ja (ja). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in ja on every single call — not only when the surrounding command or path happens to be in ja. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.

Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in 中文 (zh). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.

（第 4 行与第 1 行逐字相同：`undefined` 与 `'zh'` 同文本，这是"兜底中文"的定义。守卫断言的是"抽到的第 4 行 == `renderLanguageDirective(undefined)`"，不是两行互不相等。）

L2（`renderLanguageReminder`）：

Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.

Language: English (en). Reason, reply, narrate, and write every artifact in English only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.

Language: ja (ja). Reason, reply, narrate, and write every artifact in ja only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.

Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.

**为什么不再"规则前置 + 跟随用户"**：v1 的规则句（`write in the language of the user's message`）与例外句（`use Chinese only when the user's message gives no language cue`）是为了表达"界面语言为默认、用户换语言则跟随"。用户已把语义收紧为"一律用界面语言"，例外句消失，v1 §6 记录的那个实测失败模式（界面语言命令执行、跟随例外被忽略）随之不存在——措辞可以直接下命令。

**为什么 L2 比 L1 短**：L1 每步都随 system 重发，已承担完整枚举；L2 的职责是近因锚定，重复全文没有增益，只增加每轮成本。两者共用同一个 `{language} ({tag})` 取值，不构成语义漂移风险。

**不变式**：`renderLanguageDirective` 与 `renderLanguageReminder` 都是纯全函数，**永不返回空串**（空串会让整条消失，模型失去约束）。

## 7. 数据流与时效

```
提示词组装（每步）
  → resolveLanguageTag(ctx)                     # settings 热重载后的内存值
      → renderLanguageDirective(tag)  → L1：system 段（order -1，每步重发）
      → renderLanguageReminder(tag)   → L2：本步若 claim 到人类用户消息则追加一条 user 消息
```

- 同 locale 下两条文本逐字恒定 → 不引起提示词前缀抖动，不影响缓存命中。
- 改 `settings.yaml`（或 GUI 语言开关）→ 热重载 → **L1 下一步生效，L2 下一次注入生效**；不重启会话。
- 无 per-request 文件 IO。

**L2 判据为什么不能查历史**：查历史（`deriveMessages()` 里有没有语言标记）得到的语义是"这个会话里已经有一条提醒"——那等于每会话一次，与 bootstrap 重合，近因价值归零。本步 claim 到的消息是唯一能回答"这一步是在回应人类吗"的输入，而 `agent/pre-step` 的 waterfall 恰好把它交到手里。附带收益：零历史派生读取，且纯工具续步、维护步、压缩步天然不注入。

**「每条用户消息」的口径**：实际粒度是"**每个 claim 到人类消息的步**"。若用户一次连发三条消息、同一步全部 claim 进输入，则注入一条提醒——这正确，因为那一步只有一次生成。排队消息分批 claim 时，每批都会得到自己的提醒。

## 8. 失败模式与降级

| 失败 | 行为 |
|---|---|
| `settings` 服务在 preset realm 不可解析（v1 的唯一未验证点） | `resolveLanguageTag` 返回 `undefined` → 两条都按 `中文` 渲染；`ctx.logger.warn` 一次，不刷屏 |
| `locale` namespace 未注册 / `get` 抛错 / `preference` 为空串或畸形 | 同上，**兜底中文**（v1 是"从不假设语言"，这是行为变更） |
| `scope.systemPrompt.section` 不存在或注册抛错（旧宿主） | try/catch 吞掉并 warn 一次：L1 缺席，**L2 仍在**（两条注入路径互相独立），挂载不中断 |
| `agent/pre-step` 决策是 `reject` 或已 abort | 不注入（同 bootstrap） |
| 本步没有人类消息 | 不注入（正常路径，非失败） |
| `renderLanguageDirective` / `renderLanguageReminder` 内部异常 | **不会发生**：纯全函数，只做 `typeof` 检查、一次正则 `test` 与字面量插值，无抛路径 |

**已知边界（写进 README）**：

- 会话若实际跑在别的预设上（README 已记录：235 个会话中 5 个带 `agent-preset/selected`，其中一条 header 写 `engineering` 实际跑在 `cordis`），本插件根本不挂载，语言规则不存在——这是"过程全英文"的一种既有解释，本次不解决。
- 界面语言是 `en` 时，本规则会命令模型**只用英文**（连思考也是）。这是"一律用设置里的语言"的正确推论，但要如实写进文档，避免英文界面用户以为思考还会跟自己的消息走。

## 9. 测试与验证

**架构性未知已关闭，不设探针任务**：原先计划先跑一个真会话探针，实测 `scope.systemPrompt.section()` 是否可从 preset realm 调用。该问题在实施时用三条代码级证据回答完毕（见 §3 约束 1）：加载器自己声明 preset 的 `ctx.systemPrompt` 注册进 agent 层、`section` 与 `context` 同在一个 `SystemPrompt` 原型上、`context()` 已实测在该 realm 跑通。**因此不安排探针、不需要为它重启宿主。** §8 那条 `section()` 缺失的 try/catch 保留，但它守的是"未来宿主移除了 section API"，不是"当前宿主不支持"；真的不可用时，唯一备选是把 L1 文本并进 persona `prefix`（代价是语言冻结为启动快照、渲染逻辑两处实现）。

`preset/plugins/output-language/output-language.test.mjs`（无框架 plain-assert，可 standalone 跑；安装门禁要求同名文件存在）：

1. `renderLanguageDirective` 四态（`'zh'`、`'en'`、`'ja'`、`undefined`）**整行逐字全等**；`renderLanguageReminder` 同样的四态。两者返回值均非空。
2. 非法输入（`''`、`'中文'`、`'zh_CN'`、`123`、`null`）→ 与 `undefined` 同文本（即兜底中文）。
3. `resolveLanguageTag` 在无 ctx / 无服务 / 服务抛错 / 值非法时都返回 `undefined`，不抛。
4. `apply` 注册**恰好一条** system section：`name: 'output-language'`、`order: -1`、`text` 是函数且求值当时的设置值；**断言不再注册任何 context**（防止旧行残留成双重声明）。
5. `apply` 注册的 `agent/pre-step` 监听：给定含人类消息的决策 → 追加**恰好一条** `source.plugin === 'output-language'` 的 user 消息，文本逐字等于 `renderLanguageReminder(tag)`；给定不含人类消息的决策 → 不追加；决策为 `reject` → 不追加；`signal.aborted` → 不追加。
6. 注入消息形状与 bootstrap 一致（`role`/`content`/`source`/`id`，且被 `Object.isFrozen` 深冻结）。
7. 插件源码**不含 `@deepseek-ai/` import**（守住约束）。

`scripts/output-language.test.mjs`（`node:test`，对齐 `scripts/task-sizing.test.mjs` 惯例）：

8. `preset/agent.cordis.yml` 含 `./plugins/output-language/index.js` 挂载行且 id 为 `output-language`（守卫保留，不改）。
9. 插件导出面：`name` / `apply` / `renderLanguageDirective` / `renderLanguageReminder` / `resolveLanguageTag`。
10. README「输出语言」节发布的 L1 与 L2 示例行，各自与 `renderLanguageDirective('zh')` / `renderLanguageReminder('zh')` 逐字全等。
11. **spec §6 冻结子句交叉校验**：读 `docs/superpowers/specs/2026-09-23-output-language-v2-design.md` 的 §6，按行首 `Output-language directive: ` 与 `Language: ` 抽取裸行，滤掉含 `{language}` 的模板行后各断言**恰好四行**状态行；第 1–3 行（`中文 (zh)` / `English (en)` / `ja (ja)`）与第 4 行（= 兜底）分别与 `renderLanguageDirective` / `renderLanguageReminder` 的对应态输出**逐字全等**。四态顺序在 spec 里是 `zh`/`en`/`ja`/兜底，守卫按位置取——顺序写错即红。

**命令与证据**：`cd /home/goalizc/dsh-engineering && npm test`（`pretest` 重建 `preset/.manifest.json`），贴真实输出；另跑 `node scripts/verify-composition.mjs` 的挂载组合检查，贴真实输出。**注意**：改契约面会让现存的 v1 守卫先变红——这是 TDD 的红，不是回归。

**端到端实测（唯一真证据，需要人类重启宿主后新建会话）**：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 界面 `zh`、中文多轮任务 | 思考流剥引用后 CJK ≥ 50%，可见正文 CJK ≥ 50%，每条消息首个思考块是中文 |
| 2 | 界面 `zh`、**用户发纯英文消息** | 仍全中文（本次语义下这是正确行为，v1 的"跟随用户"已废止） |
| 3 | 会话中途把 `preference` 改成 `en`（热重载） | 下一条起全英文，无需重启会话 |
| 4 | 派一个子代理执行任务 | 子代理报告同规则 |

## 10. 未验证点与风险

- **`systemPrompt.section()` 在 preset realm 的可调用性**：已用代码级证据关闭（§3 约束 1），不再列为未知。剩下的只是**观测量**——section 文本在渲染后的 system 消息里出现、且位于 persona 之前——由 §9 的端到端实测覆盖。
- **模型遵从度**：规则是提示词级约束，不是熔断。本次把规则提升到 system 层并加了近因锚定，**提高遵从概率，不构成保证**；若诊断正确（§2），预期改善显著，但可能仍达不到 §9 的 ≥ 50% 门槛。**达标与否以实测为准，不达标就如实记失败**，不修改门槛来"通过"。
- **与 §9 门槛相关的反例**：本轮分析量化的是 2 轮 18 步、6.4 万字符思考的一条会话，样本量小。
- **三份 `createUserMessage` 拷贝**：`bootstrap`、`caveman-command`、`output-language`。bootstrap 源码已声明前两份必须同提交同改；本次加入第三份，同一纪律适用。
- **成本**：L1 每步重发约 240 字符；L2 每条用户消息约 110 字符。相对被替换掉的 419 字符一次性上下文行，是净增，但仍在噪声级。
- **把委派提示词也要求成中文的代价（2026-09-23 追加）**：`subagent` 若路由到 `claude-code` / `codex` 这类外部代理，中文任务书可能**降低其执行准确度**；本仓库只把语言要求交给模型，不评估下游模型的语言能力。若日后发现下游执行质量下降，回退点是把 §12.2 从枚举里删掉——规则文本、测试与文档三处同步改即可。
- **成本增额（2026-09-23 追加）**：L1 由约 240 增至 **1102** 字符（每步重发），L2 由约 110 增至 **199** 字符（每条用户消息）。相对被替换掉的 419 字符一次性上下文行，L1 已是**数倍净增**——这是为"工具字段必须本地化"付的可见代价，不再是噪声级，如实记录。
- **强化措辞是实测驱动、且预留了回退**：首次端到端验收发现 `bash.description` 只有 `1/12` 用中文（重启前 `0/167`），而 `subagent.description`/`prompt` 为中文。据此在 L1 里加了独立强断言段（"hard requirement, not a preference… a tool's own schema documents its field in English; that documents the field, it does not license an English value"）。若强化后仍不达标，回退点是删掉该段、恢复 §12 首版措辞，并把"工具字段是概率性的"写进 README 已知边界。

## 11. 明确不做

- **不改 `preset/bootstrap.md` / `scripts/build-bootstrap.sh`**：那是 `using-superpowers` 的 vendored 正文加工具映射，语言规则不是它的职责；放进生成物只能得到启动快照。
- **不翻译 bootstrap、技能正文、工具描述**：工具描述归 harness 所有；翻译技能正文违反上游移植规则并破坏 skill 名与 `superpowers` 原始措辞。
- **不做"识别用户本条消息语言"**：用户已明确改为读设置（§4）。
- **不改 persona `prefix`**：理由见 §5。
- **不写 harness 侧补丁**：升级即丢，且把用户设置契约固化进 harness 不是本仓库的职责。
- **不翻译本 spec 的规则文本自身**（L1/L2）：它必须对任意界面语言生效，"把规则翻译成界面语言"会让 `en` 界面读不到中文规则、`zh` 界面读不到英文规则。
- **不改 harness 拥有的静态文本**：工具描述、参数描述、审批弹窗的 `escalate sandbox to …:` 前缀。理由与上一条同源：那是 harness 的字符串，本仓库没有改它的契约（见 §12.3）。
- **不删 v1 spec 文件**：它是 2026-09-17/09-22 的实测记录，仍被 `docs/superpowers/plans/2026-09-17-output-language.md` 与 `.superpowers/sdd/` 下的历史报告引用；仅在其正文加一行"渲染规则已被 v2 取代"的指引。冻结子句的唯一权威副本因此转移到本文件 §6，两套守卫都改读本文件——避免"两个 spec 都声称自己是冻结源"的歧义。

## 12. 追加需求（2026-09-23，落地后扩展）：工具调用字段与委派提示词

**触发**：v2 落地并通过端到端实测后，owner 提出范围扩展——"`bash` 等一些 `description` 也都使用界面设置语言，总之，所有内容都使用界面设置语言"。原覆盖句只点名 agent 写出的**叙述性文本**，没有点名**工具调用参数里的可见字段**，也没有点名**交给另一个 agent 的提示词**。

### 12.1 进界面的模型生成字段（已查证，非推断）

| # | 字段 | 证据（harness 源码） |
|---|---|---|
| 1 | `bash.description`、`pwsh.description` | 调用树摘要白名单 `SUMMARY_KEYS.bash = ["description","command"]`（`dsh-client-ui-tool/lib/client.js:883`）；终端卡片把 `description` 作为 props 渲染（同文件 `503`、`592-610`）；schema 明文 "(shown in the UI)"（`dsh-tool-bash/lib/index.js:268-271`）；校验器强制非空（同文件 `121`） |
| 2 | `present.files[].description` | schema："Brief description for the user."（`dsh-tool-present`） |
| 3 | 越权 `justification` | `dsh-tool-bash` 把 `justification` 交给 `approveEscalation`（`238-246`）；`dsh-sandbox/lib/index.js:102` 组装为 `reason: \`escalate sandbox to ${mode}: ${justification}\``；客户端把 `pending.reason` 直接显示（`dsh-client-ui-approval/lib/client.js:73`） |
| 4 | `subagent.description` | schema："A short (3-5 word) description of the delegated task, for display."；`dsh-tool-subagent/lib/index.js:510`、`529` 把它做成卡片 `label` |
| 5 | `todo_write.todos[].content` | `planSummary(todos)` 进调用树（`dsh-client-ui-tool/lib/client.js:2240`）；L1 已点名 `todo text` |
| 6 | 调用树兜底 | `deriveSummary` 在白名单键都缺席时**取任意非空字符串参数**（`dsh-client-ui-tool/lib/client.js:899-911`） |

### 12.2 交给另一个 agent 的提示词（owner 明确纳入）

`subagent.prompt`、`subagent_fork.prompt`、`workflow` 的 agent 提示词正文、`ralph` 的 `objective`。

**这不是界面字段**，纳入是 owner 的决定：让子代理会话的转录与它自己的提示词一致。代价见 §10 的新增条目。

### 12.3 仍然不译（"所有内容"的例外）

- **必须保持原文的字段值**：`command`、`file_path`、`query`/`pattern`、`url`、工具名与枚举值（`workspace-write` 等）、提交哈希。
- **harness 拥有的静态文本**：工具描述与参数描述本身、系统级消息（例如审批弹窗里 `escalate sandbox to workspace-write:` 这个前缀由 `dsh-sandbox` 写死）。**本设计改不了它们，也不假装能改**；弹窗里模型能控的只有 `justification`，所以那一行是"英文前缀 + 中文说明"。
- **本 spec 的规则文本自身**（L1/L2）：永不翻译，它们要能对任意界面语言生效。

### 12.4 验收口径（逐项检查，不看总体比例）

端到端实测（§9）除三条 CJK 指标外，必须逐项确认：

1. 至少 3 次 `bash` 调用里 `description` 为中文；
2. 任何沙箱越权调用的 `justification` 为中文；
3. 出现 `present` / `subagent` 时，其 `description` 为中文；
4. 派子代理时，`subagent.prompt` 正文为中文（且子代理能正常完成——见 §10 的代价）。
