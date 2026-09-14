# 工程模式：caveman 激活机制 + 项目改名 + 上游缓存 —— 设计

| 项 | 值 |
|---|---|
| 日期 | 2026-09-14 |
| 状态 | 设计已确认，待实施 |
| 动因 | (1) caveman 从不在会话中被激活；(2) 项目已超出"superpowers 技能包"的定位；(3) sync 脚本依赖人工传入上游检出路径 |

## 1. 问题陈述

三个诉求合并为一次改动，因为它们共享同一批文件（`bootstrap.md`、`agent.cordis.yml` 的 persona、`README.md`、`preset.yml`）。

### 1.1 caveman 从不自动激活（实测确认）

persona 注入（`preset/agent.cordis.yml:39`）声明：

> For routine engineering chat and implementation notes, answer concisely (caveman lite)

而 caveman 技能的 catalog 触发描述（`preset/skills/caveman/SKILL.md` frontmatter）为：

> Use for /caveman, "caveman mode", "talk like caveman", "be brief" or "less tokens"

**"routine engineering chat" 不在触发词列表里**。persona 命令模型采用该风格，但技能 catalog 中无对应条目，模型无理由加载该技能。因此技能正文（含 `lite`/`full`/`ultra` 全部级别规则）从未进入上下文——persona 引用的 "caveman lite" 是一个没有定义的术语。

**这不是 DSH 缺陷**：会话 transcript 证明 caveman 与用户提问同一轮送达（`rec=1158`，时间 2026-09-14T10:29:50.083Z）。是集成侧的声明与机制不符。

### 1.2 级别切换通道根本不存在

caveman 技能声明的切换语法是 `/caveman lite|full|ultra|wenyan-*|off`。上游通过 **Claude Code slash command** 提供它（`.tmp-caveman/commands/caveman.toml`）。

DSH 只有 `dsh-command-compact`、`dsh-command-feedback`、`dsh-command-goal` 三个命令插件，且**技能级 `/名` 手势不存在**（`dsh-tool-skill` 类型定义中 grep `slash|/name|user-invoc` 无命中）。

**结论：persona 中 `Tune with /caveman full|ultra|off` 是空头承诺，纯自然语言也未被验证可用。**

### 1.3 项目名与内容不符

实测内容：**17 个 vendored 技能**，来源两个上游（`obra/superpowers` + `JuliusBrussee/caveman`），另有 bundle 安装器、sha-256 清单、白名单同步脚本。`superpowers-dsh` 与 `Superpowers 模式` 已不能描述该项目。

### 1.4 上游获取依赖人工路径

`sync-superpowers-skills.sh <path>` 与 `sync-caveman-skills.sh <path>` 都要求调用者准备并维护上游检出。

### 1.5 血缘留痕不对等

`preset/SYNC.md` 只记录 superpowers 上游 commit（`d884ae0`），**未记录 caveman 上游**。3 个 vendored 技能的来源 commit 无留痕。

## 2. 上游评估结论（caveman 适用性）

对 vendored 内容做的深度评估，作为保留该依赖的依据。

| 维度 | 结论 | 证据 |
|---|---|---|
| **独立性** | ✅ 强 | 3 个技能对生态零外部依赖：grep `engine\|mcp\|registry\|hooks/\|bin/\|cavecrew\|optimize\|discover\|evidence\|explore\|learn\|setup\|stats\|manage\|verbs\|compile` 无命中。唯一 `/` 引用是级别语法 |
| **同步状态** | ✅ 无漂移 | 上游 HEAD `15581d14007fd01fb3f132016741962f34936ca2`（2026-09-07），3 个技能目录 `diff -rq` 逐字节一致 |
| **排除判断** | ✅ 正确 | 上游 `skills/` 共 22 个技能 + 构建系统（`engine/`、`registry.json`、`compile.mjs`、`verbs-gate.mjs`、`generated/{claude,codex,gemini,...}`）。排除的 16 个（`caveman-stats` 需 hooks、`caveman-manage` 需云、`cavecrew`/`caveman-optimize` 等）确实绑生态 |
| **适用性** | ⚠️ 有保留 | `caveman` **不在**上游 `preserved_skill_ids`（该表为 `cavecrew, caveman-commit, caveman-compress, caveman-help, caveman-review, caveman-stats`）。它是 `native-core.md` 生成的 native pack 产物，上游重构可能改其形态 |
| **功能完整性** | ⚠️ 有缺口 | 见 §1.2：切换通道缺失 |

