# 任务分档（Task sizing）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在注入文本里加一节自著规则，按可核查的改动半径与四族硬闸把 Superpowers 流程分三档，让小改动不再产生 spec/plan 文档与子代理派发。

**Architecture:** 上游技能正文逐字 vendored、不可改，而被覆盖的文本（`using-superpowers` 的 1% 规则与 Red Flags 表）是每会话注入的 —— 所以覆盖物必须同为注入文本。落点是 `scripts/build-bootstrap.sh` 的 FOOTER here-doc（既有 `## Repository rules outrank these skills` 已开此先例），生成物 `preset/bootstrap.md` 由该脚本重建。注入节零项目专有名词，本仓库如何实例化只写在 spec §8。三个守卫测试读生成物与 persona，防未来 sync 或误删把规则冲掉。

**Tech Stack:** Bash（`scripts/build-bootstrap.sh`）、Node `node:test` + `node:assert/strict`（守卫测试）、YAML（`preset/agent.cordis.yml` 的 persona 块标量）、Markdown（文档与注入文本）。

**Spec:** `docs/superpowers/specs/2026-09-16-task-sizing-design.md`

## Global Constraints

- **不改任何 vendored 技能正文**（`preset/skills/**`）。移植契约要求逐字复用；同步脚本会整棵替换该目录。
- **注入节零项目专有名词**：不得出现 `cordis`、`manifest.json`、`preset/`、`dsh-engineering`、`engineering-dsh`、`npm test`。它被注入任意工作区。
- **生成物只经脚本更新**：`preset/bootstrap.md` 由 `bash scripts/build-bootstrap.sh` 重建，从不手改。`preset/.manifest.json` 被 `.gitignore:9` 忽略，**永不 `git add`**。
- **门限值固定**：A 档 ≤3 文件 且 diff ≤50 行；B 档 ≤5 文件（无行数上限）；其余 C 档。diff 行数 = `git diff --numstat` 的「新增 + 删除」之和。
- **硬闸标签固定**：`**G1**` 不可逆/外部可见、`**G2**` 公共契约面、`**G3**` 安全与正确性高风险面、`**G4**` 安全网自改。
- **验证证据必须真实**：粘贴实测输出，禁止编造。改动的生效边界是**新建会话**，当前会话看不到。
- **提交约定**：Conventional Commits + 中文主题；一个子系统一个 commit；不 `push`。
- **测试终值**：`npm test` → `tests 21`、`pass 21`、`fail 0`（现有 18 + 新 3）。

## File Structure

| 文件 | 责任 | 本次动作 |
|---|---|---|
| `scripts/build-bootstrap.sh` | 组装 `preset/bootstrap.md` + self-check 段存活 | FOOTER 加注入节；self-check pattern 列表加 3 条 |
| `scripts/task-sizing.test.mjs` | 守卫：生成物含分档规则、覆盖句点名上游、persona 不再自相矛盾 | 新建（3 个测试） |
| `preset/agent.cordis.yml` | 组合与 persona | persona 一行改为按档位生效 |
| `preset/bootstrap.md` | 生成物，每会话注入 | 由脚本重建（git 跟踪） |
| `preset/.manifest.json` | 生成物逐文件哈希 | 由脚本重建（gitignore，不提交） |
| `README.md` | 用户文档 | 「三件事」升为四件；新增「任务分档」一节；测试计数 18 → 21 |
| `evidence/VERIFICATION.md` | 验证记录（真实输出） | 追加本次复验节 |

---

### Task 1: 注入节主体（三档 + 四族硬闸 + 闭合规则 + 各档流程）与组装守卫

**Files:**
- Create: `scripts/task-sizing.test.mjs`
- Modify: `scripts/build-bootstrap.sh`（FOOTER here-doc，插在 `## Repository rules take precedence` 之前；以及 `for pat in ...` 那行）
- Regenerated（不手改、不提交 manifest）: `preset/bootstrap.md`、`preset/.manifest.json`

