# 将 Superpowers 适配并集成为 DSH 新模式 —— 可行性分析报告

> **占位符约定**：为便于公开分发，本文件中的本机路径已占位符化——
> `$REPO` 本仓库根、`$DSH_HOME` DSH 配置目录（默认 `~/.dsh`）、`$ARDUPLOT_WS` 一个使用本 preset 的工作区示例、`$UPSTREAM` 上游 Superpowers 检出、`$DSH_WEB_URL` DSH Web GUI 地址、`$HOME` 用户家目录。
> 技术内容与数字未作任何改动。

| 项 | 值 |
|---|---|
| 报告日期 | 2026-09-12 |
| 被适配方 | Superpowers v6.1.1（`$UPSTREAM`，HEAD `d884ae0`，本地 git clone，2026-07-02 打标） |
| 宿主 | DeepSeek Harness 0.1.5-rc.1（`/usr/lib/node_modules/@deepseek-ai/dsh`），Web GUI `$DSH_WEB_URL` |
| 工作区 | `$ARDUPLOT_WS`（ArduPilot 4.7-dev，已在使用 superpowers 风格产物：`docs/superpowers/plans`、`docs/superpowers/specs`） |
| 结论 | **可行（GO）**，且不需要 DSH 侧改代码。推荐以"用户 preset + 内置 skills + persona 引导注入"实现，属 Superpowers 官方移植文档中的 **Shape C**（由安装物自带上下文文件），主力成本在工具映射与验证，不在架构改造 |
| **实施状态** | **方案 B 已落地并通过验证**（2026-09-12，同日）。实现位于 `$REPO`，已安装为 preset `superpowers`（显示名 `Superpowers 模式`）。验证记录见 `evidence/VERIFICATION.md`；实现与验证过程中修正了本报告的两处判断，见 **§12 实施回填** |

---

## 0. 执行摘要

### 0.1 一句话结论

Superpowers 与 DSH 的契合度**高于**它已官方支持的多数宿主：DSH 的"模式"（preset）本身就是"一份可被会话挂载的组合文件"，天然满足 Superpowers 移植文档里唯一不可协商的硬性要求——**每个会话自动、且无需用户逐会话选择性开启地把 bootstrap 注入模型上下文**。因此这不是"打补丁式适配"，而是"把 Superpowers 当成一个 DSH 模式来发布"。

### 0.2 判定依据（三条硬性要求对齐结果）

| Superpowers 移植硬性要求（`docs/porting-to-a-new-harness.md` Part 2） | DSH 现状 | 判定 |
|---|---|---|
| 会话启动自动注入 bootstrap | preset 的 `dsh-persona` 行把 `prefix` 注册为系统提示段，**每次会话必然渲染**，无需用户粘贴提示词或运行命令 | ✅ 满足 |
| 技能发现 + 按需加载 | `dsh-skill-filesystem`（磁盘发现，支持 preset 私有 `customSkillDirs`/`bundledSkillDir`）+ `dsh-tool-skill`（`skill` 工具 + `/技能名` 用户显式调用） | ✅ 满足（原生，甚至有用户级 `/name` 手势） |
| 文件读写 / Shell / 子代理 / 待办 | `read`/`write`/`edit`/`glob`/`grep`、`bash`（含 `run_in_background`）、`subagent`（干净上下文，可指定模型）、`subagent_fork`、`todo_write`、`ask_user_question`、`web_fetch`/`web_search` | ✅ 满足，可写 1:1 工具映射 |

### 0.3 三个必须正视的差距（都不阻塞，但必须写进设计与文档）

1. **没有 SessionStart 钩子，也没有环境变量契约。** DSH 不是"跑 shell 读 stdout"的宿主（Shape A 不可用），也没有 `CLAUDE_PLUGIN_ROOT` 之类变量。此外 **DSH 缺少"压缩后重新注入"挂载点**，而 Superpowers 明确要求在 compaction 后重新注入 bootstrap（长会话 + 子代理工作流下这是真实场景）。
2. **沙箱语义与 Superpowers 的两条技能假设冲突。** 本会话文件策略是 `workspace-write`：workspace 之外不可写。`using-git-worktrees` 默认把 worktree 建到 workspace 之外（会失败），`finishing-a-development-branch` 要 `push`/建 PR。DSH 侧必须通过**工具映射 + 技能调用约定**把 worktree 收敛到 workspace 内，并显式声明 push/PR 不在无人值守流程内。
3. **仓库治理规则优先于技能。** 当前工作区是 ArduPilot，其 `AGENTS.md` 已声明：AI 贡献必须披露、提交必须 `Subsystem: xxx` 前缀且**单一子系统**、禁止把仓库当简历垫脚石。Superpowers 的 `subagent-driven-development` 会"每任务提交一次"，这与 ArduPilot 的提交约定天然摩擦，必须在模式文档里让仓库规则压过技能。

### 0.4 工作量与推荐路径

| 方案 | 内容 | 人力 | 风险 |
|---|---|---|---|
| **A 零代码** | 复制 `cordis` preset → 改名 `superpowers` → 把 skills 目录软链/内联进 preset → 把 bootstrap 写进 persona `prefix` → 在 `SKILL.md` 的 Platform Adaptation 加 DSH 指针 | 0.5 天 | 低。生效快，唯一缺"压缩后重注入" |
| **B 加固（推荐）** | A + 一个约 60 行的 preset 私有 Cordis 插件，在 `agent/pre-step` 幂等注入 bootstrap 与工具映射（用户角色、去重哨兵）；技能目录仍走 `customSkillDirs` | 1.5 天 | 低-中。需要一次 `standingKeyFor` 挂载校验 |
| **C 完整** | B + 自研 `superpowers_gate` 工具 + 侧边栏/对话框面板展示"技能门禁状态 / 任务账本 / 评审结论" | 3–5 天 | 中。存在过度设计的诱惑（见 §8.3） |

**建议**：先做 A 验证概念与验收（半天内可拿到"模型知道自己有 superpowers"的证据），随即升级到 B 作为长期形态。C 只在其确有需求时做，且只做"提示与可观察性"，不要试图做硬性门禁（DSH 没有可以真正阻断模型跳过技能的机制，见 §8.3）。

---

## 1. Superpowers 现状解剖（v6.1.1）

### 1.1 它不是一个插件，而是"内容 + 三件薄适配"

Superpowers 官方移植文档把自己的架构说得很清楚：**内容对所有宿主相同，每个宿主只换一层薄适配**。三层是：

