# git 安装兜底清单 + 包名收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `dsh plugin add` 从任意来源（npm tarball / git / 本地目录）都能成功植入 preset，并把包名收敛为 `@goalizc/dsh-engineering`。

**Architecture:** copy 策略的 `plant()` 目前在 `plant-core.mjs:67` 硬读 `<source>/.manifest.json`，而该文件被 `.gitignore:9` 忽略、git 检出里没有 → git 安装静默失败。改为三级解析（显式参数 → 文件 → 缺失时按 `build-manifest.mjs` 的同一规则现算），只在 ENOENT 降级；排除项抽成共享常量 `MANIFEST_EXCLUDES`，让生成器与运行时兜底不可能漂移。失败姿态保持非致命，但消息可操作、日志标明来源。包名改动只有两处活引用（`package.json`、`cordis.patch.yml` 自指行），新增守卫测试防它们分叉。

**Tech Stack:** Node ESM（`node:test` + `node:assert/strict`）、bash（验证命令）、pnpm/`dsh plugin`（端到端验证）、YAML（`cordis.patch.yml`）。

**Spec:** `docs/superpowers/specs/2026-09-16-git-install-fallback-design.md`

## Global Constraints

- **清单生成规则是唯一权威**：`scripts/build-manifest.mjs:13` 的 `walkFiles(source, { exclude: [...] })`；排除项固定为 `['.manifest.json', 'node_modules']`，本次抽成 `MANIFEST_EXCLUDES` 共享常量，**不改变取值**。
- **只在 ENOENT 降级**：其它读错误（权限、JSON 语法损坏）必须继续抛出，不得被兜底吞掉。
- **`.installed.json` 结构不变**：`{name, installedAt, files}`。兜底算出的哈希与文件清单与生成物逐键相同，变更检测语义（`plant-core.mjs:80-101`）不改。
- **`cordis.patch.yml` 没有末尾换行**（实测 `od -c`：`'` 之后即 EOF）。编辑时保持这一形态，避免无意义的空白 diff。
- **不改**：`preset/skills/**`、`preset/bootstrap.md`、`preset/agent.cordis.yml`、带日期的历史 docs（`docs/superpowers/{plans,specs}/2026-09-14-*`）。
- **不把 `preset/.manifest.json` 提交进 git**；不加 `prepare` 脚本；不做失败状态文件。
- **本机无法推送**（沙箱无任何 git 凭据），因此 GitHub 安装必须用「本地 clone + 本地 tarball」做等价实验；真机 `dsh plugin add github:…` **不声称验证过**。
- **提交约定**：Conventional Commits + 中文主题；一个子系统一个 commit；不 `push`。
- **临时目录一律放工作区内**且以 `.tmp-` 开头（`.gitignore` 已忽略 `.tmp-*/`），验证结束删除。
- **npm 在沙箱里需要**：`npm_config_cache` 与 `npm_config_logs_dir` 指向工作区内，否则 `npm pack` 报 `rofs`（日志目录在工作区外且只读）。

## File Structure

| 文件 | 责任 | 本次动作 |
|---|---|---|
| `scripts/plant-core.mjs` | 植入引擎；清单解析与拷贝策略 | 导出 `MANIFEST_EXCLUDES`；`plant()` 三级解析 + `manifestSource` |
| `scripts/build-manifest.mjs` | 生成清单（唯一权威） | 改用共享的 `MANIFEST_EXCLUDES` |
| `scripts/plant-core.test.mjs` | 植入引擎测试 | 新增 4 例 + 1 处既有断言 |
| `index.js` | bundle 安装器插件 | `formatResult` / `formatError` 抽出；失败可操作；日志标来源 |
| `scripts/index.test.mjs` | 安装器插件测试 | 新增 4 例 |
| `scripts/bundle-identity.test.mjs` | 守卫：包名 / patch 自指 / `files` 白名单 | 新建（4 条断言） |
| `package.json` | 包身份 | `name` → `@goalizc/dsh-engineering` |
| `cordis.patch.yml` | bundle 自指挂载行 | `name` 同步 |
| `README.md` | 用户文档 | 计数、测试清单、目录树、新增「通过 `dsh plugin add` 安装」小节 |
| `evidence/VERIFICATION.md` | 验证记录（真实输出） | 追加本次复验节 |

---

### Task 1: `plant()` 三级清单解析 + 共享排除常量

**Files:**
- Modify: `scripts/plant-core.mjs`（顶部导出常量、`plant()` 内清单解析、`resolveManifest` 辅助函数）
- Modify: `scripts/build-manifest.mjs:5,13`
- Test: `scripts/plant-core.test.mjs`（新增 4 例 + 既有 link 用例加 1 行断言）

