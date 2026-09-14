# 工程模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `caveman` 默认 full 且可运行时切换，把项目从 `superpowers` 改名为 `engineering`（显示名 `工程模式`），并让两个 sync 脚本自管上游缓存、不再需要人工传入检出路径。

**Architecture:** (1) `bootstrap.md` 新增 caveman 一节，声明默认 full 与流程产物优先级，并**显式声明该技能"尚未激活"**，从而保留级别切换所需的加载路径；(2) 新增一个自包含的预设本地命令插件，注册真 `/caveman` 命令，通过 `invocation.agent.followup()` 注入级别声明；(3) 产品名从 `superpowers` 改为 `engineering`，但**不动上游名与 `docs/superpowers/` 技能产物路径**；(4) sync 脚本自管 `.cache/`，锁 commit 不变。

**Tech Stack:** Node ≥18（`node:test` + `node:assert/strict`）、bash、Cordis 插件（`name`/`inject`/`apply`）、git。

## 执行后勘误（本节为实施回填，非原始计划）

本计划已执行完毕（6 任务，`70e5ec2..ee5b0a0` 之后另有收尾修复）。执行期与评审期共发现 **7 处计划缺陷**，其中多数是执行者被迫绕开的——正文保留原样以存真，此处逐条列明，供复用本计划时修正。

| # | 位置（本文件行号） | 缺陷 | 执行期的正确做法 |
|---|---|---|---|
| 1 | `153` | `printf … >> "$SKILL"` 把 DSH 指针行**追加到文件末尾** | 改为幂等重排：插到 `## Platform Adaptation` 小节的 `- Antigravity:` 行之后，并删除错位行（Task 1 修复 `b470028`） |
| 2 | `714`、`769` | `git add … preset/.manifest.json && git commit` —— 该路径**被 gitignore**，`git add` **退出 1**，`&&` 短路会**静默跳过提交** | 只显式暂存已追踪文件；绝不把被忽略路径放进 `&&` 链 |
| 3 | `918` | `grep -rn "superpowers" --include=*` 期望"无输出"——**按构造不可达**（计入 gitignored 账本 + 大量合法上游名） | 改用 `git grep`（只搜已追踪文件）+ 产品名特征串，并加反向断言（上游署名须存活）。见 spec §8bis E2 |
| 4 | `723` | Files 列了 `Modify: scripts/build-manifest.mjs`（原文已带"若需同步；先读确认"的保留）——实测该文件**遍历目录**，加插件目录**无需改动** | 不碰该文件 |
| 5 | `35`、`330`、`340`、`343` | `selftest.mjs` 命名——后按重命名需求改为 `bootstrap.test.mjs` / `caveman-command.test.mjs` 并收进 `npm test`（Task 5） | 使用 `*.test.mjs`，由根测试 glob 收集 |
| 6 | `764`、`890`、`1086` | 过期测试计数（`11` / `12`）——收编插件自测后为 **15** | 计数随每次收编而变，不要写死 |
| 7 | `930` | `git add -A` —— 会把无关路径卷入，提交不可审 | 显式逐路径暂存 |

**另有一处计划未预见的实现约束**（不属缺陷，但复用本计划必须知道）：**预设本地插件不得 `import` 任何 `@deepseek-ai/*` 包**。实测依据——从检出目录解析 `@deepseek-ai/dsh-llm` 失败（`ERR_MODULE_NOT_FOUND`），只有已安装的 preset 才有 `node_modules` 符号链接，而 `--copy` 安装模式根本没有该链接。故消息对象须用 `node:crypto` 自行构造。详见 spec §8bis E4。

**注意**：本计划**未**采用 subtree；`subtree` 相关教训属 git 纳管任务线（`docs/superpowers/{specs,plans}/2026-09-12-*`）。

## Global Constraints

- 产品名：preset ID = **`engineering`**，显示名 = **`工程模式`**，npm 包名 = **`@engineering-dsh/engineering-dsh`**，插件目录 = **`preset/plugins/bootstrap/`**。
- 上游名**不得改动**：`obra/superpowers`、`JuliusBrussee/caveman`、技能名（`using-superpowers`、`sync-superpowers-skills.sh` 等）。
- `docs/superpowers/` 路径**不得改动**（上游写作规范定的技能产物路径）。
- 锁定 commit 不得漂移：superpowers `d884ae04edebef577e82ff7c4e143debd0bbec99`，caveman `15581d14007fd01fb3f132016741962f34936ca2`。
- **预设本地插件必须自包含**：不得 `import` 任何 `@deepseek-ai/*` 包。实测依据——从检出目录解析 `@deepseek-ai/dsh-llm` 失败（`ERR_MODULE_NOT_FOUND`），只有装好的 preset 才有 `node_modules` 符号链接；而 `--copy` 安装模式根本没有该链接。消息对象用 `node:crypto` 的 `randomUUID` 自行构造。
- `caveman` 技能正文**不得改写**（上游 vendored）。级别规则单份维护在技能内。
- 生成物不得手改：`preset/bootstrap.md`（由 `scripts/build-bootstrap.sh` 重建）、`preset/.manifest.json`（由 `scripts/build-manifest.mjs` 重建）、`preset/SYNC.md`（由 sync 脚本写入）。
- 提交信息用中文，与本仓库既有风格一致（`feat:`/`fix:`/`docs:`/`refactor:`）。
- 不得 `git push`（人类动作）。

---

## File Structure

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `.gitignore` | 忽略本地产物 | 加 `.cache/` |
| `scripts/sync-caveman-skills.sh` | 白名单同步 caveman 技能 | 改为自管缓存、无参数 |
| `scripts/sync-superpowers-skills.sh` | 同步 superpowers 技能 | 改为自管缓存、无参数、修互删 bug |
| `scripts/build-bootstrap.sh` | 生成 `preset/bootstrap.md` | 追加 caveman 一节 |
| `preset/plugins/caveman-command/index.js` | 注册 `/caveman` 命令 | 新建 |
| `preset/plugins/caveman-command/package.json` | 插件清单 | 新建 |
| `preset/plugins/caveman-command/selftest.mjs` | 插件回归测试 | 新建 |
| `preset/agent.cordis.yml` | 组合：插件挂载 + persona | 改插件路径、改 persona、加新插件行 |
| `preset/preset.yml` | 显示名 | 改 `工程模式` |
| `index.js`、`cordis.patch.yml`、`package.json`、`scripts/plant-core.mjs`、`scripts/install.sh` | 安装器产品名 | 改 `engineering` |
| `scripts/plant-core.test.mjs`、`scripts/index.test.mjs` | 安装器测试 | 改断言与 fixture |
| `preset/plugins/bootstrap/*` | 由 `superpowers-bootstrap` 改名而来 | 改产品名 |
| `docs/feasibility-report.md`、`evidence/VERIFICATION.md` | 历史记录 | 只加状态说明，**不动正文** |
| `README.md` | 项目说明 | 重写 |

