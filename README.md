# dsh-engineering

把**两套**上游技能方法论适配为 **DeepSeek Harness 的一个模式**：`工程模式`（preset id `engineering`）。

- [Superpowers](https://github.com/obra/superpowers)（v6.1.1，14 个技能）—— 流程严谨：设计澄清 → 实施计划 → 子代理驱动开发 → TDD → 评审 → 验证。
- [Caveman](https://github.com/JuliusBrussee/caveman)（2.6.0，白名单 3 个技能）—— 输出压缩：默认 `full` 级，去掉客套与填充，保留全部技术实体、代码与报错原文。

两个上游的分工是本项目的核心：Superpowers 决定**怎么做**（流程产物、检查点、验证证据），Caveman 决定**怎么说**（表达密度）。两者不冲突，因为流程产物被显式排除在压缩之外——计划、规格、设计、评审意见、TDD 红绿说明、动手前的澄清一律保持完整结构化。

这不是给 DSH 打补丁，而是按 Superpowers 官方的宿主移植契约做一个 **Shape B** 移植：一个进程内插件把 bootstrap 在会话开始时注入模型上下文；DSH 的 preset（模式）机制天然满足"自动注入、无需逐会话 opt-in"这条唯一不可协商的要求。

上游技能**逐字复用**，不改写任何技能正文——这是上游移植规则的要求，也让升级同步变成一次目录复制。适配只发生在三处：一份工具映射文件、一段 bootstrap 拼装、三个 preset 本地插件（`bootstrap`、`caveman-command`、`output-language`）。

## harness 0.2 迁移（0.2.0-rc.2 起）

**上游换掉了 preset 的登记机制，这不是本仓库的 bug**：

| | harness ≤0.1.5 | harness 0.2（0.2.0-rc.2 起） |
|---|---|---|
| preset 从哪来 | `@deepseek-ai/dsh-agent-presets` 扫描 `$DSH_HOME/.agent-presets/<id>/` | 组合树里的一行 `@deepseek-ai/dsh-agent-preset`，注册进 `@deepseek-ai/dsh-agent-preset-registry` |
| 本仓库交付物 | `index.js` 在该 profile 启动时植入目录 | `cordis.patch.yml` 里的 `preset-engineering` 声明行 |

0.2 把那套目录机制连同包一起删掉了；registry 的 README 原文是 *"Definitions are ordinary plugin rows; the registry neither scans directories nor accepts preset paths."*。所以**继续往 `~/.dsh/.agent-presets/engineering/` 植入文件毫无效果**：模式选择器里没有「工程模式」，而宿主日志一切正常——这是升级后最容易误判的一类静默退化。

本仓库的 0.2 形态：

- `preset/agent.cordis.yml` 仍是**源码**，但 0.2 的声明必须是组合里的静态行，于是它由 `scripts/build-preset-patch.mjs` 渲染进 `cordis.patch.yml`（产物入库；漂移由 `scripts/preset-patch.test.mjs` 守护）。渲染时按 0.2 的真实差异做三处改写：
  1. preset 本地插件行 `'./plugins/<x>'` → `'@goalizc/dsh-engineering/preset/plugins/<x>'`：0.2 的 preset 子树继承 **profile 目录** 的 baseUrl，相对行会指向 profile 根下不存在的文件。
  2. `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`（0.2 不再提供前者；行 id 同步改）。
  3. `skill-filesystem.customSkillDirs` 改由运行时表达式解析包内 `preset/skills`，解析失败才回落到 legacy 植入目录。
- `preset/preset.yml` 变成**显示元数据源**：`name`/`description`/`order` 被渲染进声明行（0.2 的 registry 不读这个文件）。
- `index.js`、`scripts/install.sh`、`scripts/plant-core.mjs`、`scripts/verify-composition.mjs` 只服务 ≤0.1.5 的目录机制，0.2 上不会被加载或触发。

安装（0.2）仍是 bundle 通道，装完**重启宿主**，再**新建**会话（模式在创建时确定，不能中途切换）：

```sh
dsh plugin --profile <name> add github:goalizc/dsh-engineering
```

升级到 0.2 后还要注意：

- `$DSH_HOME/.agent-presets/engineering/` 不再被读取（文件还在，只是没人看）；确认无其他用途后可删。整个 `settings.yaml` 在 0.2 首次启动时会被改名成 `settings.yaml.imported`，然后逐节写入同名 entry；`agent-presets` 这一节在 0.2 的组合里没有同名 entry（新行 id 是 `agent-preset-registry`），所以它不会被导入、只留在改名后的文件里，默认值请在「设置 → Agent 预设」里重设。
- **同一个 preset id 只能声明一次**：若你曾在 profile 的 `cordis.patch.yml` 里手写过 `engineering` 声明行（迁移期的临时做法），必须在本 bundle 更新到本版本**之前**删掉，否则 `Duplicate agent preset: engineering` 会让声明行激活失败。
- 0.1.5 用户留在 ≤`v0.1.0` 的标签：本版本（`0.2.0`）起 `cordis.patch.yml` 不再插入安装器行，而声明行引用的 `@deepseek-ai/dsh-agent-preset` 在 ≤0.1.5 的依赖树里不存在，所以那一行只会在启动日志里留下一条 import 失败告警，preset 不会出现。（本条按 0.2 的启动审计语义推断——非 required 行失败只告警、不中断启动；未在 ≤0.1.5 上实跑。）

改完 preset 源码后的两条命令：

```sh
npm run build:preset-patch     # 重新渲染 cordis.patch.yml（改 preset/agent.cordis.yml 或 preset.yml 之后）
npm run verify:preset-patch    # 静态校验：漂移 + 方言 + specifier 解析 + 迁移陷阱
```

## 自动生效的五件事（其中一件刻意"不生效"）

| 能力 | 保障方式 |
|---|---|
| `using-superpowers` 引导 | 正文**注入**（`agent/pre-step`），每会话必达 |
| Caveman 默认 `full` 与流程产物优先级 | 同上，注入 `bootstrap.md` 的 "Caveman output style" 一节 |
| Caveman 级别定义 | **技能**保留在 catalog，按需加载 |
| **任务分档**（按规模缩放流程） | 注入 `bootstrap.md` 的 "Task sizing (harness override)" 一节，覆盖上游的无条件表述 |
| **输出语言跟随界面语言** | 插件 `preset/plugins/output-language` 注册一条 `order: -1` 的 system-prompt 段（每步重发）与一条每条用户消息后的提醒，读 host 设置 `locale.preference`（界面 `zh` 默认中文、`en` 默认英文，读不到兜底中文；覆盖思考、回复、过程旁白与流程产物） |

`Caveman 级别定义` 那行是刻意的，也是这套设计里唯一的不对称：注入**没有**宣告 `caveman` 技能已激活，反而明说 "It is NOT active yet: load it with the `skill` tool"。

为什么不对称：`using-superpowers` 是**静态引导**——它要求的行为在会话生命周期内不变，所以把整段正文注入、并禁止再次加载是安全的，也免掉了每个会话一次的工具往返。`caveman` 不同，它是**带运行时可调参数的风格规则**：级别可以在会话中途被切换，规则文本必须能从 catalog 里被重新读取。若像 bootstrap 那样把 `caveman` 的正文宣告为"已激活、勿加载"，级别切换就没有任何可达路径——模型手里只有注入时那一刻的默认值。所以注入只写**默认值与优先级**（默认 full、流程产物优先、7 个合法级别名），规则正文单份留在技能内，切换时按需加载。

同理，`/caveman` 命令本身只**宣告级别**，不重复规则文本：规则只有技能这一个家，避免两处文本漂移。

## 任务分档（按规模缩放流程）

Superpowers 全流程不再无条件施加到每个任务。注入文本里有一节 `## Task sizing (harness override)`（生成物 `preset/bootstrap.md`，源自 `scripts/build-bootstrap.sh` 的 FOOTER here-doc），按可核查的改动半径选档：

| 档 | 进入条件 | 保留 | 免掉 |
|---|---|---|---|
| **A 直接改** | ≤3 文件 且 diff ≤50 行，不碰公共契约，非不可逆 | 一行轨道声明 + 跑既有验证并引用真实输出 | brainstorming、spec、plan、子代理、TDD |
| **B 轻量** | ≤5 文件，意图无歧义 | 上述 + TDD | spec、plan、子代理 |
| **C 完整** | 其余一切 | 现状全流程 | 无 |

四族硬闸**命中即 C，与半径无关**：**G1** 不可逆或外部可见、**G2** 公共契约面、**G3** 安全与正确性高风险面、**G4** 安全网自改（删测试、关校验、改本规则或其执行机制、改安装发布链路）。此外：爆炸半径无法靠阅读确定、同时落在 ≥2 个契约类、拿不准 —— 一律 C。只升不降；用户可一句话改档（「走完整流程」/「别搞流程」）。

这一节的覆盖对象是 vendored `using-superpowers` 正文里那行 Red Flags（`| "The skill is overkill" | ... | Use it. |`）与 1% 规则 —— 上游正文逐字不改，所以覆盖物必须同为注入文本。守卫在 `scripts/task-sizing.test.mjs`：生成物含三档与四族、注入节零项目专有名词、承重覆盖句点名上游两处、persona 不再自相矛盾。

代价：`preset/bootstrap.md` **每会话注入一次**，比上一版常驻多 `1946` 字节（实测差值，见 `evidence/VERIFICATION.md`；"每会话一次"由 2026-09-22 的幂等修复保证——此前每个 claim 到输入的 step 都会重注一次）。改动**只在新建会话生效** —— bootstrap 是生成物且经符号链接安装。

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
Output-language directive: write every text you produce — your reasoning, your replies, your progress notes between tool calls, every workflow artifact (plans, specs, review comments, TDD red/green explanations, todo text), every visible field of a tool call (a shell description, a file's description, an escalation justification, a subagent's description), and every prompt or brief you hand to another agent — in 中文 (zh). This is a hard requirement, not a preference: the description fields of your tool calls are shown to the user verbatim, so write them in 中文 on every single call — not only when the surrounding command or path happens to be in 中文. A tool's own schema documents its field in English; that documents the field, it does not license an English value. Never write any of it in another language, including those tool-call fields and delegated prompts; never let a sandbox-denial message, a path, or an identifier justify switching to English for the prose around it. Keep tool names, enum values, code, identifiers, commands, file paths, and error text verbatim: never translate them.
```

**L2——每条人类用户消息之后的提醒**（`agent/pre-step`，紧跟本步 claim 到的消息；判据是**本步的批次**，不查历史，所以每个回应人类的步都会得到一条）：

```
Language: 中文 (zh). Reason, reply, narrate, and write every artifact in 中文 only — including what you put in tool-call fields and in a delegated prompt. Keep code, commands, paths, and errors verbatim.
```

**代码、标识符、命令、路径、错误原文一律不翻译**（含工具名与 `workspace-write` 这类枚举值）。注意 L1 已从约 240 字符增长到 **1102** 字符（每步重发），这是「工具字段必须本地化」的可见代价，不再是噪声级。

**范围含工具调用参数里的可见字段与交给另一个 agent 的提示词**（2026-09-23 追加）。规则点名的不只是叙述文本，还包括：`bash` / `pwsh` 的 `description`（调用树与终端卡片直接渲染它，见 `dsh-client-ui-tool/lib/client.js:883`）、`present` 的 `files[].description`、沙箱越权的 `justification`（`dsh-sandbox/lib/index.js:102` 把它拼进审批弹窗的 `reason`）、`subagent` 的 `description`、`todo_write` 的 `content`，以及 `subagent` / `subagent_fork` / `workflow` / `ralph` 的提示词正文。**不译的例外**：`command`、`file_path`、`query`/`pattern`、`url`、工具名与枚举值，以及 harness 写死的字符串（例如审批弹窗那半句 `escalate sandbox to workspace-write:`）。证据清单见 v2 spec §12。

为什么要两处（2026-09-23 实测驱动）：v1 只有一条 **user 角色**的运行时上下文行，规则文本已经点名 reasoning 与过程旁白，实测仍失守——一条 2 轮会话里思考块**首词 18/18 是英文**，剥掉引用块后思考 CJK 只有 `3.7%`（第 1 轮 `0.19%`），而可见正文 `37.3%`。诊断是投递层与近因：规则不在 system 里，且一轮英文锚定自我延续（T2 才升到 7.5%）。详见 `evidence/VERIFICATION.md` 的 2026-09-23 一节。

生效边界（实测，见 `evidence/VERIFICATION.md` 的 2026-09-18 与 2026-09-23 两节）：

- `locale.preference` 的**值**改动**热生效**——L1 下一步生效，L2 下一条生效；两条都是 provider，不做注册时快照。
- **插件 / 组合代码改动需要重启宿主**（`dsh web`）：运行中的 host 进程缓存 preset 插件模块（Node ESM 模块缓存），**只新建会话不够**。
- 安装/刷新 preset 后仍需**新建会话**（DSH 会话一旦开始不能切换模式）。
- **思考语种是提示词级引导，不是熔断**：v2 把它提到 system 层并加了每轮近因，仍不构成保证。
- **中文任务书可能降低外部代理的执行准确度**：`subagent` 若路由到 `claude-code` / `codex`，规则会要求提示词正文用界面语言。本仓库只把语言要求交给模型，不评估下游模型的语言能力；若要回退，把委派提示词从覆盖枚举里删掉即可（规则文本、测试与文档三处同步改）。
- **`settings` 服务不可达时没有界面信号**：降级静默生效（插件只 `warn` 一次），唯一判据是渲染出的文本——它会落到中文兜底那一支。
- 界面语言是 `en` 时，本规则要求**连思考也用英文**；不会跟随你自己消息的语言。

实现落在 `preset/plugins/output-language/index.js`：一个 `order: -1` 的 `systemPrompt.section`（provider 文本）+ 一个 `agent/pre-step` 监听器；插件自包含，`section()` 不可用时只丢 L1 并 warn 一次，绝不打断会话。

## 级别切换

```
/caveman              # 显示当前级别与用法
/caveman ultra        # 切到 ultra
/caveman off          # 恢复正常表达
```

合法级别共 7 个：`lite`、`full`、`ultra`、`wenyan-lite`、`wenyan-full`、`wenyan-ultra`、`off`。非法输入报错并列出全部合法值，不会静默忽略。

`/caveman` 由预设自带插件 `preset/plugins/caveman-command/` 注册。上游把它交付为 **Claude Code 的 slash command**，本 harness 没有该机制——没有注册命令时，技能里写的激活契约就是不可达的。所以这里自己实现：命令把选中的级别作为一条持久 user 消息写入会话（`source: { kind: 'plugin' }`），下一轮模型从对话里读到级别，与注入的默认值走同一条路径。

## 目录结构

```
dsh-engineering/
├── index.js                         # ≤0.1.5 的安装器插件（0.2 不再挂载它，见「harness 0.2 迁移」）
├── cordis.patch.yml                 # 生成物：0.2 的 preset 声明行（由 build-preset-patch.mjs 渲染）
├── package.json                     # 也定义 npm test（脚本与插件测试的 glob）
├── preset/                          # preset 的源码树；0.2 通过包内子路径引用其中的插件与技能
│   ├── preset.yml                   # 显示名（工程模式）、描述、排序的**源码**（渲染进 cordis.patch.yml）
│   ├── agent.cordis.yml             # 组合源码：persona + 标准工具面 + 插件 + 技能目录
│   ├── bootstrap.md                 # 生成物：using-superpowers 正文 + 工具映射 + caveman 默认
│   ├── SYNC.md                      # 生成物：各上游 commit / 版本 / 同步时间
│   ├── .manifest.json               # 生成物：逐文件 sha-256（gitignore，发布时经 files 白名单打入）
│   ├── plugins/
│   │   ├── bootstrap/               # 注入插件（agent/pre-step，幂等，压缩后自愈）
│   │   │   ├── index.js
│   │   │   ├── package.json
│   │   │   └── bootstrap.test.mjs
│   │   ├── caveman-command/         # /caveman 命令插件
│   │   │   ├── index.js
│   │   │   ├── package.json
│   │   │   └── caveman-command.test.mjs
│   │   └── output-language/         # 输出语言：system 段（order -1）+ 每条用户消息提醒
│   │       ├── index.js
│   │       ├── package.json
│   │       └── output-language.test.mjs
│   └── skills/                      # vendored：Superpowers 14 + Caveman 3 = 17 个技能
├── scripts/
│   ├── sync-superpowers-skills.sh   # 自管缓存同步 14 个技能并重打 DSH 指针
│   ├── sync-caveman-skills.sh       # 白名单同步 3 个 caveman 技能
│   ├── sync-lib.sh                  # 两个 sync 共用的 SYNC.md 写入
│   ├── build-bootstrap.sh           # 重建 bootstrap.md（带技能存在性自检）
│   ├── build-manifest.mjs           # 生成逐文件 sha-256 清单
│   ├── build-preset-patch.mjs       # 0.2：把 agent.cordis.yml + preset.yml 渲染成 cordis.patch.yml
│   ├── verify-preset-patch.mjs      # 0.2 静态层：方言解析 + 每条 specifier 解析 + 产物漂移 + 迁移陷阱
│   ├── plant-core.mjs               # ≤0.1.5 的植入引擎（link / copy 两种策略）
│   ├── install.sh                   # ≤0.1.5：投影到 ${DSH_HOME}/.agent-presets/engineering
│   ├── verify-composition.mjs       # ≤0.1.5 的第 2a 层：用 harness 自带 discoverPresets 查组合健康
│   ├── index.test.mjs               # 安装器插件测试
│   ├── plant-core.test.mjs          # 植入引擎测试
│   ├── preset-patch.test.mjs        # 0.2 守卫：产物 == 生成物，且三条改写结果都在
│   ├── caveman-default-level.test.mjs  # 三个家的默认级别 + 插件级别名 == vendored 技能
│   ├── bundle-identity.test.mjs     # 守卫：声明行指向包内子路径、旧安装器行未挂载、files 齐备
│   ├── vendored-skills.test.mjs     # 白名单 caveman 技能必须在（半同步树不得通过 npm test）
│   ├── task-sizing.test.mjs         # 守卫：自撰的 Task sizing 分档节存在且未被污染
│   └── output-language.test.mjs     # 守卫：组合挂载 output-language 行 + 插件导出面
├── docs/                            # 设计与可行性记录（含上游的 skills 撰写约定）
├── evidence/VERIFICATION.md         # 历史验证记录
└── .cache/                          # sync 自管的上游检出（gitignore，可重建）
```

## 安装 / 刷新

> **本节描述 ≤0.1.5 的目录植入通道。** harness 0.2 请走「harness 0.2 迁移」一节的 bundle 通道：
> 那里的 `cordis.patch.yml` 是生成物，而 `scripts/install.sh` 植入的 `$DSH_HOME/.agent-presets/`
> 在 0.2 上不会被任何代码读取（现象就是模式选择器里没有「工程模式」）。

```sh
scripts/build-bootstrap.sh          # 技能有变动时先跑
scripts/install.sh                  # 默认：真实目录 + 逐项符号链接（改动即时生效）
scripts/install.sh --copy           # 深拷贝（检出可能被删除的机器）
```

`install.sh` 末尾遍历 `preset/plugins/*/` 运行**每个**预设本地插件的自测（当前是 `bootstrap`、`caveman-command` 与 `output-language`），任一失败即中止安装并明确报错；某个插件缺少同名 `<name>.test.mjs` 同样直接失败——插件名单不写死，新增插件自动纳入门禁，"新增插件必须带自测"因此是门禁的一部分，避免把坏 preset 静默装到新机器上。

之后**新建**一个会话，在模式选择器里选 `工程模式`。会话一旦开始就不能切换模式（DSH 的设计），所以必须新建——安装完成后继续用旧会话是看不到的。

**改动类型决定要不要重启宿主**：preset 本地插件的**代码**改动需要重启宿主（`dsh web`）才生效——运行中的 host 进程缓存了插件模块，**只新建会话不够**；`settings` 的**值**改动是**热生效**的。两点的实测证据见「输出语言」节的生效边界。

**曾经的缺陷（已修）**：按默认 `link` 策略装完后，宿主每次启动都会打印 `engineering: preset NOT installed — destination … exists without .installed.json; refusing to touch` —— `link` 策略留下一个「真实目录 + 逐项符号链接」且**不写** `.installed.json`，而 `copy` 策略因此永远拒绝接管。现在 `copy` 会接管**纯符号链接**的目标目录（那些链接是安装器产物，不是用户数据）；只要目录里出现任何一个真实文件或子目录，拒绝照旧。回归测试见 `scripts/plant-core.test.mjs` 的 `plant copy takes over a previous link install` 与 `plant still refuses a marker-less dest mixing links with real files`。

### 通过 `dsh plugin add` 安装（bundle 通道）

```sh
dsh plugin --profile <name> add /path/to/goalizc-dsh-engineering-0.2.0.tgz   # 本地 tarball（npm pack 产物）
dsh plugin --profile <name> add github:goalizc/dsh-engineering               # GitHub
```

`dsh plugin` 必须带 `--profile`（实现上它把余下参数转发给该 profile 目录里的 pnpm），因此它能装的东西 = pnpm 能装的东西：tarball、git、本地目录都行，裸 registry 包名则需要先发布。

加进 profile **不等于**已植入：`add` 只登记 `dsh.profile.bundles` 并把 patch 层组合进去，`~/.dsh/.agent-presets/engineering/` 是**启动该 profile 时**由 `index.js` 的 `apply()` 植入的。

git 来源的检出里没有 `preset/.manifest.json`（它被 gitignore，只有 npm 打包时经 `files` 白名单带入）。植入引擎因此在文件缺失时按与生成器相同的规则现算，成功日志会追加 `(manifest computed)` 以标明走的是哪条路径。植入失败**不会**中断宿主启动，但会打印含 preset id、原始错误与排查方向的警告。

### 为什么安装成"真实目录 + 符号链接"

preset 发现用 `readdir(root, { withFileTypes: true })` 并只接受 `isDirectory()` 为真的条目。**指向目录的符号链接会被静默跳过**（`isDirectory()` 返回 false），所以不能把 `~/.dsh/.agent-presets/engineering` 直接做成指向本检出的符号链接。`install.sh` 因此创建一个真实目录，内部每个条目是符号链接——既被发现，又保持改动即时生效。

预设本地插件**自包含**：不 import 任何 harness 包（构造注入消息用 `node:crypto` 复刻 `createUserMessage` 的形状）。原因是本地创作的 preset 位于用户家目录，Node 的 `node_modules` 上行查找到不了 harness 自己的包，而 `--copy` 安装模式连链接都没有。这也是 `bootstrap/index.js` 与 `caveman-command/index.js` 各持一份**语义相同**的消息构造代码的原因——两份里 `deepFreeze` 逐字相同，`createUserMessage` 只是排版不同；不变量是**字段（`role`/`content`/`source`）、深冻结与全新 UUID**，不是字节。跨安装布局没有共享模块可用，改一处必须同 commit 改另一处。

### 从旧 id `superpowers` 升级（破坏性）

preset id 已从 `superpowers` 改为 `engineering`。**旧安装不会自己消失，也不会报错**：

- `<DSH_HOME>/.agent-presets/superpowers/` 若还在，模式选择器会同时列出**两个 `工程模式`**。旧目录的条目符号链接回同一份检出，所以它看起来一样健康、内容也一样——但刷新只写 `engineering/`，旧目录从此不再更新。
- `settings.yaml` 里的 `agent-presets.default: superpowers` 仍然解析得到（指向旧目录），所以它不会失败提醒你改名。
- 旧会话记录里的 preset 名是历史值，不改写。

清理步骤（删除用户目录是不可逆的，脚本一律不代劳）：

```sh
# 1. 确认没有别的用途后删除旧目录
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/superpowers"
# 2. 把默认值改成新 id：settings.yaml 里 agent-presets.default: engineering
```

`scripts/install.sh` 检测到同级仍存在旧 `superpowers/` 目录时会**打印上述告警**，但绝不自动删除。

## 上游同步

两个脚本都**自管缓存**，无需传入上游路径：

```sh
scripts/sync-superpowers-skills.sh   # -> .cache/superpowers，锁定 commit
scripts/sync-caveman-skills.sh       # -> .cache/caveman，锁定 commit
```

`CACHE_ROOT` 可覆盖缓存位置。**锁定 commit，不追最新分支**——同步必须可复现；`preset/SYNC.md` 记录确切 commit 与同步时间。

两个上游的 vendee 范围不同，因此两个脚本会互相补齐：

- Superpowers **拥有整棵 `skills/` 树**，所以它的同步是整体替换目录。这会顺手删掉那 3 个 caveman 技能，因此 `sync-superpowers-skills.sh` 在结束时**自动重跑 `sync-caveman-skills.sh`**，避免静默丢失。那次调用内部还会重建 `bootstrap.md` 与清单，所以一次 superpowers 同步结束时，最终的 `bootstrap.md` 一定是完成态技能树的函数。
- Caveman 是**部分 vendee**：白名单只有 `caveman`、`caveman-commit`、`caveman-review` 三个技能。上游其余部分（`LICENSING.md` 列为 Engine-linked、采用 BSL-1.1 的 `engine/`、`proxy/`、`rewriter/` 等目录）本仓库一律不再分发，细节见 `THIRD-PARTY-NOTICES.md`。

顺序上：**先同步，再 `build-bootstrap.sh`，再 `install.sh`**。

## 验证

四步，从便宜到昂贵：第 1 层在任何机器上可跑；**第 2a 层在 0.2 与 ≤0.1.5 各有自己的脚本**（都需要机器上装了对应版本的 harness）；第 2b 层需要本会话之外的探针工具；第 3 层不是自动化的。

**1. 测试（不需要 running agent，秒级）**

```sh
npm test          # 47 pass / 0 fail
```

这会先跑 `build:manifest` 重建 `preset/.manifest.json`，然后按 glob 收集全部测试：`scripts/*.test.mjs`（8 个文件：植入引擎、安装器插件、0.2 preset 声明守卫、caveman 三个家的默认级别与 vendored 技能级别名一致、白名单 caveman 技能存在性、任务分档守卫、bundle 身份守卫、输出语言守卫）以及 `preset/plugins/*/*.test.mjs`（三个插件的自测）。三个插件测试也可单独运行——它们不依赖 harness，用合成的 `ctx` 与 `pre-step` 决策驱动真正安装的监听器：

```sh
node preset/plugins/bootstrap/bootstrap.test.mjs
node preset/plugins/caveman-command/caveman-command.test.mjs
node preset/plugins/output-language/output-language.test.mjs
```

同一层还有一条不需要 harness 的静态检查——**产品名残留**（旧 id 的具体串）与上游署名：

```sh
# 代码与配置里旧 id 残留：期望无输出（git grep 只搜已跟踪文件，账本/缓存天然排除）
git grep -nE 'superpowers-bootstrap|superpowers-installer|@superpowers-dsh|Superpowers 模式|plugins/superpowers-bootstrap|destRoot/superpowers|agent-presets/superpowers|dsh-superpowers-bootstrap' \
  -- ':!docs' ':!evidence' ':!preset/skills' ':!scripts/sync-superpowers-skills.sh' ':!README.md'
# 上游署名仍在：期望 3 个文件各有命中
git grep -c 'obra/superpowers' -- README.md THIRD-PARTY-NOTICES.md preset/SYNC.md
```

排除项逐条：`docs/`、`evidence/` 是 spec §5.3 裁定冻结的历史记录（记录的是当时真实跑过的旧名命令），`preset/skills/` 是上游正文，`scripts/sync-superpowers-skills.sh` 的名字取自上游。README 需排除有**两个**原因：升级一节必须写出旧 id 才能给出迁移步骤，且**上面这条 grep 命令自身**就含被检的模式串。

bootstrap 自测断言移植契约的三条性质：首次注入一次、不重复注入、压缩丢掉后重新注入。它按**真实的 `agent/pre-step` 载荷形状**驱动（`messages` 只是本步 claim 到的增量，历史另经 `session.deriveMessages()` 建模），因此第 2 组能抓住"按本步消息去重"这个曾经的缺陷：老实现下 5 步会注入 5 次。另外覆盖跨会话各自注入一次、读不到历史时的退化为每会话一次、user 角色与 plugin 来源标记、被拒绝/被中止的步、空步、已有消息的保留顺序、消息身份新鲜与冻结。caveman 自测覆盖 7 个级别的解析往返（名字钉死字面量）、注册形状、`/caveman` 裸调用报**当前**级别且不注入、级别的按会话隔离、非法输入报错且不注入。

**2a. 组合健康（本仓库可跑，需要机器上装了 harness）**

harness **0.2**（`cordis.patch.yml` 的声明行是否可用于挂载）：

```sh
node scripts/verify-preset-patch.mjs
```

期望（六项全 OK；`dialect` 在找不到已安装 harness 的 js-yaml 时记 SKIP 而非 FAIL）：

```
  OK   drift       cordis.patch.yml 与生成物一致
  OK   dialect     YAML 方言解析通过（js-yaml @ <harness>/node_modules）
  OK   declaration id=engineering name=工程模式 order=5
  OK   specifiers  34 行全部解析得到
  OK   row-count   21 个顶层行 / 含嵌套共 34 行
  OK   porting     没有 0.1.5 → 0.2 的已知陷阱
```

它证明的是**声明可用于挂载**：产物等于生成物、YAML 合 loader 方言、每条 specifier 都解析得到（`@deepseek-ai/*` 包在 harness 依赖树里、包内 `preset/...` 文件在本包里）、没有 `'./plugins/...'` 相对行与 `worker-thread` 残留。**它不等于挂载**：不 import 任何插件、不求值行配置、不检查 realm、不断言技能目录——那些属于 2b。

活体确认（0.2）：`cordis_inspect_query` 的 `Config` provider，`name` 用 `@deepseek-ai/dsh-agent-preset`，应列出 `include:preset-engineering`；`dsh --profile <name> --dump-config-schema` 也能做同样的确认，但注意它会对**每一个** preset 声明行报 `unrecognized Loader tree carrier`（shipped 的 standard/ptc/minimal/cordis 一样报），那是投影器读不了 `config.plugins` 的已知限制，不代表声明有问题。

harness **≤0.1.5**（已植入目录的组合健康，目录机制的 2a 层）：

```sh
scripts/install.sh                                  # 或已装好旧目录
node scripts/verify-composition.mjs                 # 默认查 ${DSH_HOME:-~/.dsh}/.agent-presets
```

它调的是 harness **自己的** `discoverPresets`（与模式选择器读的是同一个名单），harness 位置由 `dsh` 启动器 / `--harness-base` / `DSH_HARNESS_BASE` 解析。期望输出：

```
roster: [{"id":"engineering","name":"工程模式","order":5,"broken":null,...}]
2a OK: "engineering" is a loadable roster row (broken: null) — every row specifier resolves.
```

`broken: null` 表示组合 YAML 合 loader 语法、每条行都能解析（`@deepseek-ai/*` 包在同一套 `node_modules` 上行查找里找得到，`./plugins/...` 相对行指向的文件存在）。在 0.2 上这个脚本会**明确报出「这份 harness 是 0.2+，目录机制的 2a 层不再适用」并退出**，而不是让你以为装坏了。

**2b. 真挂载与技能目录（残余缺口，需要用本仓库之外的探针）**

- ≤0.1.5 时代的探针（**不在本仓库、也不在 harness 包里**，见 `grep -rl sp_probe` 无命中）：`sp_probe validate=engineering` → 应得 `MOUNT OK: engineering`（`standingKeyFor` 真挂载：本地相对插件、`!!js`、技能目录、realm 全部合法）；`sp_verify preset=engineering cwd=<workspace>` → 断言该 preset 作用域下的技能目录。
- 0.2 这一层没有等价探针，只能在活体上取：`Config.listConfigs` 里 `preset-engineering` 行存在（声明已注册，`broken` 字段为空即挂载审计通过），再用一个**新建会话**验证真挂载——技能目录、`/caveman`、bootstrap 注入是否都在（这一步与第 3 层合并）。

**3. 端到端（人类验收，唯一的最终证据）**

前三步都不证明"模型真的会按这个模式行动"。那一步只能由人做：新建会话选 `工程模式`，发：

> Let's make a react todo list

期望：模型**在写任何代码之前**先加载 `brainstorming` 技能（官方完成定义里的验收用例），且回复默认即为压缩风格。随后试 `/caveman off` 与 `/caveman ultra`，观察表达风格确实变化。

**本项目目前的验证状态：第 1 层（`npm test`，47 pass）与 0.2 的 2a 层（`scripts/verify-preset-patch.mjs` 六项全 OK）实跑过；0.2 上「声明真的挂载成会话」与第 3 层尚未验证，不要当成已通过。** `evidence/VERIFICATION.md` 是 ≤0.1.5 目录机制的历史记录（含当时真实输出），不随机制变更改写。

## 设计要点

- **注入的是 user 角色消息，不是 system 消息**：符合上游 Shape B 纪律，也是 DSH 记录持久上下文的方式（`createUserMessage` + `source: { kind: 'plugin', plugin }`）。
- **幂等靠内容标记，但判据是"会话历史"，不是本步消息**：注入文本带 `<EXTREMELY_IMPORTANT>`。`agent/pre-step` 拿到的 `messages` 只是本步从 inbox claim 到的**增量**（`ReactLoopInbox.claim`），永远不含已注入的那条，所以插件改问会话自己：`agent.session.deriveMessages()` 里还有没有这个标记。曾经按"本步消息"去重的版本因此每个 claim 到输入的 step 都重注一次——一条 10 轮会话实测注入 11 次、`128282` 字符，另一条 12 轮注入 44 次、`513128` 字符。
- **压缩后自愈**：压缩的 `replace` 会把被遮蔽的节点从 `deriveMessages()` 的派生历史里删掉，标记随之消失，下一次 pre-step 自动重新注入。不需要订阅压缩事件，也不需要"该步有无输入"之外的额外条件：同一次历史读取同时回答了"在不在上下文里"和"是不是刚被压缩掉"。
- **失败姿态**：读历史整段 try/catch，读不到（会话对象形状不认识）就退化为"每个会话对象注入一次"——比按步重注好，且不阻断会话。
- **persona 段保持简短**：只在系统提示里说"你有 superpowers、先查技能、默认 caveman full"，把 9 KB 正文交给一次性注入的消息，避免每轮重复付费。persona 用 `complete: false`（它是必填字段，省略会挂载失败）。
- **不改技能正文**：唯一例外是官方允许的 Platform Adaptation 指针行（`using-superpowers/SKILL.md` 加一行 `- DeepSeek Harness: references/dsh-tools.md`）。
- **仓库规则优先**：bootstrap 末尾有专门一节声明工作区的 `AGENTS.md`/`CLAUDE.md` 与直接人类指令高于任何技能——用于压住"每任务自动提交 / 自动 push"这类与具体仓库治理冲突的通用建议。

## 已知边界

| 边界 | 说明 |
|---|---|
| 无原生 worktree 工具 | `using-git-worktrees` 只能走 `git worktree add` 回退；受文件沙箱约束时必须建在 workspace 内，被拒绝时按技能自带的降级措辞告知人类 |
| 不做 push/PR | `finishing-a-development-branch` 只做验证与选项呈现；push、建 PR、合并是人类的动作 |
| 可视化伴侣 | brainstorming 的可选本地服务器可用 `bash run_in_background` 起；但要人类自己打开 URL。遥测可用 `SUPERPOWERS_DISABLE_TELEMETRY=1` 关闭 |
| 不承诺硬性门禁 | DSH 没有能真正阻断"模型跳过技能直接写代码"的原语。本模式是强引导 + 可观察性，不是强制流程 |
| 级别切换依赖本仓库插件 | `/caveman` 是本仓库实现；上游的 slash command 形态在 DSH 不适用，删掉这个插件级别切换即失效 |
| 裸 `/caveman` 的"当前级别"只在进程内记得 | 级别按会话存在插件的内存里（`invocation.agent.id` 为键），重启/新进程后裸 `/caveman` 回落显示默认 `full`（显示层缺口）。更实质的一条：级别公告是**普通会话历史**，压缩若把它折掉，模型上下文里的级别随之丢失，而重新注入的 bootstrap 会再断言默认 `full` —— 即级别只持久到压缩为止。要彻底闭合需把当前级别一并重新注入，本仓库刻意未做 |
| 上游同步是手动的 | 没有定时任务也没有 CI：运行两个 sync 脚本，然后 `build-bootstrap.sh` 与 `install.sh` |
| "选了工程模式"不等于"会话跑在工程模式" | DSH 的新会话页把预设挑选**暂存在客户端**，落到"下一个成为当前会话的空白会话"上（转录里体现为 `agent-preset/selected` 事件）。所以 transcript header 的 `agentPreset` 只是**创建时**的默认值，可被该事件覆盖；判据要看会话头部的模式标签、或转录里的 `agent-preset/selected` 与 bootstrap 标记。实测：235 个会话中 5 个带该事件，其中一条 header 写 `engineering` 的会话实际跑在 `cordis`（创造模式）上——没有 bootstrap 注入，也没有语言规则，表现就是"过程全英文" |

## 上游与许可

- Superpowers：MIT，© 2025 Jesse Vincent / Prime Radiant，<https://github.com/obra/superpowers>，v6.1.1（commit `d884ae04edebef577e82ff7c4e143debd0bbec99`）
- Caveman：MIT，© 2026 Julius Brussee，<https://github.com/JuliusBrussee/caveman>，2.6.0（commit `15581d14007fd01fb3f132016741962f34936ca2`）
- `preset/skills/**` 是上游内容的原样 vendored 副本，差异清单、范围与许可全文见 `THIRD-PARTY-NOTICES.md`；确切 commit 与同步时间见 `preset/SYNC.md`。