**Interfaces:**
- Consumes: 既有 `hashFile` / `walkFiles` / `buildManifestMap` / `PRESET_ID`
- Produces:
  - `export const MANIFEST_EXCLUDES = ['.manifest.json', 'node_modules']`
  - `plant({ source, destRoot, name, policy, manifest })` → 返回值新增 `manifestSource: 'provided' | 'file' | 'computed' | 'n/a'`
  - 内部 `async function resolveManifest({ source, manifest })`

- [ ] **Step 1: 写失败的测试**

在 `scripts/plant-core.test.mjs` 的 import 行（第 4 行）加入 `rm`：

```js
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
```

把第 7 行的 import 改为：

```js
import { hashFile, walkFiles, buildManifestMap, plant, PRESET_ID, MANIFEST_EXCLUDES } from './plant-core.mjs';
```

在文件末尾（第 118 行之后）追加：

```js
// A git checkout has no preset/.manifest.json: the file is gitignored and only
// enters the npm tarball because package.json#files lists it explicitly. The
// copy policy used to hard-require it, so `dsh plugin add github:...` installed
// the package and then planted nothing, silently.
async function sourceWithoutManifest() {
  const d = await fixture();
  await rm(join(d, '.manifest.json'));
  return d;
}

test('plant computes the manifest when the source has none (git checkout)', async () => {
  const src = await sourceWithoutManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'planted');
  assert.equal(r.manifestSource, 'computed');
  assert.equal(await readFile(join(destRoot, PRESET_ID, 'bootstrap.md'), 'utf8'), 'hello');
  const inst = JSON.parse(await readFile(join(destRoot, PRESET_ID, '.installed.json'), 'utf8'));
  assert.deepEqual(Object.keys(inst.files), ['bootstrap.md', 'skills/SKILL.md']);
  for (const rel of Object.keys(inst.files)) {
    assert.equal(inst.files[rel], await hashFile(join(src, rel)));
  }
});

// The fallback must equal the generated manifest key for key, or the same tree
// plants different file sets depending on how it was installed. `npm test`'s
// pretest regenerates preset/.manifest.json, so this compares live values.
test('MANIFEST_EXCLUDES reproduces the shipped manifest exactly', async () => {
  const preset = fileURLToPath(new URL('../preset', import.meta.url));
  const shipped = JSON.parse(await readFile(join(preset, '.manifest.json'), 'utf8'));
  const computed = await buildManifestMap(preset, { exclude: MANIFEST_EXCLUDES });
  assert.deepEqual(computed, shipped.files);
});

test('an explicit manifest wins over the file', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const only = { 'bootstrap.md': await hashFile(join(src, 'bootstrap.md')) };
  const r = await plant({ source: src, destRoot, policy: 'copy', manifest: only });
  assert.equal(r.manifestSource, 'provided');
  const inst = JSON.parse(await readFile(join(destRoot, PRESET_ID, '.installed.json'), 'utf8'));
  assert.deepEqual(Object.keys(inst.files), ['bootstrap.md']);
});

// Only ENOENT justifies recomputing: a corrupt manifest is a real fault and
// must surface, not get papered over by hashing the tree.
test('a corrupt manifest still throws instead of silently recomputing', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await writeFile(join(src, '.manifest.json'), '{ not json');
  await assert.rejects(plant({ source: src, destRoot, policy: 'copy' }));
});
```

同时需要 `fileURLToPath`：在第 5 行 `import { tmpdir } from 'node:os';` 之后插入

```js
import { fileURLToPath } from 'node:url';
```

并在既有 link 用例（`plant link policy ...`）的 `assert.equal(r.action, 'planted');` 之后加一行：

```js
  assert.equal(r.manifestSource, 'n/a');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/plant-core.test.mjs`

Expected: 红。形态取决于 Node 对缺失导出的处理：若 `MANIFEST_EXCLUDES` 未导出，ESM 会在加载期报 `SyntaxError: The requested module './plant-core.mjs' does not provide an export named 'MANIFEST_EXCLUDES'`，运行器把整个文件记为 1 个文件级失败；若先只做部分实现，则逐例失败（`plant computes the manifest when the source has none` 报 `ENOENT ... .manifest.json`，link 用例 `undefined !== 'n/a'`）。无论哪种，**必须有真实红输出**，以实际输出为准记录。

- [ ] **Step 3: 实现**

`scripts/plant-core.mjs` 在 `PRESET_ID` 附近（第 46-47 行下方）加：

```js
/**
 * The exclude set shared by the generated manifest and the runtime fallback.
 * Both must exclude exactly these, or the same tree plants different file sets
 * depending on whether preset/.manifest.json happened to ship with it.
 */
export const MANIFEST_EXCLUDES = ['.manifest.json', 'node_modules'];
```

把 `plant()` 整体替换为下面这版（`link` 分支只多一个 `manifestSource: 'n/a'`，其余逐字保留）：

