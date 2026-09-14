# superpowers-dsh Bundle 发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 superpowers-dsh 发布成 DSH 插件 bundle——用户一条 `dsh plugin add` 即装上 `Superpowers 模式`,并让本地 `install.sh` 与发布链路共用同一植入引擎。

**Architecture:** 新增共享植入引擎 `scripts/plant-core.mjs`(自包含 ESM,导出 hashing 工具与 `plant()`,含 CLI);`scripts/build-manifest.mjs` 从 `preset/` 产出 `.manifest.json`(每文件 sha-256)。bundle 形态 = 根 `package.json` + `index.js`(cordis 插件,`apply()` 时调 `plant` 把自带 `preset/` 植入 `~/.dsh/.agent-presets/superpowers`)+ `cordis.patch.yml`(insert 该安装器行)。本地 `install.sh` 改为 `node plant-core.mjs install ... --policy link`,保留即时生效的符号链接语义。

**Tech Stack:** Node ≥18 内置(none:test / crypto / fs / os / path / url),纯 ESM(`.mjs`);无 npm 运行时依赖。bash 仅保留 `install.sh`/`build-bootstrap.sh` 的薄壳。

## Global Constraints

- 自包含:运行时不得 import 任何第三方或 harness 包;消息 id 用 `node:crypto`(与已有 bootstrap 插件一致)。
- ESM:`"type":"module"`,新增脚本统一 `.mjs`;保持 preset 内插件相对引用 `./plugins/...` 不变。
- 版戳:升级**逐文件三元比对**(`current` / `installed` / `new`),`installed` 记录"上次落下时 bundle hash";用户未动且包更新→落新;用户改过→保留用户版;只补不删。
- 目标目录已有内容但无 `.installed.json` → 拒绝触碰(`skipped`,退出码非 0);copy 策略逐文件原子写(`.tmp` + `rename`);不提供卸载钩子,README 写 `rm -rf ~/.dsh/.agent-presets/superpowers`。
- `preset/.manifest.json` 与目标 `.installed.json` 均为构建/运行产物,不提交 git。
- 每个 preset 顶层文件(SYNC.md/agent.cordis.yml/bootstrap.md/plugins/preset.yml/skills)都要可被 `plant` 落地与比对;`nodes_modules`、`.manifest.json`、`.installed.json` 排除。

---

### Task 1: plant-core 哈希与目录遍历工具

**Files:**
- Create: `scripts/plant-core.mjs`
- Test: `scripts/plant-core.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `hashFile(absPath) -> Promise<string>(sha256 hex)`;`walkFiles(dir, {exclude}) -> Promise<string[]>(相对路径,排序)`;`buildManifestMap(dir, {exclude}) -> Promise<{rel: sha}>`(后续 build-manifest / plant 复用)。

- [ ] **Step 1: 写失败测试**

```js
// scripts/plant-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile, walkFiles, buildManifestMap } from './plant-core.mjs';

async function fixture() {
  const d = await mkdtemp(join(tmpdir(), 'plant-core-'));
  await mkdir(join(d, 'skills'));
  await writeFile(join(d, 'bootstrap.md'), 'hello');
  await writeFile(join(d, 'skills', 'SKILL.md'), 'skill body');
  await writeFile(join(d, '.manifest.json'), '{}');
  return d;
}

test('hashFile returns sha256 hex', async () => {
  const d = await fixture();
  const h = await hashFile(join(d, 'bootstrap.md'));
  assert.match(h, /^[0-9a-f]{64}$/);
  const h2 = await hashFile(join(d, 'bootstrap.md'));
  assert.equal(h, h2);
});

test('walkFiles lists rel paths sorted, excluding top-level excludes', async () => {
  const d = await fixture();
  const rows = await walkFiles(d, { exclude: ['.manifest.json'] });
  assert.deepEqual(rows, ['bootstrap.md', 'skills/SKILL.md']);
});

