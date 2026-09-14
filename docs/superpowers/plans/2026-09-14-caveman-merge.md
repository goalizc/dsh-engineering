# Caveman 技能并入 superpowers preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 caveman 的 3 个自包含纯规则技能 vendored 进 superpowers preset, 让 DSH 的 Superpowers 模式下可用 caveman 压缩风格, 并新增 `sync-caveman-skills.sh` 建立可维护的向上游同步。

**Architecture:** 3 个技能目录(`caveman`/`caveman-commit`/`caveman-review`)拷入 `preset/skills/`, 由既有 `skill-filesystem` 自动收集(不改注册逻辑); 在 `agent.cordis.yml` 的 `persona.prefix` 追加 Caveman 调和声明(默认 lite + 流程产出不休); `build-bootstrap.sh` 自检增加对 3 技能的缺失断言; 新增白名单同步脚本 `sync-caveman-skills.sh` 只覆盖这 3 个目录并向 `build-bootstrap.sh` 联动重算清单。

**Tech Stack:** bash(仅 `build-bootstrap.sh`/`sync-caveman-skills.sh` 薄壳) + YAML(`agent.cordis.yml`) + vendored 纯数据技能文件; 无 npm 运行时依赖。

## Global Constraints

- 技能为纯数据(vendored): 内容取自上游 `skills/<id>/` 原样拷贝, **不改 frontmatter 与正文**, 便于 diff 与 sync。
- 只并入 3 个白名单技能: `caveman`、`caveman-commit`、`caveman-review`; 其余 caveman 技能(云/钩子依赖)一律不搬(详见设计文档排除表)。
- **绝不对 `preset/skills` 整目录 `rm -rf`**: 那会误删现有 14 个 superpowers 技能; 同步只按白名单逐目录覆盖。
- 不引入 caveman 的 proxy/engine(BSL 运行时), 不碰 BSL 许可。
- 技能名与现有 14 个 superpowers 技能零冲突(已核对)。
- `preset/.manifest.json` 为构建产物, 不入 git(已被 `.gitignore` 忽略)。
- 所有改动在当前已合并的 `main` 分支上进行; 涉及中文/多行提交信息用 `git commit -F <msg-file>`。
- 本机 caveman 上游检出: `/mnt/e/project/caveman`(对应 Windows `E:\project\caveman`); 已确认 3 个 `SKILL.md` 在场。

---

### Task 1: vendored 拷贝 3 技能 + build-bootstrap 自检断言

**Files:**
- Create: `preset/skills/caveman/{SKILL.md,README.md}`
- Create: `preset/skills/caveman-commit/{SKILL.md,README.md}`
- Create: `preset/skills/caveman-review/{SKILL.md,README.md}`
- Modify: `scripts/build-bootstrap.sh`(自检段落, 第 57-62 行的 `for pat` 循环之后, `[ "$fail" -eq 0 ] || exit 1` 之前)

**Interfaces:**
- Consumes: 上游(`/mnt/e/project/caveman/skills/<id>/`)的原始技能文件。
- Produces: `preset/skills/{caveman,caveman-commit,caveman-review}/` 就位; `build-bootstrap.sh` 对 3 个技能目录缺失时非零退出 —— 供 Task3 的 sync 脚本与后续端到端校验依赖。

- [ ] **Step 1: 从上游拷贝 3 个技能(数据落地, 无"失败测试"先行——技能为纯数据)**

```bash
cd /home/goalizc/dsh-engineering && \
for id in caveman caveman-commit caveman-review; do \
  rm -rf "preset/skills/$id" && \
  cp -R "/mnt/e/project/caveman/skills/$id" "preset/skills/" ; done
git status --short
```
Expected: 工作区新增 `preset/skills/caveman/`、`preset/skills/caveman-commit/`、`preset/skills/caveman-review/`(各含 SKILL.md 与 README.md)。

- [ ] **Step 2: 修改 build-bootstrap.sh 增加 3 技能缺失断言**

在 `scripts/build-bootstrap.sh` 的 `for pat in ... ; done` 之后、`[ "$fail" -eq 0 ] || exit 1` 之前插入:

```bash
# Caveman vendored skills must survive assembly; fail loudly if a sync or
# removal dropped one (same rule as the dsh-tools.md mis-delete lesson).
for c in caveman caveman-commit caveman-review; do
  [ -f "$PRESET/skills/$c/SKILL.md" ] || { echo "build-bootstrap: missing caveman skill: $c" >&2; exit 1; }
done
```

- [ ] **Step 3: 运行 build-bootstrap.sh 验证通过**