---

### Task 1: 上游缓存与互删修复

**Files:**
- Modify: `.gitignore`
- Modify: `scripts/sync-caveman-skills.sh`
- Modify: `scripts/sync-superpowers-skills.sh`

**Interfaces:**
- Consumes: 无
- Produces: 两个无参数可用的 sync 脚本；缓存目录 `${CACHE_ROOT:-$ROOT/.cache}/superpowers` 与 `.../caveman`；环境变量 `CACHE_ROOT` 可覆盖缓存位置

**背景（必读）**：现有 `sync-superpowers-skills.sh:20` 执行 `rm -rf "$PRESET/skills"`，会**删掉 3 个 caveman 技能**；`sync-caveman-skills.sh:6` 的注释已记录这一陷阱的反方向。两个脚本都必须修好这个互删问题，否则单跑任一个都会悄悄丢技能。

- [ ] **Step 1: 复现互删 bug（确认问题真实存在）**

旧脚本接受路径参数，因此可从自建缓存复现，不依赖任何外部检出。

Run:
```bash
cd $REPO && bash scripts/sync-caveman-skills.sh "$HOME/.cache-probe/caveman" 2>/dev/null || \
  (mkdir -p "$HOME/.cache-probe" && git clone --filter=blob:none -q https://github.com/JuliusBrussee/caveman "$HOME/.cache-probe/caveman")
echo "--- 先确保 caveman 技能在场 ---"
bash scripts/sync-caveman-skills.sh "$HOME/.cache-probe/caveman" >/dev/null 2>&1 || true
git -C "$HOME/.cache-probe/caveman" checkout --quiet 15581d14007fd01fb3f132016741962f34936ca2
bash scripts/sync-caveman-skills.sh "$HOME/.cache-probe/caveman" >/dev/null
echo "caveman 在场: $(ls preset/skills | grep -c '^caveman')"
```
Expected: `caveman 在场: 3`

再跑一次 superpowers 同步（旧脚本会整体替换 `preset/skills/`）：

```bash
mkdir -p "$HOME/.cache-probe" && [ -d "$HOME/.cache-probe/superpowers/.git" ] || git clone --filter=blob:none -q https://github.com/obra/superpowers "$HOME/.cache-probe/superpowers"
git -C "$HOME/.cache-probe/superpowers" checkout --quiet d884ae04edebef577e82ff7c4e143debd0bbec99
bash scripts/sync-superpowers-skills.sh "$HOME/.cache-probe/superpowers" >/dev/null
echo "同步 superpowers 后 caveman 数: $(ls preset/skills | grep -c '^caveman')"
```
Expected: `同步 superpowers 后 caveman 数: 0` —— **证明互删 bug 真实存在**

复现后恢复现场：

```bash
bash scripts/sync-caveman-skills.sh "$HOME/.cache-probe/caveman" >/dev/null && ls preset/skills | wc -l
```
Expected: `17`

- [ ] **Step 2: `.gitignore` 加缓存目录**

在 `.gitignore` 末尾追加：

```gitignore

# 自管的上游检出缓存（sync 脚本自动 clone/fetch；可重建，不入库）
.cache/
```

- [ ] **Step 3: 改写 `scripts/sync-superpowers-skills.sh` 为自管缓存**

整个文件替换为：

```bash
#!/usr/bin/env bash
# Sync the vendored Superpowers skills from a self-managed upstream cache.
#
# Skills are the upstream source of truth and are reused verbatim; this
# repository never edits a skill body. The only exception is the pointer line in
# `using-superpowers/SKILL.md`'s "Platform Adaptation" section that names this
# harness's tool-mapping reference — the one edit the upstream porting guide
# sanctions. It is re-applied here after every sync.
#
# Usage: scripts/sync-superpowers-skills.sh
#   CACHE_ROOT overrides where the upstream cache lives (default: <repo>/.cache)
#
# NOTE: this script REPLACES preset/skills wholesale. Caveman skills are a
# partial vendee living in the same directory, so they are re-synced at the end
# to avoid silently deleting them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"
CACHE_ROOT="${CACHE_ROOT:-$ROOT/.cache}"
UPSTREAM="$CACHE_ROOT/superpowers"
REPO_URL="https://github.com/obra/superpowers.git"
PIN="d884ae04edebef577e82ff7c4e143debd0bbec99"

# Fetch-or-update the cache, then check out the pinned commit. Never tracks a
# moving branch: a sync must be reproducible.
if [ ! -d "$UPSTREAM/.git" ]; then
  mkdir -p "$CACHE_ROOT"
  git clone --filter=blob:none "$REPO_URL" "$UPSTREAM"
fi
git -C "$UPSTREAM" fetch --tags --quiet origin
git -C "$UPSTREAM" checkout --quiet "$PIN"

[ -d "$UPSTREAM/skills" ] || { echo "not a superpowers checkout: $UPSTREAM" >&2; exit 1; }

# shellcheck source=scripts/sync-lib.sh
. "$ROOT/scripts/sync-lib.sh"

echo "syncing skills from $UPSTREAM at $PIN"
rm -rf "$PRESET/skills"
mkdir -p "$PRESET/skills"
cp -R "$UPSTREAM/skills/." "$PRESET/skills/"

# Re-apply the sanctioned Platform Adaptation pointer.
SKILL="$PRESET/skills/using-superpowers/SKILL.md"
if ! grep -q 'references/dsh-tools.md' "$SKILL"; then
  printf '%s\n' '- DeepSeek Harness: `references/dsh-tools.md`' >> "$SKILL"
fi

# The full-directory replace above deletes repo-local files under skills/;
# upstream never carries this harness's tool mapping, so restore it from the
# repo (tracked) when the copy did not bring it back.
TOOLS_REL="preset/skills/using-superpowers/references/dsh-tools.md"
if [ ! -f "$ROOT/$TOOLS_REL" ] && git -C "$ROOT" rev-parse --verify --quiet "HEAD:$TOOLS_REL" >/dev/null; then
  git -C "$ROOT" restore -- "$TOOLS_REL"
  echo "restored $ROOT/$TOOLS_REL (repo-local tool mapping)"
fi

write_sync_section "Superpowers" "$UPSTREAM" "$REPO_URL"

# The wholesale replace dropped the caveman skills; bring them back.
bash "$ROOT/scripts/sync-caveman-skills.sh"

echo "skills: $(find "$PRESET/skills" -name SKILL.md | wc -l) skills, $(find "$PRESET/skills" -type f | wc -l) files"
```

- [ ] **Step 4: 改写 `scripts/sync-caveman-skills.sh` 为自管缓存**

整个文件替换为：