```js
export async function plant({ source, destRoot, name = PRESET_ID, policy = 'copy', manifest } = {}) {
  const destDir = join(destRoot, name);
  const installedPath = join(destDir, '.installed.json');
  let installed = null;
  try { installed = JSON.parse(await readFile(installedPath, 'utf8')); } catch { installed = null; }

  if (policy === 'link') {
    await mkdir(destDir, { recursive: true });
    for (const ent of await readdir(destDir, { withFileTypes: true })) {
      await rm(join(destDir, ent.name), { recursive: true, force: true });
    }
    for (const ent of await readdir(source, { withFileTypes: true })) {
      if (ent.name === '.manifest.json') continue;
      await symlink(join(source, ent.name), join(destDir, ent.name));
    }
    return { action: 'planted', changed: 0, kept: 0, reason: null, manifestSource: 'n/a' };
  }

  // NOTE: `manifestFiles`, not `manifest` — a top-level `const manifest` in the
  // function body would collide with the parameter of the same name.
  const { files: manifestFiles, manifestSource } = await resolveManifest({ source, manifest });

  if (!installed) {
    let hadNonEmpty = false;
    try { hadNonEmpty = (await readdir(destDir)).length > 0; } catch { hadNonEmpty = false; }
    if (hadNonEmpty) throw new Error(`destination ${destDir} exists without .installed.json; refusing to touch`);
  }

  await mkdir(destDir, { recursive: true });
  const newFiles = Object.keys(manifestFiles);
  const next = {};
  let changed = 0, kept = 0;

  for (const rel of newFiles) {
    const dst = join(destDir, rel);
    const newSha = manifestFiles[rel];
    if (!existsSync(dst)) {
      await copyAtomic(join(source, rel), dst);
      next[rel] = newSha; changed++;
      continue;
    }
    const cur = await hashFile(dst);
    if (cur === newSha) { next[rel] = newSha; continue; }
    const installedSha = installed && installed.files ? installed.files[rel] : null;
    if (installedSha === cur) { await copyAtomic(join(source, rel), dst); next[rel] = newSha; changed++; }
    else { next[rel] = newSha; kept++; }
  }

  const record = { name, installedAt: new Date().toISOString(), files: next };
  if (!installed) {
    await writeFileAtomic(installedPath, JSON.stringify(record, null, 2));
    return { action: 'planted', changed, kept, reason: null, manifestSource };
  }
  const action = (kept === 0 && changed === 0) ? 'unchanged' : (kept > 0 ? 'partial' : 'updated');
  await writeFileAtomic(installedPath, JSON.stringify(record, null, 2));
  return { action, changed, kept, reason: null, manifestSource };
}
```

在 `plant()` **之前**加辅助函数：

```js
async function resolveManifest({ source, manifest }) {
  if (manifest) return { files: manifest, manifestSource: 'provided' };
  try {
    const parsed = JSON.parse(await readFile(join(source, '.manifest.json'), 'utf8'));
    return { files: parsed.files, manifestSource: 'file' };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return {
      files: await buildManifestMap(source, { exclude: MANIFEST_EXCLUDES }),
      manifestSource: 'computed',
    };
  }
}
```

`scripts/build-manifest.mjs`：第 5 行改为

```js
import { hashFile, walkFiles, MANIFEST_EXCLUDES } from './plant-core.mjs';
```

第 13 行改为

```js
const rels = await walkFiles(source, { exclude: MANIFEST_EXCLUDES });
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```bash
node --test scripts/plant-core.test.mjs
npm run build:manifest
node --test scripts/plant-core.test.mjs
```

Expected: 第一次 `pass 14`、`fail 0`；`npm run build:manifest` 打印 `manifest: 65 files -> preset/.manifest.json`（**仍是 65，与改动前一致**——排除项取值未变）；第二次仍 `pass 14`。

- [ ] **Step 5: 提交**

```bash
git add scripts/plant-core.mjs scripts/build-manifest.mjs scripts/plant-core.test.mjs
git commit -F - <<'EOF'
fix: plant() 缺清单时现算，修 git 安装静默不植入

`dsh plugin add github:goalizc/dsh-engineering` 能装上，但启动时植入失败：
`engineering: ENOENT: ... preset/.manifest.json`，`.agent-presets/` 不生成。
根因是 copy 策略先硬读清单，而该文件被 gitignore——npm tarball 能用只是因为
package.json#files 显式列了它。失败还被 index.js 的 console.warn 吞掉。

plant() 改为三级解析：显式 manifest 参数 → `<source>/.manifest.json` → 缺失时
按 build-manifest.mjs 的同一规则现算。只在 ENOENT 降级，JSON 损坏等真故障继续
抛出。排除项抽成共享常量 MANIFEST_EXCLUDES，生成器与兜底共用一份，杜绝漂移；
新增用例逐键比较现算结果与已发布清单。

