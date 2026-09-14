# Caveman 技能并入 Superpowers 模式 设计

> **日期**: 2026-09-14
> **状态**: 设计定稿
> **范围**: 把 caveman 的核心纯规则技能 vendored 进 superpowers preset,让 DSH 的 Superpowers 模式下可直接使用 caveman 的极简压缩风格,并建立可维护的向上游同步机制。

## 背景与目标

superpowers-dsh 把 obra/superpowers 的 skills 打包成 DSH 的 agent preset(`~/.dsh/.agent-presets/superpowers`), 由注入引擎 `plant-core` 分发, 经 `skill-filesystem` 让 `skill` 工具按名加载。

**caveman**(`https://github.com/JuliusBrussee/caveman`) 是一个 token 压缩代理技能:"why use many token when few do trick"。其核心是一只纯规则 `SKILL.md`, 让 agent 以极简风格作答, 保留全部技术实体。本设计把 caveman 的有价值技能并入 Superpowers 模式, 让用户在同一种模式下既能用 superpowers 的严谨流程方法论, 又能享受 caveman 的低 token 表达。

**成功判据**:
1. 并入的技能能被 `skill` 工具按名加载(如 `/caveman`、`/caveman-help`), 无需改注册逻辑。
2. caveman 压缩风格与 superpowers 流程不打架: 常规对话简洁化, 流程产出保持结构化。
3. 换机后 `install.sh`/bundle 一次装好, 技能随 preset 落地。
4. 上游 caveman 技能更新时, 有脚本可跟进。

## 方案选择

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. vendored 技能并入现有模式(本设计)** | 8 个纯规则技能拷入 `preset/skills/`, skill-filesystem 自动收集 | ✅ 采用 |
| B. 复用 bundle 引擎做独立 Caveman 模式 | `plant-core` + 独立 preset 打包 | ❌ 用户选定合并进现有模式, 不做独立模式 |
| C. 仅写指南文档让用户自行 `npx skills add` | 不落代码 | ❌ 用户要并入, 非文档化 |

## 架构

```
repo/preset/skills/
  ├── brainstorming/ ... writing-skills/     # superpowers 现有 14 技能(不动)
  └── caveman/
      ├── caveman/           # 主压缩风格技能
      ├── caveman-commit/
      ├── caveman-review/
      ├── caveman-stats/
      ├── caveman-help/
      ├── caveman-manage/
      ├── caveman-optimize/
      └── caveman-discover/
```

- **收集**: `agent.cordis.yml` 的 `skill-filesystem.customSkillDirs` 已指向 `preset/skills/`, 新目录自动被收集, 不修改注册逻辑。
- **注入声明**: `agent.cordis.yml` 的 `persona.prefix` 追加 Caveman 调和声明(见下)。
- **构建**: `build-bootstrap.sh` 自检新增 8 个技能目录存在断言; `build-manifest.mjs` 重算 hash(自动, 无需新逻辑)。
- **分发**: `install.sh` / bundle 经由 `plant-core` 把 `preset/skills/caveman*` 落地到目标, 原样工作。

## 组件清单

| 文件 | 变更 | 责任 |
|---|---|---|
| `preset/skills/caveman*/` (8 目录) | 新增(vendored) | 技能规则, 内容取自上游, 不改 frontmatter |
| `preset/agent.cordis.yml` (`persona.prefix`) | 修改 | 追加 Caveman 调和声明 |
| `scripts/build-bootstrap.sh` | 修改 | 自检新增 8 个技能目录存在断言 |
| `scripts/sync-caveman-skills.sh` | 新增 | 从上游拉取 8 个技能目录到 `preset/skills/` |
| `preset/.manifest.json` | 重建(构建产物, 不入 git) | 逐文件 hash 清单, plant 升级比对用 |
| `docs/superpowers/plans/...` | 新增 | 实施计划(writing-plans 产出) |

## 风格调和(关键决策)

