# 验证记录

> **历史记录**：本记录成文于 2026-09-12，当时 preset id 为 `superpowers`。此后更名为 `engineering`。正文中的旧 id 与实测输出**保持原样**（例如 `sp_probe validate=superpowers`），因为它们记录的是当时真实跑过的命令。

本文件记录方案 B 落地后**实际跑过**的验证，以及**尚未跑过**的部分。数字与命令都可复现。

> **占位符约定**：为便于公开分发，本文件中的本机路径已占位符化——
> `$REPO` 本仓库根、`$DSH_HOME` DSH 配置目录（默认 `~/.dsh`）、`$ARDUPLOT_WS` 一个使用本 preset 的工作区示例、`$UPSTREAM` 上游 Superpowers 检出、`$DSH_WEB_URL` DSH Web GUI 地址、`$HOME` 用户家目录。
> 技术内容与数字未作任何改动。

## 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-09-12 |
| DSH | 0.1.5-rc.1，Web profile (`dsh web`)，PID 9256 |
| Node | v26.8.1 |
| 上游 Superpowers | v6.1.1，commit `d884ae04edebef577e82ff7c4e143debd0bbec99`（2026-07-02） |
| 安装位置 | `$DSH_HOME/.agent-presets/superpowers`（真实目录 + 逐项符号链接） |
| 源 | `$REPO/preset` |

## 已通过的验证

### 1. 组合真挂载（standingKeyFor）

```
sp_probe validate=superpowers
=> MOUNT OK: superpowers
```

`standingKeyFor` 执行的是会话启动所做的同一件事（挂载插件子树，不启动 agent）。它一次捕获四类失败：包不可解析、配置非法、行未激活、服务发布到进程全局 realm。全部通过，说明：

- 组合 YAML 合法，19 个顶层行全部激活；
- `./plugins/superpowers-bootstrap/index.js` 这个 **preset 相对行**被解析并成功 import（这是方案 B 的关键前提，已由实测确认）；
- `!!js` 表达式（`customSkillDirs` + `baseUrl`）求值成功；
- 三个 `isolate` realm 组（planning / compaction / delegation）行为正确。

### 2. 技能目录断言（skills.snapshot，scope = 该 preset 的 standing key）

```
mount OK for preset superpowers
catalog complete=true
catalog size=14
custom-source skills=14
names=brainstorming,dispatching-parallel-agents,executing-plans,finishing-a-development-branch,
      receiving-code-review,requesting-code-review,subagent-driven-development,systematic-debugging,
      test-driven-development,using-git-worktrees,using-superpowers,verification-before-completion,
      writing-plans,writing-skills
sources=custom
model-invocable=14
using-superpowers present=true
using-superpowers desc-len=154
using-superpowers resourceBase=$DSH_HOME/.agent-presets/superpowers/skills/using-superpowers
load brainstorming=true body-bytes=10149
```

要点：14 个技能全部进入该 preset 作用域的目录（不是全局），全部模型可调用，`resourceBase` 解析到 preset 自己的技能目录（所以技能里的 `references/...`、`scripts/...` 路径可用），并且真的加载了一个技能正文（10,149 字节）。

### 3. 插件自测（node，无宿主依赖）

```
cd preset/plugins/superpowers-bootstrap && node selftest.mjs
=> selftest OK: 6 assertions groups passed
   bootstrap bytes: 9061
```

从**已安装路径**（`~/.dsh/.agent-presets/superpowers/plugins/...`，经由符号链接）再次运行，同样通过，证明符号链接安装方式下依赖解析与文件定位都成立。

覆盖的断言：

1. step 1 且无 claimed 输入时，注入恰好一条消息；
2. 注入消息是 `user` 角色，`source = { kind: 'plugin', plugin: 'superpowers-bootstrap' }`；
3. 注入文本含 `<EXTREMELY_IMPORTANT>`、工具映射、仓库规则优先章节；
4. 已经在场的 bootstrap 不再重复注入；
5. 历史被压缩摘要替换后**重新注入**，且摘要仍在最前；
6. `reject` 步不被改动；非首步的空步不被注入；已有消息保持不变且排在 bootstrap 之前。

### 4. 依赖解析

```
cd preset/plugins/superpowers-bootstrap && node -e "import('@deepseek-ai/dsh-llm').then(...)"
=> resolved from: $REPO/preset/plugins/superpowers-bootstrap
   createUserMessage: function
```