**Interfaces:**
- Consumes: 既有 FOOTER here-doc 结构（`scripts/build-bootstrap.sh:45-69`）与 self-check 循环（`scripts/build-bootstrap.sh:74`）
- Produces:
  - 生成物 `preset/bootstrap.md` 内含 `## Task sizing (harness override)` 节，含 `| A direct |`、`| B light |`、`| C full |` 三行与 `**G1**`–`**G4**` 四个标签
  - `scripts/task-sizing.test.mjs` 导出常量 `read(rel)` 与 `sectionOf(bootstrap)` —— Task 2 在同一文件续写测试时复用

- [ ] **Step 1: 写失败的测试（仅第三条轨道/硬闸/通用性断言）**

创建 `scripts/task-sizing.test.mjs`，内容逐字如下：

```js
// scripts/task-sizing.test.mjs
//
// Guards the harness-authored "Task sizing" section that build-bootstrap.sh
// injects into every session. That section is the only local override of the
// vendored `using-superpowers` body — and that body forbids the very judgement
// the section requires (`| "The skill is overkill" | ... | Use it. |`). Losing
// the section silently restores the every-task-full-process treadmill, so
// these assertions read the generated artifact, not the source that writes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Scope every text assertion to the section itself: preset/bootstrap.md also
// carries the vendored bodies, which are full of prose that would mask a
// missing or polluted section.
const sectionOf = (bootstrap) =>
  bootstrap.slice(bootstrap.indexOf('## Task sizing (harness override)')).split('\n## ')[0];

test('bootstrap.md carries the three tracks and the four hard gates', async () => {
  const bootstrap = await read('../preset/bootstrap.md');
  for (const needle of [
    '## Task sizing (harness override)',
    '| A direct |',
    '| B light |',
    '| C full |',
    '**G1**',
    '**G2**',
    '**G3**',
    '**G4**',
  ]) {
    assert.ok(
      bootstrap.includes(needle),
      `preset/bootstrap.md must contain ${JSON.stringify(needle)}. It is a ` +
        `generated file: add the section to the FOOTER here-doc in ` +
        `scripts/build-bootstrap.sh and re-run it.`,
    );
  }

  // The section is injected into arbitrary workspaces, so it must stay
  // project-agnostic. How this repository instantiates the gates belongs in
  // docs/superpowers/specs/2026-09-16-task-sizing-design.md §8, not in the
  // injected text.
  const section = sectionOf(bootstrap);
  for (const noun of [
    'cordis',
    'manifest.json',
    'preset/',
    'dsh-engineering',
    'engineering-dsh',
    'npm test',
  ]) {
    assert.ok(
      !section.includes(noun),
      `the injected "Task sizing" section must not name ${JSON.stringify(noun)}: ` +
        `it is injected into arbitrary workspaces, so it must stay ` +
        `project-agnostic. Move the project-specific wording into the spec.`,
    );
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/task-sizing.test.mjs`

Expected: FAIL。`fail 1`、`pass 0`，断言信息含

```
must contain "## Task sizing (harness override)"
```

- [ ] **Step 3: 实现 —— FOOTER 加节 + self-check 加 pattern**

在 `scripts/build-bootstrap.sh` 的 FOOTER here-doc 内，把下面这段插到 `## Repository rules take precedence` 之前（保持 here-doc 原有的缩进层级：这两行在 `cat <<'FOOTER'` 与 `</EXTREMELY_IMPORTANT>` 之间，顶格）：

```md
## Task sizing (harness override)

Process scales with the task. Declare the track in one line before touching
code, e.g. `Track B — 3 files, private helper only`.

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

然后把 `scripts/build-bootstrap.sh:74` 的 pattern 列表从

```bash
for pat in 'The Rule' 'Red Flags' 'DeepSeek Harness tool mapping' 'Dispatch a subagent' 'subagent_fork' 'Repository rules take precedence' 'Caveman output style' 'It is NOT active yet'; do
```

改为

```bash
for pat in 'The Rule' 'Red Flags' 'DeepSeek Harness tool mapping' 'Dispatch a subagent' 'subagent_fork' 'Task sizing' 'G4' 'never downgrade' 'Repository rules take precedence' 'Caveman output style' 'It is NOT active yet'; do
```

- [ ] **Step 4: 重建生成物并跑测试确认通过**

Run:

```bash
bash scripts/build-bootstrap.sh
node --test scripts/task-sizing.test.mjs
```

Expected: 第一行打印 `built <path>/preset/bootstrap.md (<N> bytes, <M> lines)`（N 应≈11.4 KB，M 应≈220）；第二行 `pass 1`、`fail 0`。若 self-check 报 `build-bootstrap: missing section: Task sizing`，说明 Step 3 的插入位置不在 here-doc 内。

- [ ] **Step 5: 提交**

```bash
git add scripts/build-bootstrap.sh scripts/task-sizing.test.mjs preset/bootstrap.md
git commit -F - <<'EOF'
feat: 注入任务分档规则（三档门限 + 四族硬闸）