返回值新增 manifestSource，调用方据此在日志里标明来源。

Refs: docs/superpowers/specs/2026-09-16-git-install-fallback-design.md
EOF
```

- [ ] **Step 6: 反向取证（证明守卫有牙），然后还原**

```bash
sed -i 's/export const MANIFEST_EXCLUDES = \[.*\];/export const MANIFEST_EXCLUDES = [];/' scripts/plant-core.mjs
node --test scripts/plant-core.test.mjs 2>&1 | grep -E "MANIFEST_EXCLUDES reproduces|^ℹ (tests|pass|fail)"
git checkout -- scripts/plant-core.mjs
node --test scripts/plant-core.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: 第一条 → `fail 1`、`pass 13`，失败用例是 `MANIFEST_EXCLUDES reproduces the shipped manifest exactly`（`[]` 会让 `.manifest.json` 与 `node_modules` 进入现算集合）；`git checkout` 后 → `pass 14`、`fail 0`。保留第一条输出给 Task 4。

---

### Task 2: 失败姿态可操作 + 日志标明清单来源

**Files:**
- Modify: `index.js`
- Test: `scripts/index.test.mjs`（新增 4 例）

**Interfaces:**
- Consumes: Task 1 的 `plant()` 返回值（`manifestSource`）与 `PRESET_ID`
- Produces:
  - `export function formatResult(r)` → 单行日志文本
  - `export function formatError(e)` → 单行可操作警告文本
  - `doInstall({ destRoot, name })` 的默认 `name` 改由 `PRESET_ID` 提供（取值不变，仍是 `'engineering'`）

- [ ] **Step 1: 写失败的测试**

`scripts/index.test.mjs` 第 4 行的 import 加入 `writeFile`：

```js
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
```

第 7 行改为：

```js
import plugin, { doInstall, formatResult, formatError } from '../index.js';
```

在文件末尾追加：

```js
// The log line is how a human tells an npm install (manifest shipped) from a
// git install (manifest computed). Losing the marker makes the two
// indistinguishable in a boot log, which is exactly how the git path failed
// silently before.
test('formatResult marks a computed manifest and stays quiet for a shipped one', () => {
  const computed = formatResult({ action: 'planted', changed: 65, manifestSource: 'computed' });
  assert.match(computed, /^engineering: preset planted \(65 changed\) \(manifest computed\)$/);
  const shipped = formatResult({ action: 'planted', changed: 65, manifestSource: 'file' });
  assert.equal(shipped, 'engineering: preset planted (65 changed)');
});

// The old message was `engineering: ` + e.message, which named neither the
// preset nor what to check. A silent-looking install is the failure mode this
// whole change exists to remove.
test('formatError names the preset, the original error and what to check', () => {
  const msg = formatError(new Error('ENOENT: no such file or directory'));
  assert.match(msg, /^engineering: preset NOT installed/);
  assert.match(msg, /ENOENT: no such file or directory/);
  assert.match(msg, /preset\/\.manifest\.json/);
});

test('doInstall reports where its manifest came from', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.manifestSource, 'file');
});

test('apply() warns instead of throwing when planting cannot proceed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-fail-'));
  const notADir = join(dir, 'not-a-dir');
  await writeFile(notADir, 'x'); // DSH_HOME pointing at a file: mkdir must fail
  const prevHome = process.env.DSH_HOME;
  const prevWarn = console.warn;
  let warned = '';
  process.env.DSH_HOME = notADir;
  console.warn = (m) => { warned += String(m); };
  try {
    await assert.doesNotReject(plugin.apply());
  } finally {
    console.warn = prevWarn;
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  }
  assert.match(warned, /^engineering: preset NOT installed/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/index.test.mjs`

Expected: 整个文件加载失败或 4 例失败——`formatResult` / `formatError` 尚未导出（`does not provide an export named`）。以真实输出为准。

- [ ] **Step 3: 实现**

把 `index.js` 整体替换为：

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plant, PRESET_ID } from './scripts/plant-core.mjs';

export const PRESET_DIR = fileURLToPath(new URL('./preset', import.meta.url));

export async function doInstall({ destRoot, name = PRESET_ID } = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const root = destRoot || join(dshHome, '.agent-presets');
  return plant({ source: PRESET_DIR, destRoot: root, name, policy: 'copy' });
}

export function formatResult(r) {
  let line = `${PRESET_ID}: preset ${r.action}`;
  if (r.changed) line += ` (${r.changed} changed)`;
  if (r.kept) line += ` (${r.kept} kept user files)`;
  if (r.manifestSource === 'computed') line += ' (manifest computed)';
  return line;
}

export function formatError(e) {
  return (
    `${PRESET_ID}: preset NOT installed — ${e.message} ` +
    `Check that the installed package carries preset/.manifest.json, or that its ` +
    `version can compute one when that file is absent from a git checkout.`
  );
}