即 `node_modules/@deepseek-ai` 符号链接确实让本地插件解析到 harness 自带的包。

### 5. 静态检查

- `node --check` 通过（`index.js`、`selftest.mjs`）；
- `agent.cordis.yml` 可被 YAML 解析（19 个顶层行）；
- 生成的 `bootstrap.md`：9,104 字节 / 177 行，关键锚点各命中一次。

## 自测抓到并修复的缺陷

| 缺陷 | 现象 | 修复 |
|---|---|---|
| `bootstrap.md` 相对路径少一层 | `new URL('../bootstrap.md', import.meta.url)` 解析到 `plugins/bootstrap.md`，读取失败。插件按设计**静默降级为"无 superpowers"**并打一条 warning——在真实会话里这会表现为"模式装了但完全没效果" | 改为 `'../../bootstrap.md'`，并在插件头注释里写明两层的原因 |
| 符号链接安装方式不生效 | 首次安装把 `~/.dsh/.agent-presets/superpowers` 直接做成指向检出的符号链接，`/agent-presets` 名单里看不到它 | 根因：preset 发现用 `readdir(withFileTypes)` 且只接受 `isDirectory()`，符号链接目录返回 false 被静默跳过。改为"真实目录 + 逐项符号链接" |

## 尚未验证（诚实清单）

1. **真实会话的端到端注入未跑**。需要人类新建一个 `Superpowers 模式` 会话。降级替代证据是自测（逻辑）与挂载（装配），但"注入消息真的进入模型请求"这一步只有真实会话能证明。
2. **官方验收用例未跑**：干净会话发 `Let's make a react todo list`，期望在写代码前自动触发 `brainstorming`。
3. **动态沙箱内无法做 live mount**：`await import()` 在受限执行环境中被禁（`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`），且 `process`/`fs` 未暴露，因此无法从动态插件里直接挂载该模块做进程内注入测试。已用上面的自测替代。
4. **压缩后重注入只在合成数据上验证**：无法在真实长会话里制造一次压缩来复现。
5. **`--copy` 安装模式**未实测（默认的符号链接模式已实测）。
6. **Windows** 未涉及（`tool-pwsh` 行沿用副本，插件本身跨平台）。

## 复现全部命令

```sh
ROOT=$REPO

# 1. 重建 bootstrap 并自检
"$ROOT/scripts/build-bootstrap.sh"

# 2. 安装（真实目录 + 符号链接）
"$ROOT/scripts/install.sh"

# 3. 插件自测
(cd "$ROOT/preset/plugins/superpowers-bootstrap" && node selftest.mjs)

# 4. 挂载 + 目录断言（需要本会话的 sp_probe / sp_verify 探针）
#    sp_probe  validate=superpowers
#    sp_verify preset=superpowers cwd=$ARDUPLOT_WS
```

---

## 2026-09-14 最终全分支评审修复后的复验（新增第 2a 层）

> 本节成文于 2026-09-14，preset id 已是 `engineering`；上文的 2026-09-12 记录保持原样。
> 约定同上：`$REPO` 本仓库根。安装验证一律使用仓库内的临时 `DSH_HOME`（`$REPO/.tmp-*`），
> 跑完即删，不触碰真实的 `~/.dsh`；harness 装在发行默认位置，故 harness base 是绝对路径。

### 第 1 层：`npm test`

```
$ npm test
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

`pretest` 先重建 `preset/.manifest.json`。计数随收编的断言数变化（本次修复又加了 3 条），
契约是 **`0 failed`**。

### 第 2a 层：组合健康（harness 自带的 `discoverPresets`，本仓库可跑）

```
$ DSH_HOME=$REPO/.tmp-2a scripts/install.sh
$ DSH_HOME=$REPO/.tmp-2a node scripts/verify-composition.mjs
composition health (layer 2a, harness discoverPresets)
  preset root  : $REPO/.tmp-2a/.agent-presets (trust: user)
  harness base : file:///usr/lib/node_modules/@deepseek-ai/dsh/
  discovery    : <harness>/node_modules/@deepseek-ai/dsh-agent-presets/lib/index.js
  roster       : [{"id":"engineering","name":"工程模式","order":5,"broken":null,"path":".../engineering/agent.cordis.yml"}]