Run: `cd /home/goalizc/dsh-engineering && bash scripts/build-bootstrap.sh`
Expected: 末行依次输出 `built .../preset/bootstrap.md (... bytes, ... lines)`, 随后无报错; 且 `preset/.manifest.json` 被重新生成(清单文件数应 >56, 因新增技能)。

- [ ] **Step 4: 验证清单确实收录新增技能**

```bash
cd /home/goalizc/dsh-engineering && node -e "const m=require('./preset/.manifest.json');const k=Object.keys(m.files);const ids=['caveman','caveman-commit','caveman-review'];console.log('skills/caveman/SKILL.md in manifest:',k.includes('skills/caveman/SKILL.md'));process.exit(ids.every(i=>k.includes('skills/'+i+'/SKILL.md'))?0:1)"
```
Expected: `skills/caveman/SKILL.md in manifest: true` 且退出码 0(3 个技能都在清单)。

- [ ] **Step 5: 提交**

```bash
cd /home/goalizc/dsh-engineering
printf '%s\n' 'feat: vendored caveman 3 技能并纳入 build-bootstrap 存在断言' > .tmp-msg.txt
git add preset/skills/caveman preset/skills/caveman-commit preset/skills/caveman-review scripts/build-bootstrap.sh
git commit -F .tmp-msg.txt && rm -f .tmp-msg.txt
```

> 注: `preset/.manifest.json` 被忽略, 不 `git add`。

---

### Task 2: persona 调和声明

**Files:**
- Modify: `preset/agent.cordis.yml`(`persona.prefix` 块, 第 37 行 `Skills are mandatory workflows...` 之后追加)

**Interfaces:**
- Consumes: Task 1 已就位的 3 个技能(使声明与实存技能一致)。
- Produces: session 启动时注入模型的 persona 声明 —— agent 默认以 caveman lite 风格作答且知晓 superpowers 流程产物优先于压缩。

- [ ] **Step 1: 在 persona.prefix 块内追加 Caveman 声明**

将 `preset/agent.cordis.yml` 中的:

```yaml
      Skills are mandatory workflows, not suggestions. Process skills come first (brainstorming, systematic-debugging), then implementation skills. Announce "Using [skill] to [purpose]" and follow the skill exactly.
```

替换为(即在其后空一行追加 Caveman 段):

```yaml
      Skills are mandatory workflows, not suggestions. Process skills come first (brainstorming, systematic-debugging), then implementation skills. Announce "Using [skill] to [purpose]" and follow the skill exactly.

      For routine engineering chat and implementation notes, answer concisely (caveman lite): drop pleasantries, keep every technical entity, code, command, and exact error verbatim. Superpowers workflow artifacts — plans, specs, designs, review comments, TDD red/green explanations, pre-edit clarifications — stay complete, structured, and take priority over compression. Tune with `/caveman full|ultra|off`; `/caveman-commit` and `/caveman-review` apply terse output within their own scopes.
```

- [ ] **Step 2: 校验 YAML 合法**

```bash
cd /home/goalizc/dsh-engineering && node -e "const y=require('yaml');const p=require('fs').readFileSync('preset/agent.cordis.yml','utf8');const d=y.parse(p);console.log('parse OK, persona exists:', d.some(r=>r.id==='persona'))"
```
Expected: `parse OK, persona exists: true`(若 `yaml` 包不可用, 用 `node -e "new (require('js-yaml'))..."` 或本仓库已用的解析器, 以能让文件被解析为准)。

> 若仓库无 `yaml`/`js-yaml` 依赖可离线校验: 确认缩进为 6 空格字符串(prefix 的子块), 且无制表符、无尾部 `:` 截断即可。

- [ ] **Step 3: 提交**

```bash
cd /home/goalizc/dsh-engineering
printf '%s\n' 'feat: persona 注入 caveman 调和声明(默认 lite + 流程产物优先)' > .tmp-msg.txt
git add preset/agent.cordis.yml && git commit -F .tmp-msg.txt && rm -f .tmp-msg.txt
```

---

### Task 3: sync-caveman-skills.sh 白名单同步脚本

**Files:**
- Create: `scripts/sync-caveman-skills.sh`

**Interfaces:**
- Consumes: Task 1 的 `build-bootstrap.sh` 断言与构建联动; 上游 caveman checkout(含 `skills/<id>/{SKILL.md,...}`)。
- Produces: 命令 `scripts/sync-caveman-skills.sh <caveman-checkout>` —— 按白名单 3 目录覆盖 `preset/skills/<id>/`, 缺失即非零退出; 末尾调 `build-bootstrap.sh` 联动重算清单。供后续换机/上游更新使用。