| 层 | 位置 | 是否可移植 |
|---|---|---|
| **Skills（宿主无关）** | `skills/*/SKILL.md`，14 个技能 | 逐字复用，**禁止改写正文** |
| **Tool mapping（每宿主一份）** | `skills/using-superpowers/references/<harness>-tools.md` | 必须为 DSH 新写一份 |
| **Bootstrap（每宿主一套注入）** | `hooks/session-start`（Shape A）/ `.opencode/plugins/superpowers.js`（Shape B）/ `GEMINI.md`（Shape C） | DSH 需要新形态 |

技能正文刻意"描述动作而不点名工具"（"dispatch a subagent"、"create a todo"、"read a file"），这正是它能跨 Claude Code / Codex / Cursor / Copilot / Kimi / OpenCode / Pi / Antigravity 的原因，也是 DSH 能低成本接入的根本原因。

### 1.2 技能清单（14 个，实测）

| 层 | 技能 | 作用 |
|---|---|---|
| 流程骨架 | `using-superpowers` | bootstrap 本体；规定"任何回应（包括澄清提问）之前先查技能"，含"红旗思维"反合理化表 |
| 设计阶段 | `brainstorming` | 苏格拉底式需求澄清 → 分块呈现设计 → 落盘设计文档（含可选"可视化伴侣"本地 Web 服务器） |
| 隔离 | `using-git-worktrees` | 设计批准后建隔离工作区，跑项目 setup，验证干净测试基线 |
| 计划 | `writing-plans` | 拆成 2–5 分钟粒度的任务，每任务含确切文件路径、完整代码、验证步骤 |
| 执行 | `subagent-driven-development` | 每任务派一个**干净上下文**的 implementer 子代理 + 任务评审（规格符合性 + 代码质量）+ 结尾全分支评审 |
| 执行 | `executing-plans` | 另一会话中按批次执行，带人工检查点 |
| 执行 | `dispatching-parallel-agents` | 2+ 个互不依赖任务时并发派发 |
| 实现 | `test-driven-development` | RED-GREEN-REFACTOR 强制循环（含反模式参考） |
| 调试 | `systematic-debugging` | 四阶段根因流程（根因追踪 / 纵深防御 / 条件等待等） |
| 收尾 | `verification-before-completion` | 声称"完成/修好/通过"之前必须跑验证并给证据 |
| 协作 | `requesting-code-review` / `receiving-code-review` | 提交前自审清单 / 收到评审意见时的技术严谨回应 |
| 收尾 | `finishing-a-development-branch` | 验证测试 → 呈现 merge/PR/保留/丢弃选项 → 清理 worktree |
| 元 | `writing-skills` | 编写/测试新技能的规范 |

体量实测：`skills/` 共 **436 KB / 48 个文件**；14 份 `SKILL.md` 正文合计 **125,392 字节**；其中 `brainstorming/scripts` 内嵌一个 **56 KB** 的本地静态服务器；另有 34 个参考资源文件（`*-prompt.md`、`testing-anti-patterns.md`、`root-cause-tracing.md`、Graphviz `.dot`、示例等）。

### 1.3 各 skill 的工具面依赖（实测扫描）

| 依赖 | 实际出现情况 | 对 DSH 的含义 |
|---|---|---|
| `TodoWrite` | 仅 1 处，且在 `references/pi-tools.md` 里作为"旧文档术语"解释 | ✅ 与 DSH `todo_write` 语义等价，映射即可 |
| `Bash` 工具 | 1 处，`brainstorming/visual-companion.md` 用 `run_in_background: true` | ✅ DSH `bash` 支持 `run_in_background`（返回 job id） |
| `EnterWorktree` / 原生 worktree 工具 | `using-git-worktrees` 用"探测原生工具 → 回退 `git worktree add`"结构 | ⚠️ DSH 无原生 worktree 工具，必走 `git worktree add`，受沙箱约束（§4.2） |
| 子代理派发 | `subagent-driven-development` 引用 `implementer-prompt.md`、`task-reviewer-prompt.md`（模板里是纯文本提示，不点名工具） | ✅ DSH `subagent`（`provider: spawn`）就是"干净上下文子代理"，且可 `modelSelectionSettings` 指定模型 |
| Skill 调用 | 技能正文描述"invoke a skill"这一动作 | ✅ DSH `skill` 工具 + `/技能名` |
| `CLAUDE.md` 字样 | 4 处，均为"用户指令（CLAUDE.md/AGENTS.md…）优先于技能"或历史记录 | ✅ 无需改动，语义仍成立 |
| `/plugin` | 1 处，仅在打包脚本 `brainstorming/scripts/server.cjs` 里探测 Codex 插件清单 | ✅ 与技能行为无关 |

**结论**：技能正文**不需要为 DSH 做任何改写**。这既符合官方规则（"绝不为了适配而改动技能正文"），也把工作量压到了工具映射这一层。

### 1.4 官方移植契约要点（决定了 DSH 的方案形态）

- **不可协商**：会话启动自动注入，**不能**依赖用户每会话选择。文档原话：若唯一途径是让用户每会话 opt-in，则"该宿主不能被正当支持"。
- **三种形态**：A = shell 钩子读 stdout；B = 进程内插件在消息生命周期回调里改消息数组；C = 由**安装物自带**、被 manifest 声明的上下文文件。
- **交付规则**：所有东西（bootstrap、技能、工具映射）必须**走宿主自己的安装机制**，**严禁**去改用户全局/个人配置（`~/.gemini/config/AGENTS.md`、`settings.json`、`~/.bashrc` …）。
- **Shape B 的三条纪律**：① 幂等去重哨兵（回调可能每步触发）；② 压缩后重新注入（在压缩摘要消息之后插入）；③ bootstrap 作为 **user 角色消息**而非 system 消息。
- **完成定义**：干净会话里发一句 `Let's make a react todo list`，必须**在写任何代码之前**自动触发 `brainstorming`，并留完整 transcript。

> 我们的方案 A 严格说属于 Shape C 的一个变体：上下文不是来自 `GEMINI.md` 而是来自 **preset 自己的 `agent.cordis.yml` 里的 persona 段**；交付走 preset 复制/安装机制，不碰用户全局配置——符合规则 2。方案 B 则升级为货真价实的 Shape B。

---

## 2. DSH 侧现状：所谓"模式"就是 preset

### 2.1 两套容易混淆的"模式"

| 概念 | 包/文件 | 性质 |
|---|---|---|
| **Agent preset（即用户口中的"模式"）** | `@deepseek-ai/dsh-agent-presets`；每模式一目录，含 `preset.yml` + `agent.cordis.yml` | 会话级组装：决定该会话有哪些工具、提示词段、技能。**这才是"新模式"的落点** |
| Plan mode（计划模式） | `@deepseek-ai/dsh-plan-mode` | 单个会话内的只读规划状态，由 `exit_plan_mode` 退出；不是可选"模式" |

已随部署发布的 preset（实测，含中文显示名与 `order`）：