test('buildManifestMap maps rel to hash', async () => {
  const d = await fixture();
  const m = await buildManifestMap(d, { exclude: ['.manifest.json'] });
  assert.deepEqual(Object.keys(m), ['bootstrap.md', 'skills/SKILL.md']);
  assert.match(m['bootstrap.md'], /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/goalizc/dsh-engineering && node --test scripts/plant-core.test.mjs`
Expected: FAIL(`Cannot find module .../plant-core.mjs`)。

- [ ] **Step 3: 实现 plant-core.mjs(本任务只写哈希/遍历/清单,plant() 在 Task 2 加)**

```js
// scripts/plant-core.mjs
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function hashFile(absPath) {
  return createHash('sha256').update(await readFile(absPath)).digest('hex');
}

export async function walkFiles(dir, { exclude = [] } = {}) {
  const out = [];
  async function rec(d, rel) {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (rel === '' && exclude.includes(ent.name)) continue;
      const full = join(d, ent.name);
      if (ent.isDirectory()) await rec(full, r);
      else if (ent.isFile()) out.push(r);
    }
  }
  await rec(dir, '');
  return out.sort();
}

export async function buildManifestMap(dir, { exclude }) {
  const map = {};
  for (const rel of await walkFiles(dir, { exclude })) map[rel] = await hashFile(join(dir, rel));
  return map;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/plant-core.test.mjs`
Expected: PASS(3 tests)。

- [ ] **Step 5: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add scripts/plant-core.mjs scripts/plant-core.test.mjs
git commit -m "feat: plant-core 哈希与目录遍历工具"
```

---

### Task 2: plant() 植入引擎(copy 三态 + link 策略)

**Files:**
- Modify: `scripts/plant-core.mjs`(追加 `plant` 及内部 helper)
- Test: `scripts/plant-core.test.mjs`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 `hashFile` / `walkFiles` / `buildManifestMap`
- Produces: `plant({source, destRoot, name='superpowers', policy='copy'}) -> Promise<{action, changed, kept, reason}>`,满足:
  - `action ∈ planted|unchanged|updated|partial|skipped`
  - 副本目标 = `destRoot/name`;copy 时读 `source/.manifest.json`(缺→throw)、写/比对 `destDir/.installed.json`(`{name,installedAt,files:{rel:sha}}`)。CLI:`install <source> <destRoot> --name <n> --policy copy|link`。

- [ ] **Step 1: 写失败测试**

```js
// 追加到 scripts/plant-core.test.mjs（沿用已有 import；补 bm/rm/cp dir）
import { basename } from 'node:path';
import { plant } from './plant-core.mjs';
// 复用 fixture() 已有；制造带 .manifest.json 的 source
async function sourceWithManifest() {
  const d = await fixture(); // 含 bootstrap.md, skills/SKILL.md, .manifest.json('{}')
  const m = {};
  for (const sect of ['bootstrap.md', 'skills/SKILL.md']) m[sect] = await hashFile(join(d, sect));
  await writeFile(join(d, '.manifest.json'), JSON.stringify({ version: 1, files: m }));
  return d;
}

test('plant first install -> planted, files landed', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'planted');
  assert.ok((await readFile(join(destRoot, 'superpowers', 'bootstrap.md'), 'utf8')) === 'hello');
  const inst = JSON.parse(await readFile(join(destRoot, 'superpowers', '.installed.json'), 'utf8'));
  assert.equal(inst.files['bootstrap.md'], await hashFile(join(src, 'bootstrap.md')));
});

test('plant unchanged rerun -> unchanged', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'unchanged');
});

test('plant keeps user-modified file (partial) and lands new file', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  const userFile = join(destRoot, 'superpowers', 'bootstrap.md');
  await writeFile(userFile, 'user edit');                      // 用户改过
  await writeFile(join(src, 'skills', 'NEW.md'), 'new body');  // bundle 新增
  const rebuilt = {};
  for (const sect of ['bootstrap.md', 'skills/SKILL.md', 'skills/NEW.md']) rebuilt[sect] = await hashFile(join(src, sect));
  await writeFile(join(src, '.manifest.json'), JSON.stringify({ version: 1, files: rebuilt }));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'partial');
  assert.equal(await readFile(userFile, 'utf8'), 'user edit');        // 保留用户版
  assert.equal(await readFile(join(destRoot, 'superpowers', 'skills', 'NEW.md'), 'utf8'), 'new body'); // 新增落地
  assert.equal(r.kept, 1);
});

test('plant bundle update overwrites untouched file (updated)', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await plant({ source: src, destRoot, policy: 'copy' });
  await writeFile(join(src, 'bootstrap.md'), 'bundle v2');  // 包更新、用户未动
  const rebuilt = {};
  for (const sect of ['bootstrap.md', 'skills/SKILL.md']) rebuilt[sect] = await hashFile(join(src, sect));
  await writeFile(join(src, '.manifest.json'), JSON.stringify({ version: 1, files: rebuilt }));
  const r = await plant({ source: src, destRoot, policy: 'copy' });
  assert.equal(r.action, 'updated');
  assert.equal(await readFile(join(destRoot, 'superpowers', 'bootstrap.md'), 'utf8'), 'bundle v2');
});

test('plant refuses non-empty dest without our marker (skipped)', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-dest-'));
  await writeFile(join(destRoot, 'superpowers', 'user.txt'), 'x'); // 别处放的
  await assert.rejects(plant({ source: src, destRoot, policy: 'copy' }));
});

test('plant link policy creates real dir + per-entry symlinks, no manifest link', async () => {
  const src = await sourceWithManifest();
  const destRoot = await mkdtemp(join(tmpdir(), 'plant-link-'));
  const r = await plant({ source: src, destRoot, policy: 'link' });
  assert.equal(r.action, 'planted');
  const dest = join(destRoot, 'superpowers');
  const { lstat, readlink } = await import('node:fs/promises');
  const st = await lstat(join(dest, 'bootstrap.md'));
  assert.ok(st.isSymbolicLink());              // 逐项符号链接
  assert.equal(await readlink(join(dest, 'bootstrap.md')), join(src, 'bootstrap.md'));
  await assert.rejects(readFile(join(dest, '.manifest.json'))); // 不链 .manifest.json
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/plant-core.test.mjs`
Expected: FAIL(`plant is not a function`) 等。

- [ ] **Step 3: 实现 plant()(追加到 plant-core.mjs 末尾)+ 依赖导入**

在文件头部 import 补全:

```js
import { readdir, readFile, writeFile, mkdir, copyFile, symlink, lstat, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
```

头部工具(追加):

```js
async function exists(p) { return existsSync(p); }
async function ensureParent(p) { await mkdir(dirname(p), { recursive: true }); }
async function writeFileAtomic(p, data) {
  const t = p + '.tmp';
  await writeFile(t, data);
  await rename(t, p);
}
async function copyAtomic(src, dst) {
  await ensureParent(dst);
  const t = dst + '.tmp';
  await copyFile(src, t);
  await rename(t, dst);
}
```

plant 主函数(追加):

```js
export async function plant({ source, destRoot, name = 'superpowers', policy = 'copy' }) {
  const destDir = join(destRoot, name);
  const installedPath = join(destDir, '.installed.json');
  let installed = null;
  try { installed = JSON.parse(await readFile(installedPath, 'utf8')); } catch { installed = null; }

  if (policy === 'link') {
    await mkdir(destDir, { recursive: true });
    for (const ent of await readdir(destDir, { withFileTypes: true })) {
      const p = join(destDir, ent.name);
      await rm(p, { recursive: true, force: true });
    }
    for (const ent of await readdir(source, { withFileTypes: true })) {
      if (ent.name === '.manifest.json') continue;
      await symlink(join(source, ent.name), join(destDir, ent.name));
    }
    return { action: 'planted', changed: 0, kept: 0, reason: null };
  }

  const manifest = JSON.parse(await readFile(join(source, '.manifest.json'), 'utf8')).files;

  // 目标已有内容但非本工具植入：拒绝触碰
  if (!installed) {
    let hadNonEmpty = false;
    try {
      const l = await readdir(destDir);
      hadNonEmpty = l.length > 0;
    } catch { hadNonEmpty = false; }
    if (hadNonEmpty) throw new Error(`destination ${destDir} exists without .installed.json; refusing to touch`);
  }

  await mkdir(destDir, { recursive: true });
  const newFiles = Object.keys(manifest);
  const next = {};
  let changed = 0, kept = 0;

  for (const rel of newFiles) {
    const dst = join(destDir, rel);
    const newSha = manifest[rel];
    if (!exists(dst)) {
      await copyAtomic(join(source, rel), dst);
      next[rel] = newSha; changed++;
      continue;
    }
    const cur = await hashFile(dst);
    if (cur === newSha) { next[rel] = newSha; continue; }          // 已就位
    const installedSha = installed && installed.files ? installed.files[rel] : null;
    if (installedSha === cur) { await copyAtomic(join(source, rel), dst); next[rel] = newSha; changed++; } // 纯包更新
    else { next[rel] = newSha; kept++; }                            // 用户改过：保留
  }

  if (!installed) {
    await writeFileAtomic(installedPath, JSON.stringify({ name, installedAt: new Date().toISOString(), files: next }, null, 2));
    return { action: 'planted', changed, kept, reason: null };
  }

  const action = (kept === 0 && changed === 0) ? 'unchanged' : (kept > 0 ? 'partial' : 'updated');
  await writeFileAtomic(installedPath, JSON.stringify({ name, installedAt: new Date().toISOString(), files: next }, null, 2));
  return { action, changed, kept, reason: null };
}
```

CLI 分支(追加,`install <source> <destRoot> [--name ...] [--policy ...]`):

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , cmd, source, destRoot, ...rest] = process.argv;
  if (cmd !== 'install' || !source || !destRoot) {
    console.error('usage: node scripts/plant-core.mjs install <source> <destRoot> [--name superpowers] [--policy copy|link]');
    process.exit(2);
  }
  const arg = (k) => (rest[rest.indexOf(k) + 1]);
  const name = arg('--name') ?? 'superpowers';
  const policy = arg('--policy') ?? 'copy';
  const r = await plant({ source, destRoot, name, policy }).catch((e) => { console.error('superpowers: ' + e.message); process.exit(1); });
  let line = `superpowers: ${r.action}`;
  if (r.changed) line += ` (${r.changed} changed)`;
  if (r.kept) line += ` (${r.kept} kept user files)`;
  console.log(line);
  if (r.action === 'skipped') process.exit(1);
}
```

> 说明:`skipped` 以抛错实现(见上方 `refusing to touch`),CLI catch 后 `exit 1`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/plant-core.test.mjs`
Expected: PASS(Task 1 的 3 + 本任务 6 用例)。

- [ ] **Step 5: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add scripts/plant-core.mjs scripts/plant-core.test.mjs
git commit -m "feat: plant 植入引擎 — copy 三态保守升级 + link 即时语义 + 原子写"
```

---

### Task 3: build-manifest.mjs 清单生成 CLI

**Files:**
- Create: `scripts/build-manifest.mjs`
- Test: 无独立单测(由 Task 5 更新后由 Task 7 产出物间接验证);本任务以手动命令验证。

**Interfaces:**
- Consumes: Task 1 的 `hashFile` / `walkFiles`
- Produces: 命令 `node scripts/build-manifest.mjs <presetDir> [--out <path>]`,默认写 `<presetDir>/.manifest.json` 形如 `{version:1, files:{rel:sha}}`,排除 `.manifest.json` 与 `node_modules`。

- [ ] **Step 1: 实现 CLI**

```js
#!/usr/bin/env node
// scripts/build-manifest.mjs
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hashFile, walkFiles } from './plant-core.mjs';