上游正文逐字 vendored、不能改，而被它覆盖的 1% 规则与 Red Flags 表
（`using-superpowers/SKILL.md:47`："The skill is overkill" → "Use it."）是
每会话注入的——覆盖物必须同为注入文本。落点是 build-bootstrap.sh 的
FOOTER here-doc，与既有 `## Repository rules outrank these skills` 同一
先例，不新造机制。

本次只落规则主体：三档（A ≤3 文件且 ≤50 行 / B ≤5 文件 / C 其余）、四族
硬闸 G1–G4、闭合规则（判定不了 → C、≥2 契约类 → C、拿不准 → C、只升不降）、
各档流程与五条全档不变量。承重覆盖句由下一个提交补上。

注入节零项目专有名词（它进入任意工作区），守卫测试断言这一点；本仓库
如何实例化记在 spec §8。self-check 增 'Task sizing' / 'G4' /
'never downgrade' 三条，未来 sync 或误删冲掉该节会直接构建失败。

Refs: docs/superpowers/specs/2026-09-16-task-sizing-design.md
EOF
```

- [ ] **Step 6: 反向取证（证明守卫有牙），然后还原**

```bash
sed -i 's/\*\*G4\*\*/G4/' preset/bootstrap.md
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
git checkout -- preset/bootstrap.md
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
```

注意模式要用 `s/\*\*G4\*\*/G4/`，不能用行首锚定：生成物里那行是 `- **G4** weakening the safety net: ...`，行首是 `- `。

Expected: 第一条 `node --test` → `fail 1`、`pass 0`，信息含 `must contain "**G4**"`；`git checkout` 后第二条 → `pass 1`、`fail 0`。把前一条的完整输出留到 Task 4 抄进 `evidence/VERIFICATION.md`。

---

### Task 2: 承重覆盖句（点名它覆盖的是什么）

**Files:**
- Modify: `scripts/task-sizing.test.mjs`（同文件加第 2 个测试）
- Modify: `scripts/build-bootstrap.sh`（FOOTER 里该节标题下插一段）
- Regenerated: `preset/bootstrap.md`、`preset/.manifest.json`

**Interfaces:**
- Consumes: Task 1 的 `read`、`sectionOf` 与已存在的节标题 `## Task sizing (harness override)`
- Produces: 生成物里紧随标题的那段声明，含子串 `overrides the "1% chance" rule` 与 `"The skill is overkill" Red`

- [ ] **Step 1: 写失败的测试**

在 `scripts/task-sizing.test.mjs` 末尾追加：

```js
// The load-bearing sentence. Without it this section is one more opinion next
// to an unconditional vendored rule, and the vendored text wins by being
// closer to the decision. The test names both upstream things it overrides so
// a future reword cannot quietly soften it into a suggestion.
test('the injected section overrides the vendored Red Flags decision', async () => {
  const bootstrap = await read('../preset/bootstrap.md');
  const section = sectionOf(bootstrap);
  assert.ok(
    section.includes('overrides the "1% chance" rule') &&
      section.includes('"The skill is overkill" Red'),
    'the "Task sizing" section must name what it overrides — the "1% chance" ' +
      'rule and the "The skill is overkill" Red Flags row. Without that ' +
      'sentence the unconditional vendored text still wins and the tracks are ' +
      'a suggestion. Edit the FOOTER here-doc in scripts/build-bootstrap.sh ' +
      'and re-run it.',
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/task-sizing.test.mjs`