| id | 显示名 | order | 说明 |
|---|---|---|---|
| `standard` | 标准模式 | 1 | 全功能编码 Agent |
| `ptc` | PTC 模式 | 2 | 工具改由 PTC SDK 以 TypeScript 程序组合呈现 |
| `minimal` | （无 `preset.yml`） | — | 固定双工具、单提示词训练配置 |
| `cordis` | 创造模式 | 4 | 标准模式 + Cordis 自省/插件实验/preset 创作技能 |

> **命名先例**：`preset.yml` 的 `name` 就是 GUI 模式选择器里的显示名（如 `标准模式`）。因此"新模式"应命名为例如 `Superpowers 模式`，`id` 为 `superpowers`。

### 2.2 机制与发现路径

- 用户自撰 preset 位于 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/<id>/`，一目录一 preset；随部署发布的集合位于部署自身配置旁的 `agent-presets` 目录。**该随附集合不可编辑**（升级会覆盖，且破坏 `cordis` 会废掉 preset 创作能力本身）。
- 创作方式：`ctx.agentPresets.copy(from, id, name?)` 复制整个目录（组合、元数据、技能目录、资产），只保留描述、丢弃原名与 `order`。
- 校验方式：`standingKeyFor(id)` 真挂载一次插件子树（即会话启动所做的同一件事，只是没有 agent），能捕获包不存在、配置非法、行未激活、服务发布到根 realm 四类失败。
- preset 内部**服务行必须置于带 `isolate` realm 的 group 中**，否则污染进程全局 realm，第二次挂载即冲突。

### 2.3 `cordis` preset 给出的两个关键先例（本方案的直接依据）

**先例一：preset 可以自带技能目录。**

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

`baseUrl` 是该 preset 自身目录，所以技能随 preset 走。这正是 Superpowers "安装物自带技能"的等价物。

**先例二：preset 可以自带 persona 段。**

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
      You are a coding agent powered by the {{model}} model, running on the DeepSeek Harness.
      …
```

`dsh-persona` 的配置为 `prefix`（必填，字符串）、`suffix`、`complete`（默认 `false`）、`includeRuntimeContext`（默认 `true`）。`complete: false` 表示**在部署默认人格之上追加**，这正是我们想要的：保留 DSH 的完整编码 agent 行为，只加 Superpowers 引导。

**先例三：preset 可以自带一个真正的插件（方案 B 需要的）。** `cordis` preset 挂了 `@deepseek-ai/dsh-tool-cordis`；而标准模式里挂了 `@deepseek-ai/dsh-plan-mode` 等。若需自带代码，可在 preset 目录放一个本地包并在组合里引用——这是 §6 方案 B 的实现基础。

### 2.4 四个原语：Superpowers 需要的能力在 DSH 的对应物

| Superpowers 概念 | DSH 对应物 | 关键差异 |
|---|---|---|
| SessionStart hook | preset 的 persona `prefix` 段（每次会话必然渲染） | 没有 shell/环境变量契约；内容是**系统提示**而非 user 消息 |
| 压缩后重注入 | **无对应挂载点** | Superpowers Shape B 的硬性纪律之一，DSH 缺失；可用 `agent/pre-step` 自建幂等注入近似（§6 方案 B） |
| 技能目录 | `dsh-skill-filesystem` 的 `customSkillDirs` / `bundledSkillDir` | 发现规则：只认 `<root>/<name>/SKILL.md` 与 `<root>/<name>.md`，**不递归**；`name` 必须 kebab-case，`description` 必填；未知 frontmatter 键（如 `license`）被忽略而非导致丢弃（实测 `parseSkillFile`，只读 `name`/`description`） |
| Skill 调用 | `dsh-tool-skill` 的 `skill` 工具 + 用户 `/技能名` 手势 | DSH 更严格：有精确名匹配、`disable-model-invocation` / `user-invocable` 门控、重复加载防护 |
| 工具映射文件 | 需新建 `references/dsh-tools.md` | DSH 的 `SKILL.md` "Platform Adaptation" 段落目前只列 Codex / Pi / Antigravity，需追加一行 DSH 指针（官方允许的唯一 `SKILL.md` 改动） |

---

## 3. 组件级可移植性映射表

**判定口径**：✅ 完全等价｜🟡 需薄适配（只动映射/包装，不动技能正文）｜🔻 可降级且技能自带回退措辞｜❌ 缺失，需自研或改部署

| # | Superpowers 组件 | 现实现 | DSH 落点 | 判定 | 备注 |
|---|---|---|---|---|---|
| 1 | Bootstrap 注入 | `hooks/session-start`（JSON 输出） | persona `prefix` 段（方案 A）/ `agent/pre-step` 插件注入 user 消息（方案 B） | 🟡 | DSH 无 Shape A 面 |
| 2 | 压缩后重注入 | hook matcher `startup\|clear\|compact` | 无 | ❌ | 方案 B 以幂等哨兵近似；需实测长会话 |
| 3 | 技能发现与加载 | 原生 `skills/` + `Skill` 工具 | `customSkillDirs` + `skill` 工具 | ✅ | 发现规则已核对 |
| 4 | 工具映射 | `references/*-tools.md` | 新增 `references/dsh-tools.md` | 🟡 | 必须给出真实工具名，禁止臆造 |
| 5 | 子代理派发（SDD） | `Task` 风派发 + 独立 prompt 模板 | `subagent`（spawn，干净上下文，可指定模型） | ✅ | `subagent_fork` **不要**用（它会继承父上下文，违反"绝不继承会话历史"） |
| 6 | 并行子代理 | 并发派发 | `subagent` 多次调用（同一条回复内并发）+ `job_output` 回收 | ✅ | |
| 7 | 待办跟踪 | `TodoWrite` | `todo_write`（标准模式已开 `allowParallelInProgress`） | ✅ | |
| 8 | 清理/合并分支 | `git worktree add/remove` + `push`/PR | `bash` + git | 🔻 | **沙箱约束**：worktree 必须落在 workspace 内；push/PR 不应在无人值守流程中执行（§4.2、§4.3） |
| 9 | 设计/计划文档落盘 | `docs/` 或仓库约定 | `write`/`edit` + `present` | ✅ | 本仓库已有 `docs/superpowers/{specs,plans}` 先例 |
| 10 | 可视化伴侣（brainstorming 可选） | 本地 Node 静态服务器 + 浏览器 | `bash run_in_background` 起服务；URL 交由用户打开 | 🟡 | 无浏览器自动打开通道；遥测可关（`SUPERPOWERS_DISABLE_TELEMETRY`） |
| 11 | Web 检索 | 部分技能引用 | `web_search` / `web_fetch` | ✅ | |
| 12 | Graphviz 图 | 若干技能用 DOT 画流程 | 纯文本渲染 | ✅ | 只是可读性，不影响行为 |
| 13 | 安装分发 | 各宿主插件市场 / `plugin install` | preset 目录复制（`agentPresets.copy`）或打包为 Profile Bundle | 🟡 | 无市场机制；可写 `sync-superpowers.sh` 做上游同步 |
| 14 | 版本追踪 | `.version-bump.json`（7 个 manifest 同版本） | preset 内加 `SUPERPOWERS_VERSION` 文件或 `preset.yml` 扩展字段 | 🟡 | 便于"技能来自哪个上游版本"可追溯 |
| 15 | 行为评测 | `superpowers-evals`（drill 评测框架） | DSH 有会话日志与 headless profile，可脚本化 | 🔻 | 首版以官方验收用例手测为准（§7） |