- [ ] **Step 1: 编写 sync-caveman-skills.sh**

创建 `scripts/sync-caveman-skills.sh`:

```bash
#!/usr/bin/env bash
# Sync the vendored Caveman skills (whitelist) from an upstream checkout.
#
# Only the whitelisted skills below are vendored into this preset. Unlike
# Superpowers (which owns the whole skills tree), Caveman is a partial vendee:
# a full `rm -rf preset/skills` would delete the 14 Superpowers skills. Sync
# therefore overwrites exactly the whitelisted directories and nothing else.
#
# Usage: scripts/sync-caveman-skills.sh <path-to-caveman-checkout>
set -euo pipefail

UPSTREAM="${1:?usage: sync-caveman-skills.sh <path-to-caveman-checkout>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"

CAVEMAN_IDS=(caveman caveman-commit caveman-review)

[ -d "$UPSTREAM/skills" ] || { echo "not a caveman checkout: $UPSTREAM" >&2; exit 1; }

echo "syncing ${#CAVEMAN_IDS[@]} caveman skills from $UPSTREAM"
for id in "${CAVEMAN_IDS[@]}"; do
  [ -f "$UPSTREAM/skills/$id/SKILL.md" ] || { echo "missing upstream skill: $id" >&2; exit 1; }
  rm -rf "$PRESET/skills/$id"
  cp -R "$UPSTREAM/skills/$id" "$PRESET/skills/"
done

# Keep the per-file content stamp in sync with this sync; this also runs the
# new caveman presence assertions (Task 1) and fails loudly on drift.
bash "$ROOT/scripts/build-bootstrap.sh" >/dev/null

echo "caveman skills: ${#CAVEMAN_IDS[@]} synced -> $PRESET/skills/{${CAVEMAN_IDS[*]}}"
```

- [ ] **Step 2: 可执行位 + 实际运行验证(用本机上游检出)**

```bash
cd /home/goalizc/dsh-engineering && chmod +x scripts/sync-caveman-skills.sh && bash scripts/sync-caveman-skills.sh /mnt/e/project/caveman
```
Expected: 依次输出 `syncing 3 caveman skills from /mnt/e/project/caveman`、`built .../preset/bootstrap.md ...`、末行 `caveman skills: 3 synced -> .../preset/skills/{caveman caveman-commit caveman-review}`; 退出码 0。

- [ ] **Step 3: 验证 14+3 技能全在(整目录未被误删)**

```bash
cd /home/goalizc/dsh-engineering && echo "SKILL.md count: $(find preset/skills -name SKILL.md | wc -l)" && ls -d preset/skills/brainstorming preset/skills/caveman preset/skills/caveman-commit preset/skills/caveman-review && node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('preset/.manifest.json','utf8'));const ids=['caveman','caveman-commit','caveman-review'];console.log('manifest has 3 caveman skills:',ids.every(i=>m.files['skills/'+i+'/SKILL.md']))"
```
Expected: `SKILL.md count: 17`(14+3); 4 个 `ls` 目标目录都存在; `manifest has 3 caveman skills: true`。

- [ ] **Step 4: 提交**

```bash
cd /home/goalizc/dsh-engineering
printf '%s\n' 'feat: sync-caveman-skills.sh 白名单同步并联动重算清单' > .tmp-msg.txt
git add scripts/sync-caveman-skills.sh && git commit -F .tmp-msg.txt && rm -f .tmp-msg.txt
```

---

### Task 4: 端到端验收

**Files:** 无源码改动; 验收动作(若发现回归再修)。

**Interfaces:**
- 前置: Task 1-3 完成, `preset/skills/` 下 17 个技能、`preset/agent.cordis.yml` 含 Caveman 声明、`scripts/sync-caveman-skills.sh` 就位、`preset/.manifest.json` 在场。

- [ ] **Step 1: 运行测试套件**

Run: `cd /home/goalizc/dsh-engineering && npm test`
Expected: `tests 11, pass 11, fail 0`(技能为纯数据, 不新增用例)。

- [ ] **Step 2: 临时 DSH_HOME 下 plant-core 植入并断言 3 技能落地(copy 分支)**