2a OK: "engineering" is a loadable roster row (broken: null) — every row specifier resolves.
EXIT=0
```

反向取证（把该检查逼到失败，证明它不是恒真断言）：

| 注入的故障 | 关键输出 | EXIT |
|---|---|---|
| 一行包名改成不存在的包（`@deepseek-ai/dsh-persona-renamed`） | `2a FAIL: "engineering" is a broken roster row: row "persona" names a plugin that cannot be resolved: …` | 1 |
| 把组合文件 `agent.cordis.yml` 移走 | `2a FAIL: … the composition file agent.cordis.yml is missing …` | 1 |
| `--root` 指向未安装该 preset 的目录 | `2a FAIL: no "engineering" preset under …` | 1 |

`broken: null` 的含义与边界：discovery 解析组合的 YAML 方言、跑 `entryListProblem`、逐行解析
specifier（包名走上行 `node_modules` 查找，`./` 相对行 stat 文件），但**刻意不 import 任何插件**——
所以它**不是挂载**。`standingKeyFor`、行配置求值、realm 合法性、技能目录断言仍属 2b。

### 其余同时实跑过的检查

- **安装门禁**：`DSH_HOME=$REPO/.tmp-* scripts/install.sh` → EXIT=0、`self-tests: 2 plugin(s) OK`；
  给 `preset/plugins/caveman-command/caveman-command.test.mjs` 追加一条 `assert.fail` →
  EXIT=1 且打印 `self-test: caveman-command FAILED — see output above`。临时新增一个无自测的
  插件目录 → EXIT=1 且打印缺失路径；临时新增一个带自测的插件目录 → 被自动纳入（`3 plugin(s) OK`）。
- **产品名残留**：`git grep -nE '<旧 id 特征串>' -- ':!docs' ':!evidence' ':!preset/skills' ':!scripts/sync-superpowers-skills.sh' ':!README.md'`
  → 无输出（代码与配置侧 0 命中）；反向断言 `git grep -c 'obra/superpowers' -- README.md THIRD-PARTY-NOTICES.md preset/SYNC.md` 各非零。命令全文见 README「验证」第 1 层。
- **shell 语法**：本次改动的 shell 脚本只有 `scripts/install.sh` 与 `scripts/sync-lib.sh`，逐个
  `bash -n "$f"` → 两者均 OK。（注意 `bash -n a b` 只解析 `a`，`b` 会被当成位置参数——必须逐个跑。）
- **上游同步端到端**：`scripts/sync-superpowers-skills.sh` → EXIT=0、`skills: 17 skills, 55 files`，
  且 `preset/skills/**` 与 `preset/bootstrap.md` 相对基线逐字节未变（vendored 树与 pin 一致、
  DSH 指针重放幂等）；`preset/SYNC.md` 由该次真实同步重写。

### 2b 与第 3 层：仍未验证

与上文 2026-09-12 的「尚未验证」清单一致，其中 2b 的残余部分是**真挂载**（`sp_probe validate=engineering`）
与**技能目录断言**（`sp_verify preset=engineering cwd=…`）——两者都需要本仓库之外的探针工具；
第 3 层端到端仍需人类新建会话验收。

## 2026-09-16 任务分档（按规模缩放流程）复验

改动：`scripts/build-bootstrap.sh` 的 FOOTER 新增 `## Task sizing (harness override)`
节与 self-check 三条 pattern；`preset/agent.cordis.yml` persona 改为按档位生效；
新增 `scripts/task-sizing.test.mjs`（3 个守卫）。

### 第 1 层：`npm test`

```
$ npm test
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ skipped 0
```

### 生成物与脚本一致（幂等）

```
$ bash scripts/build-bootstrap.sh
built /home/goalizc/dsh-engineering/preset/bootstrap.md (11729 bytes, 230 lines)
$ git diff --exit-code preset/bootstrap.md; echo "drift exit=$?"
drift exit=0
```

### 注入节体量（每会话常驻成本）

- 改前：`9783` bytes / `192` lines
- 改后：`11729` bytes / `230` lines
- 差值：`+1946` bytes / `+38` lines

### 反向取证（每条断言都能转红）

| 断言 | 制造违规 | 结果 | 还原后 |
|---|---|---|---|
| `bootstrap.md` 含 `**G4**` | `sed -i 's/\*\*G4\*\*/G4/' preset/bootstrap.md` | `pass 0 / fail 1`：`must contain "**G4**"` | `pass 1 / fail 0` |
| 承重覆盖句点名 1% 规则 | `sed -i 's/This section overrides the "1% chance" rule/This section notes the "1% chance" rule/' preset/bootstrap.md` | `pass 1 / fail 1`：`must name what it overrides` | `pass 2 / fail 0` |
| persona 不再含旧无条件句 | `printf '      Skills are mandatory workflows, not suggestions.\n' >> preset/agent.cordis.yml` | `pass 2 / fail 1`：`still carries the unconditional` | `pass 3 / fail 0` |

