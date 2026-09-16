# 设计：bundle 从 git 安装的兜底清单 + 包名收敛为 `@goalizc/dsh-engineering`

日期：2026-09-16
状态：待实施（本文件是 spec，实施计划由 `writing-plans` 产出）
轨道：**C**（命中 G4「改安装与发布链路」，另触及 G2 的发布契约面）

## 1. 问题与实测证据

`dsh plugin --profile headless add github:goalizc/dsh-engineering` 在 pnpm 层成功：

```
+ @dsh-engineering/dsh-engineering github:goalizc/dsh-engineering
Done in 8.6s    exit=0
```

但启动该 profile 时植入失败，`.agent-presets/` **根本没有生成**：

```
engineering: ENOENT: no such file or directory, open
'<DSH_HOME>/profiles/headless/node_modules/@dsh-engineering/dsh-engineering/preset/.manifest.json'
```

同一 bundle 走本地 tarball 安装时一切正常（同一会话实测）：

```
engineering: preset planted (65 changed)
植入后：66 个文件、17 个 SKILL.md、bootstrap.md 含 "## Task sizing (harness override)"
2a OK: "engineering" is a loadable roster row (broken: null)
```

**naming 现象**（本次一并解决）：`npm pack` 的产物名是「去掉 `@`、把 `/` 换成 `-`」再拼版本：

| `name` | 产物 |
|---|---|
| `@dsh-engineering/dsh-engineering` | `dsh-engineering-dsh-engineering-0.1.0.tgz` |
| `@goalizc/dsh-engineering` | `goalizc-dsh-engineering-0.1.0.tgz` |
| `goalizc-dsh-engineering` | `goalizc-dsh-engineering-0.1.0.tgz` |

重复不是逻辑缺陷，而是 **scope 名与包名相同**。改名后产物名干净，且 `npm publish --dry-run` 两种候选都通过、registry 查询均 `404`（未被占用）。

## 2. 根因

`scripts/plant-core.mjs:67` 的 copy 策略第一件事就是读清单：

```js
const manifest = JSON.parse(await readFile(join(source, '.manifest.json'), 'utf8')).files;
```

而 `.gitignore:9` 忽略了 `preset/.manifest.json`，所以 **git 检出里没有它**。npm tarball 之所以能用，是因为 `package.json#files` 显式列了 `"preset/.manifest.json"`，npm 会把被 ignore 但被 `files` 列出的文件打进包（上一轮实测 tgz 内含 `package/preset/.manifest.json`）。

**失败还是静默的**：`index.js:23` 用 `console.warn` 兜住异常，用户看到的是"装完了但模式不出现"。

## 3. 约束

1. **清单的生成规则是唯一权威**：`scripts/build-manifest.mjs:13`

   ```js
   const rels = await walkFiles(source, { exclude: ['.manifest.json', 'node_modules'] });
   ```

   写入结构 `{version: 1, preset: basename(source), files: {rel: sha256}}`。任何兜底实现必须与它**逐键相等**，否则同一棵树在两条安装路径上得到不同的植入集合。
2. **`plant()` 有两个调用方**：`scripts/plant-core.mjs:114`（CLI）与 `index.js:11`。只修后者会漏掉 CLI 路径。
3. **上游技能正文与既有注入节不动**：本次不碰 `preset/skills/**`、`preset/bootstrap.md`、`preset/agent.cordis.yml`。
4. **不把生成物提交进 git**：用户已否掉「把 `preset/.manifest.json` 纳入版本控制」。
5. **不加 `prepare` 脚本**：pnpm 是否对 git 依赖执行 `prepare` **未验证**，且 `scripts/build-manifest.mjs` 不在 `files` 白名单内，不押注。
6. **本机无法推送**：沙箱无任何凭据（上一轮实测：无 `~/.ssh`、无 ssh-agent、无 credential helper、无 token 环境变量），所以端到端验证必须在**不依赖网络与推送**的前提下做到等价。

## 4. 目标与非目标

**目标**

- `dsh plugin add` 的任意来源（npm tarball / git / 本地目录）都能成功植入 preset。
- 缺清单时**自动**现算，且与生成物逐键相等。
- 失败信息可操作；兜底是否生效在日志里可见。
- 包名收敛为 `@goalizc/dsh-engineering`，产物名变成 `goalizc-dsh-engineering-0.1.0.tgz`。
- 用测试守住「包名 / patch 自指 / `files` 白名单」这组跨文件重复值。

**非目标**

