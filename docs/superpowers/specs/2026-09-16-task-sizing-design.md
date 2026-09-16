# 设计：任务分档（Task sizing）—— 按规模缩放 Superpowers 流程

日期：2026-09-16
状态：待实施（本文件是 spec，实施计划由 `writing-plans` 产出）

## 1. 问题

当前模式把 Superpowers 全流程施加到**每一个**任务上，与任务规模无关。实际后果：

- 改一行 README 也要走 brainstorming → spec → plan → 子代理驱动开发 → TDD → 评审。
- 流程产物（spec 文档、plan 文档、子代理派发与回收）是主要成本项，turn 数与 token 消耗与改动规模完全脱钩。
- 用户明确提出的诉求：**严重拖慢工作进度以及消耗 token**。

根因不是某个技能写错了，而是三处共同作用，且**每一处都是无条件表述**：

| 位置 | 内容 |
|---|---|
| `preset/skills/using-superpowers/SKILL.md:47` | Red Flags 表：`\| "The skill is overkill" \| Simple things become complex. Use it. \|` —— 直接封死"按规模降档"这一判断 |
| `preset/skills/using-superpowers/SKILL.md`（注入正文） | 1% 规则与 "NO CHOICE"：任何任务都要先查技能并加载 |
| `preset/agent.cordis.yml` persona | `Skills are mandatory workflows, not suggestions.` |

再叠加 `brainstorming` 的 description（`You MUST use this before any creative work`）与 `writing-plans`（`Use when you have ... a multi-step task`）的触发面，任何任务都会从 spec 起跑。

整库检索确认：**不存在任何按任务规模分级的机制**。`trivial`/`small`/`overkill` 一类词的命中只有上面那行"禁止判断过重"。

## 2. 约束（决定了落点）

1. **上游技能正文逐字 vendored，不改写**（移植契约，见 README）。因此不能在 `SKILL.md` 里加判据。
2. 被覆盖的文本是**每会话注入**的。覆盖物必须与它同处一个注入信封，否则在决策那一刻仍然输。
3. `preset/bootstrap.md` 是**生成物**，由 `scripts/build-bootstrap.sh` 组装（HEADER here-doc + vendored `using-superpowers` 正文 + vendored 工具映射 + FOOTER here-doc）。手改生成物会被下次构建冲掉。
4. 现有 `## Repository rules outrank these skills`（同脚本 FOOTER 内）已是"自著小节覆盖上游技能"的先例，本设计沿用该先例，不新造机制。
5. 注入文本进入**任意工作区**，因此规则必须是**通用的**：不得出现本仓库专有名词（`cordis.patch.yml`、`.manifest.json`、`preset/` 等）。

## 3. 目标与非目标

**目标**

- 三档流程，按可核查的半径门限与硬闸选择。
- 小改动不再产生 spec/plan 文档与子代理派发，省下主要成本项。
- 验证证据在**任何**档位都不可跳。
- 规则通用、判据可核查、且**不能给自己开后门**（改规则本身必进最严档）。
- 判据随注入文本一起防漂移（有测试守）。

**非目标**

- 不改动任何 vendored 技能正文，也不缩短现有注入正文（不放宽 `using-superpowers` 的注入范围）。
- 不新增技能、不新增命令（如 `/track`）——YAGNI。
- 不动 preset id、显示名、bundle 形态、安装布局。
- 不引入按项目配置的门限文件；项目规则通过既有的 precedence 通道（`AGENTS.md`/`CLAUDE.md`/用户指令）覆盖默认值。

## 4. 轨道定义

**改动半径** = 本任务修改的文件数（新增/删除/编辑各计一个）。**diff 行数** = `git diff --numstat` 的「新增 + 删除」之和（非 git 项目按实际计数）。**由工具自动重写的生成物照常计入**半径与行数，不设豁免——多一条豁免就多一个可自我放宽的口子。动手前按预计判档，收尾按实际复核；复核超出即在收尾声明里升档并说明。

| 档 | 进入条件 |
|---|---|
| **A 直接改** | 半径 ≤3 文件 **且** diff ≤50 行 **且** 不触碰公共契约 **且** 非不可逆 |
| **B 轻量** | 半径 ≤5 文件；意图无歧义（不需要在多个方案间取舍） |
| **C 完整** | 其余一切 |

B 档**不设行数上限**（用户决定）。取舍：一个 5 文件但改动量很大的任务仍走轻量档；爆炸半径由 G 族硬闸兜底，不额外引入"整文件重写/新子系统"这类模糊判据。若日后证明这个口子太宽，再加定性约束，并同步改注入文本与守卫测试。