Expected: `fail 1`、`pass 1`（新测试失败，Task 1 的仍通过），新断言信息含

```
must name what it overrides
```

- [ ] **Step 3: 实现 —— 在节标题下插承重句**

在 `scripts/build-bootstrap.sh` 的 FOOTER 里，把这两行插到 `## Task sizing (harness override)` 与 `Process scales with the task.` 之间，前后各留一个空行：

```md
This section overrides the "1% chance" rule, the "The skill is overkill" Red
Flags row, and every skill description that reads as unconditional.
```

- [ ] **Step 4: 重建生成物并跑测试确认通过**

Run:

```bash
bash scripts/build-bootstrap.sh
node --test scripts/task-sizing.test.mjs
```

Expected: `built ... (N bytes, M lines)`；`pass 2`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add scripts/build-bootstrap.sh scripts/task-sizing.test.mjs preset/bootstrap.md
git commit -F - <<'EOF'
feat: 分档节补承重覆盖句，点名覆盖 1% 规则与 Red Flags 行

没有这句，本节只是与上游无条件规则并列的又一条意见；注入文本的胜负取决于
谁更靠近决策点，而 vendored `using-superpowers` 正文一直在场。所以显式点名
被覆盖的两处：1% 规则、以及 `| "The skill is overkill" | ... | Use it. |`
那一行，再补一句"任何读起来无条件的技能 description"。

守卫测试断言这两个子串同时存在——未来重写该句若把它弱化成"一次建议"，
测试转红。

Refs: docs/superpowers/specs/2026-09-16-task-sizing-design.md
EOF
```

- [ ] **Step 6: 反向取证（证明承重句被弱化会转红），然后还原**

```bash
sed -i 's/This section overrides the "1% chance" rule/This section notes the "1% chance" rule/' preset/bootstrap.md
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
git checkout -- preset/bootstrap.md
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
```

Expected: 第一条 → `fail 1`、`pass 1`，信息含 `must name what it overrides`；还原后 → `pass 2`、`fail 0`。保留第一条输出给 Task 4。

---

### Task 3: persona 按档位生效（消除与注入节的矛盾）

**Files:**
- Modify: `preset/agent.cordis.yml:37`
- Modify: `scripts/task-sizing.test.mjs`（同文件加第 3 个测试）

**Interfaces:**
- Consumes: 注入节标题 `## Task sizing (harness override)`（Task 1 产出）
- Produces: persona 里指向该节的表述，且不再含子串 `Skills are mandatory workflows, not suggestions.`

- [ ] **Step 1: 写失败的测试**

在 `scripts/task-sizing.test.mjs` 末尾追加：

```js
// The persona states the policy in prose, and nothing generates that line, so
// it drifts on its own — the same coupling the default-level guard exists for.
// Asserting the ABSENCE of the old sentence is the point: leaving it in place
// makes the composition disagree with the section it points at.
test('the composition persona gates skills by track instead of mandating them', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  assert.ok(
    composition.includes('Task sizing (harness override)'),
    'preset/agent.cordis.yml must point the persona at the injected ' +
      '"Task sizing (harness override)" section; otherwise the persona and ' +
      'the section disagree about whether every skill is unconditional.',
  );
  assert.ok(
    !composition.includes('Skills are mandatory workflows, not suggestions.'),
    'preset/agent.cordis.yml still carries the unconditional "Skills are ' +
      'mandatory workflows, not suggestions." sentence, which contradicts the ' +
      'injected task-sizing section. Replace it with the track-scaled wording.',
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/task-sizing.test.mjs`

Expected: `fail 1`、`pass 2`（只有新测试失败），信息含 `still carries the unconditional`。

- [ ] **Step 3: 实现 —— 改写 persona 那一行**

把 `preset/agent.cordis.yml:37` 这一行（6 空格缩进）

```
      Skills are mandatory workflows, not suggestions. Process skills come first (brainstorming, systematic-debugging), then implementation skills. Announce "Using [skill] to [purpose]" and follow the skill exactly.
```

替换为

