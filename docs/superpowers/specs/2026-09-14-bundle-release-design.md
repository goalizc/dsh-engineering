# superpowers-dsh bundle 发布设计

日期：2026-09-14
状态：已批准（brainstorming 收敛）

## 背景与目标

superpowers-dsh 已把 Superpowers 适配为 DSH 的一个 agent preset（`Superpowers 模式`），bootstrap 插件已改造成自包含、跨机器可移植。本规范的目标：把它发布成一个 DSH **插件 bundle**，让用户用一条 `dsh plugin add` 就装上这个模式。

官方约束与事实基础（前期调研确认）：

- DSH 官方明确 bundle **不能注册 agent-preset root**；`composeProfile` 会在最后组合 `agent-presets` 行并钉死 `roots`。因此"把 preset 目录种进用户可写 preset 根"是唯一正路（`dsh-programming-mode` 已验证）。
- bundle = 含 `dsh.bundle` manifest + `cordis.patch.yml` 的 npm 包，`dsh plugin --profile <name> add <pkg>` 安装。
- 现在 preset 已自包含（bootstrap 插件不 import harness 任何包），比 `dsh-programming-mode` 的"包名引用插件"架构更利于分发：preset 植入后完全自足，bundle 只负责"种目录"这一件事。

## 范围与验收

- 范围：新增 bundle 分发骨架（根 `package.json`、`index.js`、`cordis.patch.yml`）、共享植入引擎（`scripts/plant-core.mjs`）、manifest 构建器（`scripts/build-manifest.mjs`），改造 `scripts/install.sh` 调共享核心。不动 `preset/skills` 内容与现有注入插件逻辑。
- 验收：`pnpm pack` 产 tgz → `dsh plugin --profile <新 profile> add ./xxx.tgz` 在本地真实跑通（模式出现 + 插件 selftest 通过）。**本轮不做真实 npm publish**（需用户后定 scope 并自行触发）。

## 关键设计决策（已批准）

1. **仓库根建 bundle + 共享植入核心**：`scripts/install.sh`（本地链路）与 bundle installer 共用一份 JS plant 引擎，避免双维护。
2. **逐文件 hash 清单版戳**：bundle 附 `.manifest.json`（每个 preset 文件的 sha-256），升级逐文件三态判定，实现"只补不删"，且 `bootstrap.md` 等内容更新**不依赖包版本 bump**。
3. **本轮验收到本地 pack+add 端到端**，不真正发布 npm。

## 组件清单

| 文件 | 角色 | 状态 |
|---|---|---|
| `scripts/plant-core.mjs` | 共享植入引擎；自包含 ESM；导出 `plant()` 并暴露 CLI | 新增 |
| `scripts/build-manifest.mjs` | 扫 `preset/` 生成 `.manifest.json` | 新增 |
| `scripts/build-bootstrap.sh` | 尾部追加 manifest 生成步骤 | 改造 |
| `index.js` | bundle 安装器入口；`apply()` 时调 plant-core 植入 preset | 新增 |
| `cordis.patch.yml` | insert 一行安装器 `{id: superpowers-installer, name: '@<scope>/superpowers-dsh'}` | 新增 |
| 根 `package.json` | 发布态：`files:[preset,index.js,cordis.patch.yml,scripts/plant-core.mjs]`，`dsh.bundle`、`type:module`、`main` | 新增 |
| `scripts/install.sh` | 改调 plant-core（`--policy link`） | 改造 |

## 植入策略双分支

plant-core 按 `policy` 分支：

- `--policy copy`：bundle installer 用；深拷贝到 `~/.dsh/.agent-presets/superpowers`，逐文件走 manifest 规则。
- `--policy link`：本地 `install.sh` 用；保留"真实目录 + 逐项符号链接"的即时生效特性。

同一份核心、两种策略，消除"共享会牺牲即时生效"的张力。

## 版戳与保守升级（manifest 三态）

- bundle 携带 `.manifest.json`（每个 preset 文件的 sha-256，即"新 bundle 版本"）。首次植入写入 `.installed.json`，记录"我们落下时每个文件当时的 bundle hash"（`installed`）。
- 升级逐文件做三元比对（`current`=用户磁盘当前 hash，`installed`=上次落下时的 bundle hash，`new`=本次 bundle hash）：
  - `current == new` → 已就位，跳过；
  - `current == installed` → 用户未动、仅包更新 → 落新 bundle 版；
  - 其余（`current` 与 `installed`/`new` 都不相等）→ 用户改过 → **保留用户版**。
- 增量文件（在 `new` 而不在 `installed`）→ 落 bundle 版；被移除项（在 `installed` 而不再在 `new`）→ 默认保留用户版（只补不删）。
- 结论：`bootstrap.md` 等内容更新，只要用户没改就能随 bundle 推送、无需 bump 包版本；用户改过则不被覆盖。
- 目标目录无 `.installed.json`（非本工具植入）→ **拒绝触碰**并警告，不覆盖可能是手写的同名 preset。
- 卸载：不在 bundle 内提供删除钩子（避免误删）；README 给 `rm -rf ~/.dsh/.agent-presets/superpowers`。

## 错误处理

- `.manifest.json` 缺失 → 安装器报错退出（不应发生：build 已生成并随 `files` 打包）。
- 植入中断 → 写临时目录后 `rename` 原子替换，避免半写目录。
- 导入/日志失败 → 记录一次、本会话不阻塞（沿用注入插件"读失败降级"的既有策略）。

## 测试与验证

- 单测：`plant()` 分支（planted / unchanged / updated / partial / skipped）+ 原子替换 + manifest 缺失路径。
- 端到端（验收）：`pnpm pack` → `dsh plugin --profile <新> add ./xxx.tgz` → 模式出现、selftest 通过。

## 开放项（不由本轮落地）

- npm scope / 包名：真正发布前由用户确定；本轮本地验证先用占位 scope。
- 真实 `npm publish`：验收后由用户提供账号并触发。