### 4.1 硬闸（命中即 C，与半径无关）

硬闸是**升档触发器**，不是禁止清单：命中只是带上流程，不是不能做。

- **G1 不可逆 / 外部可见**：删数据或删文件、schema 迁移、格式转换、发布（发包/推镜像/打 tag）、改写已推送历史、`force push`、开 PR、推分支、对外发消息、调外部 API 产生副作用、改本机共享状态（用户目录、全局配置）、花钱或配额。
- **G2 公共契约面**：对外 API 面、可执行入口（CLI 命令与参数、脚本入口名、环境变量名）、数据格式与 schema、跨进程与网络形状（HTTP 路由、请求响应形状、RPC、消息格式）、配置键与默认值语义、发布元数据与安装布局、项目文档（`AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING`/架构文档）声明的边界。**不改变签名但改变既有行为**（默认值、错误码、排序、精度、空值语义）同样算契约变更。
  - 判定问句：改了它，**本模块之外的人或代码**会不会被迫跟着改？会 → 命中。
  - 明确不算契约面：模块内部私有函数与局部变量、注释与排版、测试内部实现、未导出类型、仅本文件使用的常量、文档措辞、日志文案、无副作用的内部重命名。
- **G3 安全与正确性高风险面**：认证、鉴权、权限位、密钥与凭据、加密、沙箱与文件策略、输入校验、注入面；并发与事务边界、锁与顺序、重试与幂等、资源释放、超时。这类改动 diff 常常极小（一行放开校验），因此不能靠行数过滤。
- **G4 安全网自改**：删除/弱化/跳过测试、断言、校验或 CI 步骤；改本规则本身或其执行机制（bootstrap 注入、persona、`build-bootstrap.sh` 的 self-check）；改安装与发布链路（植入引擎、清单、同步脚本）。

### 4.2 闭合规则

- **C1** 命中任意 G → C 档
- **C2** 判定不了 → C 档。信号：需要超过 2–3 次读才能确定爆炸半径、工作区不熟悉、依赖信息在仓库外
- **C3** 同一任务落在 ≥2 个契约类（硬闸 G2 与"跨子系统"）→ C 档
- **C4** 拿不准就取更高档，并说明为什么拿不准；**只升不降**
- **C5** 项目规则（`AGENTS.md`/`CLAUDE.md`）或用户直接指令可覆盖以上默认

## 5. 各档流程与全档不变量

| 档 | 保留 | 免掉 |
|---|---|---|
| **A 直接改** | 一行轨道声明；改完跑项目既有验证命令并引用真实输出 | brainstorming、spec 文档、plan 文档、子代理（SDD）、TDD |
| **B 轻量** | 轨道声明；TDD（先写失败测试再实现）；跑验证并引用真实输出 | spec 文档、plan 文档、子代理（SDD） |
| **C 完整** | 现状全流程：brainstorming → spec → plan → SDD/TDD → review → verification | 无 |

A 档通常不加载任何技能，因此不出现 "Using [skill] to ..." 宣告。A 档**不等于**少读上下文：仍要读相关文件再动手，它只免掉流程产物。

**全档不变量（任何档不可跳）**

1. **验证证据**：宣称完成/修好/通过之前，必须实跑命令并引用真实输出。A 档也不豁免。项目没有测试或验证命令时，跑最接近的可用检查（构建、语法检查、类型检查、可执行烟测），并明确说明跑了什么、没跑什么。
2. **轨道声明**：动手前一行声明档位与理由，例如 `Track B — 3 files, private helper only`。
3. **只升不降**：中途出现超出门限的事实，立即声明升档并给出触发事实；已进入的档不得下调。
4. **用户优先**：用户说「走完整流程」强制 C，说「别搞流程」强制 A（不变量 1 仍生效）。
5. **不可逆操作**永远要书面计划 + 人工确认，与档位无关。

## 6. 落点

### 6.1 注入节（`scripts/build-bootstrap.sh` 的 FOOTER here-doc，置于 `## Repository rules take precedence` 之前）

英文，与注入信封同语言。逐字草案：