---

## 4. 差距与风险分析

### 4.1 高风险（必须在设计阶段解决）

**R1 — 无 SessionStart 钩子 / 无压缩点（注入的完整性）**

- 影响：bootstrap 是全套系统的开关。若它没进上下文，技能文件"在磁盘上但永不触发"。
- 现状：perset 的 persona 段是**每次请求都渲染的系统提示**，可靠性实际上**高于**钩子方案（钩子只在特定事件触发，且可能被去重逻辑吃掉）。所以"首次注入"不是问题。
- 真问题只剩**压缩后**：Superpowers 的 `using-superpowers` 在长会话里被折叠后，纪律可能衰减；`systematic-debugging`、`verification-before-completion` 这类"刹车"技能最依赖它。
- 缓解：方案 B 的 `agent/pre-step` 幂等注入（哨兵字符串检测 + 缓存内容），并在文档中明确它**不是**事件驱动的重注入，而是"每步检查、缺失即补"。

**R2 — 沙箱语义 vs worktree/PR（安全与可行性）**

- 本会话策略为 `workspace-write`：workspace 之外不可写。`using-git-worktrees` 的默认路径（如 `/tmp/...` 或仓库同级目录）在 DSH 下会**直接失败**——该技能已自带"沙箱回退"措辞（"若 `git worktree add` 因权限失败，告知用户并在当前目录工作"），所以不会死锁，但会静默降级成"在当前目录干活"，而用户以为有隔离。
- ArduPilot 仓库自身规则进一步收紧：AI 贡献不得造假测试、不得修改子模块、参数索引不可变、每 commit 单一子系统。
- 缓解（写进 `dsh-tools.md` 与模式说明）：
  - worktree 一律建在 **workspace 内**（如 `<cwd>/.worktrees/<branch>`），并在 `.gitignore` 说明中提示；
  - `finishing-a-development-branch` 的 merge/push/PR 分支状态改为**需用户显式确认**，默认只做"验证 + 呈现选项"；
  - 提交信息遵循仓库 `AGENTS.md`（ArduPilot：`Subsystem: desc`、单一子系统），而非技能的通用建议。

**R3 — 上游内容与仓库治理冲突（谁来压谁）**

- 证据：本仓库 `AGENTS.md` 第 10 节明确"不要为简历/教学目的向 master 推 PR"、"不得伪造测试结果"、"AI 参与必须披露"；第 7 节规定提交格式与"一 commit 一子系统"。
- Superpowers 的 SDD 流程"每任务实现、测试、提交"，粒度天然是"多 commit"，且不感知 ArduPilot 的子系统前缀规则。
- 结论：**必须在 bootstrap 之后追加一段"仓库规则优先"声明**（Superpowers 自己的 `using-superpowers` 也承认"用户指令优先于技能"），否则会产生一堆格式违规的本地提交，浪费人类时间。
- 注意：这是**策略层**而非技术层问题——不要为了让 ArduPilot 合规去改技能正文（违反官方移植规则），而应放在工具的 `description` 与模式 persona 里。

### 4.2 中风险

**R4 — 用户已有工作流的重叠**

- 实测：本仓库已在用 superpowers 风格产物——`docs/superpowers/specs/*.md`（9 份设计）、`docs/superpowers/plans/*.md`（大量实施与证据文档，部分已进入 git 历史：`Tools: show_gcs add the auto-align implementation plan`），以及 `docs/superpowers/experience/ardupilot-dev-lessons.md` 这样的"经验库"。
- 含义：新模式必须与既有约定**对齐而非另起一套**：设计文档落 `docs/superpowers/specs/`，计划落 `docs/superpowers/plans/`，证据文件命名沿用 `*-evidence.md`。否则会出现两套并行的目录约定，反而降低可追溯性。

**R5 — 技能目录与外置仓库的耦合**

- 技能物理位置在 `$UPSTREAM/skills`（**workspace 之外**），DSH 无法把 skill root 指向那里并跨会话稳定工作，也不符合"安装物自带"的交付规则。
- 缓解：preset 内 `skills/` 目录**内置**一份（vendored），并附一个同步脚本（`scripts/sync-superpowers-skills.sh`：从指定上游 commit 复制 `skills/` 并写入版本号），把"上游版本"变成显式可追踪的字段。

**R6 — 令牌开销（可量化）**

- bootstrap 正文 ≈ 3 KB（`using-superpowers/SKILL.md`，实测 3,063 字节）+ 工具映射 ≈ 2 KB。
- 关键设计选择：**只内联 bootstrap，绝不内联全部技能**（14 份合计 125 KB）。其余技能走 DSH 的目录 + `skill` 工具按需加载，天然省 token。
- 方案 A 把 bootstrap 放进 persona（系统提示段，**每请求重复**）→ 每轮固定 +5 KB 左右；方案 B 作为 user 消息注入一次（去重）→ 只付一次。这是 B 相对 A 的一个实质增益。

**R7 — 技能命名空间与工具名考古**

- Superpowers 文本里出现 `superpowers:brainstorming`、`superpowers:finishing-a-development-branch` 这类带命名空间写法，DSH 的 `skill` 工具要求**精确名**且会校验；`skill` 传 `superpowers:brainstorming` 会报 `invalid skill name`。
- 缓解：`dsh-tools.md` 里明确"`superpowers:X` → 调用 `skill` 时传 `X`"。

### 4.3 低风险 / 可接受

- **技能 frontmatter 兼容**：只需 `name`（kebab-case）+ `description`；Superpowers 14 个技能全部满足；`frontend-design` 里的 `license:` 键会被忽略（已核对解析实现）。
- **技能内脚本可执行**：`brainstorming/scripts/*.sh`、`find-polluter.sh`、`render-graphs.js` 均可经 `bash` 运行。
- **子代理模型选择**：SDD 要求"总是显式指定模型"；DSH `subagent` 工具在标准模式已开启 `modelSelectionSettings`，语义对齐。
- **plan mode 关系**：Superpowers 要求"进入 plan mode 前先 brainstorming"；DSH 的 `dsh-plan-mode` 是独立只读状态，二者的衔接需要在 persona 里点明一句（否则模型可能直接进 plan mode 跳过设计澄清）。

