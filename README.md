# engineering-dsh

把**两套**上游技能方法论适配为 **DeepSeek Harness 的一个模式**：`工程模式`（preset id `engineering`）。

- [Superpowers](https://github.com/obra/superpowers)（v6.1.1，14 个技能）—— 流程严谨：设计澄清 → 实施计划 → 子代理驱动开发 → TDD → 评审 → 验证。
- [Caveman](https://github.com/JuliusBrussee/caveman)（2.6.0，白名单 3 个技能）—— 输出压缩：默认 `full` 级，去掉客套与填充，保留全部技术实体、代码与报错原文。

两个上游的分工是本项目的核心：Superpowers 决定**怎么做**（流程产物、检查点、验证证据），Caveman 决定**怎么说**（表达密度）。两者不冲突，因为流程产物被显式排除在压缩之外——计划、规格、设计、评审意见、TDD 红绿说明、动手前的澄清一律保持完整结构化。

这不是给 DSH 打补丁，而是按 Superpowers 官方的宿主移植契约做一个 **Shape B** 移植：一个进程内插件把 bootstrap 在会话开始时注入模型上下文；DSH 的 preset（模式）机制天然满足"自动注入、无需逐会话 opt-in"这条唯一不可协商的要求。

上游技能**逐字复用**，不改写任何技能正文——这是上游移植规则的要求，也让升级同步变成一次目录复制。适配只发生在三处：一份工具映射文件、一段 bootstrap 拼装、两个 preset 本地插件。

## 自动生效的三件事（第三件刻意"不生效"）

| 能力 | 保障方式 |
|---|---|
| `using-superpowers` 引导 | 正文**注入**（`agent/pre-step`），每会话必达 |
| Caveman 默认 `full` 与流程产物优先级 | 同上，注入 `bootstrap.md` 的 "Caveman output style" 一节 |
| Caveman 级别定义 | **技能**保留在 catalog，按需加载 |

第三行是刻意的，也是这套设计里唯一的不对称：注入**没有**宣告 `caveman` 技能已激活，反而明说 "It is NOT active yet: load it with the `skill` tool"。

为什么不对称：`using-superpowers` 是**静态引导**——它要求的行为在会话生命周期内不变，所以把整段正文注入、并禁止再次加载是安全的，也免掉了每个会话一次的工具往返。`caveman` 不同，它是**带运行时可调参数的风格规则**：级别可以在会话中途被切换，规则文本必须能从 catalog 里被重新读取。若像 bootstrap 那样把 `caveman` 的正文宣告为"已激活、勿加载"，级别切换就没有任何可达路径——模型手里只有注入时那一刻的默认值。所以注入只写**默认值与优先级**（默认 full、流程产物优先、7 个合法级别名），规则正文单份留在技能内，切换时按需加载。

同理，`/caveman` 命令本身只**宣告级别**，不重复规则文本：规则只有技能这一个家，避免两处文本漂移。

## 级别切换

```
/caveman              # 显示当前级别与用法
/caveman ultra        # 切到 ultra
/caveman off          # 恢复正常表达
```

合法级别共 7 个：`lite`、`full`、`ultra`、`wenyan-lite`、`wenyan-full`、`wenyan-ultra`、`off`。非法输入报错并列出全部合法值，不会静默忽略。

`/caveman` 由预设自带插件 `preset/plugins/caveman-command/` 注册。上游把它交付为 **Claude Code 的 slash command**，本 harness 没有该机制——没有注册命令时，技能里写的激活契约就是不可达的。所以这里自己实现：命令把选中的级别作为一条持久 user 消息写入会话（`source: { kind: 'plugin' }`），下一轮模型从对话里读到级别，与注入的默认值走同一条路径。

## 目录结构

```
engineering-dsh/
├── index.js                         # bundle 安装器插件（dsh bundle 形态的入口）
├── cordis.patch.yml                 # bundle 挂载声明
├── package.json                     # 也定义 npm test（脚本与插件测试的 glob）
├── preset/                          # 这个目录就是被 DSH 挂载的"模式"
│   ├── preset.yml                   # 显示名（工程模式）、描述、排序（模式选择器读它）
│   ├── agent.cordis.yml             # 组合：persona + 标准工具面 + 插件 + 技能目录
│   ├── bootstrap.md                 # 生成物：using-superpowers 正文 + 工具映射 + caveman 默认
│   ├── SYNC.md                      # 生成物：各上游 commit / 版本 / 同步时间
│   ├── .manifest.json               # 生成物：逐文件 sha-256（gitignore，发布时经 files 白名单打入）
│   ├── plugins/
│   │   ├── bootstrap/               # 注入插件（agent/pre-step，幂等，压缩后自愈）
│   │   │   ├── index.js
│   │   │   ├── package.json
│   │   │   └── bootstrap.test.mjs
│   │   └── caveman-command/         # /caveman 命令插件
│   │       ├── index.js
│   │       ├── package.json
│   │       └── caveman-command.test.mjs
│   └── skills/                      # vendored：Superpowers 14 + Caveman 3 = 17 个技能
├── scripts/
│   ├── sync-superpowers-skills.sh   # 自管缓存同步 14 个技能并重打 DSH 指针
│   ├── sync-caveman-skills.sh       # 白名单同步 3 个 caveman 技能
│   ├── sync-lib.sh                  # 两个 sync 共用的 SYNC.md 写入
│   ├── build-bootstrap.sh           # 重建 bootstrap.md（带技能存在性自检）
│   ├── build-manifest.mjs           # 生成逐文件 sha-256 清单
│   ├── plant-core.mjs               # 植入引擎（link / copy 两种策略）
│   ├── install.sh                   # 投影到 ${DSH_HOME}/.agent-presets/engineering
│   ├── index.test.mjs               # 安装器插件测试
│   ├── plant-core.test.mjs          # 植入引擎测试
│   └── caveman-default-level.test.mjs  # 断言插件默认级别 == build-bootstrap 注入的级别
├── docs/                            # 设计与可行性记录（含上游的 skills 撰写约定）
├── evidence/VERIFICATION.md         # 历史验证记录
└── .cache/                          # sync 自管的上游检出（gitignore，可重建）
```

## 安装 / 刷新

```sh
scripts/build-bootstrap.sh          # 技能有变动时先跑
scripts/install.sh                  # 默认：真实目录 + 逐项符号链接（改动即时生效）
scripts/install.sh --copy           # 深拷贝（检出可能被删除的机器）
```

`install.sh` 末尾遍历 `preset/plugins/*/` 运行**每个**预设本地插件的自测（当前是 `bootstrap` 与 `caveman-command`），任一失败即中止安装并明确报错；某个插件缺少同名 `<name>.test.mjs` 同样直接失败——插件名单不写死，新增插件自动纳入门禁，"新增插件必须带自测"因此是门禁的一部分，避免把坏 preset 静默装到新机器上。

之后**新建**一个会话，在模式选择器里选 `工程模式`。会话一旦开始就不能切换模式（DSH 的设计），所以必须新建——安装完成后继续用旧会话是看不到的。

### 为什么安装成"真实目录 + 符号链接"

preset 发现用 `readdir(root, { withFileTypes: true })` 并只接受 `isDirectory()` 为真的条目。**指向目录的符号链接会被静默跳过**（`isDirectory()` 返回 false），所以不能把 `~/.dsh/.agent-presets/engineering` 直接做成指向本检出的符号链接。`install.sh` 因此创建一个真实目录，内部每个条目是符号链接——既被发现，又保持改动即时生效。

预设本地插件**自包含**：不 import 任何 harness 包（构造注入消息用 `node:crypto` 复刻 `createUserMessage` 的形状）。原因是本地创作的 preset 位于用户家目录，Node 的 `node_modules` 上行查找到不了 harness 自己的包，而 `--copy` 安装模式连链接都没有。这也是 `bootstrap/index.js` 与 `caveman-command/index.js` 各持一份**语义相同**的消息构造代码的原因——两份里 `deepFreeze` 逐字相同，`createUserMessage` 只是排版不同；不变量是**字段（`role`/`content`/`source`）、深冻结与全新 UUID**，不是字节。跨安装布局没有共享模块可用，改一处必须同 commit 改另一处。

## 上游同步

两个脚本都**自管缓存**，无需传入上游路径：

```sh
scripts/sync-superpowers-skills.sh   # -> .cache/superpowers，锁定 commit
scripts/sync-caveman-skills.sh       # -> .cache/caveman，锁定 commit
```

`CACHE_ROOT` 可覆盖缓存位置。**锁定 commit，不追最新分支**——同步必须可复现；`preset/SYNC.md` 记录确切 commit 与同步时间。

两个上游的 vendee 范围不同，因此两个脚本会互相补齐：

- Superpowers **拥有整棵 `skills/` 树**，所以它的同步是整体替换目录。这会顺手删掉那 3 个 caveman 技能，因此 `sync-superpowers-skills.sh` 在结束时**自动重跑 `sync-caveman-skills.sh`**，避免静默丢失。那次调用内部还会重建 `bootstrap.md` 与清单，所以一次 superpowers 同步结束时，最终的 `bootstrap.md` 一定是完成态技能树的函数。
- Caveman 是**部分 vendee**：白名单只有 `caveman`、`caveman-commit`、`caveman-review` 三个技能。上游其余部分（`LICENSING.md` 列为 Engine-linked、采用 BSL-1.1 的 `engine/`、`proxy/`、`rewriter/` 等目录）本仓库一律不再分发，细节见 `THIRD-PARTY-NOTICES.md`。

顺序上：**先同步，再 `build-bootstrap.sh`，再 `install.sh`**。

## 验证

三层，从便宜到昂贵。第 1 层在本仓库可直接跑；第 2 层需要本会话之外的探针工具；第 3 层不是自动化的。

**1. 测试（不需要 running agent，秒级）**

```sh
npm test          # 15 pass / 0 fail
```

这会先跑 `build:manifest` 重建 `preset/.manifest.json`，然后按 glob 收集全部测试：`scripts/*.test.mjs`（植入引擎、安装器插件、caveman 默认级别与 bootstrap 注入值一致）以及 `preset/plugins/*/*.test.mjs`（两个插件的自测）。两个插件测试也可单独运行——它们不依赖 harness，用合成的 `ctx` 与 `pre-step` 决策驱动真正安装的监听器：

```sh
node preset/plugins/bootstrap/bootstrap.test.mjs
node preset/plugins/caveman-command/caveman-command.test.mjs
```

bootstrap 自测断言移植契约的三条性质：首次注入一次、不重复注入、压缩丢掉后重新注入；另外覆盖 user 角色与 plugin 来源标记、被拒绝的步、空步、已有消息的保留顺序。caveman 自测覆盖 7 个级别的解析往返、注册形状、`/caveman` 裸调用只显示不注入、非法输入报错且不注入。

**2. 组合挂载与技能目录（需要用本会话之外的探针工具）**

在本仓库里**没有**可用的挂载探针，所以这一步无法作为本仓库的自动化断言：

- `sp_probe validate=engineering` → 应得 `MOUNT OK: engineering`（`standingKeyFor` 真挂载：本地相对插件、`!!js`、技能目录、realm 全部合法）
- `sp_verify preset=engineering cwd=<workspace>` → 断言该 preset 作用域下的技能目录

**3. 端到端（人类验收，唯一的最终证据）**

前两层都不证明"模型真的会按这个模式行动"。那一步只能由人做：新建会话选 `工程模式`，发：

> Let's make a react todo list

期望：模型**在写任何代码之前**先加载 `brainstorming` 技能（官方完成定义里的验收用例），且回复默认即为压缩风格。随后试 `/caveman off` 与 `/caveman ultra`，观察表达风格确实变化。

**本项目目前的验证状态：只跑过第 1 层。第 2、3 层都是待办的人类步骤，没有被验证过，不要当成已通过。**

## 设计要点

- **注入的是 user 角色消息，不是 system 消息**：符合上游 Shape B 纪律，也是 DSH 记录持久上下文的方式（`createUserMessage` + `source: { kind: 'plugin', plugin }`）。
- **幂等靠内容标记**：注入文本带 `<EXTREMELY_IMPORTANT>`；每次 pre-step 扫描本步将进入的消息，已在场就什么都不做。
- **压缩后自愈**：DSH 没有压缩事件可订阅，也不需要——压缩把旧历史换成摘要后，标记从"将进入的消息"里消失，下一次 pre-step 自动重新注入。这是"存在性即条件"的设计，比订阅事件更抗变化。
- **persona 段保持简短**：只在系统提示里说"你有 superpowers、先查技能、默认 caveman full"，把 9 KB 正文交给一次性注入的消息，避免每轮重复付费。persona 用 `complete: false`（它是必填字段，省略会挂载失败）。
- **不改技能正文**：唯一例外是官方允许的 Platform Adaptation 指针行（`using-superpowers/SKILL.md` 加一行 `- DeepSeek Harness: references/dsh-tools.md`）。
- **仓库规则优先**：bootstrap 末尾有专门一节声明工作区的 `AGENTS.md`/`CLAUDE.md` 与直接人类指令高于任何技能——用于压住"每任务自动提交 / 自动 push"这类与具体仓库治理冲突的通用建议。

## 已知边界

| 边界 | 说明 |
|---|---|
| 无原生 worktree 工具 | `using-git-worktrees` 只能走 `git worktree add` 回退；受文件沙箱约束时必须建在 workspace 内，被拒绝时按技能自带的降级措辞告知人类 |
| 不做 push/PR | `finishing-a-development-branch` 只做验证与选项呈现；push、建 PR、合并是人类的动作 |
| 可视化伴侣 | brainstorming 的可选本地服务器可用 `bash run_in_background` 起；但要人类自己打开 URL。遥测可用 `SUPERPOWERS_DISABLE_TELEMETRY=1` 关闭 |
| 不承诺硬性门禁 | DSH 没有能真正阻断"模型跳过技能直接写代码"的原语。本模式是强引导 + 可观察性，不是强制流程 |
| 级别切换依赖本仓库插件 | `/caveman` 是本仓库实现；上游的 slash command 形态在 DSH 不适用，删掉这个插件级别切换即失效 |
| 上游同步是手动的 | 没有定时任务也没有 CI：运行两个 sync 脚本，然后 `build-bootstrap.sh` 与 `install.sh` |

## 上游与许可

- Superpowers：MIT，© 2025 Jesse Vincent / Prime Radiant，<https://github.com/obra/superpowers>，v6.1.1（commit `d884ae04edebef577e82ff7c4e143debd0bbec99`）
- Caveman：MIT，© 2026 Julius Brussee，<https://github.com/JuliusBrussee/caveman>，2.6.0（commit `15581d14007fd01fb3f132016741962f34936ca2`）
- `preset/skills/**` 是上游内容的原样 vendored 副本，差异清单、范围与许可全文见 `THIRD-PARTY-NOTICES.md`；确切 commit 与同步时间见 `preset/SYNC.md`。