- 不发布到 npm（需用户账号与授权，单独进行）。
- 不改 preset id `engineering`、显示名 `工程模式`、安装布局、bundle 形态。
- 不改带日期的历史 docs（`docs/superpowers/plans/2026-09-14-*.md`、`docs/superpowers/specs/2026-09-14-*-design.md`）；其中的旧包名是当时记录。
- 不引入新的安装机制、不做 `prepare`、不加失败状态文件。

## 5. §1 兜底语义（`plant()`）

签名扩展为：

```js
export async function plant({ source, destRoot, name = PRESET_ID, policy = 'copy', manifest } = {})
```

清单解析顺序：

1. 显式传入的 `manifest`（Map/对象，`{rel: sha}`）
2. `<source>/.manifest.json` 的 `.files`
3. 前两者都不可用时**现算**：`await buildManifestMap(source, { exclude: ['.manifest.json', 'node_modules'] })`

**只在 ENOENT（文件不存在）时降级**。其它错误（权限、JSON 解析失败）照旧向外抛，不掩盖真故障。

三级解析最终都产出同一种形状：**`{rel: sha256}` 映射本身**（即 `.files` 的值），不构造 `version` / `preset` 外层字段——那两个字段只有生成物用，运行时用不到。

返回值新增 `manifestSource: 'provided' | 'file' | 'computed'`；`link` 策略下为 `'n/a'`（该策略不读清单，`plant-core.mjs:55-65`）。既有的 link 用例只断言 `r.action`（`plant-core.test.mjs:111`），没有对返回对象整体相等断言，新增字段不会打破它。

`.installed.json` 的结构 `{name, installedAt, files}` **不变**——兜底算出的哈希与文件清单相同，因此变更检测语义不变（`plant-core.mjs:80-101` 逐文件比对逻辑无需改动）。

## 6. §2 失败姿态（`index.js`）

保持**非致命**：一个 preset 的故障不该拖垮整个宿主启动。catch 分支从

```js
console.warn('engineering: ' + e.message);
```

改为带修复线索的可操作消息，含三样：preset id（`engineering`）、原始错误、以及一句排查建议（检查包内 `preset/.manifest.json` 是否存在，或确认所装版本含兜底逻辑）。

成功分支在 `manifestSource === 'computed'` 时追加标记，便于事后判断走的是哪条路径：

```
engineering: preset planted (65 changed) (manifest computed)
```

## 7. §3 包名收敛

改动**仅两处活的引用**（本轮 `git ls-files` 实测）：

- `package.json:2` → `"name": "@goalizc/dsh-engineering"`
- `cordis.patch.yml:4` → `name: '@goalizc/dsh-engineering'`

`cordis.patch.yml` 的那一行是 bundle 把自己挂进组合的自指，靠包名解析，**必须与新包名一致**，否则组合层静默少了挂载行。

连带效果：产物名 `dsh-engineering-dsh-engineering-0.1.0.tgz` → `goalizc-dsh-engineering-0.1.0.tgz`。

**无需迁移**：用户真实安装走 `scripts/install.sh` 的符号链接投影，与包名无关；只有临时 smoke profile 里装过旧名。

**风险与退路**：若 npm 上 `goalizc` 这个 scope 不归用户所有，将来无法发布该 scoped 名。退路是改成无 scope 的 `goalizc-dsh-engineering`——产物名完全相同，只改这两行，守卫测试照样通过。

## 8. §4 测试与验证

### 8.1 `scripts/plant-core.test.mjs`（现有文件，新增 4 例）

1. **无清单的源能植入**（先红：当前必抛 ENOENT）。源目录只放几个文件、不放 `.manifest.json`；断言植入成功、目标文件齐、`.installed.json` 的 `files` 与源逐键相等、`manifestSource === 'computed'`。
2. **现算映射与生成物逐键相等**。对仓库真实的 `preset/` 目录，比较 `buildManifestMap(preset, {exclude:[...]})` 与 `preset/.manifest.json` 的 `files`。这条把「兜底必须与 `build-manifest.mjs:13` 同规则」变成可执行的断言。
3. **显式 `manifest` 参数优先于文件**。传入一个刻意的假映射，断言植入用的是它、`manifestSource === 'provided'`。
4. **非 ENOENT 错误照旧抛出**。写一个 JSON 损坏的 `.manifest.json`，断言 `plant()` reject（不静默降级）。

### 8.2 新增 `scripts/bundle-identity.test.mjs`（4 个断言，守卫风格同 `caveman-default-level.test.mjs`）