const [, , source, flag, outArg] = process.argv;
if (!source) {
  console.error('usage: node scripts/build-manifest.mjs <presetDir> [--out <path>]');
  process.exit(2);
}
const out = flag === '--out' ? outArg : join(source, '.manifest.json');
const rels = await walkFiles(source, { exclude: ['.manifest.json', 'node_modules'] });
const files = {};
for (const rel of rels) files[rel] = await hashFile(join(source, rel));
await writeFile(out, JSON.stringify({ version: 1, preset: basename(source), files }, null, 2));
console.log(`manifest: ${Object.keys(files).length} files -> ${out}`);
```

- [ ] **Step 2: 运行验证(应含 bootstrap/agent/plugins/skills,不含 .manifest 自身与 node_modules)**

Run: `cd /home/goalizc/dsh-engineering && node scripts/build-manifest.mjs preset && node -e "const m=require('./preset/.manifest.json'); console.log(Object.keys(m.files).length, Object.keys(m.files).includes('agent.cordis.yml'), Object.keys(m.files).includes('.manifest.json'))"`
Expected: 输出形如 `manifest: N files -> .../preset/.manifest.json`,下列行输出 `false false`(指 agent.cordis true、.manifest false——见说明)。

> 精确断言命令:`node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('preset/.manifest.json','utf8'));const k=Object.keys(m.files);console.log('agent=',k.includes('agent.cordis.yml'),'self=',k.includes('.manifest.json'),'node_modules=',k.some(x=>x.startsWith('node_modules')));if(k.includes('agent.cordis.yml')||k.some(x=>x.startsWith('node_modules')))process.exit(1)"` — 期望 `agent= true self= false node_modules= false`。

