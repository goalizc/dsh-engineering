# superpowers-dsh 纳管 git 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/home/goalizc/superpowers-dsh` 从无版本管理的目录变成一个可公开推送到 GitHub、不含本机信息、且许可合规的 git 仓库。

**Architecture:** 原地 `git init`（使用仓库局部身份，因为全局 `user.*` 与 `~/.gitconfig` 都不存在）；`preset/node_modules/` 与临时目录写入 `.gitignore`；`preset/skills/` 用一个只含上游 v6.1.1 的单提交快照经 `git subtree add` 导入，两处 DSH 本地改动作为叠加提交保留（这是否决 submodule 的全部理由）；三份含本机路径的文档在入库前做占位符化脱敏；补齐 MIT 许可与第三方声明。最终由人类推送（本会话无凭据）。

**Tech Stack:** git 2.55.0、`git subtree`（contrib，随 2.55.0 安装）、bash、Node（仅用于跑既有插件自测）

## Global Constraints

- 仓库路径固定为 `/home/goalizc/superpowers-dsh`；所有命令在仓库根执行。
- git 身份**仅设仓库局部**：`user.name=goalizc`、`user.email=goalizc@localhost`。不得写 `--global`。
- 默认分支名固定为 `main`。
- 提交信息使用**中文**，与本仓库文档语言一致。
- `preset/node_modules/` 与 `.tmp-*/` 必须零追踪。
- 脱敏占位符固定为 `$REPO`、`$DSH_HOME`、`$ARDUPLOT_WS`、`$UPSTREAM`、`$DSH_WEB_URL`，不得自创其他写法。
- 上游固定为 v6.1.1，commit `d884ae04edebef577e82ff7c4e143debd0bbec99`，树 `795caed14920f27a1d2d152a09b4720194f64472`。
- **禁止 `git push`**：本会话无 GitHub 凭据且仅 git 协议出网。推送是人类的动作。
- 上文 design spec：`docs/superpowers/specs/2026-09-12-git-management-design.md`。

---

### Task 1: 初始化仓库与忽略规则

**Files:**
- Create: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 一个已初始化的 git 仓库，分支 `main`，含仓库局部身份；`.gitignore` 覆盖 `preset/node_modules/` 与 `.tmp-*/`

- [ ] **Step 1: 确认起点干净**

Run:
```bash
cd /home/goalizc/superpowers-dsh && test -d .git && echo "ALREADY A REPO" || echo "not a repo yet"
```
Expected: `not a repo yet`

- [ ] **Step 2: 写 `.gitignore`**

写入 `.gitignore`，内容**完全等于**：

```gitignore
# 机器本地的符号链接：preset/node_modules/@deepseek-ai 指向已安装 harness 的依赖树。
# 它指向仓库之外、换机即失效，由 scripts/install.sh 重建。
preset/node_modules/

# 探针与临时 checkout（上游快照、布局比对等）
.tmp-*/
```

- [ ] **Step 3: 初始化并设置局部身份**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git init -b main -q . \
  && git config user.name "goalizc" \
  && git config user.email "goalizc@localhost" \
  && echo "init ok"
```
Expected: `init ok`

- [ ] **Step 4: 验证身份是局部的、分支正确、忽略规则生效**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git config user.name && git config user.email && git symbolic-ref --short HEAD && git check-ignore -v preset/node_modules && echo ".tmp-full" | git check-ignore --stdin -v
```
Expected（四项依次）：
```
goalizc
goalizc@localhost
main
.gitignore:3:preset/node_modules/	preset/node_modules
.gitignore:6:.tmp-*/	.tmp-full
```

- [ ] **Step 5: 确认 `preset/node_modules` 不会被追踪**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git add -A --dry-run 2>/dev/null | grep -c "preset/node_modules" || true
```
Expected: `0`

- [ ] **Step 6: 提交**

```bash
cd /home/goalizc/superpowers-dsh && git add .gitignore && git commit -q -m "chore: 初始化仓库并忽略机器本地依赖与临时目录" && git log --oneline
```
Expected: 一行，形如 `xxxxxxx chore: 初始化仓库并忽略机器本地依赖与临时目录`

---

### Task 2: 补齐 MIT 许可与第三方声明

**Files:**
- Create: `LICENSE`
- Create: `THIRD-PARTY-NOTICES.md`

**Interfaces:**
- Consumes: Task 1 的仓库
- Produces: 许可合规所需的两个文件，供公开分发

- [ ] **Step 1: 确认这两个文件当前不存在**

Run:
```bash
cd /home/goalizc/superpowers-dsh && ls LICENSE THIRD-PARTY-NOTICES.md 2>&1 | tail -2
```
Expected: 两条 `No such file or directory`（中文环境为 `无法访问`）

- [ ] **Step 2: 写 `LICENSE`（本仓库自身，MIT）**

内容**完全等于**（仅版权行不同）：

```
MIT License