---

## 5. 推荐方案

### 5.1 总体形态：**"一个 preset + 一份 tool mapping + 一段 bootstrap"**

```
${DSH_HOME}/.agent-presets/superpowers/
├── preset.yml                 # name: Superpowers 模式 ; description: …
├── agent.cordis.yml           # 复制自 cordis（或 standard），改写 persona 与 skill-filesystem
├── skills/                    # vendored：上游 superpowers/skills 全量（436 KB）
│   ├── using-superpowers/
│   │   ├── SKILL.md           # 上游原文，仅追加一行 DSH 指针
│   │   └── references/dsh-tools.md   # ★ 新写：动作 → DSH 真实工具名
│   └── … 另外 13 个技能
├── bootstrap.md               # ★ 新写：bootstrap = using-superpowers 正文 + 工具映射 + 仓库规则声明
└── SYNC.md                    # ★ 记录上游 commit/版本与同步命令
```

### 5.2 为什么从 `cordis` 而不是 `standard` 复制

`agentPresets.copy(from, id, name)` 会整目录复制（组合 + 元数据 + 技能目录 + 资产），并且**副本天然可加载**——避免"从零写组合忘掉 realm / 漏掉消费行"的经典错误。

- 复制 `cordis`：白拿 `skill-filesystem` + `tool-skill` 两行，且现成的 `customSkillDirs` + `baseUrl` 写法就是我们要的形态。代价是顺带带上 Cordis 自省工具（`tool-cordis`）——可保留（能力更强）或删除（更贴近上游意图）。
- 复制 `standard`：要自己补 `skill-filesystem`/`tool-skill` 两行，但产物更干净。

**建议**：复制 `cordis`，然后**删除** `tool-cordis` 行与 `editing-cordis-compositions` 技能（若希望 Superpowers 模式是"纯方法论模式"而非"同时能改运行时"）。这个取舍应交给用户决定（见 §10）。

### 5.3 方案 A：零代码落地（半天）

`agent.cordis.yml` 的关键改动（其余行沿用副本）：

```yaml
# ── 人格：在这里承载 Superpowers bootstrap ────────────────────────────────
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    # complete 保持 false：在部署默认人格之上追加，不吞掉 DSH 的完整 agent 行为
    prefix: |-
      You have superpowers. Before any response or action — including clarifying
      questions — check whether a skill applies, and load it with the `skill` tool.
      …（using-superpowers 正文要点 + 工具映射摘要 + 仓库规则优先声明）
    suffix: Your working directory is {{cwd}}.

# ── 技能：随 preset 自带 ──────────────────────────────────────────────────
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
  config:
    catalogDescriptionMaxLength: 500
```

**A 方案的已知不足**：bootstrap 每请求重复（约 +5 KB/轮）；无法在压缩后"重新宣告"（虽然它作为系统提示始终在场，反而不会丢——**这点上 A 比 Shape B 的注入更抗压缩**，因为系统提示段不参与历史折叠）。这是一个反直觉但真实的优势，值得在评审时说明。

### 5.4 方案 B：加固形态（1.5 天）

新增一个 preset 私有 Cordis 插件（preset 目录内本地包，约 60 行，纯 JS，无 TypeScript/JSX/import 变形）：

```js
// 伪代码示意；真实实现须先按 cordis-plugin-development 技能核对服务与事件契约
return {
  inject: ['agents'],                       // 具体依赖以 Inspect 结果为准
  apply(ctx) {
    const BOOTSTRAP = /* 读取 preset 内 bootstrap.md，模块级缓存一次 */ ''
    ctx.on('agent/pre-step', async ({ agent, messages, signal, step }, next) => {
      // 幂等哨兵：已存在 EXTREMELY_IMPORTANT 标记则不重复注入
      // 若最近一段历史被压缩（摘要消息在头部），则在摘要之后重新注入
      // 以 user 角色追加，绝不追加 system 消息
      return next()
    })
  },
}
```

它复刻 Superpowers Shape B 的三条纪律（幂等去重、压缩后重注入、user 角色消息），并保持"bootstrap 内容来自 preset 自带的 `bootstrap.md`"。方案 A 的 persona 段可同时保留（双保险），也可在 B 稳定后精简为一句指针。

### 5.5 方案 C：可选增强（3–5 天，需明确需求再做）

- 自研 `superpowers_gate` 工具：参数为阶段枚举（`brainstorm`/`design-approved`/`plan`/`implement`/`review`/`finish`），返回"当前阶段应加载哪个技能、门禁是否满足"。
- 客户端（Client 平面）向侧边栏 Slot 注册一个面板，展示：当前阶段、已加载技能、任务账本、评审结论。
- **不要**试图做硬性门禁（见 §8.3）。

---

## 6. 文件清单与骨架

> 本节给出可直接落地的骨架；真实写入前须按 `editing-cordis-compositions` 技能做 `standingKeyFor('superpowers')` 挂载校验。

### 6.1 `preset.yml`

```yaml
name: Superpowers 模式
description: 在标准模式之上集成 Superpowers 技能方法论：设计澄清（brainstorming）→ 实施计划 → 子代理驱动开发 → TDD → 评审与验证。技能随模式自带，无需逐会话手动开启。
order: 5
```

### 6.2 `skills/using-superpowers/references/dsh-tools.md`（新写，内容示意）

```markdown
# Superpowers → DeepSeek Harness tool mapping

技能正文描述"动作"，这里给出 DSH 里的真实机器名。

| Action (skill wording) | DSH tool | Notes |
|---|---|---|
| read a file | `read` | 返回带行号的文本；大文件用 offset/limit 续读 |
| create / edit a file | `write` / `edit` | 已有文件优先 `edit`；整文件替换才用 `write` |
| delete a file | `bash` (`rm`) | 无独立删除工具 |
| run a shell command | `bash` | 长任务用 `run_in_background: true`，用 `job_output` 取回 |
| search contents / find files | `grep` / `glob` | 专有工具，优于 shell 的 grep/find |
| fetch a URL / search the web | `web_fetch` / `web_search` | `web_search` 接受 1–4 条 query |
| dispatch a subagent | `subagent` | `provider: spawn`，**干净上下文**；不要用 `subagent_fork`（会继承父会话） |
| specify a subagent's model | `subagent` 的模型选择参数 | SDD"总是显式指定模型"在此对应模型选择，而非省略 |
| create / update todos | `todo_write` | 对应旧文档里的 `TodoWrite` |
| ask the human a question | `ask_user_question` | 仅用于用户拥有的选择或检视无法回答的歧义 |
| deliver a file to the user | `present` | 产物文件必须 present，仅在回复里写路径不算交付 |
| invoke a skill | `skill` | 传**精确技能名**；`superpowers:brainstorming` → 传 `brainstorming` |

## Sandbox and repository reality

- 文件写入被限制在会话工作区内。`git worktree add` 只在**工作区内**的路径可用（例如 `<cwd>/.worktrees/<branch>`）；工作区外的路径会被策略拒绝。
- `push`、建 PR、改远端不在无人值守流程内执行：`finishing-a-development-branch` 只呈现选项，动作交人类确认。
- **仓库规则优先于本技能集**：本仓库 `AGENTS.md` 规定提交信息格式、每提交单一子系统、AI 参与必须披露。技能里的通用提交建议不得覆盖它。
```