```bash
#!/usr/bin/env bash
# Sync the vendored Caveman skills (whitelist) from a self-managed cache.
#
# Only the whitelisted skills below are vendored into this preset. Unlike
# Superpowers (which owns the whole skills tree), Caveman is a partial vendee:
# a full `rm -rf preset/skills` would delete the 14 Superpowers skills. Sync
# therefore overwrites exactly the whitelisted directories and nothing else.
#
# Usage: scripts/sync-caveman-skills.sh
#   CACHE_ROOT overrides where the upstream cache lives (default: <repo>/.cache)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRESET="$ROOT/preset"
CACHE_ROOT="${CACHE_ROOT:-$ROOT/.cache}"
UPSTREAM="$CACHE_ROOT/caveman"
REPO_URL="https://github.com/JuliusBrussee/caveman.git"
PIN="15581d14007fd01fb3f132016741962f34936ca2"

CAVEMAN_IDS=(caveman caveman-commit caveman-review)

if [ ! -d "$UPSTREAM/.git" ]; then
  mkdir -p "$CACHE_ROOT"
  git clone --filter=blob:none "$REPO_URL" "$UPSTREAM"
fi
git -C "$UPSTREAM" fetch --tags --quiet origin
git -C "$UPSTREAM" checkout --quiet "$PIN"

[ -d "$UPSTREAM/skills" ] || { echo "not a caveman checkout: $UPSTREAM" >&2; exit 1; }

# shellcheck source=scripts/sync-lib.sh
. "$ROOT/scripts/sync-lib.sh"

echo "syncing ${#CAVEMAN_IDS[@]} caveman skills from $UPSTREAM at $PIN"
for id in "${CAVEMAN_IDS[@]}"; do
  [ -f "$UPSTREAM/skills/$id/SKILL.md" ] || { echo "missing upstream skill: $id" >&2; exit 1; }
  rm -rf "$PRESET/skills/$id"
  cp -R "$UPSTREAM/skills/$id" "$PRESET/skills/"
done

# Caveman gets its own provenance block; do not clobber the Superpowers one.
write_sync_section "Caveman" "$UPSTREAM" "$REPO_URL"

# Keep the per-file content stamp in sync; this also runs the caveman presence
# assertions in build-bootstrap.sh and fails loudly on drift.
bash "$ROOT/scripts/build-bootstrap.sh" >/dev/null

echo "caveman skills: ${#CAVEMAN_IDS[@]} synced -> $PRESET/skills/{${CAVEMAN_IDS[*]}}"
```

- [ ] **Step 5: 抽出共享的 `write_sync_section` 函数**

两个脚本都调用 `write_sync_section`，但 bash 函数不跨脚本共享。新建 `scripts/sync-lib.sh`：

```bash
#!/usr/bin/env bash
# Shared helpers for the sync scripts. Sourced, never executed.

# Append one provenance section to preset/SYNC.md under a stable heading.
# Called once per upstream so each keeps its own block; the Superpowers call
# initialises the file, later calls append.
write_sync_section() {
  local label="$1" upstream="$2" url="$3"
  local file="$PRESET/SYNC.md"

  if [ ! -f "$file" ]; then
    printf '# 上游同步记录\n' > "$file"
  fi
  # Drop any previous block for this label so a re-sync replaces, not appends.
  if grep -q "^## $label$" "$file"; then
    awk -v h="## $label" '
      $0 == h { skip = 1; next }
      skip && /^## / { skip = 0 }
      !skip { print }
    ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  fi

  {
    printf '\n## %s\n\n' "$label"
    printf -- '- 上游仓库: %s\n' "$url"
    printf -- '- 本地缓存: %s\n' "$upstream"
    git -C "$upstream" log -1 --format='- commit: %H%n- date: %ad%n- subject: %s' --date=short
    if [ -f "$upstream/package.json" ]; then
      grep -m1 '"version"' "$upstream/package.json" | sed 's/^ */- package.json version: /'
    fi
    printf -- '- 同步时间: %s\n' "$(date -Iseconds)"
  } >> "$file"
}
```

然后在两个 sync 脚本的变量定义之后各加一行 source：

```bash
# shellcheck source=scripts/sync-lib.sh
. "$ROOT/scripts/sync-lib.sh"
```

并把脚本里 `write_sync_section "Superpowers" "$UPSTREAM" "$REPO_URL"` 的第三个参数确认存在（Step 3/4 的模式已带 `REPO_URL`）。

- [ ] **Step 6: 无参数跑通 caveman 同步**

Run:
```bash
cd $REPO && bash scripts/sync-caveman-skills.sh && echo "EXIT=$?" && ls preset/skills | wc -l
```
Expected: 打印 `syncing 3 caveman skills ... at 15581d1...`，`EXIT=0`，技能数 `17`

- [ ] **Step 7: 验证 SYNC.md 有两段留痕**

Run:
```bash
cd $REPO && grep -c "^## " preset/SYNC.md && grep -n "15581d14007fd01fb3f132016741962f34936ca2" preset/SYNC.md
```
Expected: 第一行至少 `1`（caveman 段；superpowers 段在 Task 1 Step 8 后出现），第二行命中 caveman 的 commit

- [ ] **Step 8: 无参数跑通 superpowers 同步并验证互删已修**

Run:
```bash
cd $REPO && bash scripts/sync-superpowers-skills.sh && echo "EXIT=$?" && echo "caveman 技能数: $(ls preset/skills | grep -c '^caveman')" && echo "技能总数: $(ls preset/skills | wc -l)"
```
Expected: `EXIT=0`，`caveman 技能数: 3`（**互删 bug 已修**），`技能总数: 17`

- [ ] **Step 9: 验证两段留痕都在，且缓存被忽略**

Run:
```bash
cd $REPO && grep -c "^## " preset/SYNC.md && git check-ignore -v .cache && git status --porcelain | grep -c cache || true
```
Expected: `2`（Superpowers 与 Caveman 两段）；命中 `.gitignore`；`0`（缓存未被追踪）

- [ ] **Step 10: 重建清单与 bootstrap（生成物同步）**

Run:
```bash
cd $REPO && npm run build:manifest >/dev/null && bash scripts/build-bootstrap.sh && echo "EXIT=$?"
```
Expected: `EXIT=0`

- [ ] **Step 11: 提交**

```bash
cd $REPO && git add .gitignore scripts/sync-lib.sh scripts/sync-superpowers-skills.sh scripts/sync-caveman-skills.sh preset/SYNC.md preset/skills && git commit -m "refactor: sync 脚本自管上游缓存并修复互删"
```

---

### Task 2: `/caveman` 命令插件

**Files:**
- Create: `preset/plugins/caveman-command/index.js`
- Create: `preset/plugins/caveman-command/package.json`
- Create: `preset/plugins/caveman-command/selftest.mjs`

**Interfaces:**
- Consumes: 无（自包含）
- Produces: 名为 `caveman-command` 的 Cordis 插件，导出 `name`、`inject`、`apply`、`CAVEMAN_LEVELS`、`parseLevel`、`createUserMessage`；注册命令 `caveman`，输入语法 `[<level>]`