三次取证分别在对应提交之后执行，`git checkout --` 还原，未混入任何提交。

### 第 2a 层：组合健康

```
$ node scripts/verify-composition.mjs
  roster       : [{"id":"engineering","name":"工程模式","order":5,"broken":null,"path":"/home/goalizc/.dsh/.agent-presets/engineering/agent.cordis.yml"}]

2a OK: "engineering" is a loadable roster row (broken: null) — every row specifier resolves. Mounting, row configs, realms and the skills catalog are layer 2b.
```

### 执行期发现的计划缺陷（已就地修正）

1. Task 3 红阶段的失败信息是 `must point the persona at ...`（第一条断言先失败），
   计划里写的是第二条断言的信息 `still carries the unconditional`。两条断言当时都未
   满足，红阶段成立，仅期望信息写错。
2. `require('yaml')` 在本仓库根**不可解析**（`yaml` 只存在于 harness 的 `node_modules`）。
   校验组合文件解析需用绝对路径：
   `node -e "...require('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml')..."`。
   实测 `rows: 20`，persona 行已是按档位措辞。解析时 `!!js` 标签报 `TAG_RESOLVE_FAILED`
   警告属**改动前既有**（`disabled: !!js ...` 三处），真实挂载由第 2a 层证明。

### 生效边界

`preset/bootstrap.md` 是生成物，经 `scripts/install.sh` 以符号链接装入
`${DSH_HOME}/.agent-presets/engineering/`。本次改动**只在新建会话生效**，
当前会话看不到——与本仓库既有结论一致。

## 2026-09-16 git 安装兜底清单 + 包名收敛复验

改动：`plant()` 三级清单解析 + `MANIFEST_EXCLUDES`；`index.js` 可操作失败提示与
来源标记；包名改 `@goalizc/dsh-engineering`；新增 `scripts/bundle-identity.test.mjs`。

### 第 1 层：`npm test`

```
$ npm test
ℹ tests 33
ℹ pass 33
ℹ fail 0
ℹ skipped 0
```

### git 路径的等价实验

`git clone` 的检出里没有清单（与 GitHub 安装拿到的树形状一致）：

```
$ git clone -q . .tmp-e2e/clone
$ test ! -e .tmp-e2e/clone/preset/.manifest.json && echo "clone has no manifest: OK"
clone has no manifest: OK
$ (cd .tmp-e2e/clone && npm pack --pack-destination "$OLDPWD/.tmp-e2e")
goalizc-dsh-engineering-0.1.0.tgz
$ tar -tzf <clone tgz> | grep -c 'preset/.manifest.json'
0
$ tar -tzf <clone tgz> | wc -l
71
```

装进临时 profile 并启动：

```
$ DSH_HOME=<临时> dsh plugin --profile headless add <clone tgz> --store-dir ... --cache-dir ...
Progress: resolved 1, reused 0, downloaded 1, added 1, done
Done in 1s using pnpm v11.26.0
$ DSH_HOME=<临时> dsh --profile headless "reply ok"
engineering: preset planted (65 changed) (manifest computed)

dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; …
```

植入结果与组合健康：

```
文件数: 66
SKILL.md: 17
$ DSH_HOME=<临时> node scripts/verify-composition.mjs
2a OK: "engineering" is a loadable roster row (broken: null) — every row specifier resolves. …
```

（`MISSING_CREDENTIAL` 是临时 profile 没有模型凭据，与本改动无关，植入发生在此之前。）

### npm 路径回归

