# 设计：将 superpowers-dsh 纳入 git 管理

| 项 | 值 |
|---|---|
| 日期 | 2026-09-12 |
| 目标仓库 | `$REPO` |
| 状态 | 设计已确认，待实施 |
| 动机 | 该目录此前**不是** git 仓库（无 `.git`、无 `.gitignore`），需要一个可公开推送的版本历史 |

## 1. 目标与成功标准

让本仓库成为可版本管理、可公开推送到 GitHub、且不泄露本机信息、不违反上游许可的 git 仓库。

成功标准（即 §7 的验证清单）：

1. `git status` 干净，所有应追踪文件已入库；
2. `preset/node_modules/` **零追踪**；
3. 仓库内**无本机绝对路径残留**；
4. `preset/skills/` 与上游 v6.1.1 的差异仅限已知的两处 DSH 改动；
5. 脱敏与入库**不影响运行时**——插件自测仍通过。

## 2. 环境约束（实测，非假设）

这些约束决定了设计的形状，全部经过实测：

| 约束 | 证据 | 影响 |
|---|---|---|
| `~/.dsh` 挂载为**只读** | `findmnt` → `ext4 ro,nosuid,nodev` | 本会话无法运行 `install.sh`；但已安装的 preset 是由符号链接指回本 workspace，故本仓库的编辑仍然生效 |
| Windows 盘符挂载（`/mnt/*`）均为**只读** | `findmnt` → `9p ro,...` | 无法在外部建 worktree 或备份镜像 |
| 无 `~/.gitconfig`，无全局 `user.*` | `git config --list --show-origin` 空 | 必须设置**仓库局部**身份 |
| 无 GitHub 凭据 | 无 credential helper 配置 | 本会话**不能** `git push`；只准备 remote 与步骤 |
| `git subtree` 可用 | `git subtree add` 实测 EXIT=0 | 虽然 `git subtree --help` 因无 man 而失败，但子命令本身正常 |
| `~/.dsh/.agent-presets` 不可写 | `touch` → "只读文件系统" | 安装投影不由本仓库版本化 |

## 3. 仓库边界

### 3.1 追踪

约 60 个文件 / 420KB：

- `README.md`
- `docs/`（含本设计文档）
- `evidence/`
- `preset/{preset.yml,agent.cordis.yml,bootstrap.md,SYNC.md}`
- `preset/plugins/superpowers-bootstrap/`（3 文件）
- `preset/skills/`（49 文件，经 §4 的 subtree 导入）
- `scripts/`（3 文件）
- `.gitignore`、`LICENSE`、`THIRD-PARTY-NOTICES.md`

### 3.2 忽略

```gitignore
# 机器本地的符号链接：指向 harness 安装树的依赖，他机为死链；install.sh 重建
preset/node_modules/

# 探针与临时 checkout
.tmp-*/
```

`preset/node_modules` 的真实结构：目录 `preset/node_modules/` 内只有一个符号链接 `@deepseek-ai`，指向 `/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`（即已安装 harness 的依赖树，属主 `nobody:nobody`）。它与 README 第 23、44 行的描述一致，**无需修正文档**。忽略它的理由是它指向仓库之外、机器本地、换机即失效。

> 勘误：本设计早期版本曾断言该目录是"真实目录 + 240 条符号链接"、并据此计划修正 README 的"过期描述"。该结论源于 `ls` 在尾斜杠下**跟随符号链接**导致的误读，已实测否定。

### 3.3 明确不追踪

- `~/.dsh/.agent-presets/superpowers`：只读挂载上的安装投影，仅为指向本仓库的符号链接。

## 4. skills 的血统策略：子树提升快照 subtree

### 4.1 为什么不是 submodule

`preset/skills/` 与上游 v6.1.1 **仅两处不同**：

```
只在 preset/skills/using-superpowers/references 中存在：dsh-tools.md   （88 行工具映射）
preset/skills/using-superpowers/SKILL.md 第 59 行多出：
  - DeepSeek Harness: `references/dsh-tools.md`                        （Platform Adaptation 指针行）
```

其余 13 个技能及全部脚本、参考文件与上游**逐字节一致**。

submodule 要求内容保持未修改，而这两处 DSH 改动**恰好住在 `skills/using-superpowers/` 内部**，无法外挂到子模块之外。采用 submodule 就必须放弃它们——而 `dsh-tools.md` 正是 bootstrap 明确要求模型读取的工具映射，移植契约的核心交付物。此外 submodule 的挂载路径即根路径，取 `preset/skills/` 还需改动 `agent.cordis.yml` 的 `customSkillDirs` 解析。故**否决 submodule**。

### 4.2 为什么用子树提升快照

subtree 的合并只依赖一个祖先提交，不需要上游全部历史。实测：

| | 完整历史 | 子树提升快照（选中） |
|---|---|---|
| 体量 | 276.72 MiB / 7,920 commits | 约 1.3 MB（仅 v6.1.1 可达历史） |
| 树一致性 | v6.1.1 | 提升后树与 `v6.1.1:skills` 子树**逐文件相同**（48 文件，已验） |

**两条路线均已实测否决**：

1. **浅克隆快照**：`git subtree add` 会对参考仓库执行自己的 `git fetch`，而 git 拒绝更新浅克隆的根（`拒绝 refs/tags/v6.1.1 因为浅克隆的根不允许被更新` → `致命错误：需要一个单独的版本`）。故参考仓库必须**非浅**。
2. **`git filter-branch --subdirectory-filter`**：本会话实测**静默无效**——退出码 0，但树仍是整仓 172 文件。不采用。

### 4.3 导入做法（已实测跑通）