**关键约束（来自 Global Constraints）**：此插件**不得 import 任何 `@deepseek-ai/*` 包**。消息对象按 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 形状自行构造。本计划选择**复制**这 15 行而非抽取共享模块，理由是 bootstrap 插件已有独立自测且已验证，抽取会带来无谓回归风险；两处都是小而稳定的代码。

- [ ] **Step 1: 写失败测试**

创建 `preset/plugins/caveman-command/selftest.mjs`：

```js
// preset/plugins/caveman-command/selftest.mjs
// Drives the installed apply() with a fake ctx — no harness, no agent needed.
import assert from 'node:assert/strict'
import { apply, inject, name, CAVEMAN_LEVELS, parseLevel } from './index.js'

let groups = 0
const report = (label) => { groups += 1; console.log(`ok ${groups} - ${label}`) }

// 1. plugin shape
assert.equal(name, 'caveman-command')
assert.deepEqual(inject, ['commands'])
report('exports name and inject')

// 2. level parsing
assert.deepEqual(parseLevel(''), { kind: 'show' })
assert.deepEqual(parseLevel('   '), { kind: 'show' })
assert.deepEqual(parseLevel('ultra'), { kind: 'set', level: 'ultra' })
assert.deepEqual(parseLevel('  OFF '), { kind: 'set', level: 'off' })
assert.deepEqual(parseLevel('bogus'), { kind: 'invalid', input: 'bogus' })
report('parseLevel handles show/set/invalid')

// 3. every advertised level round-trips
for (const level of CAVEMAN_LEVELS) {
  assert.equal(parseLevel(level).level, level)
}
report('all advertised levels parse')

// 4. registration + followup injection
const registered = []
const followed = []
const ctx = {
  commands: { register: (def) => registered.push(def) },
}
apply(ctx)
assert.equal(registered.length, 1)
const def = registered[0]
assert.equal(def.name, 'caveman')
assert.ok(typeof def.description === 'string' && def.description.length > 0)
assert.ok(typeof def.input?.hint === 'string')

const invocation = {
  rawInput: 'ultra',
  attachments: [],
  agent: { followup: (m) => followed.push(m) },
}
const result = def.handler(invocation)
assert.equal(result.kind, 'success')
assert.equal(followed.length, 1)
assert.equal(followed[0].role, 'user')
assert.equal(followed[0].source.plugin, 'caveman-command')
assert.ok(typeof followed[0].id === 'string' && followed[0].id.length > 0)
assert.ok(followed[0].content[0].text.includes('ultra'))
report('handler registers, injects one user message naming the level')

// 5. show path injects nothing
followed.length = 0
const shown = def.handler({ rawInput: '', attachments: [], agent: { followup: (m) => followed.push(m) } })
assert.equal(shown.kind, 'success')
assert.equal(followed.length, 0)
assert.ok(shown.text.includes('full'))
report('bare /caveman shows current level and injects nothing')

// 6. invalid level is an error and injects nothing
followed.length = 0
const bad = def.handler({ rawInput: 'bogus', attachments: [], agent: { followup: (m) => followed.push(m) } })
assert.equal(bad.kind, 'error')
assert.equal(followed.length, 0)
assert.ok(bad.text.includes('ultra'))
report('invalid level errors, lists valid levels, injects nothing')

console.log(`selftest OK: ${groups} assertions groups passed`)
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd $REPO/preset/plugins/caveman-command && node selftest.mjs
```
Expected: FAIL — `Cannot find module .../index.js`（实现尚未存在）

- [ ] **Step 3: 写插件清单**

创建 `preset/plugins/caveman-command/package.json`：

```json
{
  "name": "dsh-caveman-command",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Registers the /caveman command that sets this session's output compression level.",
  "main": "index.js",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2"
  }
}
```

- [ ] **Step 4: 写最小实现**

创建 `preset/plugins/caveman-command/index.js`：

```js
/**
 * The `/caveman` command for this preset.
 *
 * The `caveman` skill declares its activation contract as
 * `/caveman lite|full|ultra|wenyan-*|off`, but that syntax comes from the
 * upstream project's Claude Code slash command, which this harness does not
 * have. Without a registered command the contract is unreachable, so this
 * plugin supplies it.
 *
 * The command does NOT reimplement the level rules: it only announces the
 * chosen level as a durable user message. The `caveman` skill remains the
 * single home of the rule text and stays loadable through the `skill` tool —
 * see the "Caveman output style" section of `bootstrap.md`.
 *
 * Self-contained by the same rule as the bootstrap plugin: a preset under the
 * user's home has no `node_modules` walk that reaches the harness's packages,
 * and a `--copy` install has no such link at all. The message shape below
 * replicates `@deepseek-ai/dsh-llm`'s `createUserMessage` using only Node's
 * own UUID.
 *
 * @module dsh-caveman-command
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name. */
const name = 'caveman-command'

/** The `commands` service is host-plane; a preset row resolves it. */
const inject = ['commands']

/** Levels the `caveman` skill defines. Kept as names only; rules stay in the skill. */
const CAVEMAN_LEVELS = Object.freeze([
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan-full',
  'wenyan-ultra',
  'off',
])

/** The level a session starts at, matching the injected default. */
const DEFAULT_LEVEL = 'full'

/** Deep-freeze a message the way the harness publishes its own messages. */
function deepFreeze(value) {
  if (value instanceof Object && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
  }
  return value
}

/** Build one immutable user-role message with a fresh identity. */
function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))
}

/**
 * Parse the command's own grammar. Arbitrary other input is an invalid level,
 * never a silent no-op.
 *
 * @param rawInput - the text after `/caveman`.
 * @returns a discriminated result the handler can render.
 */
function parseLevel(rawInput) {
  const input = String(rawInput ?? '').trim()
  if (input.length === 0) return { kind: 'show' }
  const level = input.toLowerCase()
  if (CAVEMAN_LEVELS.includes(level)) return { kind: 'set', level }
  return { kind: 'invalid', input }
}

/** Human-readable usage line. */
const USAGE = `Usage: /caveman [${CAVEMAN_LEVELS.join('|')}]`

/**
 * Execute one `/caveman` invocation.
 *
 * @param invocation - the harness's command invocation.
 * @returns a command result the UI renders.
 */
function executeCavemanCommand(invocation) {
  const command = parseLevel(invocation.rawInput)

  if (command.kind === 'show') {
    return {
      kind: 'success',
      text: [`Caveman output style: ${DEFAULT_LEVEL} (default)`, '', USAGE].join('\n'),
    }
  }

  if (command.kind === 'invalid') {
    return {
      kind: 'error',
      text: [`Unknown level: ${command.input}`, '', USAGE].join('\n'),
    }
  }

  // Durable announcement: the next model turn reads the level from the
  // conversation, exactly as the injected default does.
  const announcement =
    command.level === 'off'
      ? 'Caveman output style: off. Answer in normal prose from now on, and do not load the `caveman` skill.'
      : `Caveman output style: ${command.level}. Load the \`caveman\` skill with the \`skill\` tool and apply its \`${command.level}\` level to every response. Superpowers workflow artifacts stay complete and structured, and take priority over compression.`

  invocation.agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: announcement }],
      source: { kind: 'plugin', plugin: name },
    }),
  )

  return {
    kind: 'success',
    text: `Caveman output style set to ${command.level}.`,
  }
}