```
$ npm pack --pack-destination .tmp-npm
goalizc-dsh-engineering-0.1.0.tgz
$ tar -tzf <repo tgz> | grep -c 'preset/.manifest.json'
1
$ dsh plugin --profile headless add <repo tgz> ...
Done in 1s using pnpm v11.26.0
$ DSH_HOME=<临时> dsh --profile headless "reply ok"
engineering: preset planted (65 changed)
文件数: 66
```

**无** `(manifest computed)` —— npm 路径仍优先使用包内清单，没有退化。

### 常规门禁

```
$ bash scripts/build-bootstrap.sh
built /home/goalizc/dsh-engineering/preset/bootstrap.md (11729 bytes, 230 lines)
$ git diff --exit-code preset/bootstrap.md; echo "drift exit=$?"
drift exit=0
$ node scripts/verify-composition.mjs
2a OK: "engineering" is a loadable roster row (broken: null) …
```

### 反向取证

| 断言 | 制造违规 | 结果 | 还原后 |
|---|---|---|---|
| 现算集合与发布清单逐键相等 | `MANIFEST_EXCLUDES` 改为 `[]` | `pass 13 / fail 1`：`Expected values to be strictly deep-equal` | `pass 14 / fail 0` |
| patch 自指 == 包名 | 自指行改成 `@goalizc/wrong-name` | `pass 3 / fail 1`：`must insert a row named "@goalizc/dsh-engineering" … got "@goalizc/wrong-name"` | `pass 4 / fail 0` |

两次取证分别在对应提交之后执行，`git checkout --` 还原，未混入任何提交。

### 计划外增补（如实记录）

spec §8.4 预期 29 例；实施时在 `scripts/index.test.mjs` 额外加了 4 例（`formatResult`
的来源标记两例、`formatError` 内容一例、`apply()` 不抛一例），故终值为 33。理由：失败
姿态是用户可见行为，值得守卫，而不是只靠端到端覆盖。

### 未验证（诚实清单）

真机 `dsh plugin add github:goalizc/dsh-engineering` **未验证**：沙箱无任何 git 凭据，
本次改动未能推送。等价实验用「本地 clone → 本地 tarball」，树形状与 GitHub 安装一致
（被 gitignore 的清单在两者中都不存在）。推送后由人类真机复验一次即可闭环。

---

## 输出语言跟随界面语言（2026-09-18）

改动：新增预设本地插件 `preset/plugins/output-language/`（3 个文件：`index.js`、`package.json`、
`output-language.test.mjs`），在 `preset/agent.cordis.yml` 挂载一行，并加预设层守卫
`scripts/output-language.test.mjs`。能力是让模型的**输出语言跟随界面语言**：读 host 用户设置
`locale.preference`，每次组装提示词时渲染一条动态运行时上下文行；用户改用自己的语言提问时该条跟随用户。

> 路径占位符约定同文件头；本节未用到的变量从略。

### 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-09-18 |
| DSH | 0.1.5-rc.1，Web profile (`dsh web`)，<http://127.0.0.1:3080/> |
| Node | v26.7.0 |
| 安装位置 | `$DSH_HOME/.agent-presets/engineering`（真实目录 + 逐项符号链接，`scripts/install.sh` 默认策略） |
| 源 | `$REPO/preset` |
| 分支 / 提交 | `feat/output-language`：`f49a2ed`(插件) → `75ea80e`(挂载) → `edc3c8e`(守卫) → `aeb15b6`(规则前置修复) |

### 1. 单元与守卫测试（HEAD=`aeb15b6` 后）

```
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**计数口径**（Task 1/4 实测校正）：Node v26 的 `node --test` 按**每个 `test()` 调用**计数，无
`test()` 的测试文件（3 个 preset 插件自测）各计 1。基线 33 = 31 个 `test()` + 2 个插件自测文件；
Task 1 后 34；Task 4 后 **36** = 33 个 `test()`（含 `scripts/output-language.test.mjs` 的 2 条）
+ 3 个插件自测文件。（本轮修复在 `scripts/output-language.test.mjs` 新增 1 条 `test()`——spec §6 冻结文案与
实现输出的交叉守卫——故当时实测为 **37** = 34 个 `test()` + 3 个插件自测文件；上面的 36 是当时那一轮的实测值。
遗留清理轮（R1）又在同一文件新增 1 条 `test()`——README 的 zh 全行示例守卫——故**当前实测为 38**，
= 35 个 `test()` + 3 个插件自测文件。）

### 2. 组合健康（第 2a 层）

```
composition health (layer 2a, harness discoverPresets)
  preset root  : $DSH_HOME/.agent-presets (trust: user)
  harness base : file:///usr/lib/node_modules/@deepseek-ai/dsh/
  discovery    : <harness>/node_modules/@deepseek-ai/dsh-agent-presets/lib/index.js
  roster       : [{"id":"engineering","name":"工程模式","order":5,"broken":null,"path":"$DSH_HOME/.agent-presets/engineering/agent.cordis.yml"}]