- [ ] **Step 3: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add scripts/build-manifest.mjs
git commit -m "feat: build-manifest 从 preset 生成逐文件 sha-256 清单"
```

> 上一步生成的 `preset/.manifest.json` 是产物,已被 Task 6 加入 `.gitignore`,此处无需 `git add`(未跟踪,不会进提交)。

---

### Task 4: bundle 骨架 — 根 package.json + index.js + cordis.patch.yml

**Files:**
- Create: `index.js`, `cordis.patch.yml`, 根 `package.json`
- Test: `scripts/index.test.mjs`

**Interfaces:**
- Consumes: Task 2 `plant()`
- Produces: `doInstall({destRoot, name}) -> Promise<plant结果>`(具名导出,供测试);`default` 导出 cordis 插件 `{name, apply}`(profile 启动时把自带 `preset/` 植入环境)。`cordis.patch.yml` 以 `@<scope>/superpowers-dsh` 命名安装器行(scope 见开放项)。

- [ ] **Step 1: 写失败测试**

```js
// scripts/index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { doInstall } from '../index.js';

test('default export is a cordis plugin', () => {
  assert.equal(typeof plugin, 'object');
  assert.equal(typeof plugin.apply, 'function');
});

test('doInstall plants bundled preset to destRoot/superpowers', async () => {
  const destRoot = await mkdtemp(join(tmpdir(), 'bundle-dest-'));
  const r = await doInstall({ destRoot });
  assert.equal(r.action, 'planted');
  const comp = await readFile(join(destRoot, 'superpowers', 'agent.cordis.yml'), 'utf8');
  assert.ok(comp.includes('superpowers-bootstrap'));
});
```

> 测试依赖 `preset/` 已含 `.manifest.json`(Task 3 已生成,Task 6 会进 gitignore 但文件在场)。若文件缺失,本任务 Step 2 先复制一份到工作区。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /home/goalizc/dsh-engineering && node --test scripts/index.test.mjs`
Expected: FAIL(`Cannot find module '../index.js'`)。