/**
 * Register `/caveman` for every composed command adapter.
 *
 * @param ctx - the mounting context.
 */
function apply(ctx) {
  ctx.commands.register({
    name: 'caveman',
    description: "set this session's output compression level",
    input: { hint: `[${CAVEMAN_LEVELS.join('|')}]` },
    handler: (invocation) => executeCavemanCommand(invocation),
  })
}

export { CAVEMAN_LEVELS, DEFAULT_LEVEL, apply, createUserMessage, inject, name, parseLevel }
```

- [ ] **Step 5: 跑测试确认通过**

Run:
```bash
cd $REPO/preset/plugins/caveman-command && node selftest.mjs
```
Expected: `selftest OK: 6 assertions groups passed`

- [ ] **Step 6: 静态检查**

Run:
```bash
cd $REPO/preset/plugins/caveman-command && node --check index.js && node --check selftest.mjs && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] **Step 7: 提交**

```bash
cd $REPO && git add preset/plugins/caveman-command && git commit -m "feat: 新增 /caveman 命令插件（自包含，不改写技能）"
```

---

### Task 3: bootstrap 注入 caveman 默认与优先级

**Files:**
- Modify: `scripts/build-bootstrap.sh`
- Modify: `preset/agent.cordis.yml`（persona 段）

**Interfaces:**
- Consumes: 无
- Produces: `preset/bootstrap.md` 含 `## Caveman output style` 一节与 `It is NOT active yet` 声明

**关键约束**：必须写明"尚未激活"。若照抄 `using-superpowers` 的 `ALREADY ACTIVE: do not try to load` 模式，用户切换级别时模型不会加载技能，级别契约不可达 —— 这正是本次 bug 的同型错误。

- [ ] **Step 1: 写失败测试（bootstrap 内容断言）**

在 `scripts/build-bootstrap.sh` 的现有自检 `for pat in ...` 循环中追加两个必需模式。把该行改为：

```bash
for pat in 'The Rule' 'Red Flags' 'DeepSeek Harness tool mapping' 'Dispatch a subagent' 'subagent_fork' 'Repository rules take precedence' 'Caveman output style' 'It is NOT active yet'; do
```

- [ ] **Step 2: 跑构建确认失败**

Run:
```bash
cd $REPO && bash scripts/build-bootstrap.sh; echo "EXIT=$?"
```
Expected: FAIL，打印 `build-bootstrap: missing section: Caveman output style`，`EXIT=1`

- [ ] **Step 3: 在 FOOTER 中加入 caveman 一节**

把 `scripts/build-bootstrap.sh` 里 `cat <<'FOOTER'` 与 `FOOTER` 之间的内容替换为：

```bash
cat <<'FOOTER'
## Caveman output style

Default compression level: **full**. Terse like smart caveman — all technical
substance stays, only fluff dies.

Superpowers workflow artifacts — plans, specs, designs, review comments, TDD
red/green explanations, pre-edit clarifications — stay complete, structured,
and take priority over compression.

The `caveman` skill holds the level definitions. It is NOT active yet: load it
with the `skill` tool when the user changes the level, or when you need the full
rule set. Levels: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra, off.
The `/caveman` command sets the level; without it, obey an explicit level request
in plain language.

## Repository rules take precedence

The workspace's own instruction files (`AGENTS.md`, `CLAUDE.md`, local overlays)
and any direct human instruction override every skill in this library. When a
repository rule conflicts with generic skill advice — commit message format, one
subsystem per commit, AI-assistance disclosure, no fabricated test evidence,
no unattended push or PR — **the repository rule wins**.
</EXTREMELY_IMPORTANT>
FOOTER
```

- [ ] **Step 4: 跑构建确认通过**

Run:
```bash
cd $REPO && bash scripts/build-bootstrap.sh; echo "EXIT=$?"
```
Expected: 打印 `built .../preset/bootstrap.md (N bytes, M lines)`，`EXIT=0`

- [ ] **Step 5: 断言注入文本的两条关键性质**

Run:
```bash
cd $REPO && grep -c "Caveman output style" preset/bootstrap.md && grep -c "It is NOT active yet" preset/bootstrap.md && grep -c "ALREADY ACTIVE: do not try to load \`caveman\`" preset/bootstrap.md || true
```
Expected: `1`、`1`、`0`（第三节必须为 0：不得把 caveman 宣告为已激活）

- [ ] **Step 6: 修正 persona**

把 `preset/agent.cordis.yml` 中这一段（原第 39 行）：

```
      For routine engineering chat and implementation notes, answer concisely (caveman lite): drop pleasantries, keep every technical entity, code, command, and exact error verbatim. Superpowers workflow artifacts — plans, specs, designs, review comments, TDD red/green explanations, pre-edit clarifications — stay complete, structured, and take priority over compression. Tune with `/caveman full|ultra|off`; `/caveman-commit` and `/caveman-review` apply terse output within their own scopes.
```

替换为：

```
      Output style: caveman, level full (see the injected "Caveman output style"
      section). Keep every technical entity, code, command, and exact error verbatim.
      Superpowers workflow artifacts — plans, specs, designs, review comments, TDD
      red/green explanations, pre-edit clarifications — stay complete, structured,
      and take priority over compression. The `/caveman` command changes the level;
      the `caveman` skill holds the level rules and is loaded on demand.
```

- [ ] **Step 7: 组装校验（YAML 仍合法）**

Run:
```bash
cd $REPO && node -e "const y=require('node:fs').readFileSync('preset/agent.cordis.yml','utf8');console.log('top-level rows:',(y.match(/^- id:/gm)||[]).length)" && grep -c "caveman lite" preset/agent.cordis.yml || true
```
Expected: `top-level rows: 19`（与改动前一致），第二项 `0`（旧措辞已消失）

- [ ] **Step 8: 提交**

```bash
cd $REPO && git add scripts/build-bootstrap.sh preset/bootstrap.md preset/agent.cordis.yml preset/.manifest.json && git commit -m "feat: bootstrap 注入 caveman 默认 full 与流程产物优先级"
```

---

### Task 4: 挂载命令插件

**Files:**
- Modify: `preset/agent.cordis.yml`
- Modify: `scripts/build-manifest.mjs`（若其排除列表需同步；先读确认）