2a OK: "engineering" is a loadable roster row (broken: null) — every row specifier resolves.
```

> 引文为实测输出；为可分发，本机路径已占位符化。该尾句 `Mounting, row configs, realms and the skills catalog are layer 2b.` 在本文件既有 2a 小节（`## 2026-09-16 任务分档（按规模缩放流程）复验` → `### 第 2a 层：组合健康`）已逐字照贴，此处从略。

`broken: null` 说明新挂载行 `./plugins/output-language/index.js` 指向的文件存在、组合 YAML 合语法；
它**不是挂载**（discovery 刻意不 import 插件），真挂载仍属 2b。

### 3. 闸门 A：`settings` 服务在 preset realm 可达

探针会话 `session-37e7c308-ee53-4baf-8a28-7b5ad230cfb6`（cwd `$REPO`，preset `engineering`，
created `2026-09-18T08:51:43Z`）。该会话注入的运行时上下文原文：

```
Interface language: zh (Chinese). Write your replies and every workflow artifact — plans, specs, review comments, TDD red/green explanations, todo items — in Ch…
```

→ 服务路径生效，**未启用** `$DSH_HOME/settings.yaml` 文件降级（计划 Task 3 按条件跳过）。探针不以推断
代替取证：注入行是模型逐字贴出的。

### 4. 端到端四场景

数据源为 `ctx.get('settings')` 服务路径（由闸门 A 结论决定，非文件降级路径）。

**第一次（修复前）**，会话 `session-ea6960d6-e95b-4934-8f58-55ce0edaa2cf`（created `08:55:04`）：

| # | 场景 | 证据 | 判定 |
|---|---|---|---|
| 1 | 界面 zh，新会话 | 注入行 `Interface language: zh (Chinese).` @`08:55:05`；`U: 用一句话说明这个 preset 是做什么的。` → `A: 工程模式 preset：把 Superpowers 技能方法论（头脑风暴 → 计划 → 子代理开发 → TDD → 评审验证）和 Caveman 压缩风格打包进一个 DSH agent preset…` | ✅ 中文 |
| 2 | 同会话中途切 `en` | 注入行 @`08:55:33` 变为 `Interface language: en (English).`（热生效）；`U: State in one sentence what this preset does.` → `A: This preset ("工程模式" / engineering mode) wraps a DSH coding agent with the Superpowers skills methodology — brainstorming → plans → subagent-driven development → TDD → review → verification — plus Caveman …` | ✅ 英文 |
| 3 | 界面 zh + 英文消息 | 注入行 @`08:55:48` 回到 `zh (Chinese)`；`U: Please name the language you are answering in, in the first line.` → `A: 中文。 工程模式 preset：…`（**中文**）。随后在普通英文内容问题上干净复测：`U @09:00:05: Summarize in one sentence what the README says this preset bundles.` → `A @09:00:10: 依据 README：preset 捆绑的是**两套逐字复用、不改写正文的上游技能**…`（**仍中文**） | ❌ |
| 4 | 子代理 | 子会话 `b3f5ed22-6b09-4112-85d8-75c707012d19`（depth=1）带该注入行，末条报告为中文 | ✅ 中文 |

**场景 3 失败**：界面语言压过用户消息语言，违反设计语义（§4「用户改用别的语言提问 → 该条跟随用户」）。
用户拍板**方案 A（规则前置）**，修复提交 `aeb15b6`：注入文本把规则句
`Output-language rule: write in the language of the user's message.` 放在最前，界面语言降为
「消息未给出语言线索」时的回退；四态各加一组**顺序守卫**断言（旧文案下四态全红 → RED，修复后 GREEN）。

**第二次（修复 + 重启宿主后）**，会话 `session-d6bca65a-fceb-4d58-8cc7-c3171a0436e0`（created `09:12:48`）：