- [ ] **Step 3: 实现三个文件**

```js
// index.js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plant } from './scripts/plant-core.mjs';

export const PRESET_DIR = fileURLToPath(new URL('./preset', import.meta.url));

export async function doInstall({ destRoot, name = 'superpowers' } = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const root = destRoot || join(dshHome, '.agent-presets');
  return plant({ source: PRESET_DIR, destRoot: root, name, policy: 'copy' });
}

export default {
  name: 'superpowers-installer',
  async apply() {
    try {
      const r = await doInstall();
      let line = `superpowers: preset ${r.action}`;
      if (r.changed) line += ` (${r.changed} changed)`;
      if (r.kept) line += ` (${r.kept} kept user files)`;
      console.log(line);
    } catch (e) {
      console.warn('superpowers: ' + e.message);
    }
  },
};
```

```yaml
# cordis.patch.yml
- insert:
    - id: superpowers-installer
      name: '@superpowers-dsh/superpowers-dsh'
```

```json
{
  "name": "@superpowers-dsh/superpowers-dsh",
  "version": "0.1.0",
  "description": "Superpowers skills as a DeepSeek Harness agent preset bundle.",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml", "preset", "scripts/plant-core.mjs", "preset/.manifest.json"],
  "engines": { "node": ">=18" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "publishConfig": { "access": "public" },
  "scripts": {
    "build:manifest": "node scripts/build-manifest.mjs preset --out preset/.manifest.json",
    "test": "node --test scripts/"
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/index.test.mjs`
Expected: PASS(2 tests)。