**保留决定**：`caveman-commit`、`caveman-review` 是 preserved skill，稳定；`caveman` 虽为生成产物，但当前与上游一致且自包含，可用。上游形态变更的风险由"锁 commit + SYNC.md 留痕"覆盖。

## 3. 方案选择记录

| 议题 | 选项 | 决定 | 理由 |
|---|---|---|---|
| 自动激活强度 | A 内联注入 / B 指令强制加载 / C 只改触发词 | **A** | B 每会话多一次 skill 调用；C 仍不是"自动"，只是提高概率 |
| 注入内容 | A1 内联完整正文 / A2 只注入默认与优先级 | **A2** | 见 §4.1 的关键约束 |
| 切换通道 | 1 自然语言 / 2 真 `/caveman` 命令 / 3 不支持 | **2**（并保留 1 作为补充） | 契约已取证实测可行，且自然语言未被验证 |
| 上游获取 | A 脚本自管缓存 / B submodule / C 只补 SYNC.md | **A** | 见 §6 |
| preset ID | 不改 / 连改 | **连改** | 用户决定 |
| 显示名 | — | **`工程模式`** | 用户决定 |
| `docs/superpowers/` 路径 | 改 / 不改 | **不改** | 见 §5.3 |

## 4. 激活机制设计

### 4.1 关键约束：不得宣告技能"已激活"

现有 bootstrap 的 `using-superpowers` 段开头写着：

> It is ALREADY ACTIVE: do not try to load `using-superpowers` again

**caveman 不能照抄这个模式。** `using-superpowers` 是一次性 bootstrap；caveman 是**带运行时可调参数的风格规则**。若把它的正文内联并宣告"已激活、勿加载"，那么用户切换级别时模型不会去 `skill` 调用，也就拿不到级别契约——这会复现 §1.1 的同型错误（声明与机制不符）。

**因此**：caveman 技能**保留在 catalog**，注入只写默认值与优先级。

### 4.2 bootstrap.md 新增一节

由 `scripts/build-bootstrap.sh` 的 FOOTER 段加入（该文件是生成物，禁止手改）：

```markdown
## Caveman output style

Default compression level: **full**. Terse like smart caveman — all technical
substance stays, only fluff dies.

Superpowers workflow artifacts — plans, specs, designs, review comments, TDD
red/green explanations, pre-edit clarifications — stay complete, structured,
and take priority over compression.

The `caveman` skill holds the level definitions. It is NOT active yet: load it
with the `skill` tool when the user changes the level, or when you need the full
rule set. Levels: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra, off.
```

**要点**：
- 显式写 `It is NOT active yet` —— 这是与 §4.1 约束对应的反面声明，保证技能可被加载
- 级别定义不复制，只列名字，正文单份维护在技能内
- 流程产物优先级写进注入，与 persona 表达一致

### 4.3 persona 修正

`preset/agent.cordis.yml:39` 现文引用了一个未定义的术语并承诺一个不存在的命令。改为与新机制一致：陈述默认 full、流程产物优先、切换方式为 `/caveman` 命令或自然语言。

### 4.4 自动使用的含义界定

"本模式使用时自动使用 superpowers 和 caveman"落地为：

| 技能 | 自动程度 | 机制 |
|---|---|---|
| `using-superpowers` | 正文内联注入，全程生效 | 既有插件（`agent/pre-step`），必达 |
| `caveman` 的**默认 full 与优先级** | 注入，全程生效 | 同上，§4.2 |
| `caveman` 的**级别定义** | 保留在 catalog，按需加载 | `skill` 工具 |

即：**默认风格自动生效；级别切换按需加载规则。** 后者不可内联，理由见 §4.1。

## 5. 改名设计

### 5.1 映射