### 6.3 `bootstrap.md`（拼装产物，供 persona 或 pre-step 注入）

```
<EXTREMELY_IMPORTANT>
You have superpowers.

**Below is your 'using-superpowers' skill — your introduction to using skills.
For all other skills, use the `skill` tool. It is already active: do NOT
re-load it with the `skill` tool.**

<…using-superpowers/SKILL.md 正文，去掉 YAML frontmatter…>

## DeepSeek Harness tool mapping
<…dsh-tools.md 正文…>

## Repository rules take precedence
This workspace's AGENTS.md (e.g. ArduPilot's) overrides any generic advice in
these skills: commit message format, one subsystem per commit, AI-assistance
disclosure, no fabricated test evidence.
</EXTREMELY_IMPORTANT>
```

> 注意官方 Shape B 纪律：注入必须是 **user 角色消息**，且带幂等哨兵；Shape C（persona 段）则无需哨兵，但每请求重复。

### 6.4 同步脚本 `scripts/sync-superpowers-skills.sh`（建议）

```sh
#!/usr/bin/env bash
# 从上游 superpowers 检出同步 skills/ 到本 preset，并记录版本与 commit。
set -euo pipefail
UPSTREAM="${1:?usage: sync-superpowers-skills.sh <superpowers-checkout> }"
DEST="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$DEST/skills"
cp -R "$UPSTREAM/skills" "$DEST/skills"
git -C "$UPSTREAM" log -1 --format='%H %ad' --date=short > "$DEST/SYNC.md"
grep -m1 '"version"' "$UPSTREAM/package.json" >> "$DEST/SYNC.md"
```

---

## 7. 验收清单与测试方法

Superpowers 官方的"完成定义"（Part 3）逐条落到 DSH 上：

| # | 验收项 | DSH 验证方法 | 现状可判定性 |
|---|---|---|---|
| 1 | 每个会话自动注入 bootstrap，无逐会话 opt-in | 新建会话选 `Superpowers 模式`，问"describe your superpowers" | ✅ 可用 GUI 验证（需人类操作） |
| 2 | 存在 DSH 工具映射 | 检查 `references/dsh-tools.md` 且被 bootstrap 引用 | ✅ 静态 |
| 3 | 技能可真正被调用且模型遵循 | `skill` 工具加载 `brainstorming`，观察全文与资源基路径提示 | ✅ 可用会话验证 |
| 4 | **验收用例**：干净会话发 `Let's make a react todo list`，**在写代码前**自动触发 `brainstorming` | 保存完整 transcript | ✅ 人类执行并留证 |
| 5 | 集成测试 | ① `standingKeyFor('superpowers')` 挂载校验通过；② 技能目录发现数量 = 14（可用临时探针工具打印 catalog 名列表） | ✅ 可自动化 |
| 6 | 用户能通过宿主自身机制安装 | 走 `agentPresets.copy` 落在用户根；不手工改用户全局配置 | ✅ 设计保证 |

**额外建议的 DSH 专属回归项**：

- 沙箱回归：在 `workspace-write` 下抛 `using-git-worktrees` 场景，确认它落到 workspace 内或给出明确回退说明，而不是静默"就地干活"。
- 压缩回归：制造一次历史压缩（长会话触发 `compaction-basic`），确认 bootstrap 纪律仍在（方案 A 因系统提示段特性应天然通过；方案 B 需验证重注入）。
- 子代理回归：SDD 派发 `subagent`，确认子代理**看不到**父会话历史（证明用的是 `spawn` 而非 `fork`）。

---

## 8. 备选方案与反方案

### 8.1 不集成，沿用现状

现状已经在"非正式使用" Superpowers：本仓库有 `docs/superpowers/specs`、`plans`、`experience` 三类产物，设计与证据文档齐全。若只是想要文档约定，不需要新模式。**但**：`brainstorming`/`systematic-debugging`/`verification-before-completion` 的"任何动作前先查技能"这一强制性，恰好是"靠自觉"最容易退化的部分——这正是不集成的主要代价。

### 8.2 用工作区 `AGENTS.md` 承载 bootstrap（**不推荐**）

看起来最省事（DSH 的 `dsh-agent-instructions` 会自动加载 `AGENTS.md`/`CLAUDE.md`），但：

- 它把 Superpowers 强加给**所有**模式，违背"新模式"的诉求；
- 它是**用户/仓库文件**，不是"安装物自带"，直接违反 Superpowers 移植规则 2（"绝不通过改用户配置来注入"）；
- 会把 3 KB bootstrap 写进一个受 ArduPilot 提交规范约束的仓库文件，污染仓库。

### 8.3 试图做"硬性门禁"（**不推荐**）

DSH 没有可以真正阻断模型"跳过技能直接写代码"的机制（工具目录在模式间保持稳定，且不存在"未加载技能则工具不可用"的原语）。因此：
- 可以做**提示 + 可观测**（`superpowers_gate` 工具 + 面板）；
- 不要承诺"流程强制"，否则会得到一个看起来很硬、实际只是提示的系统，比诚实的软引导更糟。

### 8.4 向上游提交 DSH 移植（可选，非本次目标）

Superpowers 仓库欢迎新宿主移植（有完整流程、PR 模板与评测要求），且要求把 `references/dsh-tools.md` 与 bootstrap 注入一并提交。若将来希望"官方支持 DSH"，需要额外准备：`dsh-tools.md`、注入实现、测试（`tests/`）、以及 Part 5 Step 7 的 tmux 实机验收 transcript。**注意**：本报告的范围不是上游贡献，而是本地集成；两者可以共用同一批产物，但上游 PR 需单独评审与授权。

---

## 9. 风险登记册（含缓解与责任方）