```md
## Task sizing (harness override)

This section overrides the "1% chance" rule, the "The skill is overkill" Red
Flags row, and every skill description that reads as unconditional. Process
scales with the task. Declare the track in one line before touching code, e.g.
`Track B — 3 files, private helper only`.

| Track | Enter when |
|---|---|
| A direct | radius ≤3 files, diff ≤50 lines, no contract face, nothing irreversible |
| B light | radius ≤5 files, intent unambiguous |
| C full | everything else |

Any of these forces C, at any radius:

- **G1** irreversible or externally visible: delete, migrate, publish, tag,
  rewrite pushed history, force push, open a PR, spend.
- **G2** contract face: public API, entry points, data format, network shape,
  config keys, release metadata, or a boundary the project's own docs declare —
  including a behaviour change to one. Private helpers, comments, formatting,
  test internals and locals are not contract faces.
- **G3** security or correctness surface: auth, secrets, permissions, crypto,
  sandbox, validation, concurrency, transactions, retries, resource release.
- **G4** weakening the safety net: skipping or deleting tests, disabling checks,
  editing this rule or its enforcement, editing the install or release path.

Also C when the blast radius cannot be established by inspection, when two or
more contract faces are touched, or when in doubt.

Per track: **A** — no brainstorming, no spec, no plan, no subagents, no TDD.
**B** — TDD, but no spec, no plan, no subagents. **C** — the full flow. In every
track: run the project's own verification commands and quote real output before
claiming success — if the project has none, run the closest available check and
say what you ran; never downgrade mid-task; when a new fact forces an upgrade,
announce it with that fact. A workspace's instruction files or a direct user
instruction may retune the thresholds.
```

**通用性要求（可核查）**：该节不得出现 `cordis.patch.yml`、`.manifest.json`、`preset/`、`engineering` 等本仓库专有名词。本仓库如何实例化这些闸只记录在本文件 §8，不注入。

**两处定义的关系（避免双份规格）**：§4.1 是**权威完整定义**（含全部举例与排除项）；注入节是它的**紧凑子集**——只保留四族名与关键条目，删掉举例，语义必须与 §4.1 一致。任何一方改动都要同步另一方，并由 §6.4 的测试 1 守住"注入节仍含四族标签"。

### 6.2 persona（`preset/agent.cordis.yml`）

`Skills are mandatory workflows, not suggestions. Process skills come first (brainstorming, systematic-debugging), then implementation skills.` 改为按档位生效并指向注入节，例如：

```
Skills are mandatory workflows scaled by task size — see the injected
"Task sizing" section; pick the track before touching code. On track C, process
skills come first (brainstorming, systematic-debugging), then implementation
skills.
```

理由：persona 与注入节若不一致，注入节赢在"更近"，但 persona 的绝对句仍会制造矛盾；且已有一个测试证明 persona 会独立漂移（`the composition persona states the same default level`）。

### 6.3 `scripts/build-bootstrap.sh`

1. FOOTER 加 §6.1 的节。
2. `scripts/build-bootstrap.sh:74` 的 self-check pattern 列表加 3 条：`Task sizing`、`G4`、`never downgrade`。这一条让"未来 sync 或误删把该节冲掉"直接变成构建失败。

### 6.4 新增 `scripts/task-sizing.test.mjs`

沿用本仓库"跨文件重复值的守卫"风格（见 `scripts/caveman-default-level.test.mjs`），3 个测试：

1. 生成物 `preset/bootstrap.md` 含三档表与 G1–G4 四族标签；失败信息指向 FOOTER 与重跑 `scripts/build-bootstrap.sh`。
2. 注入节**显式点名**覆盖 Red Flags 的 overkill 行与 1% 规则。这是承重句：没有它，vendored 正文的无条件表述仍然赢。
3. persona 已按档位生效，且旧的无条件句**不再存在**（断言旧句缺失）。

### 6.5 文档与记录

- `README.md`：「自动生效的三件事」表升为四件；新增轨道一节（三档 + 硬闸摘要），并写明每会话常驻成本。
- `evidence/VERIFICATION.md`：追加本次复验节（命令、真实输出、退出码）。
- 生成物：`preset/bootstrap.md`、`preset/.manifest.json`（bootstrap 哈希变化）。

### 6.6 生效边界

`preset/bootstrap.md` 是生成物，经 `scripts/install.sh` 以符号链接安装到 `${DSH_HOME}/.agent-presets/engineering/`。改动**只在新建会话生效**，当前既有会话看不到。README 已有同类结论（编辑组合或 bootstrap 需重启/新建会话），本次在 spec 与 VERIFICATION 里再记一次，避免被误判为"没生效"。

## 7. 验证策略