- [ ] **Step 5: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add index.js cordis.patch.yml package.json scripts/index.test.mjs
git commit -m "feat: bundle 骨架 — 安装器插件 index.js + cordis.patch.yml + 根 package.json"
```

---

### Task 5: build-bootstrap.sh 尾部追加 manifest 生成

**Files:**
- Modify: `scripts/build-bootstrap.sh`(末尾)
- Test: 手动命令验证。

**Interfaces:**
- Consumes: Task 3 的 `build-manifest.mjs`
- Produces: 每次 build 后 `preset/.manifest.json` 与 `bootstrap.md` 同时新鲜,保证发布包内容戳就地更新。

- [ ] **Step 1: 在 build-bootstrap.sh 的最终命令后追加**

```bash
# 让发布包的逐文件内容戳与本次构建保持同步。
node "$(dirname "$0")/build-manifest.mjs" "$PRESET" >/dev/null
```

- [ ] **Step 2: 运行验证**

Run: `cd /home/goalizc/dsh-engineering && rm -f preset/.manifest.json && src=scripts/build-bootstrap.sh && bash "$src"`
Expected: 末行依次输出 `built .../preset/bootstrap.md (... bytes, ... lines)`;随后无报错,`preset/.manifest.json` 即被重新生成(`ls preset/.manifest.json`)。

- [ ] **Step 3: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add scripts/build-bootstrap.sh
git commit -m "feat: build-bootstrap 尾部联动生成 preset/.manifest.json"
```

---

### Task 6: install.sh 改调共享 plant 引擎

**Files:**
- Modify: `scripts/install.sh`
- Test: 手动命令验证(临时 `DSH_HOME`)。
- Modify: `.gitignore`(纳入 `preset/.manifest.json`,运行态 `.installed.json` 本就在用户目录、不入库)

**Interfaces:**
- Consumes: Task 2 CLI `plant-core.mjs install`
- Produces: `scripts/install.sh [--copy]`(默认 link、`--copy` 深拷贝)委托 plant-core;保留尾部 selftest 与校验输出。

- [ ] **Step 1: 重写 install.sh 中段(替换原 `mkdir/rm/mkdir/cp/ln` 块)**

将第 34-54 行(`mkdir -p "$DEST_ROOT"` → symlink 检查块)替换为:

```bash
# 委托共享植入引擎；link=即时生效符号链接, copy=深拷贝(换机可移除检出)。
node "$(dirname "$0")/plant-core.mjs" install "$SRC" "$DEST_ROOT" --name superpowers --policy "$POLICY"
```

并在第 22 行 `MODE="${1:-}"` 后新增:

```bash
POLICY="link"
[ "$MODE" != "--copy" ] || POLICY="copy"
```

- [ ] **Step 2: 运行验证(link 与 copy 两分支)**

```bash
cd /home/goalizc/dsh-engineering
bash scripts/install.sh            # 默认 link
test -L "$HOME/.dsh/.agent-presets/superpowers/agent.cordis.yml" && echo LINK-OK
tmp=$(mktemp -d); DSH_HOME="$tmp" bash scripts/install.sh --copy
grep -q superpowers-bootstrap "$tmp/.agent-presets/superpowers/agent.cordis.yml" && echo COPY-OK
```

- [ ] **Step 3: 更新 .gitignore**

```bash
# 构建产物：预设文件的逐文件 sha-256 清单(发布打包时经 files 白名单打入)
preset/.manifest.json
```

- [ ] **Step 4: 提交**

```bash
cd /home/goalizc/dsh-engineering
git add scripts/install.sh .gitignore
git commit -m "refactor: install.sh 委托 plant-core; gitignore 预设清单产物"
```

---

### Task 7: 根 package.json scripts 校验 + 冒烟