| ID | 风险 | 等级 | 缓解 | 责任方 |
|---|---|---|---|---|
| R1 | 压缩后纪律衰减 | 中 | 方案 B 幂等重注入；或依赖 persona 系统提示段不参与折叠的特性 | 集成实现者 |
| R2 | worktree 越界被沙箱拒绝 / 静默降级 | 高 | 工具映射写死"worktree 在 workspace 内"；在模式文档声明降级语义 | 集成实现者 + 使用者 |
| R3 | 技能流程与仓库治理冲突（提交格式 / PR 政策） | 高 | bootstrap 末尾追加"仓库规则优先"；`finishing-a-development-branch` 的 push/PR 改为需人类确认 | 集成实现者 |
| R4 | 与既有 `docs/superpowers/*` 约定分叉 | 中 | 新模式沿用既有目录与 `*-evidence.md` 命名 | 使用者 |
| R5 | 外置仓库耦合、上游漂移 | 中 | vendored 技能 + `SYNC.md` 版本/commit + 同步脚本 | 集成实现者 |
| R6 | 令牌开销 | 中 | 只内联 bootstrap（3 KB），技能按需加载；方案 B 改为一次性注入 | 集成实现者 |
| R7 | `superpowers:X` 命名空间调用失败 | 低 | 映射表显式给出"传 X" | 集成实现者 |
| R8 | 可视化伴侣需用户手开 URL、遥测外联 | 低 | 文档说明；`SUPERPOWERS_DISABLE_TELEMETRY=1` | 使用者 |
| R9 | 技能目录发现失败但静默（DSH 只给日志警告，模型目录里"消失"） | 低 | 用探针工具打印 catalog 名列表并断言 14 项 | 集成实现者 |

---

## 10. 待决问题（需要人类决策）

1. **模式定位**：`Superpowers 模式`是"standard + 方法论"（推荐），还是"Cordis 创造模式 + 方法论"（能顺手改运行时，但信任面更大）？
2. **是否保留 Cordis 工具**：删除更贴近上游最小面；保留则新模式同时可自省/改 harness。建议**默认删除**，另开一个 `superpowers-dev` 变体给需要的人。
3. **文档落盘约定**：`docs/superpowers/`（沿用现状）还是新的 `docs/sp/`？建议沿用，避免两套约定。
4. **worktree 策略**：workspace 内建 worktree（`.worktrees/`）还是默认禁用该技能？前者保留隔离语义，但会给 git status 添噪音。
5. **是否允许自动提交**：SDD 默认每任务提交。建议在 ArduPilot 语境下**默认不自动提交**，改为"任务完成 → 交给人类批量按子系统提交"。
6. **分发方式**：仅本地 preset，还是打包为 npm Bundle 供 `dsh plugin add`？（后者需要预设根配置与版本策略，属增量工程）
7. **上游同步节奏**：何时同步（手动脚本 / 定期 / 跟随 release）？
8. **是否最终向上游提交移植**（§8.4）——若会，产物需一次做对（含测试与 transcript）。

---

## 11. 结论

1. **技术上完全可行，且不需要改 DSH 或 Superpowers 的任何核心代码。** DSH 的 preset 机制在三个关键点上天然满足 Superpowers 的移植契约：自动注入（persona 段）、自带技能（`customSkillDirs` + `baseUrl`）、真实工具面（含干净上下文子代理）。
2. **真正的工程量在"两页纸"上**：一份 `references/dsh-tools.md`、一段 bootstrap 拼装。技能正文 125 KB / 14 个技能原样复用是**最优路径**，也是唯一符合上游规则的路径。
3. **三个必须写进设计而非事后补救的差距**：压缩后纪律、沙箱与 worktree/PR 的语义收敛、仓库治理优先于技能流程。
4. **建议路线**：先做方案 A（半天，拿到验收证据），再升级方案 B（共 1.5 天）解决令牌开销与压缩加固；方案 C 待明确需求后另议。
5. **不要做的事**：不要为适配改写技能正文；不要用工作区 `AGENTS.md` 承载 bootstrap；不要承诺硬性流程门禁。

---

## 附录 A — 证据索引

| 主题 | 位置 |
|---|---|
| Superpowers 架构三件套与移植契约 | `$UPSTREAM/docs/porting-to-a-new-harness.md`（Part 1 行 31–79；硬性要求 行 86–107；能力清单 行 108–133；完成定义 行 134–166；形态 A/B/C 行 174–300；Step 3 行 350–455；Step 4 行 456–508） |
| 各宿主集成参考 | 同上 Appendix A（行 781+）；`hooks/session-start`；`.opencode/`；`.pi/extensions/superpowers.ts`；`gemini-extension.json` + `GEMINI.md` |
| bootstrap 本体 | `$UPSTREAM/skills/using-superpowers/SKILL.md`（3,063 字节） |
| 技能清单与体量 | `$UPSTREAM/skills/`（436 KB / 48 文件；14 份 `SKILL.md` 合计 125,392 字节） |
| 流程主链 | `README.md`（行 188–204）；`skills/subagent-driven-development/SKILL.md`（行 1–130） |
| DSH preset 先例（自带技能 + 自带人格 + 自带插件） | `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/cordis/agent.cordis.yml`（persona 行 20–40；skill-filesystem/tool-skill 行尾段） |
| DSH 标准模式全量行清单 | `…/presets/standard/agent.cordis.yml`（255 行） |
| 模式显示名先例 | `…/presets/standard/preset.yml`（`name: 标准模式`）、`ptc/preset.yml`（`name: PTC 模式`）、`cordis/preset.yml`（`name: 创造模式`） |
| preset 发现/复制/校验契约 | `…/dsh-agent-presets/README.zh.md`（发现路径、`copy`、`standingKeyFor`、realm 规则） |
| 技能发现与 frontmatter 规则 | `…/dsh-skill-filesystem/README.md`（roots 优先级表、格式、限制）；实现 `lib/index.js:664` 起 `parseSkillFile`（只读 `name`/`description`，未知键忽略） |
| 技能目录与 `skill` 工具行为 | `…/dsh-tool-skill/README.md`（会话目录模板、`/name` 手势、去重规则） |
| persona 行契约 | `…/dsh-persona/README.md`；schema：`prefix` 必填、`complete` 默认 false、`includeRuntimeContext` 默认 true |
| 工作区既有 superpowers 产物 | `$ARDUPLOT_WS/docs/superpowers/{specs,plans,experience}/`；`docs/superpowers/skills/frontend-design/SKILL.md` |
| 治理约束 | `$ARDUPLOT_WS/AGENTS.md`（§7 提交、§8 PR、§10 禁止事项） |

## 附录 B — 本报告未验证的假设（诚实清单）