| 检查 | 证据 | 判定 |
|---|---|---|
| 新文案是否被拾取 | 该会话 `Output-language rule: write in the language of the user's message.` 命中 1 次；旧文案 `Interface language: zh (Chinese). Write your replies` 命中 0 次 | ✅ 新文案生效 |
| 场景 3 | ``U @09:12:48: Summarize in one sentence what the README says this preset bundles.`` → ``A @09:12:52: README says preset `engineering` (`工程模式`) bundles **two upstream skill methodologies adapted into one DeepSeek Harness mode**: Superpowers (v6.1.1, 14 skills — process rigor) plus …`` | ✅ 英文 |

> 上表场景 3 的模型原文里本就含反引号代码跨度（`` `engineering` ``、`` `工程模式` ``），照贴自证据；
> 外层用双反引号包住以免破坏表格。第一次四场景表里第 3 行末尾的 `**两套逐字复用…**` 亦为模型原文。

至此四场景全部通过。**中间那次「复测未生效」是缓存而非修复失败**：修复后新建会话
`session-f47773a0…`（`09:05:36`）仍渲染旧文案，而磁盘上
`$DSH_HOME/.agent-presets/engineering/plugins/output-language/index.js`（mtime `09:01`）已是新文案。

### 5. 本次实测得到的、必须写进文档的事实

1. **`settings.locale.preference` 改动是热生效的**：同会话内 zh→en→zh 三次注入，无需重启
   （会话 `session-ea6960d6…`）。
2. **插件代码改动需要重启宿主，只新建会话不够**：修复后新建会话 `session-f47773a0…`（`09:05:36`）
   仍渲染**旧文案**，而磁盘上插件文件 mtime `09:01` 已是新文案 → 运行中的 host 进程缓存了 preset
   插件模块（Node ESM 模块缓存）；`dsh web` 重启后新会话才见新文案（`session-d6bca65a…`）。
3. **父会话是安装前创建的话，其子代理拿不到该注入行**：子会话
   `63fa0b8d-ce0d-4421-a5b5-356bf01e237d`（depth=1，派生自插件安装前创建的会话）运行时上下文无
   `Interface language` 行；而安装后新建会话的子代理有（`b3f5ed22…`）。因此 spec §2「子代理自动覆盖」
   的前提是**父会话为安装后新建**。
4. **仓库安装路径 bug（预先存在，本次因用 `install.sh` 默认 link 策略而暴露）**：`scripts/plant-core.mjs`
   的 `link` 分支（84-94 行）mkdir → 清空目标目录（连 `.installed.json` 一起删）→ 只建符号链接 →
   return，**从不写 `.installed.json`**；宿主启动时 bundle 安装器走 copy 分支，命中 100-104 行守卫
   `destination … exists without .installed.json; refusing to touch`，于是启动日志出现：

   ```
   engineering: preset NOT installed — destination $DSH_HOME/.agent-presets/engineering exists without .installed.json; refusing to touch Check that the installed package carries preset/.manifest.json, or that its version can compute one when that file is absent from a git checkout.
   ```
   （引文为宿主启动日志原文，为可分发，本机路径已占位符化。）

   功能上 preset 仍可用（条目是符号链接，仓库改动即时可见），但该警告每次启动都刷，且 bundle 安装器
   此后拒绝植入。**未在本计划范围内修**。
5. **spec §8 措辞与实现不符（预先存在）**：§8 写「`renderLanguageContext` 内部任何异常 → 返回"未设置"
   分支文本；绝不向上抛」，而实现是**纯全函数、无 try/catch**（不抛是因为只做 typeof / 正则 /
   字面量插值）。已按实现改正 spec §8 措辞。
6. **计划里两处口径要按实测改正**：(a) 测试计数口径（见 §1）；(b) 「生效边界是新建会话」应改为
   「**`settings` 值改动热生效；插件/组合改动需重启宿主**」。两条已落进计划末尾的「执行后勘误」。

### 未验证（诚实清单）

- 未在 `--copy` 安装模式下验证；未在非 Web profile（如 ACP/IM）验证；未在其他 preset 验证。
- 未验证重启宿主前**已存在**的会话是否会在重启后拾取新插件代码（本次是重启后新建会话）。
- 未复现「父会话安装前创建 → 子代理无注入行」之外的其他快照继承场景。
