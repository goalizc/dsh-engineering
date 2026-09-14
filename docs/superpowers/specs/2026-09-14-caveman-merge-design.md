# Caveman 技能并入 Superpowers 模式 设计

> **日期**: 2026-09-14
> **状态**: 设计定稿(范围已收窄)
> **范围**: 把 caveman 的 3 个自包含纯规则技能 vendored 进 superpowers preset,让 DSH 的 Superpowers 模式下可直接使用 caveman 的极简压缩风格,并建立可维护的向上游同步机制。

## 背景与目标

superpowers-dsh 把 obra/superpowers 的 skills 打包成 DSH 的 agent preset(`~/.dsh/.agent-presets/superpowers`), 由注入引擎 `plant-core` 分发, 经 `skill-filesystem` 让 `skill` 工具按名加载。

**caveman**(`https://github.com/JuliusBrussee/caveman`) 是一个 token 压缩代理技能集:"why use many token when few do trick"。本设计把其中**脱离 Caveman 生态后仍自包含可用、且有通用价值**的 3 个技能并入 Superpowers 模式, 让用户在一种模式下兼具 superpowers 的严谨流程与 caveman 的低 token 表达。

**成功判据**:
1. 并入技能能被 `skill` 工具按名加载(如 `/caveman`、`/caveman-commit`), 无需改注册逻辑。
2. caveman 压缩风格与 superpowers 流程不打架: 常规对话简洁化, 流程产出保持结构化。
3. 换机后 `install.sh`/bundle 一次装好, 技能随 preset 落地。
4. 上游 caveman 技能更新时, 有脚本可跟进。

## 方案选择

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. vendored 技能并入现有模式(本设计)** | 3 个纯规则技能拷入 `preset/skills/`, skill-filesystem 自动收集 | ✅ 采用 |
| B. 复用 bundle 引擎做独立 Caveman 模式 | `plant-core` + 独立 preset 打包 | ❌ 用户选定合并进现有模式, 不做独立模式 |
| C. 仅写指南文档让用户自行 `npx skills add` | 不落代码 | ❌ 用户要并入, 非文档化 |

## 架构

```
repo/preset/skills/
  ├── brainstorming/ ... writing-skills/     # superpowers 现有 14 技能(不动)
  └── caveman/                               # 新 vendored, 与上游目录同名
      ├── caveman/           # 主压缩风格技能
      ├── caveman-commit/    # Conventional Commits 消息
      └── caveman-review/    # 压缩式代码评审
```

- **收集**: `agent.cordis.yml` 的 `skill-filesystem.customSkillDirs` 已指向 `preset/skills/`, 新目录自动被收集, 不修改注册逻辑。
- **注入声明**: `agent.cordis.yml` 的 `persona.prefix` 追加 Caveman 调和声明(见下)。
- **构建**: `build-bootstrap.sh` 自检新增 3 个技能目录存在断言; `build-manifest.mjs` 重算 hash(自动)。
- **分发**: `install.sh` / bundle 经由 `plant-core` 把 `preset/skills/caveman*` 落地, 原样工作。

## 组件清单

| 文件 | 变更 | 责任 |
|---|---|---|
| `preset/skills/caveman/` `preset/skills/caveman-commit/` `preset/skills/caveman-review/` | 新增(vendored) | 技能规则, 内容取自上游, 不改 frontmatter |
| `preset/agent.cordis.yml` (`persona.prefix`) | 修改 | 追加 Caveman 调和声明 |
| `scripts/build-bootstrap.sh` | 修改 | 自检新增 3 个技能目录存在断言 |
| `scripts/sync-caveman-skills.sh` | 新增 | 从上游拉取 3 个技能目录到 `preset/skills/` |
| `preset/.manifest.json` | 重建(构建产物, 不入 git) | 逐文件 hash 清单, plant 升级比对用 |
| `docs/superpowers/plans/...` | 新增 | 实施计划(writing-plans 产出) |

## 风格调和(关键决策)

caveman 主技能默认"持久会话全程压缩", 与 superpowers 的严谨流程方法论冲突。调和策略 = **默认 lite + 流程产出不休**。

在 `persona.prefix` 追加:
> 常规工程对话与实现说明用简洁风格(caveman lite)——去客套、保留技术实体, 不损坏结构。
> superpowers 流程产物——计划(plan)、规格(spec)、设计、评审意见、TDD 红绿循环说明、动手前澄清——**保持完整、结构化、优先于压缩**。
> 显式 `/caveman full|ultra|off` 可调整强度, `/caveman-commit`、`/caveman-review` 可分别触发达相应输出。

## 技能范围(并入清单)