| 类别 | 原值 | 新值 |
|---|---|---|
| preset ID | `superpowers` | **`engineering`** |
| 显示名 | `Superpowers 模式` | **`工程模式`** |
| 插件目录 | `preset/plugins/superpowers-bootstrap/` | **`preset/plugins/bootstrap/`** |
| npm 包名 | `@superpowers-dsh/superpowers-dsh` | `@engineering-dsh/engineering-dsh` |
| 仓库名 | `superpowers-dsh` | `engineering-dsh`（GitHub 侧为人类动作） |

### 5.2 必须改的文件（实测 26 处出现产品名）

`index.js`、`cordis.patch.yml`、`package.json`、`preset/preset.yml`、`preset/agent.cordis.yml`、`preset/bootstrap.md`（生成物，重建）、`preset/SYNC.md`、`README.md`、`THIRD-PARTY-NOTICES.md`、`scripts/{install.sh,build-bootstrap.sh,plant-core.mjs,sync-superpowers-skills.sh,index.test.mjs,plant-core.test.mjs}`、`preset/plugins/*/{index.js,package.json,selftest.mjs}`、`preset/.manifest.json`（生成物）

以上为**产品名**出现处。另有两份**历史文档**含旧名，处理方式不同（见 §5.3）：`docs/feasibility-report.md`、`evidence/VERIFICATION.md` 只加状态说明，不改正文。

### 5.3 明确不改

| 项 | 理由 |
|---|---|
| 上游名（`obra/superpowers`、`JuliusBrussee/caveman`、`Superpowers 技能`） | 是事实陈述，改了就是不实 |
| `docs/superpowers/{specs,plans}` | 上游写作规范定的产物路径，硬编码在 `writing-plans/SKILL.md:18`、`brainstorming/SKILL.md:29`。改了技能仍会往旧路径写 |
| `preset/skills/` 下 17 个技能目录名 | 是上游技能名（`using-superpowers` 等），非产品名 |
| `docs/feasibility-report.md`、`evidence/VERIFICATION.md` 中的旧名 | **历史记录，冻结不改**。这两份记录的是"当时以 `superpowers` 之名落地并实测通过"的事实，其中 `$DSH_HOME/.agent-presets/superpowers`、`sp_probe validate=superpowers` 是**当时真实跑过的命令与输出**。改写它们等于伪造证据，而这两份文件的立身之本正是"命令可复现" |
| `.cache/` | 本地产物，可重建（§6.2） |

历史文档的处理：在其正文顶部加一行**状态说明**（不改正文），指明该记录成文于改名之前，`superpowers` 现名 `engineering`。这样既保真，又不误导读者。

### 5.4 破坏性影响（需知悉）

- 现有安装目录 `~/.dsh/.agent-presets/superpowers/` 须重装为 `engineering/`
- `settings.yaml` 的 `agent-presets.default: superpowers` 将失效，须改为 `engineering`
- 旧会话记录中的 preset 名成为历史值
- 历史提交不改写（改名是新提交）

## 6. 上游获取：脚本自管缓存

### 6.1 为何否决 submodule

实测与推理结论：

1. **挂载点受限**：submodule 只能挂仓库根。上游根是 `skills/caveman/` 之上，我们要的是其**子目录**内容。故只能挂在第三处（如 `vendor/caveman/`），**再复制**到 `preset/skills/<id>`——复制步骤无法消除，收益仅是把"上游在哪"从参数变成 git 元数据。
2. **"自动 pull 到最新"损害可复现性**：上游破坏性改动会静默进入；且与 superpowers 现有"锁 commit + SYNC.md 留痕"的治理不一致。
3. **新克隆摩擦**：需 `--recursive`，否则 `preset/skills/caveman*` 为空目录——而空技能目录是**静默失败**，不报错。
4. **体积**：caveman `.git` 6.4M，而实际需要的内容仅 40K（3 个技能目录）。

### 6.2 采用方案

两个 sync 脚本去掉路径参数，自管缓存：

```
.cache/superpowers/    # 脚本自动 clone/fetch，checkout 锁定 commit
.cache/caveman/        # 同上
```