export default {
  name: 'engineering-installer',
  async apply() {
    try {
      console.log(formatResult(await doInstall()));
    } catch (e) {
      // Non-fatal on purpose: a broken preset must not take the whole host down.
      console.warn(formatError(e));
    }
  },
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test scripts/index.test.mjs`

Expected: `pass 6`、`fail 0`（原有 2 例 + 新增 4 例）。

- [ ] **Step 5: 提交**

```bash
git add index.js scripts/index.test.mjs
git commit -F - <<'EOF'
fix: 植入失败改为可操作提示，日志标明清单来源

原来是 `console.warn('engineering: ' + e.message)`：既没说清是哪个 preset，也没说
该查什么，于是 git 安装的失败被当成"装完了但模式不出现"。改为非致命但可操作的
消息（preset id + 原始错误 + 排查方向），并在兜底生效时于成功日志后附
`(manifest computed)`，让 npm 安装与 git 安装在一行日志里可区分。

顺带把默认 preset 名从字面量 'engineering' 改为引用 plant-core 的 PRESET_ID，
消除同一事实的两处书写。

Refs: docs/superpowers/specs/2026-09-16-git-install-fallback-design.md
EOF
```

---

### Task 3: 包名收敛为 `@goalizc/dsh-engineering` + 身份守卫

**Files:**
- Modify: `package.json:2`
- Modify: `cordis.patch.yml:4`（该文件**无末尾换行**，保持）
- Test: `scripts/bundle-identity.test.mjs`（新建，4 条断言）

**Interfaces:**
- Consumes: 无（只读 `package.json` / `cordis.patch.yml`）
- Produces: 新包名 `@goalizc/dsh-engineering`；`npm pack` 产物名 `goalizc-dsh-engineering-0.1.0.tgz`

- [ ] **Step 1: 写守卫测试**

新建 `scripts/bundle-identity.test.mjs`：

```js
// scripts/bundle-identity.test.mjs
//
// Guards the cross-file values that make this repository a dsh bundle. Nothing
// links them: package.json#name and the self-referential insert row in
// cordis.patch.yml must agree or the composed profile silently loses the
// installer layer; the `files` whitelist must carry what the installer needs at
// runtime or the installed package is broken on arrival.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the patch self-reference names the package', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const patch = await read('../cordis.patch.yml');
  const rowName = /^\s*name:\s*'([^']+)'\s*$/m.exec(patch)?.[1];
  assert.equal(
    rowName,
    pkg.name,
    `cordis.patch.yml must insert a row named ${JSON.stringify(pkg.name)}, the ` +
      `installed package name; got ${JSON.stringify(rowName)}. The row is how the ` +
      `bundle mounts itself, so a mismatch drops the installer from the composition.`,
  );
});

test('dsh.bundle.patch points at a file that exists', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const rel = pkg.dsh?.bundle?.patch;
  assert.ok(rel, 'package.json must declare dsh.bundle.patch');
  const abs = fileURLToPath(new URL(`../${rel.replace(/^\.\//, '')}`, import.meta.url));
  assert.ok(existsSync(abs), `dsh.bundle.patch points at a missing file: ${rel}`);
});

test('the files whitelist carries the patch and the manifest', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  for (const must of ['cordis.patch.yml', 'preset/.manifest.json']) {
    assert.ok(
      pkg.files.includes(must),
      `package.json#files must list ${JSON.stringify(must)}: the first is the ` +
        `mount layer, the second is what the copy policy reads before planting. ` +
        `npm honours this list for gitignored files, which is why a published ` +
        `tarball carries the manifest while a git checkout does not.`,
    );
  }
});

test('the files whitelist carries the plant engine index.js imports', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.ok(
    pkg.files.includes('scripts/plant-core.mjs'),
    'package.json#files must list scripts/plant-core.mjs: index.js imports it, ' +
      'so an installed package without it cannot plant at all.',
  );
});
```

- [ ] **Step 2: 跑测试（此时应全绿——它们是守卫，不是新行为）**

Run: `node --test scripts/bundle-identity.test.mjs`

Expected: `pass 4`、`fail 0`。四条断言此刻都成立（包名与自指当前一致，`files` 齐备）。它们的牙由 Step 5 的反向取证证明。

- [ ] **Step 3: 改名**

`package.json` 第 2 行：

```
  "name": "@goalizc/dsh-engineering",
```

`cordis.patch.yml` 第 4 行（**不加末尾换行**）：

```
      name: '@goalizc/dsh-engineering'