**Interfaces:**
- Consumes: Task 2 的 `./plugins/caveman-command/index.js`
- Produces: 组合中多一行插件挂载，`/caveman` 在该 preset 下可用

- [ ] **Step 1: 在组合中加入插件挂载行**

在 `preset/agent.cordis.yml` 的 goal 段之后（`- id: tool-goal` 行块之后）插入：

```yaml
# The `/caveman` command. Preset-local and self-contained: the `caveman` skill
# declares a `/caveman <level>` contract, but that syntax ships upstream as a
# Claude Code slash command this harness does not have. The row name is a
# preset-relative specifier, so the loader resolves it against this preset.
- id: caveman-command
  name: './plugins/caveman-command/index.js'
```

- [ ] **Step 2: 校验组合行数与 YAML 合法性**

Run:
```bash
cd $REPO && node -e "const y=require('node:fs').readFileSync('preset/agent.cordis.yml','utf8');const n=(y.match(/^- id:/gm)||[]).length;console.log('top-level rows:',n)" && grep -c "caveman-command" preset/agent.cordis.yml
```
Expected: `top-level rows: 20`（由 19 增至 20），命中 `1` 行插件引用（另有注释行不计入 grep 计数时可能为 2）

- [ ] **Step 3: 重建清单**

Run:
```bash
cd $REPO && npm run build:manifest >/dev/null && node -e "const m=require('./preset/.manifest.json');console.log(Object.keys(m.files).filter(k=>k.includes('caveman-command')).join('\n'))"
```
Expected: 列出 `plugins/caveman-command/index.js` 与 `plugins/caveman-command/package.json`

- [ ] **Step 4: 跑既有测试确认未破坏**

Run:
```bash
cd $REPO && npm test 2>&1 | tail -6
```
Expected: `pass 11`、`fail 0`

- [ ] **Step 5: 提交**

```bash
cd $REPO && git add preset/agent.cordis.yml preset/.manifest.json && git commit -m "feat: 组合挂载 /caveman 命令插件"
```

---

### Task 5: 产品改名

**Files:**
- Modify: `preset/preset.yml`、`index.js`、`cordis.patch.yml`、`package.json`、`scripts/plant-core.mjs`、`scripts/install.sh`、`scripts/build-bootstrap.sh`、`scripts/index.test.mjs`、`scripts/plant-core.test.mjs`、`README.md`
- Rename: `preset/plugins/superpowers-bootstrap/` → `preset/plugins/bootstrap/`
- Modify: `docs/feasibility-report.md`、`evidence/VERIFICATION.md`（只加状态说明）

**Interfaces:**
- Consumes: Task 1–4 的成果
- Produces: preset ID `engineering`、显示名 `工程模式`、插件目录 `plugins/bootstrap/`

**纪律**：上游名与 `docs/superpowers/` 路径**不得改动**。历史文档只加说明、不改正文。

- [ ] **Step 1: 建立单一事实来源（预设 ID 常量）**

在 `scripts/plant-core.mjs` 中，把 `plant` 的默认 name 改为引用一个导出常量。找到 `export async function plant({ source, destRoot, name = 'superpowers', policy = 'copy' }) {`，在其上方加入：

```js
/** The preset id this bundle installs under. Single source of truth. */
export const PRESET_ID = 'engineering'
```

并把该签名改为：

```js
export async function plant({ source, destRoot, name = PRESET_ID, policy = 'copy' }) {
```

- [ ] **Step 2: 改安装器与包名**

`index.js`：把 `doInstall` 的默认 name 与插件名、日志前缀改为 `engineering`：

```js
export async function doInstall({ destRoot, name = 'engineering' } = {}) {
```

同时把 `export default { name: 'superpowers-installer', ... }` 改为 `name: 'engineering-installer'`，并把两处日志前缀 `superpowers:` 改为 `engineering:`。

`cordis.patch.yml`：

```yaml
# cordis.patch.yml
- insert:
    - id: engineering-installer
      name: '@engineering-dsh/engineering-dsh'
```

`package.json`：`name` 改 `@engineering-dsh/engineering-dsh`，`description` 改 `"Superpowers and Caveman skills as a DeepSeek Harness agent preset bundle."`，并新增 pretest 钩子（修 P1：干净检出下 `npm test` 因缺 `preset/.manifest.json` 必然失败）：

```json
    "pretest": "npm run build:manifest",
    "test": "node --test scripts/*.test.mjs"
```

`scripts/install.sh`：`DEST="$DEST_ROOT/superpowers"` 改 `engineering`；`--name superpowers` 改 `--name engineering`；`installed preset id: superpowers` 改 `engineering`；`sp_probe validate=superpowers` 改 `validate=engineering`；第 8 行注释路径改 `engineering`；末尾 `cd "$SRC/plugins/superpowers-bootstrap"` 改 `"$SRC/plugins/bootstrap"`。

- [ ] **Step 3: 重命名插件目录并改其产品名**

Run:
```bash
cd $REPO && git mv preset/plugins/superpowers-bootstrap preset/plugins/bootstrap && ls preset/plugins
```
Expected: 列出 `bootstrap` 与 `caveman-command`

`preset/plugins/bootstrap/package.json`：`name` 改 `dsh-bootstrap`；`description` 改为 `"Injects the Superpowers bootstrap and the Caveman default style as durable user-role context for agents on this preset."`

`preset/plugins/bootstrap/index.js`：插件名常量 `const name = 'superpowers-bootstrap'` 改 `'bootstrap'`；模块 JSDoc `@module dsh-superpowers-bootstrap` 改 `dsh-bootstrap`；日志前缀 `superpowers-bootstrap:` 改 `bootstrap:`。**注意**：`DEFAULT_BOOTSTRAP_URL` 的 `'../../bootstrap.md'` 与目录深度不变，不要改（新目录仍位于 `preset/plugins/<name>/`）。

- [ ] **Step 4: 改组合与显示名**

`preset/agent.cordis.yml`：插件路径行 `name: './plugins/superpowers-bootstrap/index.js'` 改 `'./plugins/bootstrap/index.js'`；文件头注释里两处 `plugins/superpowers-bootstrap` 改 `plugins/bootstrap`。

`preset/preset.yml`：

```yaml
name: 工程模式
description: 在标准模式之上集成 Superpowers 技能方法论与 Caveman 压缩风格：设计澄清 → 实施计划 → 子代理驱动开发 → TDD → 评审与验证，且默认以 full 级压缩表达。bootstrap 由模式自带插件在每个会话自动注入，技能随模式分发，无需逐会话手动开启。
order: 5
```

- [ ] **Step 5: 改测试断言与 fixture**

`scripts/plant-core.test.mjs`：把全部 8 处 `'superpowers'` 改为 `'engineering'`（第 52、53、69、78、92、98、99、108 行的 dest 路径拼接）。建议导入常量以免再次硬编码：

在 import 行加入 `PRESET_ID`：