Copyright (c) 2026 goalizc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: 写 `THIRD-PARTY-NOTICES.md`**

内容**完全等于**：

````markdown
# 第三方声明

本仓库分发以下第三方作品，特此声明其来源与许可。

## Superpowers

- 来源：<https://github.com/obra/superpowers>
- 版本：v6.1.1（commit `d884ae04edebef577e82ff7c4e143debd0bbec99`，2026-07-02）
- 许可：MIT，Copyright (c) 2025 Jesse Vincent
- 范围：`preset/skills/**` 为上游 `skills/**` 的副本

`preset/skills/**` 与上游的差异**仅两处**（其余逐字节一致），两者都是 DSH 移植所需的本地改动，而非内容改写：

1. `preset/skills/using-superpowers/references/dsh-tools.md` —— 新增文件，DSH 工具映射（88 行）；
2. `preset/skills/using-superpowers/SKILL.md` 第 59 行 —— 新增一行 Platform Adaptation 指针：
   `- DeepSeek Harness: \`references/dsh-tools.md\``

### 上游许可全文

```
MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
````

- [ ] **Step 4: 验证上游许可全文逐字节正确**

Run:
```bash
cd /home/goalizc/superpowers-dsh && diff <(sed -n '/^```$/,/^```$/p' THIRD-PARTY-NOTICES.md | sed '1d;$d' | sed -n '/^MIT License$/,$p' | sed '/^```$/d') <(git -C .tmp-full show 'v6.1.1^{}:LICENSE') && echo "LICENSE TEXT MATCHES UPSTREAM"
```
Expected: `LICENSE TEXT MATCHES UPSTREAM`

- [ ] **Step 5: 验证本仓库许可为 MIT 且版权行正确**

Run:
```bash
cd /home/goalizc/superpowers-dsh && head -3 LICENSE && grep -c "Copyright (c) 2026 goalizc" LICENSE
```
Expected:
```
MIT License