关键点：**subtree 祖先提交的树必须与目标前缀对齐**。上游 `skills/` 是子目录，而目标是 `preset/skills/`；若直接以整仓为祖先，会把整棵 v6.1.1 树（172 文件）灌进 `preset/skills/`，技能被多套一层变成 `preset/skills/skills/…`（实测发生过）。因此必须先把子树**提升为根**再导入：

1. 取上游 v6.1.1 到**非浅**本地快照仓库（`.tmp-snap/`，已忽略）；
2. `git subtree split --prefix=skills -b promoted` —— 把 `skills/` 提升为根，得到树内容等于上游 `skills/`（48 文件）的分支；
3. `git subtree add --prefix=preset/skills .tmp-snap promoted -m "…"`；
4. 将两处 DSH 改动作为**普通提交**叠加（subtree 与 submodule 不同，允许本地补丁）；
5. 快照仓库导入后删除，不污染工作区。

日后同步同构：重新 fetch 新版本 → 重新 `subtree split` → `git subtree pull`。该链路（add → 上游更新 → 重新 split → pull）已在废弃仓库中**端到端实测通过**。

## 5. 提交结构

四个提交，按子系统切分，便于 `git log` 阅读与单独回退：

1. `chore: 初始化仓库（.gitignore）`
2. `chore: 添加 MIT 许可与第三方声明`
3. `feat: 导入 preset 组合、插件与脚本（skills 经 subtree）`
4. `docs: 纳入可行性报告、验证记录、README 与本设计`

**（原第 4 个提交"修正 README 过期描述"已删除）**：实测证明 README 对该结构的描述是正确的，不存在需要修正的缺陷。凭空"修正"一份准确的文档会引入错误。

提交信息使用中文，与本仓库既有文档语言一致。

## 6. 脱敏（公开推送的前提）

`docs/feasibility-report.md`、`evidence/VERIFICATION.md`、`preset/SYNC.md` 中的本机信息占位符化，并在文件头加一行说明。技术内容一字不改，保留这些文件"命令可复现"的承诺。

| 原值 | 替换为 | 出现处 |
|---|---|---|
| `$REPO` | `$REPO` | 报告与验证记录 |
| `$HOME/.dsh` | `$DSH_HOME` | 报告与验证记录 |
| `/mnt/e/project/superpowers` | `$UPSTREAM` | 报告（5 行 / 8 次）与 SYNC.md（1 处） |
| `http://127.0.0.1:3080` | `$DSH_WEB_URL` | 报告 |

密钥扫描结果：**干净**。`sk-*`、`api_key`、`secret`、`password`、`PRIVATE KEY` 均无命中（仅 `tokenMeter`／"省 token" 两处误报）。

## 7. 许可合规

现状缺口：本仓库无 `LICENSE`，`preset/skills/` 内也无上游许可全文，只有 README 末尾一行署名。公开分发 MIT 代码应随附许可与版权声明。

- `LICENSE`：本仓库自身采用 **MIT**，版权行 `Copyright (c) 2026 goalizc`。选择 MIT 而非"保留所有权利"的理由：本仓库的实质内容（`preset/skills/**`）已是 MIT，且项目 README 明确定位为可复用的移植实现；若采用更严格的许可，会与"上游内容按 MIT 分发"的既有事实产生授权层级上的混乱。
- `THIRD-PARTY-NOTICES.md`：声明 `preset/skills/**` 源自 [obra/superpowers](https://github.com/obra/superpowers) v6.1.1（commit `d884ae04edebef577e82ff7c4e143debd0bbec99`），附上游 MIT 全文与 `Copyright (c) 2025 Jesse Vincent`（上游 `LICENSE` 共 21 行，已取回原文）。

## 8. 错误处理与失败模式

| 失败模式 | 处理 |
|---|---|
| subtree 快照 tree 不匹配上游 | 导入前强制比对 tree hash，不一致即中止 |
| `.tmp-*/` 残留进索引 | `.gitignore` 覆盖，且 §9 验证含零追踪断言 |
| 脱敏漏改导致路径外泄 | §9 用 `git grep` 断言零命中 |
| 误提交 `preset/node_modules` | §9 用 `git ls-files` 断言零命中 |
| 无凭据无法推送 | 明确列为**人类动作**，本设计只配置 remote 与步骤 |

## 9. 验证（完成的定义）

```sh
git status --porcelain                 # 期望：空
git ls-files | wc -l                   # 期望：约 62
git ls-files preset/node_modules | wc -l   # 期望：0
git grep -n "/home/[a-z]\|/mnt/[a-z]/" -- README.md docs/feasibility-report.md evidence preset scripts   # 期望：无输出
diff -rq <上游v6.1.1>/skills preset/skills  # 期望：仅两处已知差异
node preset/plugins/superpowers-bootstrap/selftest.mjs  # 期望：selftest OK
```

脱敏断言**刻意排除 `docs/superpowers/{specs,plans}/`**：这两份是实现文档，必须字面写出被替换的路径与脱敏规则（例如替换表与 `sed` 规则本身），否则无法理解与复现。它们记录的是"本机路径曾被替换掉"这一事实，不是路径泄漏。其余被分发的内容文件一律零命中。

断言也**不包含 `127.0.0.1`**：`preset/skills/**` 是上游逐字副本，其中 brainstorming 的配套脚本本就以 `127.0.0.1` 作默认绑定地址，那是上游内容而非本机标识。本仓库自己写下的 `127.0.0.1:3080` 已替换为 `$DSH_WEB_URL`。

最后一条尤为重要：它证明脱敏与 git 操作**没有触碰运行时代码**。

## 10. 人类动作（不由本设计执行）

- 在 GitHub 创建远端仓库；
- `git remote add origin <url>` 与 `git push -u origin main`（需凭据与网络策略放开）；
- 本会话网络仅 git 协议出网可用，且无 GitHub 凭据，故推送**无法**在此代劳。