```js
import { hashFile, walkFiles, buildManifestMap, plant, PRESET_ID } from './plant-core.mjs';
```

然后把 `join(destRoot, 'superpowers', ...)` 全部改为 `join(destRoot, PRESET_ID, ...)`。并在文件顶部加一个断言，锁死 ID：

```js
test('PRESET_ID is the documented preset id', () => {
  assert.equal(PRESET_ID, 'engineering');
});
```

`scripts/index.test.mjs`：测试名与断言改为：

```js
test('doInstall plants bundled preset to destRoot/engineering', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.action, 'planted');
  const comp = await readFile(join(destRoot, 'engineering', 'agent.cordis.yml'), 'utf8');
  assert.ok(comp.includes('plugins/bootstrap'));
});
```

- [ ] **Step 6: 跑测试确认改名未破坏安装器**

Run:
```bash
cd $REPO && npm test 2>&1 | tail -6
```
Expected: `pass 12`（原 11 + 新增的 PRESET_ID 断言）、`fail 0`

- [ ] **Step 7: 重建生成物**

Run:
```bash
cd $REPO && bash scripts/build-bootstrap.sh && echo "EXIT=$?" && grep -c "Caveman output style" preset/bootstrap.md
```
Expected: `EXIT=0`，`1`

- [ ] **Step 8: 给历史文档加状态说明（不改正文）**

在 `docs/feasibility-report.md` 的 `# 将 Superpowers 适配并集成为 DSH 新模式 —— 可行性分析报告` 之后、现有"占位符约定"引用块**之前**插入：

```markdown
> **历史记录**：本报告成文于 2026-09-12，当时该项目名为 `superpowers-dsh`、preset 显示名为 `Superpowers 模式`。此后项目更名为 `engineering-dsh`、显示名为 `工程模式`。正文中的旧名与当时实测的命令输出**保持原样**，以免破坏本文件"命令可复现"的性质。
```

在 `evidence/VERIFICATION.md` 的 `# 验证记录` 之后、现有"占位符约定"引用块**之前**插入：

```markdown
> **历史记录**：本记录成文于 2026-09-12，当时 preset id 为 `superpowers`。此后更名为 `engineering`。正文中的旧 id 与实测输出**保持原样**（例如 `sp_probe validate=superpowers`），因为它们记录的是当时真实跑过的命令。
```

- [ ] **Step 9: 改名验证（精确规则）**

Run:
```bash
cd $REPO && grep -rn "superpowers" --include=* . 2>/dev/null \
  | grep -v "^\./\.git/" | grep -v "^\./\.cache/" | grep -v "^\./preset/skills/" \
  | grep -v "^\./docs/superpowers/" | grep -v "obra/superpowers" \
  | grep -v "^\./docs/feasibility-report\.md" | grep -v "^\./evidence/VERIFICATION\.md" \
  | grep -v "^\./scripts/sync-superpowers-skills\.sh" | grep -v "^\./\.tmp-"
echo "剩余命中: $?"
```
Expected: 无输出（`$?` 为 1）。若非空，逐条判定：只有属于上游名或技能产物路径的才可保留。

- [ ] **Step 10: 提交**

```bash
cd $REPO && git add -A && git commit -m "refactor: 产品改名 superpowers -> engineering（显示名 工程模式）"
```

---

### Task 6: README 重写与整体验证

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1–5 的全部成果
- Produces: 与项目现况一致的 README；通过 spec §8 全部断言

- [ ] **Step 1: 重写 README**

`README.md` 整体替换为下列内容（保留原有技术细节的准确部分，更新名称、技能清单、上游、缓存与命令）：

````markdown
# engineering-dsh

把两套上游技能方法论适配为 **DeepSeek Harness 的一个模式**：`工程模式`。