```

- [ ] **Step 4: 验证产物名与守卫仍绿**

Run:

```bash
node --test scripts/bundle-identity.test.mjs
export npm_config_cache="$PWD/.tmp-pack/nc" npm_config_logs_dir="$PWD/.tmp-pack/nl"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir" .tmp-pack
npm pack --pack-destination .tmp-pack 2>&1 | tail -1
```

Expected: `pass 4`、`fail 0`；产物名为 `goalizc-dsh-engineering-0.1.0.tgz`。

- [ ] **Step 5: 提交，然后反向取证并还原**

```bash
git add package.json cordis.patch.yml scripts/bundle-identity.test.mjs
git commit -F - <<'EOF'
feat: 包名收敛为 @goalizc/dsh-engineering，并加身份守卫

`npm pack` 的产物名是「去掉 @、把 / 换成 -」再拼版本，scope 与包名相同就得到
`dsh-engineering-dsh-engineering-0.1.0.tgz`。改成 @goalizc/dsh-engineering 后产物
名是 `goalizc-dsh-engineering-0.1.0.tgz`（实测 npm pack 与 registry 查询：
两种候选名均可用、均未被占用）。

只有两处活的引用：package.json#name 与 cordis.patch.yml 的自指挂载行。后者靠包名
解析，分叉会让组合层静默丢掉安装器行——此前没有任何测试守着这组重复值。新增
bundle-identity 守卫：包名 == 自指行、dsh.bundle.patch 指向存在的文件、files 白名单
含 patch 与清单、含 index.js 依赖的 scripts/plant-core.mjs。

Refs: docs/superpowers/specs/2026-09-16-git-install-fallback-design.md
EOF
```

反向取证（证明守卫有牙）：

```bash
sed -i "s/@goalizc\/dsh-engineering/@goalizc\/wrong-name/" cordis.patch.yml
node --test scripts/bundle-identity.test.mjs 2>&1 | grep -E 'must insert a row named|^ℹ (tests|pass|fail)'
git checkout -- cordis.patch.yml
node --test scripts/bundle-identity.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Expected: 第一条 → `fail 1`、`pass 3`，信息含 `must insert a row named`；还原后 → `pass 4`、`fail 0`。保留第一条输出给 Task 4。

- [ ] **Step 6: 清理打包临时目录**

```bash
rm -rf .tmp-pack
```

---

### Task 4: 两条安装路径的端到端验证 + 文档 + 全部门禁

**Files:**
- Modify: `README.md`（计数、测试清单、目录树、新增小节）
- Modify: `evidence/VERIFICATION.md`（追加复验节）

**Interfaces:**
- Consumes: Task 1–3 的实现与取证输出
- Produces: 真实端到端证据；README 的安装通道文档

- [ ] **Step 1: git 路径的等价实验（不依赖网络与推送）**

Run:

```bash
cd /home/goalizc/dsh-engineering
rm -rf .tmp-e2e && mkdir -p .tmp-e2e
git clone -q . .tmp-e2e/clone
test ! -e .tmp-e2e/clone/preset/.manifest.json && echo "clone has no manifest: OK"
export npm_config_cache="$PWD/.tmp-e2e/nc" npm_config_logs_dir="$PWD/.tmp-e2e/nl"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir"
( cd .tmp-e2e/clone && npm pack --pack-destination "$OLDPWD/.tmp-e2e" 2>&1 | tail -1 )
export DSH_HOME="$PWD/.tmp-e2e/home"
timeout 300 dsh plugin --profile headless add "$PWD/.tmp-e2e"/goalizc-dsh-engineering-0.1.0.tgz \
  --store-dir "$PWD/.tmp-e2e/store" --cache-dir "$PWD/.tmp-e2e/pcache" 2>&1 | tail -4
timeout 150 dsh --profile headless "reply ok" 2>&1 | head -3
find "$DSH_HOME/.agent-presets/engineering" -type f | wc -l
find "$DSH_HOME/.agent-presets/engineering/skills" -name SKILL.md | wc -l
DSH_HOME="$DSH_HOME" timeout 120 node scripts/verify-composition.mjs 2>&1 | tail -2
```

Expected:

- `clone has no manifest: OK`
- clone 打出的 tgz 名为 `goalizc-dsh-engineering-0.1.0.tgz`（clone 里已是新包名），且**不含** `preset/.manifest.json`
- `dsh plugin … add` 打印依赖行与 `add`（pnpm）成功
- 启动打印 `engineering: preset planted (<N> changed) (manifest computed)`，随后是 `MISSING_CREDENTIAL` 的报错（临时 profile 无 key，与本改动无关）
- 植入文件数 `66`、SKILL.md 数 `17`
- `2a OK: "engineering" is a loadable roster row (broken: null)`

- [ ] **Step 2: npm 路径回归**

Run:

