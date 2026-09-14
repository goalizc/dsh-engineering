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