1. **验收用例未执行**：`Let's make a react todo list` 的自动触发需要在**新模式的新会话**里验证，当前会话无法自证。
2. **`agent/pre-step` 是否足以实现"压缩后重注入"**：事件存在且用于通知类注入（`dsh-agent` 内可见 `agent/pre-step` 瀑布监听），但**尚未实测**是否能观测到压缩边界并安全插入 user 消息；方案 B 的这一步需先做探针验证。
3. **preset 内本地包的加载方式**：`cordis` preset 引用的是已发布的 `@deepseek-ai/dsh-tool-cordis`；preset 目录内**本地相对包**是否被 loader 接受，需要一次挂载校验确认（未验证）。
4. **技能目录发现数量断言**：14 项是按上游目录统计的理论值，未在 DSH 会话目录里实际点过名。
5. **可视化伴侣在 DSH Web GUI 下的可用性**：本地服务器 + 用户手动开 URL 的路径未实测。

---

## 12. 实施回填（2026-09-12 同日完成方案 B）

报告写完后立即实施了方案 B，并跑完了除"人类目击"外的全部验证。本节记录**实际做出来的东西**与本报告原先判断的差异，供后续维护者对照。

### 12.1 实际交付物

| 项 | 落点 |
|---|---|
| 任务目录 | `$REPO`（与 ArduPilot 工作区无关，`reports/` 下的临时报告已移入此处并清理） |
| 模式 | preset id `superpowers`，显示名 `Superpowers 模式`（`order: 5`） |
| 组合 | 从随附 `cordis` 模式**复制**后改写：删除 `tool-cordis` 自省行，persona 换成 Superpowers 引导，新增一行 preset 相对路径的本地插件 |
| bootstrap | `preset/bootstrap.md`，9,104 字节 / 177 行，由 `scripts/build-bootstrap.sh` 从 vendored 技能 + `dsh-tools.md` 生成 |
| 工具映射 | `preset/skills/using-superpowers/references/dsh-tools.md`（新写，官方 Shape B 要求的 `<harness>-tools.md`） |
| 注入插件 | `preset/plugins/superpowers-bootstrap/index.js`，约 120 行纯 JS，监听 `agent/pre-step` |
| 自测 | `preset/plugins/superpowers-bootstrap/selftest.mjs`，`node selftest.mjs` 秒级跑完，无需 running agent |
| 脚本 | `sync-superpowers-skills.sh`（上游同步）/ `build-bootstrap.sh`（拼装 + 自检）/ `install.sh`（安装，含 `--copy`） |
| 技能 | 上游 14 个技能原样 vendor（正文净 125,438 字节）；`SKILL.md` 唯一改动是官方允许的 Platform Adaptation 指针行 |

### 12.2 对本报告判断的两处修正

**修正一：§5.3/§6.2 关于"方案 A 用 persona、方案 B 用插件"的取舍被简化。** 实施后 persona 段只保留 3 行引导（"你有 superpowers、先查技能、技能是强制工作流"），9 KB 正文**全部**交给插件一次性注入。这样 persona 继续承担"系统提示级的持久存在"，插件承担"带标记的持久消息"，两者不重复：persona 不会被压缩掉，插件消息则会在压缩后自愈。

**修正二：§5.4 里"压缩后重注入需要观测压缩边界"被证明是多余的复杂度。** 实现不需要任何压缩事件：只要在每次 pre-step 检查"本步将进入的消息里有没有标记"，压缩把旧历史换成摘要后标记自然消失，下一次 pre-step 自动补回。**存在性即条件**，比订阅事件更简单也更抗变化。这是实施阶段最有价值的一条简化。

### 12.3 实施阶段新发现的两个硬约束（报告未覆盖）

**约束一：preset 发现会静默跳过符号链接目录。** `dsh-agent-presets` 用 `readdir(root, { withFileTypes: true })` 并只接受 `isDirectory()` 为真的条目；**指向目录的符号链接 `isDirectory()` 返回 false，被无诊断地跳过**。因此不能把 `~/.dsh/.agent-presets/superpowers` 直接做成指向检出的符号链接（第一版安装脚本就是这么写的，名单里根本看不到它）。正确做法：安装成**真实目录 + 逐项符号链接**，既能被发现，又保持改动即时生效。`install.sh` 已按此实现并加了防御性断言。

**约束二：本地 preset 里的插件必须有 `node_modules`。** 本地创作的 preset 位于用户家目录，Node 的 `node_modules` 上行查找到不了 harness 自带的包，而插件需要 `@deepseek-ai/dsh-llm` 的 `createUserMessage`。落地方式是 `preset/node_modules/@deepseek-ai` 指向已安装 harness 的依赖树——于是这个 preset 天然是**机器本地**的（换机器或纯粹把 preset 目录拷到别处都需要重跑 `install.sh`）。这也解释了为什么随附模式从不需要这一手：它们随 harness 一起安装，上行查找天然可达。

### 12.4 验证结论摘要

| 层 | 方法 | 结果 |
|---|---|---|
| 组合装配 | `agentPresets.standingKeyFor('superpowers')` | `MOUNT OK` —— 真挂载，本地相对插件、`!!js`、技能目录、三个 isolate realm 全部合法 |
| 技能目录 | `skills.snapshot({ scope: standingKey })` | 该 preset 作用域可见 **14 个**技能（`source: custom`），全部模型可调用；`using-superpowers.resourceBase` 指向 preset 自己的技能目录；`brainstorming` 正文加载 10,149 字节 |
| 插件逻辑 | `node selftest.mjs`（真实安装路径与检出路径各跑一次） | 6 组断言通过：首步注入一次、user 角色 + plugin 来源、不重复注入、压缩后重注入且摘要在前、reject 步不动、已有消息保序 |
| 依赖解析 | `import('@deepseek-ai/dsh-llm')` 从插件目录 | `createUserMessage: function` |
| 安装模式 | 默认符号链接模式 + `--copy`（临时 DSH_HOME 冒烟） | 两种模式都能跑通自测，`--copy` 副本的依赖链接重指向 harness |

**仍未验证的一项**：真实会话里"注入消息真的进入模型请求"。这需要人类新建一个 `Superpowers 模式` 会话并跑官方验收用例（`Let's make a react todo list` 应在写代码前触发 `brainstorming`）。动态沙箱禁用 `await import()` 且不暴露 `process`/`fs`，无法从会话内自动完成这一步。

### 12.5 自测抓到的一个真实缺陷（记录在案）

插件里 `bootstrap.md` 的相对路径写成 `new URL('../bootstrap.md', import.meta.url)`——少了一层，实际解析到 `plugins/bootstrap.md`。由于插件按设计**静默降级**（读不到就退出并打一条 warning），这个错误在真实会话里的表现是"模式装了但完全没效果"，极难排查。自测立刻抓到了它。已修正为 `'../../bootstrap.md'`，并在 `evidence/VERIFICATION.md` 里记录了现象与修复。

这条恰好印证了本报告 §7 的判断：**这一层的验证必须自动化**，不能只依赖"看一下模型有没有变聪明"。