```
      Skills are mandatory workflows scaled by task size — pick the track first, as the injected "Task sizing (harness override)" section requires. On track C, process skills come first (brainstorming, systematic-debugging), then implementation skills. Announce "Using [skill] to [purpose]" and follow the skill exactly.
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/task-sizing.test.mjs`

Expected: `pass 3`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add preset/agent.cordis.yml scripts/task-sizing.test.mjs
git commit -F - <<'EOF'
feat: persona 改为按档位生效，消除与注入节的矛盾

persona 原文写死 `Skills are mandatory workflows, not suggestions.`——注入节
即使规定了三档，组合层仍在无条件强制全流程，两者互相矛盾。改为按档位生效
并指向注入节；C 档仍保留"流程技能优先"的原有次序。

persona 那一行没有生成器，会独立漂移（既有 `the composition persona states
the same default level` 就是为此设的）。新守卫断言它指向注入节、且旧的无条件
句不再存在。

Refs: docs/superpowers/specs/2026-09-16-task-sizing-design.md
EOF
```

- [ ] **Step 6: 反向取证（证明"旧句回归"会转红），然后还原**

```bash
printf '      Skills are mandatory workflows, not suggestions.\n' >> preset/agent.cordis.yml
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
git checkout -- preset/agent.cordis.yml
node --test scripts/task-sizing.test.mjs 2>&1 | tail -5
```

Expected: 第一条 → `fail 1`、`pass 2`，信息含 `still carries the unconditional`；还原后 → `pass 3`、`fail 0`。保留第一条输出给 Task 4。

---

### Task 4: 文档、体量实测与全部门禁

**Files:**
- Modify: `README.md:14`（标题）、`README.md:16-20`（表格加一行）、`README.md:22`（"第三行"措辞）、`README.md:142`（测试计数）、README 新增一节
- Modify: `evidence/VERIFICATION.md`（末尾追加复验节）

**Interfaces:**
- Consumes: Task 2 结束时的生成物与三个测试；Task 1–3 Step 6 收集到的反向取证输出
- Produces: README 里的分档文档与实测体量；VERIFICATION 的复验节（真实输出）

- [ ] **Step 1: 实测体量差值**

Run:

```bash
wc -c preset/bootstrap.md; wc -l preset/bootstrap.md
git show HEAD~3:preset/bootstrap.md | wc -c; git show HEAD~3:preset/bootstrap.md | wc -l
```

Expected: 后两条给出改动前基线 `9783` bytes / `192` lines（Task 1 提交前的值）。记下两个差值（bytes 与 lines），下一节要用，且要抄进 VERIFICATION。

若 `HEAD~3` 不是改动前那个提交（提交数与本计划的四个提交不符时），先 `git log --oneline -- preset/bootstrap.md` 找到 `feat: 注入任务分档规则` 之前的那一个提交，再 `git show <sha>:preset/bootstrap.md | wc -c`。基线的权威值记在 spec §9：`9783` bytes / `192` lines。

- [ ] **Step 2: 改 README —— 标题与表格**

把 `README.md:14`

```
## 自动生效的三件事（第三件刻意"不生效"）
```

改为

```
## 自动生效的四件事（其中一件刻意"不生效"）
```

在 `README.md:20` 那行（`| Caveman 级别定义 | **技能**保留在 catalog，按需加载 |`）**之后**插入一行：

```
| **任务分档**（按规模缩放流程） | 注入 `bootstrap.md` 的 "Task sizing (harness override)" 一节，覆盖上游的无条件表述 |
```

把 `README.md:22` 的

```
第三行是刻意的，也是这套设计里唯一的不对称：注入**没有**宣告 `caveman` 技能已激活，反而明说 "It is NOT active yet: load it with the `skill` tool"。
```

改为（把"第三行"锚定到具体那一行，避免加行后指错）

```
`Caveman 级别定义` 那行是刻意的，也是这套设计里唯一的不对称：注入**没有**宣告 `caveman` 技能已激活，反而明说 "It is NOT active yet: load it with the `skill` tool"。
```

- [ ] **Step 3: README 新增「任务分档」一节**

插在 `README.md` 的「自动生效的四件事」块之后、「## 级别切换」之前，内容如下（把 `<Δ bytes>` 换成 Step 1 实测的字节差值）：

```markdown
## 任务分档（按规模缩放流程）