- `.cache/` 写入 `.gitignore`（与 `preset/node_modules/`、`preset/.manifest.json` 同类：本地产物、可重建）
- **仍锁 commit**：superpowers `d884ae04edebef577e82ff7c4e143debd0bbec99`，caveman `15581d14007fd01fb3f132016741962f34936ca2`
- 锁定的 commit 集中声明在脚本头部，作为唯一事实来源
- 保留可选参数以覆盖缓存位置（便于离线或自定义检出）

### 6.3 SYNC.md 补齐

新增 caveman 段：上游 URL、锁定 commit、日期、同步时间。与 superpowers 段对等。**该文件是生成物**，由 sync 脚本写入。

## 7. 真 `/caveman` 命令

### 7.1 契约（取自 `dsh-command-goal` 实测）

```js
export const name = 'command-caveman'
export const inject = ['commands']
export function apply(ctx) {
  ctx.commands.register({
    name: 'caveman',
    description: 'set output compression level',
    input: { hint: '[lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off]' },
    handler: (invocation) => { /* 返回 {kind:'success'|'error', text} */ },
  })
}
```

### 7.2 行为

| 输入 | 行为 |
|---|---|
| `/caveman` | 显示当前级别与用法 |
| `/caveman <level>` | 校验级别名；注入一条 user 消息声明新级别；返回确认 |
| `/caveman <非法值>` | 返回 `{kind:'error'}`，列出合法级别 |
| `/caveman off` | 恢复正常风格 |

**级别定义不在命令插件内重复**：命令只传递"当前级别 = X"，正文规则仍由 caveman 技能单份维护。

### 7.3 挂载

在 `preset/agent.cordis.yml` 增加一行预设相对行（参照既有 `./plugins/superpowers-bootstrap/index.js` 的写法），置于 `command-goal` 附近。

## 8. 验证（完成的定义）

```sh
# 改名生效
sp_probe validate=engineering                      # 期望 MOUNT OK
grep -c "^name: 工程模式" preset/preset.yml          # 期望 1

# 产品名无遗留
# 排除项逐条对应 §5.3 的"明确不改"，且用精确路径而非松散子串，避免误报：
#   - 上游仓库引用与技能名（obra/superpowers、using-superpowers 等）
#   - 上游写作规范定的产物路径（docs/superpowers/）
#   - 上游同步脚本名（其名称取自上游）
grep -rn "superpowers" --include=* . \
  | grep -v "^\./\.git/" \
  | grep -v "^\./\.cache/" \
  | grep -v "^\./preset/skills/" \
  | grep -v "^\./docs/superpowers/" \
  | grep -v "obra/superpowers" \
  | grep -v "^\./docs/feasibility-report\.md" \
  | grep -v "^\./evidence/VERIFICATION\.md" \
  | grep -v "^\./scripts/sync-superpowers-skills\.sh"   # 期望：无产品名遗留

# 注入正确
grep -c "Caveman output style" preset/bootstrap.md   # 期望 1
grep -c "It is NOT active yet" preset/bootstrap.md   # 期望 1（§4.1 约束）

# 缓存无参数可用
scripts/sync-caveman-skills.sh                       # 期望成功，无参数
cat .cache/caveman/.git/HEAD 2>/dev/null || true
git check-ignore -v .cache                           # 期望命中 .gitignore

# 回归
npm test                                             # 期望 15 passed
node preset/plugins/bootstrap/bootstrap.test.mjs     # 期望 selftest OK
```

**人工验收（唯一能证明激活生效的步骤）**：新建会话选 `工程模式`，观察 (a) 回复默认即为 full 级压缩；(b) 输入 `/caveman off` 后风格恢复；(c) 输入 `/caveman ultra` 后风格加强。

## 8bis. 执行后勘误（本节为实施回填，非原始设计）

实施与评审过程中，本节原先的若干断言被实测证伪。如实记录，使本文档可复现。

**E1 — §8 验证清单的四处不准**

