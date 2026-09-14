# superpowers-dsh

把 [Superpowers](https://github.com/obra/superpowers)（v6.1.1）适配为 **DeepSeek Harness 的一个新模式**：`Superpowers 模式`。

这不是给 DSH 打补丁，而是按 Superpowers 官方的宿主移植契约（`docs/porting-to-a-new-harness.md`）做一个 **Shape B** 移植：一个进程内插件把 bootstrap 在会话开始时注入模型上下文；DSH 的 preset（模式）机制天然满足"自动注入、无需逐会话 opt-in"这条唯一不可协商的要求。

上游技能**逐字复用**，不改写任何技能正文——这是上游移植规则的要求，也让升级同步变成一次目录复制。适配只发生在两处：一份工具映射文件，一段 bootstrap 拼装。

## 目录结构

```
superpowers-dsh/
├── preset/                          # 这个目录就是被 DSH 挂载的"模式"
│   ├── preset.yml                   # 显示名与描述（模式选择器读它）
│   ├── agent.cordis.yml             # 组合：persona + 标准工具面 + bootstrap 插件 + 技能目录
│   ├── bootstrap.md                 # 生成物：using-superpowers 正文 + 工具映射 + 仓库规则优先
│   ├── SYNC.md                      # 生成物：上游 commit / 版本 / 同步时间
│   ├── plugins/superpowers-bootstrap/
│   │   ├── index.js                 # 注入插件（agent/pre-step，幂等，压缩后自愈）
│   │   ├── package.json
│   │   └── selftest.mjs             # 无宿主依赖的回归测试
│   └── skills/                      # vendored：上游 14 个技能原样 + 一份 dsh-tools.md
└── scripts/
    ├── sync-superpowers-skills.sh   # 从上游检出同步 skills/ 并重打 DSH 指针
    ├── build-bootstrap.sh           # 重建 bootstrap.md（带自检）
    └── install.sh                   # 投影到 ${DSH_HOME}/.agent-presets/superpowers
```

## 安装 / 刷新

```sh
scripts/build-bootstrap.sh          # 技能有变动时先跑
scripts/install.sh                  # 默认：真实目录 + 逐项符号链接（改动即时生效）
scripts/install.sh --copy           # 深拷贝（检出可能被删除的机器）
```

`install.sh` 在末尾自动运行插件自测，失败即中止安装。**换机后无需任何手工依赖处理，重新 clone 后直接跑 `install.sh` 即可。**

之后**新建**一个会话，在模式选择器里选 `Superpowers 模式`。会话一旦开始就不能切换模式（DSH 的设计），所以必须新建。

### 为什么安装成"真实目录 + 符号链接"

preset 发现用 `readdir(root, { withFileTypes: true })` 并只接受 `isDirectory()` 为真的条目。**指向目录的符号链接会被静默跳过**（`isDirectory()` 返回 false），所以不能把 `~/.dsh/.agent-presets/superpowers` 直接做成指向本检出的符号链接。`install.sh` 因此创建一个真实目录，内部每个条目是符号链接——既被发现，又保持改动即时生效。

这个 preset 是**自包含、跨机器可移植**的：它的 bootstrap 插件不 import harness 任何包（构造注入消息用 `node:crypto` 的 `randomUUID` 复刻 `createUserMessage` 的形状），因此不需要指向 harness 依赖树的 `node_modules` 链接——装到任何装有 DSH 的机器都能直接跑。

## 验证

三层，从便宜到昂贵：

**1. 插件自测（不需要 running agent，秒级）**

```sh
cd preset/plugins/superpowers-bootstrap && node selftest.mjs
# => selftest OK: 6 assertions groups passed / bootstrap bytes: 9061
```

（`install.sh` 末尾已自动运行此自测，无需单独执行。）

它驱动插件真正安装的 `agent/pre-step` 监听器，断言移植契约的三条性质：首次注入一次、不重复注入、压缩丢掉后重新注入；另外覆盖 user 角色与 plugin 来源标记、被拒绝的步、空步、已有消息的保留顺序。

**2. 组合挂载 + 技能目录断言（需要本会话的探针工具）**

用本仓库外的 `sp_probe` / `sp_verify` 探针工具：

- `sp_probe validate=superpowers` → `MOUNT OK: superpowers`（`standingKeyFor` 真挂载：本地相对插件、`!!js`、技能目录、realm 全部合法）
- `sp_verify preset=superpowers cwd=<workspace>` → 断言该 preset 作用域下的技能目录

**3. 端到端（需要人类，唯一的最终证据）**

新建会话选 `Superpowers 模式`，发：

> Let's make a react todo list

期望：模型**在写任何代码之前**先加载 `brainstorming` 技能（官方完成定义里的验收用例）。也可先发一句 `describe your superpowers` 做冒烟检查。

## 设计要点

- **注入的是 user 角色消息，不是 system 消息**：符合上游 Shape B 纪律，也是 DSH 记录持久上下文的方式（`createUserMessage` + `source: { kind: 'plugin', plugin }`）。
- **幂等靠内容标记**：注入文本带 `<EXTREMELY_IMPORTANT>`；每次 pre-step 扫描本步将进入的消息，已在场就什么都不做。
- **压缩后自愈**：DSH 没有压缩事件可订阅，也不需要——压缩把旧历史换成摘要后，标记从"将进入的消息"里消失，下一次 pre-step 自动重新注入。这是"存在性即条件"的设计，比订阅事件更抗变化。
- **persona 段保持简短**：只在系统提示里说"你有 superpowers、先查技能"，把 9 KB 的正文交给一次性注入的消息，避免每轮重复付费。persona 用 `complete: false`（它是必填字段，省略会挂载失败），因此保留 DSH 完整 agent 行为。
- **不改技能正文**：唯一的 `SKILL.md` 改动是官方允许的"Platform Adaptation 指针行"（加一行 `- DeepSeek Harness: references/dsh-tools.md`）。
- **仓库规则优先**：bootstrap 末尾有专门一节声明工作区的 `AGENTS.md`/`CLAUDE.md` 与直接人类指令高于任何技能——用于压住"每任务自动提交 / 自动 push"这类与具体仓库治理冲突的通用建议。

## 已知边界

| 边界 | 说明 |
|---|---|
| 无原生 worktree 工具 | `using-git-worktrees` 只能走 `git worktree add` 回退；受文件沙箱约束时必须建在 workspace 内，被拒绝时按技能自带的降级措辞告知人类 |
| 不做 push/PR | `finishing-a-development-branch` 只做验证与选项呈现；push、建 PR、合并是人类的动作 |
| 可视化伴侣 | brainstorming 的可选本地服务器可用 `bash run_in_background` 起；但要人类自己打开 URL。遥测可用 `SUPERPOWERS_DISABLE_TELEMETRY=1` 关闭 |
| 不承诺硬性门禁 | DSH 没有能真正阻断"模型跳过技能直接写代码"的原语。本模式是强引导 + 可观察性，不是强制流程 |
| 上游同步是手动的 | 运行 `scripts/sync-superpowers-skills.sh <checkout>`，然后 `build-bootstrap.sh` 与 `install.sh` |

## 上游与许可

- Superpowers：MIT，© Jesse Vincent / Prime Radiant，<https://github.com/obra/superpowers>
- 本目录中的 `preset/skills/**` 是上游内容的原样 vendored 副本，版本见 `preset/SYNC.md`