```bash
cd /home/goalizc/dsh-engineering
rm -rf .tmp-npm && mkdir -p .tmp-npm
export npm_config_cache="$PWD/.tmp-npm/nc" npm_config_logs_dir="$PWD/.tmp-npm/nl"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir"
npm pack --pack-destination .tmp-npm 2>&1 | tail -1
export DSH_HOME="$PWD/.tmp-npm/home"
timeout 300 dsh plugin --profile headless add "$PWD/.tmp-npm"/goalizc-dsh-engineering-0.1.0.tgz \
  --store-dir "$PWD/.tmp-npm/store" --cache-dir "$PWD/.tmp-npm/pcache" 2>&1 | tail -3
timeout 150 dsh --profile headless "reply ok" 2>&1 | head -2
```

Expected: 启动打印 `engineering: preset planted (<N> changed)`，**不带** `(manifest computed)` —— 证明 npm 路径仍走文件、没有退化。

- [ ] **Step 3: 常规门禁**

Run:

```bash
cd /home/goalizc/dsh-engineering
npm test 2>&1 | tail -8
bash scripts/build-bootstrap.sh
git diff --exit-code preset/bootstrap.md; echo "drift exit=$?"
node scripts/verify-composition.mjs 2>&1 | tail -2
git status --short
```

Expected:

- `npm test` → `tests 33`、`pass 33`、`fail 0`（21 + Task1 的 4 + Task2 的 4 + Task3 的 4）
- `built .../preset/bootstrap.md (11729 bytes, 230 lines)`（与上一轮一致，本次未碰注入节）
- `drift exit=0`
- `2a OK: "engineering" is a loadable roster row (broken: null)`
- `git status --short` 只列 `README.md`（`VERIFICATION.md` 尚未改）

- [ ] **Step 4: README 更新**

四处：

1. `README.md:142` 附近把 `npm test          # 21 pass / 0 fail` 改为实测值（预期 `33`）。
2. 同节枚举测试文件那句里，在 `任务分档守卫` 之后补 `、bundle 身份守卫（包名 == patch 自指、files 白名单齐备）`。
3. 目录结构树里 `caveman-default-level.test.mjs` 那一行之后插入：

```
│   ├── bundle-identity.test.mjs     # 守卫：包名 == patch 自指、dsh.bundle.patch 存在、files 齐备
```

4. 在「## 安装 / 刷新」一节的 `之后**新建**一个会话…` 那段之后，插入新小节（**注意 plan 文档此处用四反引号包裹，落地到 README 时用普通的三个反引号**）：

````markdown
### 通过 `dsh plugin add` 安装（bundle 通道）

```sh
dsh plugin --profile <name> add /path/to/goalizc-dsh-engineering-0.1.0.tgz   # 本地 tarball
dsh plugin --profile <name> add github:goalizc/dsh-engineering               # GitHub
```

`dsh plugin` 必须带 `--profile`（实现上它把余下参数转发给该 profile 目录里的 pnpm），因此它能装的东西 = pnpm 能装的东西：tarball、git、本地目录都行，裸 registry 包名则需要先发布。

加进 profile **不等于**已植入：`add` 只登记 `dsh.profile.bundles` 并把 patch 层组合进去，`~/.dsh/.agent-presets/engineering/` 是**启动该 profile 时**由 `index.js` 的 `apply()` 植入的。

git 来源的检出里没有 `preset/.manifest.json`（它被 gitignore，只有 npm 打包时经 `files` 白名单带入）。植入引擎因此在文件缺失时按与生成器相同的规则现算，成功日志会追加 `(manifest computed)` 以标明走的是哪条路径。植入失败**不会**中断宿主启动，但会打印含 preset id、原始错误与排查方向的警告。
````

- [ ] **Step 5: 追加 VERIFICATION 复验节**

在 `evidence/VERIFICATION.md` 末尾追加（**每个 `<...>` 换成真实输出，禁止编造**；下方模板用四反引号包裹，落地时用普通三反引号与仓库既有各节格式一致）：

````markdown
## 2026-09-16 git 安装兜底清单 + 包名收敛复验

改动：`plant()` 三级清单解析 + `MANIFEST_EXCLUDES`；`index.js` 可操作失败提示与
来源标记；包名改 `@goalizc/dsh-engineering`；新增 `scripts/bundle-identity.test.mjs`。

### 第 1 层：`npm test`

```
<粘贴 tests/pass/fail 三行>
```

### git 路径的等价实验

`git clone` 的检出里没有清单（与 GitHub 安装拿到的树形状一致）：

```
$ test ! -e .tmp-e2e/clone/preset/.manifest.json && echo "clone has no manifest: OK"
<输出>
$ (cd .tmp-e2e/clone && npm pack --pack-destination "$OLDPWD/.tmp-e2e")
<产物名>
$ tar -tzf <clone tgz> | grep -c preset/.manifest.json
<0>
```

装进临时 profile 并启动：