| 原文 | 实测 | 处置 |
|---|---|---|
| `npm test` 期望 `11 passed` | 改名并收编插件自测后为 **15 pass / 0 fail** | 已就地更正为 15 |
| `node preset/plugins/bootstrap/selftest.mjs` | 该文件已按 §5.1 的重命名计划改为 `bootstrap.test.mjs` | 已就地更正 |
| 上半段 `grep -rn "superpowers" --include=*` 期望"无产品名遗留" | **按构造不可达**：会计入被 gitignore 的 `.superpowers/sdd/**` 账本，并匹配大量合法上游名（`using-superpowers`、`superpowers:<skill>`、`You have superpowers.`）、上游产物路径 `docs/superpowers/` 与生成物 | 见 E2 |
| 第 2 层"需要探针"隐含只有探针一条路 | **低估**：harness 自带的 `discoverPresets` 组合健康检查在本仓库可跑，且实测通过 | 见 E3 |

**E2 — 替代 §8 的改名断言（实测干净）**

```sh
# 只搜已追踪文件：git grep 天然排除 gitignored 的账本与 manifest
git grep -n "@superpowers-dsh\|superpowers-dsh\|Superpowers 模式\|superpowers-installer\|superpowers-bootstrap" -- . \
  | grep -v "^docs/superpowers/" | grep -v "^preset/skills/" | grep -v "^preset/bootstrap.md" \
  | grep -v "^preset/SYNC.md" | grep -v "^THIRD-PARTY-NOTICES.md" \
  | grep -v "^docs/feasibility-report.md" | grep -v "^evidence/VERIFICATION.md"   # 期望 exit=1

# 反向断言：上游署名必须存活 —— 改名若抹掉署名是缺陷，不是成功
git grep -c "obra/superpowers" -- README.md THIRD-PARTY-NOTICES.md preset/SYNC.md   # 期望各非零
```

**E3 — 第 2 层拆成 2a 与 2b，其中 2a 在本仓库可自动化**

- **2a（可跑，已实测）**：harness 自带的 roster 健康检查 `discoverPresets([{path:'<tmp>/.agent-presets', trust:'user'}], <已安装 dsh-agent-presets 的 baseUrl>)`。它解析组合的 YAML 方言、跑 `entryListProblem`、并解析**每一行**的 specifier。实测对本设计产出的 link 布局返回 `[{id:"engineering", name:"工程模式", order:5, broken:null}]`。
- **2b（残余缺口）**：真正的 `standingKeyFor` 挂载（realm 合法性、`inject` 激活、`!!js` 求值）。无探针时不可跑；风险小（与既有 `command-goal` 行同形、不发布服务、首次会话启动即响亮失败）。
- **第 3 层（端到端）**：`/caveman ultra` 是否真的改变风格。**零执行证据**。可行路径已探明：`headless` 是随发行提供的 profile 模板，配合可写的 `DSH_HOME` 与 `agent-presets.default: engineering`，一次模型调用即可。属人类验收。

**E4 — 设计文档未预见的实现期约束（两条，均为实测所得）**

1. **预设本地插件不得 `import` 任何 `@deepseek-ai/*` 包。** 实测：从检出目录解析 `@deepseek-ai/dsh-llm` 失败（`ERR_MODULE_NOT_FOUND`）；只有**已安装**的 preset 才有 `node_modules` 符号链接，而 `--copy` 安装模式根本没有该链接。故消息对象须用 `node:crypto` 自行构造。§7.1 的示例代码未说明这一点。
2. **`invocation.agent.followup(message: UserMessage): void`** 是命令把内容送进对话的唯一通道（依据 `dsh-command-goal/lib/index.js:97-106`），且需要真正的 `UserMessage` 对象——这印证了上一条。

**E5 — 上游获取决策的执行期教训（submodule 的否决理由已被实测加强）**

§6.1 否决 submodule 的判断正确。执行期另有一条与本文档无关的教训需注意：若改用 subtree，浅克隆参考仓库不可用（`git subtree add` 会执行自己的 `git fetch`，git 拒绝更新浅克隆的根），且祖先提交的树必须与目标前缀对齐。该教训属 git 纳管任务线（`docs/superpowers/{specs,plans}/2026-09-12-*`），此处仅作交叉引用，避免误记入本文档。


## 9. 人类动作（不由本设计执行）

- GitHub 仓库改名（若要做）
- 重装 preset 并更新 `settings.yaml` 的 `agent-presets.default`
- `git push`