Superpowers 全流程不再无条件施加到每个任务。注入文本里有一节 `## Task sizing (harness override)`（生成物 `preset/bootstrap.md`，源自 `scripts/build-bootstrap.sh` 的 FOOTER here-doc），按可核查的改动半径选档：

| 档 | 进入条件 | 保留 | 免掉 |
|---|---|---|---|
| **A 直接改** | ≤3 文件 且 diff ≤50 行，不碰公共契约，非不可逆 | 一行轨道声明 + 跑既有验证并引用真实输出 | brainstorming、spec、plan、子代理、TDD |
| **B 轻量** | ≤5 文件，意图无歧义 | 上述 + TDD | spec、plan、子代理 |
| **C 完整** | 其余一切 | 现状全流程 | 无 |

四族硬闸**命中即 C，与半径无关**：**G1** 不可逆或外部可见、**G2** 公共契约面、**G3** 安全与正确性高风险面、**G4** 安全网自改（删测试、关校验、改本规则或其执行机制、改安装发布链路）。此外：爆炸半径无法靠阅读确定、同时落在 ≥2 个契约类、拿不准 —— 一律 C。只升不降；用户可一句话改档（「走完整流程」/「别搞流程」）。

这一节的覆盖对象是 vendored `using-superpowers` 正文里那行 Red Flags（`| "The skill is overkill" | ... | Use it. |`）与 1% 规则 —— 上游正文逐字不改，所以覆盖物必须同为注入文本。守卫在 `scripts/task-sizing.test.mjs`：生成物含三档与四族、注入节零项目专有名词、承重覆盖句点名上游两处、persona 不再自相矛盾。

代价：`preset/bootstrap.md` 每会话常驻多 `<Δ bytes>` 字节（实测差值，见 `evidence/VERIFICATION.md`）。改动**只在新建会话生效** —— bootstrap 是生成物且经符号链接安装。
```

- [ ] **Step 4: 改 README 的测试计数**

把 `README.md:142` 的

```
npm test          # 18 pass / 0 fail
```

改为

```
npm test          # 21 pass / 0 fail
```

同一节下方枚举测试文件的那句（`README.md:145`）里，把

```
caveman 三个家的默认级别与 vendored 技能级别名一致、白名单 caveman 技能存在性）
```

改为

```
caveman 三个家的默认级别与 vendored 技能级别名一致、白名单 caveman 技能存在性、任务分档守卫）
```

（守卫的具体断言已写进新增的「任务分档」一节，这里只列名单，避免嵌套括号。）

- [ ] **Step 5: 跑全部门禁并如实记录**

Run:

```bash
bash scripts/build-bootstrap.sh
git diff --exit-code preset/bootstrap.md; echo "drift exit=$?"
npm test 2>&1 | tail -8
node scripts/verify-composition.mjs 2>&1 | tail -3
git status --short
```

Expected:

- 构建打印 `built ... (N bytes, M lines)`
- `drift exit=0`（重跑构建不改变生成物 → 幂等，生成物与脚本一致）
- `tests 21`、`pass 21`、`fail 0`
- `2a OK: "engineering" is a loadable roster row (broken: null)`
- `git status --short` 只列出 `README.md` 与 `evidence/VERIFICATION.md`（尚未提交）

- [ ] **Step 6: 追加 VERIFICATION 复验节**

在 `evidence/VERIFICATION.md` 末尾追加下面这节，**把每个 `<...>` 换成真实输出**（禁止编造；与本文档既有各节同样格式）：

```markdown
## 2026-09-16 任务分档（按规模缩放流程）复验

改动：`scripts/build-bootstrap.sh` 的 FOOTER 新增 `## Task sizing (harness override)`
节与 self-check 三条 pattern；`preset/agent.cordis.yml` persona 改为按档位生效；
新增 `scripts/task-sizing.test.mjs`。

### 第 1 层：`npm test`

命令与真实输出：