- [Superpowers](https://github.com/obra/superpowers)（v6.1.1）—— 流程严谨：设计澄清 → 实施计划 → 子代理驱动开发 → TDD → 评审 → 验证。
- [Caveman](https://github.com/JuliusBrussee/caveman)（3 个白名单技能）—— 输出压缩：默认 full 级，去掉客套与填充，保留全部技术实体。

这不是给 DSH 打补丁，而是按 Superpowers 官方的宿主移植契约做一个 **Shape B** 移植：一个进程内插件把 bootstrap 在会话开始时注入模型上下文；DSH 的 preset（模式）机制天然满足"自动注入、无需逐会话 opt-in"这条唯一不可协商的要求。

## 自动生效的两件事

| 能力 | 保障方式 |
|---|---|
| `using-superpowers` 引导 | 正文**注入**（`agent/pre-step`），每会话必达 |
| Caveman 默认 full 与流程产物优先级 | 同上，注入 `bootstrap.md` 的 "Caveman output style" 一节 |
| Caveman 级别定义 | **技能**保留在 catalog，按需加载 |

第三行是刻意的：`caveman` 是带运行时可调参数的风格规则，若把它的正文宣告为"已激活、勿加载"，级别切换就不可达。所以注入只写默认值与优先级，规则单份留在技能内。

## 级别切换

```
/caveman              # 显示当前级别与用法
/caveman ultra        # 切到 ultra
/caveman off          # 恢复正常表达
```

`/caveman` 由预设自带插件 `preset/plugins/caveman-command/` 注册。上游把它交付为 Claude Code 的 slash command，本 harness 没有该机制，所以这里自己实现；命令只宣告级别，规则文本不重复。

## 目录结构

```
engineering-dsh/
├── index.js                         # bundle 安装器插件
├── cordis.patch.yml                 # bundle 挂载声明
├── preset/                          # 这个目录就是被 DSH 挂载的"模式"
│   ├── preset.yml                   # 显示名与描述（模式选择器读它）
│   ├── agent.cordis.yml             # 组合：persona + 标准工具面 + 插件 + 技能目录
│   ├── bootstrap.md                 # 生成物：using-superpowers 正文 + caveman 默认 + 工具映射
│   ├── SYNC.md                      # 生成物：各上游 commit / 同步时间
│   ├── plugins/
│   │   ├── bootstrap/               # 注入插件（agent/pre-step，幂等，压缩后自愈）
│   │   └── caveman-command/         # /caveman 命令插件
│   └── skills/                      # vendored：Superpowers 14 + Caveman 3 + 1 份工具映射
├── scripts/
│   ├── sync-superpowers-skills.sh   # 自管缓存同步 14 个技能并重打 DSH 指针
│   ├── sync-caveman-skills.sh       # 白名单同步 3 个 caveman 技能
│   ├── sync-lib.sh                  # 两个 sync 共用的 SYNC.md 写入
│   ├── build-bootstrap.sh           # 重建 bootstrap.md（带自检）
│   ├── build-manifest.mjs           # 生成逐文件 sha-256 清单
│   ├── plant-core.mjs               # 植入引擎
│   └── install.sh                   # 投影到 ${DSH_HOME}/.agent-presets/engineering
└── .cache/                          # sync 自管的上游检出（gitignore，可重建）
```

## 安装 / 刷新

```sh
scripts/build-bootstrap.sh          # 技能有变动时先跑
scripts/install.sh                  # 默认：真实目录 + 逐项符号链接（改动即时生效）
scripts/install.sh --copy           # 深拷贝（检出可能被删除的机器）
```

之后**新建**一个会话，在模式选择器里选 `工程模式`。会话一旦开始就不能切换模式（DSH 的设计），所以必须新建。

### 为什么安装成"真实目录 + 符号链接"

preset 发现用 `readdir(root, { withFileTypes: true })` 并只接受 `isDirectory()` 为真的条目。**指向目录的符号链接会被静默跳过**（`isDirectory()` 返回 false），所以不能把 `~/.dsh/.agent-presets/engineering` 直接做成指向本检出的符号链接。`install.sh` 因此创建一个真实目录，内部每个条目是符号链接——既被发现，又保持改动即时生效。

预设本地插件**自包含**：不 import 任何 harness 包（消息对象用 `node:crypto` 构造）。原因是本地创作的 preset 位于用户家目录，Node 的 `node_modules` 上行查找到不了 harness 自己的包，而 `--copy` 安装模式连链接都没有。

## 上游同步

两个脚本都**自管缓存**，无需传入路径：

```sh
scripts/sync-superpowers-skills.sh   # -> .cache/superpowers，锁定 commit
scripts/sync-caveman-skills.sh       # -> .cache/caveman，锁定 commit
```

`CACHE_ROOT` 可覆盖缓存位置。**锁定 commit，不追最新分支**——同步必须可复现。两个脚本会互相补齐：同步 superpowers 会整体替换 `preset/skills/`，因此结束时自动重跑 caveman 同步，避免静默删掉那 3 个技能。

## 验证

**1. 插件自测（不需要 running agent，秒级）**

```sh
(cd preset/plugins/bootstrap && node selftest.mjs)
(cd preset/plugins/caveman-command && node selftest.mjs)
```

**2. 安装器测试**

```sh
npm test          # 12 passed
```

**3. 端到端（需要人类，唯一的最终证据）**

新建会话选 `工程模式`，发：

> Let's make a react todo list

期望：模型**在写任何代码之前**先加载 `brainstorming` 技能，且回复默认即为压缩风格。随后试 `/caveman off` 与 `/caveman ultra` 观察风格变化。

## 设计要点

- **注入的是 user 角色消息，不是 system 消息**：符合上游 Shape B 纪律，也是 DSH 记录持久上下文的方式（`source: { kind: 'plugin', plugin }`）。
- **幂等靠内容标记**：注入文本带 `<EXTREMELY_IMPORTANT>`；每次 pre-step 扫描本步将进入的消息，已在场就什么都不做。
- **压缩后自愈**：DSH 没有压缩事件可订阅，也不需要——压缩把旧历史换成摘要后，标记从"将进入的消息"里消失，下一次 pre-step 自动重新注入。
- **persona 段保持简短**：9 KB 正文交给一次性注入的消息，避免每轮重复付费。persona 用 `complete: false`（它是必填字段，省略会挂载失败）。
- **不改技能正文**：唯一例外是官方允许的 Platform Adaptation 指针行。

## 已知边界

| 边界 | 说明 |
|---|---|
| 无原生 worktree 工具 | `using-git-worktrees` 只能走 `git worktree add` 回退；受文件沙箱约束时必须建在 workspace 内 |
| 不做 push/PR | `finishing-a-development-branch` 只做验证与选项呈现；push、建 PR、合并是人类的动作 |
| 可视化伴侣 | brainstorming 的可选本地服务器可用 `bash run_in_background` 起；需人类自己打开 URL |
| 不承诺硬性门禁 | DSH 没有能真正阻断"模型跳过技能直接写代码"的原语。本模式是强引导 + 可观察性，不是强制流程 |
| 级别切换依赖插件 | `/caveman` 是本仓库实现；上游的 slash command 形态在 DSH 不适用 |
| 上游同步是手动的 | 运行两个 sync 脚本，然后 `build-bootstrap.sh` 与 `install.sh` |

## 上游与许可

- Superpowers：MIT，© Jesse Vincent / Prime Radiant，<https://github.com/obra/superpowers>
- Caveman：<https://github.com/JuliusBrussee/caveman>
- 本目录中的 `preset/skills/**` 是上游内容的原样 vendored 副本，版本见 `preset/SYNC.md` 与 `THIRD-PARTY-NOTICES.md`
````

- [ ] **Step 2: 跑 spec §8 的全部断言**

Run:
```bash
cd $REPO && echo "--- 改名 ---" && grep -c "^name: 工程模式" preset/preset.yml && echo "--- 注入 ---" && grep -c "Caveman output style" preset/bootstrap.md && grep -c "It is NOT active yet" preset/bootstrap.md && echo "--- 缓存 ---" && git check-ignore -v .cache && echo "--- 回归 ---" && npm test 2>&1 | tail -4
```
Expected: `1`；`1`；`1`；命中 `.gitignore`；`pass 12 / fail 0`

- [ ] **Step 3: 插件自测全跑**

Run:
```bash
cd $REPO && (cd preset/plugins/bootstrap && node selftest.mjs) && (cd preset/plugins/caveman-command && node selftest.mjs)
```
Expected: 两条 `selftest OK`

- [ ] **Step 4: 工作区干净且提交**

```bash
cd $REPO && git add README.md && git commit -m "docs: 重写 README 以反映工程模式（双上游、缓存、/caveman）" && git status --porcelain && git log --oneline | head -8
```
Expected: 工作区空；8 条提交历史

---

## Self-Review 记录

**Spec 覆盖**：§1.1/1.2 → Task 3；§1.3 → Task 5；§1.4/1.5 → Task 1；§2 → Task 1 Step 7（留痕）；§4.2 → Task 3 Step 3；§4.3 → Task 3 Step 6；§4.4 → Task 3 + Task 2；§5 → Task 5；§6.2 → Task 1；§6.3 → Task 1 Step 5；§7 → Task 2 + Task 4；§8 → Task 6 Step 2。

**已知偏离 spec 之处（计划阶段发现）**：spec §7.1 的示例代码用 `ctx.commands.register` 且未说明消息构造方式；计划补充了实测得到的约束——插件不得 import harness 包，必须复制 `createUserMessage` 形状（依据：检出目录解析 `@deepseek-ai/dsh-llm` 失败、`--copy` 模式无链接）。spec 未提及；计划以此为准。

**类型一致性**：`parseLevel` 返回 `{kind:'show'|'set'|'invalid'}`，与 selftest 断言一致；`CAVEMAN_LEVELS` 的 7 个级别在插件、selftest、bootstrap 文本三处一致。