caveman 主技能默认"持久会话全程压缩", 与 superpowers 的严谨流程方法论冲突。调和策略 = **默认 lite + 流程产出不休**。

在 `persona.prefix` 追加:
> 常规工程对话与实现说明用简洁风格(caveman lite)——去客套、保留技术实体, 不损坏结构。
> superpowers 流程产物——计划(plan)、规格(spec)、设计、评审意见、TDD 红绿循环说明、动手前澄清——**保持完整、结构化、优先于压缩**。
> 显式 `/caveman full|ultra|off` 可调整强度, `/caveman-help` 查看速查。

原则: caveman 只压缩"说话方式", 不压缩"工程产物"; 与流程文档冲突时, 流程优先。

## 技能范围(并入清单)

仅并入 **8 个纯规则技能**(已逐一核查, 自包含、无外部运行时依赖):

`caveman`(主) · `caveman-commit` · `caveman-review` · `caveman-stats` · `caveman-help` · `caveman-manage` · `caveman-optimize` · `caveman-discover`

**排除**(已核查原因):
- `caveman-compress` —— 依赖本机 `python3 -m scripts` + Claude API, 非纯规则, DSH 无此链路。
- `caveman-explore`/`caveman-learn` —— 依赖特定 harness 的 sub-agent/CLI 机制。
- `caveman-setup` —— 教你指向 caveman 的 `gw/w/<app>` 网关, DSH 无该设施, 搬入不可用。
- `caveman-evidence-review` —— 主体方法论但含 CLI fallback, 属半依赖, 本期不搬。
- `cavecrew` —— 委派子代理 `cavecrew-*`, 依赖其自带 `agents/`, 属半依赖, 本期不搬。
- 档 3 native 技能(`investigate-first`/`lean-build`/`migration`/`safe-refactor`/`surgical-patch`/`verify-and-stop`) —— 依赖内置 sub-agents 与 superpowers 方法论重叠, 不搬。

**名字冲突**: 8 个技能名与 superpowers 现有 14 个零重叠(已核对 `preset/skills/` 列表)。

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
- 从上游 `https://github.com/JuliusBrussee/caveman` 拉取这 8 个技能目录(`skills/<id>/`)覆盖到 `preset/skills/<id>/`。
- 同步后调用 `build-bootstrap.sh` 联动重算清单(复用现有尾部 `build-manifest` 调用)。
- 只同步 8 个白名单目录, 不同步其它(沿用 superpowers sync 的整目录替换 + 白名单保护理念)。

> 说明: 上游以 `skills/<id>/{SKILL.md,README.md}` 结构组织, 与 superpowers preset 的 `skills/<id>/{SKILL.md,...}` 结构一致, 可直接对拷。

## 错误处理与测试

- **build-bootstrap.sh 自检**: 在既有 section 断言循环后, 增加对 8 个 `preset/skills/caveman*/SKILL.md` 存在性的检查, 缺失即非零退出——防止 sync/误删后静默丢失技能(与 `dsh-tools.md` 误删教训一致)。
- **冲突**: 8 个技能名已核对与现有 14 个无重叠; 若未来上游改名, sync 脚本按目录名同步, build 自检会暴露缺失。
- **单测**: 技能为纯数据, 不新增 `node --test` 用例; 维持现有 11 例。
- **端到端**: install 后断言 `~/.dsh/.agent-presets/superpowers/skills/caveman/SKILL.md` 及 `caveman-help` 等落地; 用临时 `DSH_HOME` 跑 `plant-core` copy/link 两分支。

## 安全与边界

- 仅并入纯规则技能文件; 不引入 caveman 的 proxy/engine(MIT 技能 vs BSL 运行时, 不碰 BSL)。
- 不改技能 frontmatter 与正文; vendored 内容与上游保持一致, 便于 diff 与 sync。
- 不修改 `skill-filesystem` 注册逻辑, 保持现有 preset 自包含理念。