```bash
cd /home/goalizc/dsh-engineering
W=$(mktemp -d)
node scripts/plant-core.mjs install preset "$W" --name superpowers --policy copy
for i in caveman caveman-commit caveman-review; do
  [ -f "$W/superpowers/skills/$i/SKILL.md" ] && echo "OK $i" || { echo "MISSING $i" >&2; exit 1; }
done
# 14 个 superpowers 技能也不得丢
test -f "$W/superpowers/skills/brainstorming/SKILL.md" && echo "OK brainstorming(已保留)"
[ "$(find "$W/superpowers/skills" -name SKILL.md | wc -l)" -eq 17 ] && echo "TOTAL SKILLS 17"
rm -rf "$W"
```
Expected: 3 行 `OK <skill>`, 1 行 `OK brainstorming(已保留)`, 1 行 `TOTAL SKILLS 17`。

- [ ] **Step 3: 临时 DSH_HOME 下 plant-core link 分支同样生效**

> **勘误(2026-09-14, 实施后回填):** 原命令对逐文件 `[ -L .../caveman/SKILL.md ]` 断言在实测中失败。plant-core 的 `link` 策略是对安装目标**顶层 `skills` 目录整体**创建符号链接(见 `plant-core.mjs` 的link分支),并非对每个技能文件逐文件 symlink;且用相对 `source`(`preset`)会生成不可解析的相对链接。正确的验收是: 用绝对 source(如 `"$(pwd)/preset"`),并断言顶层 `[ -L "$W/superpowers/skills" ]` 加上 `[ -f "$W/superpowers/skills/caveman/SKILL.md" ]` 可解析。plant-core 属既有稳定代码,此缺陷是验收脚本写法问题,非本计划回归。

```bash
cd /home/goalizc/dsh-engineering
W=$(mktemp -d)
node scripts/plant-core.mjs install "$(pwd)/preset" "$W" --name superpowers --policy link
[ -L "$W/superpowers/skills" ] && echo "LINK OK skills(top-level)" || { echo "skills not a symlink" >&2; exit 1; }
[ -f "$W/superpowers/skills/caveman/SKILL.md" ] && echo "RESOLVES OK caveman"
rm -rf "$W"
```
Expected: `LINK OK skills(top-level)` 与 `RESOLVES OK caveman`(link 策略下为指向检出源 `preset/skills` 的顶层符号链接,且可读)。

- [ ] **Step 4: 工作区干净 + 提交历史核对**

```bash
cd /home/goalizc/dsh-engineering && git status --short && echo '---' && git log --oneline -6
```
Expected: `git status --short` 无输出(干净); `git log` 显示本计划 3 个新提交(Task1/2/3)在 `main` 顶部。

- [ ] **Step 5(人为验收, 交给用户)**: 新开一个 DSH 会话并选 Superpowers 模式, 确认 `skill` 工具列出 `caveman`/`caveman-commit`/`caveman-review`, 发 `describe your superpowers` 后应答符合 lite 简洁风格, 且计划/评审类输出保持完整(流程产物不休)。

---

## Self-Review

**Spec coverage(设计文档 `2026-09-14-caveman-merge-design.md` 逐节 → 任务):**
- 架构/组件清单: T1(vendored 3 技能) + T2(persona)+ T3(sync 脚本) + 设计中的 `agent.cordis.yml` 收集与 `build-manifest` 联动由 T1 Step3/4、T3 Step3 覆盖。
- 风格调和(persona 声明 + 默认 lite + 流程产出不休): T2, 文案与设计"Caveman 调和声明"一致。
- 技能范围(3 个 + 排除表): T1 只拷白名单 3 个; 排除项无对应任务(符合 YAGNI)。
- 数据流与触发: T1(落地) + T2(触发声明) + T4 Step2/3(plant 落地)。
- 同步机制(白名单 3 目录 + 联动 build-bootstrap): T3。
- 错误处理与测试(自检断言 / npm test / 端到端 copy+link): T1 Step2-3, T4 Step1-3。
- 安全边界(不碰 BSL / 不改 frontmatter / 不动 `skill-filesystem`): Global Constraints,T1(原样拷贝)。

**Placeholder scan:** 无 TBD/TODO; 每步骤含实际命令与期望输出。

**Type/命名一致性:** 白名单 ids `caveman|caveman-commit|caveman-review` 在 T1(拷贝/断言)、T3(脚本 `CAVEMAN_IDS`)、T4(断言循环)三处完全一致; persona 声明中的命令名 `/caveman`/`/caveman-commit`/`/caveman-review` 与技能名一致; `remote` 挂载路径 `/mnt/e/project/caveman` 全计划一致。

**风险提示:** `sync-caveman-skills.sh` 不接受网络拉取(GitHub 直接 clone), 与 `sync-superpowers-skills.sh` 同为"本地 checkout 路径参数"风格; 若要 GitHub 直拉需用户先 `git clone`——已在计划中按现有一致设计, 不再扩展。