仅并入 **3 个自包含纯规则技能**(已逐一读全文核实):

| 技能 | 实质 | 生态外可用性 |
|---|---|---|
| `caveman` | 极简压缩风格(full/lite/ultra + 文言文 wenyan), 保留全部技术实体 | ✅ 纯规则, 完全可用 |
| `caveman-commit` | Conventional Commits 规范, ≤50 字 subject, 必要的 body 边界 | ✅ 纯规则, 完全可用 |
| `caveman-review` | 压缩式评审, 每条一行为 `L42: 🔴 bug: ...` | ✅ 纯规则, 完全可用 |

**排除**(已逐一读全文核实):
- `caveman-stats` —— 由 `hooks/caveman-stats.js`/tracker 钩子交付(`decision:"block"`), 读 session log; DSH 无此钩子, 空壳。
- `caveman-manage` —— 操作 Caveman Cloud 的 MCP/CLI 实验生命周期; 无云即无对象, 空壳。
- `caveman-optimize` —— 读 Caveman Cloud 的 report-only observations/profile; 无云即无报告, 空壳。
- `caveman-discover` —— 给 Caveman 网关打 `x-cave-workflow` 标签; 无网关则标签无载体, 空壳。
- `caveman-compress` —— 依赖本机 `python3 -m scripts` + Claude API, 非纯规则。
- `caveman-explore`/`caveman-learn` —— 依赖特定 harness 的 sub-agent/CLI 机制。
- `caveman-setup` —— 指向 caveman 的 `gw/w/<app>` 网关, DSH 无该设施。
- `caveman-evidence-review`/`cavecrew` —— 半依赖(CLI 回退 / 自带 subagents)。
- 档 3 native(`investigate-first`/`lean-build`/`migration`/`safe-refactor`/`surgical-patch`/`verify-and-stop`) —— 依赖内置 sub-agents, 与 superpowers 方法论重叠。
- `caveman-help` —— 速查卡引用未并入的 `caveman-compress`, 主要为 caveman 语法档服务, 未选入。

**名字冲突**: 3 个技能名与 superpowers 现有 14 个零重叠(已核对 `preset/skills/` 列表)。

## 数据流与触发

```
preset/skills/caveman*  --build-bootstrap.sh--> 自检验证存在
                       --build-manifest.mjs--> 重算 .manifest.json
install.sh / bundle    --plant-core copy/link--> ~/.dsh/.agent-presets/superpowers/skills/caveman*
DSH 会话启动           --skill 工具--> 列出技能名
                       --persona 声明--> agent 默认 lite 风格 + 流程产物不休
```

## 同步机制

新增 `scripts/sync-caveman-skills.sh`, 与既有 `sync-superpowers-skills.sh` 风格一致:
- 从上游 `https://github.com/JuliusBrussee/caveman` 拉取 **3 个白名单目录**(`caveman`、`caveman-commit`、`caveman-review`)覆盖到 `preset/skills/<id>/`。
- 同步后调用 `build-bootstrap.sh` 联动重算清单(复用现有尾部 `build-manifest` 调用)。
- 只同步白名单目录, 不同步其它(沿用 superpowers sync 的整目录替换 + 白名单保护理念; 防止把上游空壳技能同步进来)。

> 说明: 上游以 `skills/<id>/{SKILL.md,README.md}` 结构组织, 与 superpowers preset 的 `skills/<id>/{SKILL.md,...}` 结构一致, 可直接对拷。

## 错误处理与测试

- **build-bootstrap.sh 自检**: 在既有 section 断言循环后, 增加对 3 个 `preset/skills/{caveman,caveman-commit,caveman-review}/SKILL.md` 存在性的检查, 缺失即非零退出——防止 sync/误删后静默丢失技能(与 `dsh-tools.md` 误删教训一致)。
- **冲突**: 3 个技能名已核对与现有 14 个无重叠; 若未来上游改名, sync 脚本按目录名同步, build 自检会暴露缺失。
- **单测**: 技能为纯数据, 不新增 `node --test` 用例; 维持现有 11 例。
- **端到端**: install 后断言 `~/.dsh/.agent-presets/superpowers/skills/caveman/SKILL.md` 及 `caveman-commit` 等落地; 用临时 `DSH_HOME` 跑 `plant-core` copy/link 两分支。

## 安全与边界

- 仅并入纯规则技能文件; 不引入 caveman 的 proxy/engine(MIT 技能 vs BSL 运行时, 不碰 BSL)。
- 不改技能 frontmatter 与正文; vendored 内容与上游保持一致, 便于 diff 与 sync。
- 不修改 `skill-filesystem` 注册逻辑, 保持现有 preset 自包含理念。