1. `package.json#name` 必须等于 `cordis.patch.yml` 中 insert 行的 `name`。
2. `package.json#dsh.bundle.patch` 指向的文件必须存在。
3. `package.json#files` 必须含 `cordis.patch.yml` 与 `preset/.manifest.json`（少了后者，npm 路径也会退化成现算；少了前者，bundle 无法挂载）。
4. `package.json#files` 必须含 `scripts/plant-core.mjs`（`index.js:4` import 它；缺了则装完即崩）。

失败信息按本仓库风格写明耦合关系与修法。

### 8.3 端到端（不依赖网络与推送）

**git 路径的等价实验**：`git clone` 本仓库到工作区内临时目录 → 断言克隆里**没有** `preset/.manifest.json`（这正是 GitHub 安装拿到的树形状）→ 走真安装通道：

```
DSH_HOME=<临时> dsh plugin --profile gh add file:<clone 目录> ...
DSH_HOME=<临时> dsh --profile headless "reply ok"
```

期望：出现 `engineering: preset planted (<N> changed) (manifest computed)`，且 `<临时 DSH_HOME>/.agent-presets/engineering/` 有 66 个文件、17 个 SKILL.md；`DSH_HOME=<临时> node scripts/verify-composition.mjs` 报 `2a OK`。

（说明为何等价：GitHub 安装与本地 clone 都是「按 git 追踪内容还原的树」，被 gitignore 的 `preset/.manifest.json` 在两者中都不存在。真机 `dsh plugin add github:…` 只能在推送后由人类验证，本次不声称验证过。）

**npm 路径回归**：`npm pack` → `dsh plugin --profile smoke add <tgz>` → 启动 → 期望 `planted …` 且来源为**文件**（不带 `computed` 标记），证明没有退化。

**常规门禁**：`npm test` 全绿；`node scripts/verify-composition.mjs` 的 2a OK；`bash scripts/build-bootstrap.sh` 幂等。

### 8.4 期望计数

现有 21 例 + `plant-core.test.mjs` 新增 4 + `bundle-identity.test.mjs` 4，**预期 `npm test` 报 29 例全绿**；实际计数以真实输出为准并记入 `evidence/VERIFICATION.md`。

## 9. 风险与取舍

| 风险 | 处置 |
|---|---|
| 兜底算法与 `build-manifest.mjs` 漂移 | 不做人肉同步：8.1 用例 2 逐键比较两者 |
| 兜底把真故障（权限/JSON 损坏）也吞掉 | 只在 ENOENT 降级；8.1 用例 4 守住 |
| 包名与 patch 自指再次分叉 | 8.2 断言 1 |
| `files` 白名单漏项导致装完即坏 | 8.2 断言 3、4 |
| 真机 GitHub 安装仍未验证 | spec 与 VERIFICATION 都如实标注；给出等价的本地 clone 实验 |
| npm scope `goalizc` 不归用户 | 退路见 §7，改动两行 |
| 旧包名残留在带日期的历史 docs | 明确非目标，保持记录性质 |

## 10. 验收（DoD）

1. `plant-core.mjs` 的 `plant()` 支持三级解析顺序，返回 `manifestSource`。
2. `npm test` 全绿（预期 29 例），含 8.1 的 4 例与 8.2 的 4 条断言。
3. 8.3 的 git 路径等价实验实跑通过：`planted … (manifest computed)` + `2a OK`，命令与输出记入 `evidence/VERIFICATION.md`。
4. 8.3 的 npm 路径回归通过，来源为文件。
5. `package.json#name` 与 `cordis.patch.yml:4` 均为 `@goalizc/dsh-engineering`；`npm pack` 产物名为 `goalizc-dsh-engineering-0.1.0.tgz`。
6. `index.js` 失败消息含 preset id、原始错误与排查建议；成功且兜底生效时日志带 `manifest computed`。
7. 未改 `preset/skills/**`、`preset/bootstrap.md`、`preset/agent.cordis.yml`、带日期的历史 docs。
8. `evidence/VERIFICATION.md` 追加本次复验节（真实输出，禁止编造）。

## 11. 参考

- `scripts/plant-core.mjs:49-103`（`plant()`）、`:114`（CLI 调用方）
- `scripts/build-manifest.mjs:13`（清单生成规则，唯一权威）
- `index.js:8-26`（`doInstall` 与插件 `apply()`）
- `package.json`（`name` / `files` / `dsh.bundle.patch` / `publishConfig`）
- `cordis.patch.yml`（自指挂载行）
- `.gitignore:9`（`preset/.manifest.json`）
- `scripts/caveman-default-level.test.mjs`（守卫测试风格）
- `evidence/VERIFICATION.md`（复验记录格式）