**Files:**
- Modify: root `package.json`(如 Task 4 已带,此处仅跑通 `npm run`)

**Interfaces:**
- Consumes: 前面全部脚本
- Produces: 可重复的构建与测试入口。

- [ ] **Step 1: 运行测试套件**

Run: `cd /home/goalizc/dsh-engineering && npm test`
Expected: PASS(plant-core 9 例 + index 2 例)。

- [ ] **Step 2: 运行 manifest 构建脚本**

Run: `npm run build:manifest && node -e "const m=require('./preset/.manifest.json');console.log('files',Object.keys(m.files).length)"`
Expected: `manifest: N files -> ...` + `files N`(N>5)。

- [ ] **Step 3: 提交(如无改动则跳过)**

若前序已逐 task 提交,本任务仅验证不产生新改动;有改动就提交。

---

### Task 8: 端到端验收 — 本地 pack + dsh plugin add

**Files:** 无源码改动;验收动作。

**Interfaces:**
- 前置:Task 4 的 bundle 骨架 + Task 5/6 的清单/脚本就绪、`preset/.manifest.json` 在场。
- 判定:tgz 内含 `preset/*`;用临时 `DSH_HOME` 在临时 profile 上 `dsh plugin add` 后,`superpowers` preset 被植入、插件 selftest 通过。

- [ ] **Step 1: 打包并检查内容**

```bash
cd /home/goalizc/dsh-engineering
npm run build:manifest
pnpm pack --pack-destination /tmp/sp-bundle   # 无 pnpm 时: npx pnpm pack ---pack-destination /tmp/sp-bundle
tar -tzf /tmp/sp-bundle/superpowers-dsh-*.tgz | grep -E "preset/(agent.cordis.yml|.manifest.json|plugins/)" 
```

- [ ] **Step 2: 装进临时 profile**

```bash
WTMP=$(mktemp -d)
# 用干净 DSH_HOME,避免污染现有配置
env DSH_HOME="$WTMP" dsh plugin --profile smoke add /tmp/sp-bundle/superpowers-dsh-*.tgz
```

- [ ] **Step 3: 校验 preset 落地 + 插件自测**

```bash
grep -q superpowers-bootstrap "$WTMP/.agent-presets/superpowers/agent.cordis.yml" \
  && (cd "$WTMP/.agent-presets/superpowers/plugins/superpowers-bootstrap" && node selftest.mjs) \
  && echo "E2E-OK"
```
Expected: `selftest OK: 6 assertions groups passed / bootstrap bytes: 9061` 后输出 `E2E-OK`。

- [ ] **Step 4(人为验收)**:新开一个 DSH 会话,模式选择器出现 `Superpowers 模式`,发 `describe your superpowers` 确认 bootstrap 注入。此步需交互,dsh 命令行无法自动模拟,留给用户确认。

---

## 开放项(不由本计划落地)

- npm **scope / 包名**:当前用占位 `@superpowers-dsh/superpowers-dsh`;真正发布前由用户确定并替换 `package.json#name`、`cordis.patch.yml#name`。
- **真实 `npm publish`**:Task 8 只做本地 pack+add;发布需用户 npm 账号与推送授权,单独进行。

## Self-Review(已执行)

- **Spec 覆盖**:每个 spec 节都能对到任务——组件清单→T1/T3/T4;植入策略双分支→T2/T6;版戳三态→T2;错误处理(拒绝触碰/原子)→T2;测试→各 TDD;验收→T8。开放项(scope/真实发布)保留为计划开放项。
- **占位扫描**:无未填 TBD;测试与实际实现为同一份代码。
- **类型一致性**:`hashFile`/`walkFiles`/`buildManifestMap`/`plant`/`doInstall` 在各任务签名一致;CLI 长标志(`--name/--policy/--out`)跨任务统一;`.manifest.json` 结构 `{version,files}` 全链一致;`.installed.json` 结构 `{name,installedAt,files}` 一致。
- 侁微:`plant()` 以抛错表示 `skipped`,CLI 兜住 exit 1;Task 2 断言用 `assert.rejects` 与之对齐;`skipped` 字面量保留在说明与日志文案,不做分支返回值。