```
<粘贴 npm test 的 tests/pass/fail 三行>
```

### 生成物与脚本一致（幂等）

```
$ bash scripts/build-bootstrap.sh
<粘贴 built 行>
$ git diff --exit-code preset/bootstrap.md; echo "drift exit=$?"
drift exit=<0>
```

### 注入节体量（每会话常驻成本）

- 改前：`9783` bytes / `192` lines
- 改后：`<N>` bytes / `<M>` lines
- 差值：`<Δ bytes>` bytes / `<Δ lines>` lines

### 反向取证（每条断言都要能红）

| 断言 | 制造违规 | 结果 | 还原后 |
|---|---|---|---|
| `bootstrap.md` 含 `**G4**` | `sed -i 's/\*\*G4\*\*/G4/' preset/bootstrap.md` | `<fail 输出摘要>` | `pass 1 / fail 0` |
| 承重覆盖句点名 1% 规则 | `sed -i 's/This section overrides/This section notes/' preset/bootstrap.md` | `<fail 输出摘要>` | `pass 2 / fail 0` |
| persona 不再含旧无条件句 | `printf '      Skills are mandatory workflows, not suggestions.\n' >> preset/agent.cordis.yml` | `<fail 输出摘要>` | `pass 3 / fail 0` |

### 第 2a 层：组合健康

```
$ node scripts/verify-composition.mjs
<粘贴 2a OK 行>
```

### 生效边界

`preset/bootstrap.md` 是生成物，经 `scripts/install.sh` 以符号链接装入
`${DSH_HOME}/.agent-presets/engineering/`。本次改动**只在新建会话生效**，
当前会话看不到——与本仓库既有结论一致。
```

- [ ] **Step 7: 提交**

```bash
git add README.md evidence/VERIFICATION.md
git commit -F - <<'EOF'
docs: README 与验证记录补任务分档（含实测体量差值）

README：「自动生效的三件事」升为四件并加任务分档一行；新增「任务分档」一节
（三档表、四族硬闸摘要、被覆盖的上游文本、守卫位置、每会话常驻成本、生效
边界）；测试计数 18 → 21 并补上守卫的枚举。

VERIFICATION：追加 2026-09-16 复验节，含 npm test 真实计数、生成物幂等
（重跑构建后 git diff --exit-code 无输出）、注入节体量差值、三条反向取证
（每条断言都能转红）、第 2a 层组合健康。

Refs: docs/superpowers/specs/2026-09-16-task-sizing-design.md
EOF
```

---

## 执行顺序与提交划分

四个提交，每个自成一个子系统，且每个都在自己的测试变绿之后落地：

| 提交 | 内容 | 交付物 |
|---|---|---|
| 1 | 规则主体 + self-check + 守卫 1 | 生成物含三档与四族，且零项目专有名词 |
| 2 | 承重覆盖句 + 守卫 2 | 注入节显式点名它覆盖的上游两处 |
| 3 | persona 按档位 + 守卫 3 | 组合层与注入节不再矛盾 |
| 4 | README + VERIFICATION | 文档与真实验证记录 |

## 自审记录（spec 覆盖对照）

| spec 要求 | 落在哪个任务 |
|---|---|
| §4 三档门限与硬闸 G1–G4、闭合规则 C1–C5 | Task 1 Step 3 |
| §5 各档流程与五条不变量 | Task 1 Step 3 |
| §6.1 注入节逐字草案 + 通用性（零专有名词） | Task 1 Step 3、Task 2 Step 3、Task 1 测试 |
| §6.2 persona 改法 | Task 3 Step 3 |
| §6.3 self-check 三条 pattern | Task 1 Step 3 |
| §6.4 三个守卫测试 | Task 1 / 2 / 3 各 Step 1 |
| §6.5 README 与 VERIFICATION | Task 4 Step 2–4、6 |
| §7 验证策略（含反向取证、幂等、体量） | Task 4 Step 5–6、各 Task Step 6 |
| §11 DoD 1–8 | 全部任务；DoD 2 的 `pass 21` 由 Task 4 Step 5 断言 |
| §12 参考 | 各 Task 的 Files 段与命令 |