1. `bash scripts/build-bootstrap.sh` → 打印新的 `built ... (N bytes, M lines)`；self-check（含 3 条新 pattern）通过。
2. `npm test` → 预期 `pass 21`、`fail 0`（现有 18 + 新 3）。
3. **反向取证**：逐条临时删掉对应文本，确认对应用例转红（记录命令、真实输出、退出码），再还原。三条断言都要证明有牙。
4. `node scripts/verify-composition.mjs` → `2a OK: "engineering" is a loadable roster row (broken: null)`。
5. 漂移检查：重跑 build 后 `git diff --exit-code preset/bootstrap.md` 无输出（生成物与脚本一致）。
6. 体量记录：`preset/bootstrap.md` 前后 bytes/lines 差值写入 `evidence/VERIFICATION.md`，作为每会话常驻成本。

## 8. 本仓库的实例化（仅供文档，不注入）

- **G4** 恰好覆盖本仓库的核心面：`scripts/build-bootstrap.sh` 的 FOOTER 与 self-check、`preset/agent.cordis.yml` 的 persona、安装/发布链路（`scripts/install.sh`、`plant-core.mjs`、`build-manifest.mjs`、sync 脚本）。**本设计自身的改动命中 G4**，因此它走 C 档——规则没有给自己开后门，这一点在评审时应当被检验。
- **G2** 在本仓库的对应物：`package.json` 的 `name`/`repository`/`files`、`cordis.patch.yml` 的 `name` 行、`preset/preset.yml` 的 id/显示名/order、`preset/agent.cordis.yml` 的组合行、`preset/.manifest.json` 的键集合形状、`preset/plugins/*` 的对外导出与 `<name>.test.mjs` 文件名、`preset/skills/` 的白名单构成、`scripts/install.sh` 的安装布局。
- **G4 的例外说明**：本规则不试图用测试证明"模型会遵守档位"——那不可测。可测的是**规则的文本在生成物里存在、承重覆盖句存在、persona 不再自相矛盾**，也就是 §6.4 的三条。

## 9. 成本

预计注入节约 30 行：`preset/bootstrap.md` 从 9783 bytes / 192 行涨到约 11.7 KB / 222 行，即每会话常驻多约 450–500 token。实施后记录实测差值。

**可选精简版**（若嫌贵）：去掉 `Track B — ...` 那个格式例子与 G 族内的举例，约减 8 行；代价是闸的判据变抽象、执行稳定性下降。默认不做。

## 10. 风险与取舍

| 风险 | 处置 |
|---|---|
| 注入节被未来 sync 或误删冲掉 | `build-bootstrap.sh` self-check 增 pattern（§6.3）+ 守卫测试（§6.4 测试 1） |
| 承重覆盖句被弱化成"又一次建议" | §6.4 测试 2 显式断言它点名了 Red Flags 行与 1% 规则 |
| persona 与注入节再次不一致 | §6.4 测试 3 断言旧无条件句缺失 |
| 规则被写死成本仓库 | §6.1 通用性要求（零专有名词），评审时逐词检查 |
| B 档无行数上限导致大改动走轻量档 | 已知取舍，用户已确认；爆炸半径由 G 族兜底；若日后暴露问题再加定性约束并同步测试 |
| 档位被自我放宽（模型给自己降档） | C4 只升不降 + 用户可一句话改档 + 档位声明强制出现在动手前 |

## 11. 验收（DoD）

1. `preset/bootstrap.md` 含 `## Task sizing (harness override)` 节，三档表与 G1–G4 齐备，且**不含本仓库专有名词**（对注入节文本 grep 断言）。
2. `npm test` → `pass 21`、`fail 0`。
3. 三条新断言各有反向取证记录（临时删文本 → 转红 → 还原）。
4. `bash scripts/build-bootstrap.sh` 幂等：重跑后 `git diff --exit-code preset/bootstrap.md` 无输出；self-check 通过。
5. `node scripts/verify-composition.mjs` → `2a OK`。
6. `preset/agent.cordis.yml` persona 指向注入节，旧无条件句已不存在。
7. `README.md` 与 `evidence/VERIFICATION.md` 已更新，含实测体量差值。
8. 本仓库自身文档记录了 G2/G4 的实例化与"本设计命中 G4 → C 档"的自证。

## 12. 参考

- `preset/skills/using-superpowers/SKILL.md:41-58`（Red Flags 表，含 `:47` 的 overkill 行）
- `scripts/build-bootstrap.sh:26-70`（组装：HEADER / vendored 正文 / vendored 工具映射 / FOOTER）、`:74`（self-check pattern 列表）
- `preset/agent.cordis.yml`（persona 段）
- `scripts/caveman-default-level.test.mjs`（守卫测试风格）
- `README.md`（"自动生效的三件事"、移植契约、生效边界）