Copyright (c) 2026 goalizc
```
随后 `1`

- [ ] **Step 6: 提交**

```bash
cd /home/goalizc/superpowers-dsh && git add LICENSE THIRD-PARTY-NOTICES.md && git commit -q -m "chore: 添加 MIT 许可与第三方声明" && git log --oneline | head -1
```
Expected: 形如 `xxxxxxx chore: 添加 MIT 许可与第三方声明`

---

### Task 3: 经 subtree 导入 skills 并保留两处 DSH 改动

**Files:**
- Create: `preset/skills/**`（49 文件，经 subtree 导入）
- Modify: `preset/skills/using-superpowers/SKILL.md:59`
- Create: `preset/skills/using-superpowers/references/dsh-tools.md`

**Interfaces:**
- Consumes: Task 1 的 `.gitignore`（保证 `.tmp-*` 不入库）；`.tmp-full` 完整上游镜像（若不存在，Step 1 给出重建命令）
- Produces: `preset/skills/` 已入库，且与上游 v6.1.1 的差异恰为两处

- [ ] **Step 1: 确认上游镜像可用且是完整的**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git -C .tmp-full rev-parse 'v6.1.1^{}^{tree}' && git -C .tmp-full rev-list --count --all
```
Expected:
```
795caed14920f27a1d2d152a09b4720194f64472
7920
```
若 `.tmp-full` 缺失，先重建（约 278 MiB，需数分钟）：
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-full && git clone --mirror https://github.com/obra/superpowers .tmp-full
```

- [ ] **Step 2: 把两处 DSH 改动备份到仓库之外**

subtree 导入会用上游原始内容覆盖 `preset/skills/`，必须先备份，否则丢失移植契约的核心交付物。

Run:
```bash
cd /home/goalizc/superpowers-dsh && mkdir -p .tmp-overlay/using-superpowers/references \
  && cp preset/skills/using-superpowers/SKILL.md .tmp-overlay/using-superpowers/SKILL.md \
  && cp preset/skills/using-superpowers/references/dsh-tools.md .tmp-overlay/using-superpowers/references/dsh-tools.md \
  && echo "overlay backed up" && ls -R .tmp-overlay
```
Expected: `overlay backed up`，并列出这两个文件

- [ ] **Step 3: 验证备份里确实带着那两处改动**

Run:
```bash
cd /home/goalizc/superpowers-dsh && grep -n "dsh-tools.md" .tmp-overlay/using-superpowers/SKILL.md && wc -l < .tmp-overlay/using-superpowers/references/dsh-tools.md
```
Expected:
```
59:- DeepSeek Harness: `references/dsh-tools.md`
88
```

- [ ] **Step 4: 制作快照，并把 `skills/` 提升为根**

**必须非浅**：`git subtree add` 会对参考仓库执行自己的 `git fetch`，而 git 拒绝更新浅克隆的根。实测症状：
`警告：拒绝 refs/tags/v6.1.1 因为浅克隆的根不允许被更新` → `致命错误：需要一个单独的版本`。

**必须提升子树**：上游 `skills/` 是子目录，目标是 `preset/skills/`。若直接以整仓为祖先，会把整棵 v6.1.1 树（172 文件）灌进 `preset/skills/`，技能变成 `preset/skills/skills/…`（实测发生过）。用 `git subtree split --prefix=skills` 把子树提升为根，使祖先的树与目标前缀对齐。

（`git filter-branch --subdirectory-filter` 经实测**静默无效**：退出码 0 但树仍是整仓，不要采用。）

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-snap && git init -q .tmp-snap \
  && git -C .tmp-snap fetch -q /home/goalizc/superpowers-dsh/.tmp-full tag v6.1.1 \
  && git -C .tmp-snap checkout -q v6.1.1 \
  && git -C .tmp-snap subtree split --prefix=skills -b promoted >/dev/null 2>&1 \
  && echo "snapshot ok"
```
Expected: `snapshot ok`

- [ ] **Step 5: 验证提升后的树等于上游 `skills/` 子树**

Run:
```bash
cd /home/goalizc/superpowers-dsh && diff <(git -C .tmp-full ls-tree -r 'v6.1.1^{}:skills' --name-only | sort) <(git -C .tmp-snap ls-tree -r promoted --name-only | sort) && echo "PROMOTED TREE MATCHES UPSTREAM skills/" || echo "MISMATCH - STOP"
```
Expected: `PROMOTED TREE MATCHES UPSTREAM skills/`（两边均为 48 文件、14 个技能目录）

**若输出 `MISMATCH - STOP`：立即停止，不要继续导入。** 先查清快照来源再重试。

- [ ] **Step 6: 删除本地 skills，再经 subtree 导入提升后的快照**

subtree add 会在当前 HEAD 之上创建提交，因此这里**不需要**空提交。也不使用 `git rm --cached`（在路径尚未被追踪时它会直接报错）——`preset/skills/` 此刻还未入库，删掉工作区文件即可。

**注意：不要用管道接 `tail` 来"验证成功"**，那读到的是管道退出码而非 `git subtree` 的（实测因此误报过一次成功）。下面显式取 `$?`。

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf preset/skills \
  && git subtree add --prefix=preset/skills .tmp-snap promoted -m "feat: 经 subtree 导入上游 Superpowers v6.1.1 技能" > /tmp/st.log 2>&1
echo "EXIT=$?"; tail -2 /tmp/st.log; ls preset/skills | head -16
```
Expected: `EXIT=0`、`Added dir 'preset/skills'`，并列出 14 个技能目录（`brainstorming` … `writing-skills`）

- [ ] **Step 7: 验证导入结果先不含本地改动（确认 subtree 真的覆盖了）**

Run:
```bash
cd /home/goalizc/superpowers-dsh && grep -c "dsh-tools.md" preset/skills/using-superpowers/SKILL.md; ls preset/skills/using-superpowers/references/
```
Expected: `grep -c` 输出 `0`（上游原文没有该指针行），且 `references/` 里**没有** `dsh-tools.md`

- [ ] **Step 8: 还原两处 DSH 改动**

Run:
```bash
cd /home/goalizc/superpowers-dsh && cp .tmp-overlay/using-superpowers/SKILL.md preset/skills/using-superpowers/SKILL.md \
  && cp .tmp-overlay/using-superpowers/references/dsh-tools.md preset/skills/using-superpowers/references/dsh-tools.md \
  && echo "overlay restored"
```
Expected: `overlay restored`

- [ ] **Step 9: 验证与上游的差异恰为两处**

用 `git archive` 直接取出上游 `skills/` 子树，避免把整仓 checkout 出来。

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-verify && mkdir .tmp-verify \
  && git -C .tmp-full archive 'v6.1.1^{}:skills' | tar -x -C .tmp-verify \
  && echo "上游 skills/ 文件数: $(find .tmp-verify -type f | wc -l)" \
  && diff -rq .tmp-verify preset/skills; echo "差异行数: $(diff -rq .tmp-verify preset/skills 2>/dev/null | wc -l)"
```
Expected：上游 48 文件；**恰好两行**差异，差异行数为 `2`：
```
只在 preset/skills/using-superpowers/references 中存在：dsh-tools.md
文件 .tmp-verify/using-superpowers/SKILL.md 和 preset/skills/using-superpowers/SKILL.md 不同
```
若出现任何**第三行**差异，说明导入了错误版本，停止并排查。

- [ ] **Step 10: 提交两处 DSH 改动**

```bash
cd /home/goalizc/superpowers-dsh && git add preset/skills/using-superpowers/SKILL.md preset/skills/using-superpowers/references/dsh-tools.md \
  && git commit -q -m "feat: 保留 DSH 平台适配（工具映射与指针行）" && git log --oneline | head -2
```
Expected: 两行，首行为 `feat: 保留 DSH 平台适配（工具映射与指针行）`

- [ ] **Step 11: 清理临时目录并确认未被追踪**

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-snap .tmp-verify .tmp-overlay && git status --porcelain && echo "--- tracked node_modules count:" && git ls-files preset/node_modules | wc -l
```
Expected: `git status --porcelain` 无输出；`tracked node_modules count:` 为 `0`

---

### Task 4: 文档脱敏

**Files:**
- Modify: `docs/feasibility-report.md`（11 处）
- Modify: `evidence/VERIFICATION.md`（6 处）
- Modify: `preset/SYNC.md`（1 处）

**Interfaces:**
- Consumes: Task 1–3 的仓库
- Produces: 三份文档中不再含本机路径与端口

- [ ] **Step 1: 记录脱敏前的命中数（作为对照）**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git grep -c "/home/goalizc\|/mnt/e" -- docs evidence preset/SYNC.md
```
Expected:
```
docs/feasibility-report.md:11
evidence/VERIFICATION.md:6
preset/SYNC.md:1
```

- [ ] **Step 2: 用 sed 做占位符替换（顺序重要：先长后短）**

`/home/goalizc/superpowers-dsh` 必须早于 `/home/goalizc/ardupilot`，否则会被后者或 `$HOME` 规则切碎。替换串一律用单引号，避免 shell 展开 `$`。

Run:
```bash
cd /home/goalizc/superpowers-dsh && for f in docs/feasibility-report.md evidence/VERIFICATION.md preset/SYNC.md; do
  sed -i \
    -e 's|/home/goalizc/superpowers-dsh|$REPO|g' \
    -e 's|/home/goalizc/\.dsh|$DSH_HOME|g' \
    -e 's|/home/goalizc/ardupilot|$ARDUPLOT_WS|g' \
    -e 's|/mnt/e/project/superpowers|$UPSTREAM|g' \
    -e 's|http://127\.0\.0\.1:3080|$DSH_WEB_URL|g' \
    -e 's|/home/goalizc|$HOME|g' \
    "$f"
done && echo "replacements applied"
```
Expected: `replacements applied`

- [ ] **Step 3: 断言零残留**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git grep -n "/home/goalizc\|/mnt/e\|127\.0\.0\.1" -- docs evidence preset/SYNC.md; echo "exit=$?"
```
Expected: 无匹配输出，`exit=1`

- [ ] **Step 4: 断言占位符确实落位**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git grep -c '\$REPO\|\$DSH_HOME\|\$UPSTREAM\|\$ARDUPLOT_WS\|\$DSH_WEB_URL' -- docs evidence preset/SYNC.md
```
Expected: 三份文件均有非零计数（报告最多，SYNC.md 为 1）

- [ ] **Step 5: 在三份文件头部加占位符说明**

在 `docs/feasibility-report.md` 的标题行之后（即第 1 行 `# 将 Superpowers …` 与第 2 行空行之后）插入：

```markdown
> **占位符约定**：为便于公开分发，本文件中的本机路径已占位符化——
> `$REPO` 本仓库根、`$DSH_HOME` DSH 配置目录（默认 `~/.dsh`）、`$ARDUPLOT_WS` 一个使用本 preset 的工作区示例、`$UPSTREAM` 上游 Superpowers 检出、`$DSH_WEB_URL` DSH Web GUI 地址。
> 技术内容与数字未作任何改动。
```

在 `evidence/VERIFICATION.md` 第 3 行（`本文件记录…` 那段）之后插入同样一段。

在 `preset/SYNC.md` 中，把第 4 行 `- 本地检出: $UPSTREAM` **替换**为：

```markdown
- 本地检出: `$UPSTREAM`（占位符，指上游 Superpowers 的本地检出路径；公开分发时已脱敏）
```

（是替换该行，不是新增，避免出现两条"本地检出"。）

- [ ] **Step 6: 验证文档仍可读、结构未坏**

Run:
```bash
cd /home/goalizc/superpowers-dsh && head -12 docs/feasibility-report.md && echo "=====" && head -8 evidence/VERIFICATION.md && echo "=====" && cat preset/SYNC.md
```
Expected: 三份文件标题与表格结构完好，占位符出现在原路径位置

- [ ] **Step 7: 提交**

```bash
cd /home/goalizc/superpowers-dsh && git add docs/feasibility-report.md evidence/VERIFICATION.md preset/SYNC.md \
  && git commit -q -m "docs: 本机路径占位符化以便公开分发" && git log --oneline | head -1
```
Expected: 形如 `xxxxxxx docs: 本机路径占位符化以便公开分发`

---

### Task 5: 纳入其余仓库内容并做整体验证

**Files:**
- Create: `README.md`（已存在，入库）
- Create: `.gitignore`（Task 1 已建，此处一并确认入库）
- Create: `preset/preset.yml`、`preset/agent.cordis.yml`、`preset/bootstrap.md`（已存在，入库）
- Create: `preset/plugins/superpowers-bootstrap/**`（3 文件，入库）
- Create: `scripts/**`（3 文件，入库）
- Create: `docs/superpowers/specs/2026-09-12-git-management-design.md`（入库）
- Create: `docs/superpowers/plans/2026-09-12-git-management.md`（本计划，入库）

**Interfaces:**
- Consumes: Task 1–4 的仓库
- Produces: 完整入库的仓库，且通过 design spec §9 的全部断言

- [ ] **Step 1: 入库其余内容并提交**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git add README.md preset/preset.yml preset/agent.cordis.yml preset/bootstrap.md preset/plugins scripts docs evidence \
  && git commit -q -m "docs: 纳入 README、可行性报告、验证记录、设计与实施计划" && git log --oneline
```
Expected: 5 行提交历史

- [ ] **Step 2: 断言工作区干净**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git status --porcelain; echo "exit=$?"
```
Expected: 无输出，`exit=0`

- [ ] **Step 3: 断言追踪文件数符合预期**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git ls-files | wc -l
```
Expected: 约 62（49 skills + 13 其他；允许 ±2 的浮动，但**不得**包含任何 `preset/node_modules` 条目）

- [ ] **Step 4: 断言 `preset/node_modules` 零追踪**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git ls-files preset/node_modules | wc -l
```
Expected: `0`

- [ ] **Step 5: 断言全仓库无本机路径残留**

Run:
```bash
cd /home/goalizc/superpowers-dsh && git grep -n "/home/goalizc\|/mnt/e" -- . ; echo "exit=$?"
```
Expected: 无输出，`exit=1`

- [ ] **Step 6: 断言运行时未被破坏（关键）**

脱敏与 git 操作若误伤运行时代码，这一步会暴露。

Run:
```bash
cd /home/goalizc/superpowers-dsh/preset/plugins/superpowers-bootstrap && node selftest.mjs
```
Expected: `selftest OK: 6 assertions groups passed`（并打印 bootstrap bytes）

- [ ] **Step 7: 断言 bootstrap 与组合文件未被改动**

Run:
```bash
cd /home/goalizc/superpowers-dsh && wc -c < preset/bootstrap.md && node -e "const y=require('node:fs').readFileSync('preset/agent.cordis.yml','utf8');const n=(y.match(/^- id:/gm)||[]).length;console.log('top-level rows:',n)"
```
Expected: `9104`（bootstrap 字节数）与 `top-level rows: 19`

- [ ] **Step 8: 断言 skills 与上游的差异仍恰为两处**

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-verify && mkdir .tmp-verify \
  && git -C .tmp-full archive 'v6.1.1^{}:skills' | tar -x -C .tmp-verify \
  && diff -rq .tmp-verify preset/skills | wc -l && rm -rf .tmp-verify
```
Expected: `2`

- [ ] **Step 9: 清理大型临时镜像**

`.tmp-full` 有 278 MiB，验证完成后删除；日后同步上游时按 Task 3 Step 1 重建。

Run:
```bash
cd /home/goalizc/superpowers-dsh && rm -rf .tmp-full && ls -a | grep '^\.tmp' ; echo "临时目录已清（无输出为正常）"
```
Expected: 无 `.tmp-*` 残留

- [ ] **Step 10: 交付推送指引（不执行推送）**

Run（仅打印，不推送）：
```bash
cd /home/goalizc/superpowers-dsh && echo "git remote add origin <你的 GitHub 仓库 URL>" && echo "git push -u origin main" && git log --oneline
```
Expected: 打印两条指引与提交历史