```
$ { dsh plugin --profile headless add <clone tgz> --store-dir <...> --cache-dir <...>; } 
<依赖行>
$ DSH_HOME=<临时> dsh --profile headless "reply ok"
<planted 行，含 (manifest computed)>
<随后的 MISSING_CREDENTIAL 行>
```

植入结果与组合健康：

```
文件数: <N>    SKILL.md: <N>
$ DSH_HOME=<临时> node scripts/verify-composition.mjs
<2a OK 行>
```

### npm 路径回归

```
$ npm pack --pack-destination .tmp-npm
<产物名 goalizc-dsh-engineering-0.1.0.tgz>
$ dsh plugin --profile headless add <repo tgz> ...
$ DSH_HOME=<临时> dsh --profile headless "reply ok"
<planted 行，**无** (manifest computed)>
```

### 反向取证

| 断言 | 制造违规 | 结果 | 还原后 |
|---|---|---|---|
| 现算集合与发布清单逐键相等 | `MANIFEST_EXCLUDES` 改为 `[]` | `<fail 输出摘要>` | `pass 14 / fail 0` |
| patch 自指 == 包名 | `sed` 把自指行改成 `@goalizc/wrong-name` | `<fail 输出摘要>` | `pass 4 / fail 0` |

### 计划外增补（如实记录）

spec §8.4 预期 29 例；实施时在 `scripts/index.test.mjs` 额外加了 4 例（`formatResult`
的来源标记两例、`formatError` 内容一例、`apply()` 不抛一例），故终值为 33。理由：失败
姿态是用户可见行为，值得守卫，而不是只靠端到端覆盖。

### 未验证（诚实清单）

真机 `dsh plugin add github:goalizc/dsh-engineering` **未验证**：沙箱无任何 git 凭据，
无法推送本次改动。等价实验用「本地 clone → 本地 tarball」，树形状与 GitHub 安装一致
（被 gitignore 的清单在两者中都不存在）。推送后由人类真机复验一次即可闭环。
````

- [ ] **Step 6: 提交**

```bash
git add README.md evidence/VERIFICATION.md
git commit -F - <<'EOF'
docs: README 与验证记录补 git 安装兜底与包名收敛

README：新增「通过 dsh plugin add 安装（bundle 通道）」小节（--profile 必需、
可装来源、add 与植入是两步、git 来源缺清单时现算、失败非致命但会说明）；测试计数
与测试清单更新；目录树补 bundle-identity.test.mjs。

VERIFICATION：追加 2026-09-16 复验节——npm test 计数、git 路径等价实验（clone 无
清单 → planted (manifest computed) → 2a OK）、npm 路径回归（无 computed 标记）、
两条反向取证、计划外增补的如实说明，以及"真机 GitHub 安装未验证"的诚实清单。

Refs: docs/superpowers/specs/2026-09-16-git-install-fallback-design.md
EOF
```

- [ ] **Step 7: 清理临时目录并确认工作区干净**

```bash
cd /home/goalizc/dsh-engineering
rm -rf .tmp-e2e .tmp-npm
git status --short
echo "clean=$([ -z "$(git status --porcelain)" ] && echo yes || echo no)"
```

Expected: `clean=yes`。

---

## 执行顺序与提交划分

| 提交 | 内容 | 交付物 |
|---|---|---|
| 1 | `plant()` 三级解析 + 共享排除常量 | git 检出无清单也能植入；现算与发布清单逐键相等 |
| 2 | 失败姿态 + 来源标记 | 失败可操作；日志可区分两条安装路径 |
| 3 | 包名收敛 + 身份守卫 | `goalizc-dsh-engineering-0.1.0.tgz`；四处身份值不再可能分叉 |
| 4 | README + VERIFICATION | 安装通道文档与真实证据 |

## 自审记录（spec 覆盖对照）

| spec 要求 | 落在哪个任务 |
|---|---|
| §5 三级解析、只在 ENOENT 降级、`manifestSource` | Task 1 Step 3；用例 1、3、4 |
| §5 现算必须与生成物逐键相等 | Task 1 Step 3 的 `MANIFEST_EXCLUDES` 共享常量 + 用例 2 |
| §5 `.installed.json` 结构不变 | 未改该结构；Task 1 用例 1 断言其 `files` 内容 |
| §6 非致命但可操作 + 来源标记 | Task 2 Step 3；用例 1、2、4 |
| §7 两处引用改名 + 无需迁移 + scope 退路 | Task 3 Step 3；退路见 spec §7 |
| §8.1 四例 plant-core 测试 | Task 1 Step 1 |
| §8.2 四条 bundle-identity 断言 | Task 3 Step 1 |
| §8.3 git 路径等价实验 + npm 回归 | Task 4 Step 1、2 |
| §8.4 计数（预期 29，实测 33，偏差已记录） | Task 4 Step 3、5 |
| §10 DoD 1–8 | 全部任务；DoD 8 由 Task 4 Step 5 交付 |
