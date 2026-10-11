#!/usr/bin/env node
// scripts/verify-preset-patch.mjs
//
// cordis.patch.yml（0.2 的 preset 声明行）的静态校验。它检查的是**产物**，不是生成器：
// 手改了产物、或生成器改规则时漏了某一行，都会在这里被抓住。
//
// 四层：
//   drift      产物是否等于生成器输出（node scripts/build-preset-patch.mjs --check）
//   dialect    能否被 harness 自己的 YAML 方言解析（`!!js` → {__jsExpr}）；
//              需要一份已安装的 harness 提供 js-yaml，找不到时记 skip 而不是 fail
//   specifiers 每一行的 specifier 是否真的解析得到（@deepseek-ai/* 包、
//              <本包名>/preset/... 包内文件、cordis: 内建）
//   porting    0.2 的两个已知陷阱：'./plugins/…' 相对行、已消失的 worker-thread 包
//
// 它不证明的事：不挂载、不跑 preset。挂载状态只能看活体宿主——
// cordis_inspect_query 的 Config.listConfigs（name=@deepseek-ai/dsh-agent-preset）
// 应列出 include:preset-engineering，新会话的模式选择器才会出现「工程模式」。
//
// 用法:
//   node scripts/verify-preset-patch.mjs [--repo <dir>] [--harness-base <dir>]
//
// 退出码 0 = 全部通过（skip 不算失败）；1 = 有 fail。
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PATCH_FILE, PRESET_ID, REPO, renderPresetPatch } from './build-preset-patch.mjs';

/**
 * 候选的 harness node_modules 目录（内含 `@deepseek-ai/*` 与 js-yaml）。
 *
 * 两条路线都要覆盖：`dsh` 启动器（部署里真正在跑的那份）与仓库自带的
 * `preset/node_modules/@deepseek-ai` 链接（install.sh 重建，指向已安装 harness 的
 * 依赖树）。后者是换机后唯一一定存在的路线。
 */
export function harnessModuleDirs({ repo = REPO, env = process.env } = {}) {
  const found = [];
  const fromRoot = (root) => join(root, 'node_modules');
  if (env.DSH_HARNESS_BASE) found.push(fromRoot(resolve(env.DSH_HARNESS_BASE)));
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const launcher = join(dir, 'dsh');
    if (!existsSync(launcher)) continue;
    try {
      // <harness>/lib/bin.js -> <harness>
      found.push(fromRoot(dirname(dirname(realpathSync(launcher)))));
    } catch {
      // 读不到的启动器不贡献候选
    }
  }
  const link = join(repo, 'preset', 'node_modules', '@deepseek-ai');
  if (existsSync(link)) {
    try {
      found.push(dirname(realpathSync(link)));
    } catch {
      // 断链的链接不贡献候选
    }
  }
  return found;
}

function firstWithJsYaml(dirs) {
  for (const dir of dirs) if (existsSync(join(dir, 'js-yaml'))) return dir;
  return undefined;
}

/** 解析 harness 侧包名；不存在返回 undefined。 */
function harnessPackageDir(modules, name) {
  const rest = name.slice('@deepseek-ai/'.length);
  const pkg = rest.startsWith('@') ? rest.split('/').slice(0, 2).join('/') : rest.split('/')[0];
  const dir = join(modules, '@deepseek-ai', pkg.replace('@deepseek-ai/', ''));
  return existsSync(dir) ? dir : undefined;
}

const CORDIS_BUILTINS = new Set(['cordis:group', 'cordis:include']);

/** 收集声明里的每一行（含 group 与 preset 子表），返回 { id, name } 列表。 */
function collectRows(plugins, out = []) {
  if (!Array.isArray(plugins)) return out;
  for (const row of plugins) {
    if (typeof row !== 'object' || row === null) continue;
    out.push({ id: row.id, name: row.name });
    if (row.group === true || (row.config && Array.isArray(row.config.plugins))) {
      collectRows(Array.isArray(row.config) ? row.config : row.config.plugins, out);
    }
  }
  return out;
}

/**
 * 校验产物。
 *
 * @param repo - 仓库根。
 * @param harnessBase - harness 根目录（含 node_modules）；省略时按候选自动发现。
 * @returns { ok, checks } —— checks 每项 { name, status: 'ok'|'fail'|'skip', detail }。
 */
export async function verifyPresetPatch({ repo = REPO, harnessBase } = {}) {
  const checks = [];
  const text = await readFile(join(repo, PATCH_FILE), 'utf8');
  const expected = await renderPresetPatch({ repo });
  checks.push(
    text === expected
      ? { name: 'drift', status: 'ok', detail: `${PATCH_FILE} 与生成物一致` }
      : {
          name: 'drift',
          status: 'fail',
          detail: `${PATCH_FILE} 与生成物不一致，运行 node scripts/build-preset-patch.mjs --write`,
        },
  );

  const modules = harnessBase !== undefined ? join(resolve(harnessBase), 'node_modules') : undefined;
  const candidates = modules !== undefined ? [modules] : harnessModuleDirs({ repo });
  const jsYamlDir = firstWithJsYaml(candidates);

  let doc;
  if (jsYamlDir === undefined) {
    checks.push({
      name: 'dialect',
      status: 'skip',
      detail: '找不到已安装 harness 提供的 js-yaml（用 --harness-base 指一份）',
    });
  } else {
    try {
      const require = createRequire(join(jsYamlDir, 'noop.js'));
      const yaml = require('js-yaml');
      const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
        kind: 'scalar',
        resolve: (data) => typeof data === 'string',
        construct: (data) => ({ __jsExpr: data }),
      });
      doc = yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([JsExpr]) });
      checks.push({ name: 'dialect', status: 'ok', detail: `YAML 方言解析通过（js-yaml @ ${jsYamlDir}）` });
    } catch (error) {
      checks.push({ name: 'dialect', status: 'fail', detail: `解析失败: ${String(error)}` });
    }
  }

  if (doc !== undefined) {
    const declaration = Array.isArray(doc) ? doc[0]?.insert?.[0] : undefined;
    const config = declaration?.config;
    const problems = [];
    if (declaration === undefined) problems.push('顶层不是 `- insert: [...]` 补丁');
    if (declaration !== undefined && declaration.name !== '@deepseek-ai/dsh-agent-preset')
      problems.push(`声明行 name 应为 @deepseek-ai/dsh-agent-preset，实际 ${declaration.name}`);
    if (config?.id !== PRESET_ID) problems.push(`config.id 应为 ${PRESET_ID}`);
    if (typeof config?.name !== 'string' || config.name === '')
      problems.push('config.name（模式选择器的显示名）缺失');
    if (typeof config?.description !== 'string' || config.description === '')
      problems.push('config.description 缺失');
    if (!Array.isArray(config?.plugins) || config.plugins.length === 0)
      problems.push('config.plugins 缺失或为空');
    checks.push(
      problems.length === 0
        ? {
            name: 'declaration',
            status: 'ok',
            detail: `id=${config.id} name=${config.name} order=${String(config.order)}`,
          }
        : { name: 'declaration', status: 'fail', detail: problems.join('; ') },
    );

    if (Array.isArray(config?.plugins)) {
      const rows = collectRows(config.plugins);
      const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).name;
      const unresolved = [];
      for (const row of rows) {
        const { id, name } = row;
        if (typeof name !== 'string') {
          unresolved.push(`${id}: 行没有 name`);
          continue;
        }
        if (CORDIS_BUILTINS.has(name)) continue;
        if (name.startsWith(`${pkg}/`)) {
          const abs = join(repo, name.slice(pkg.length + 1));
          if (!existsSync(abs)) unresolved.push(`${id}: ${name} 指向的文件不存在（${abs}）`);
          continue;
        }
        if (name.startsWith('@deepseek-ai/')) {
          if (modules !== undefined || candidates.length > 0) {
            const hit = candidates.some((dir) => harnessPackageDir(dir, name) !== undefined);
            if (!hit) unresolved.push(`${id}: harness 包不存在（0.2 是否已改名/删除？）`);
          }
          continue;
        }
        unresolved.push(`${id}: 无法判定的 specifier ${name}`);
      }
      checks.push(
        unresolved.length === 0
          ? {
              name: 'specifiers',
              status: modules !== undefined || candidates.length > 0 ? 'ok' : 'skip',
              detail:
                modules !== undefined || candidates.length > 0
                  ? `${rows.length} 行全部解析得到`
                  : `${rows.length} 行，但找不到 harness 依赖树（只查了包内文件）`,
            }
          : { name: 'specifiers', status: 'fail', detail: unresolved.join('; ') },
      );
      checks.push({
        name: 'row-count',
        status: 'ok',
        detail: `${config.plugins.length} 个顶层行 / 含嵌套共 ${rows.length} 行`,
      });
    }
  }

  const traps = [];
  // 只扫非注释行：生成物的头部注释**故意**点名这两个陷阱（worker-thread 改名、
  // './' 相对行），拿全文扫会把文档当成违规。
  const scannable = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  if (/name: ['"]\.\//.test(scannable)) traps.push("残留 preset 相对行 'name: ./…'");
  if (scannable.includes('@deepseek-ai/dsh-workflow-worker-thread'))
    traps.push('残留 @deepseek-ai/dsh-workflow-worker-thread（0.2 无此包）');
  if (scannable.includes('engineering-installer'))
    traps.push('残留 engineering-installer 行（往 0.2 不读的 .agent-presets 植入）');
  checks.push(
    traps.length === 0
      ? { name: 'porting', status: 'ok', detail: '没有 0.1.5 → 0.2 的已知陷阱' }
      : { name: 'porting', status: 'fail', detail: traps.join('; ') },
  );

  return { ok: !checks.some((check) => check.status === 'fail'), checks };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const repo = arg('--repo') === undefined ? REPO : resolve(arg('--repo'));
  const harnessBase = arg('--harness-base');
  const { ok, checks } = await verifyPresetPatch({ repo, harnessBase });
  console.log(`preset patch 静态校验 (${join(repo, PATCH_FILE)})`);
  for (const check of checks) {
    const mark = check.status === 'ok' ? 'OK  ' : check.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`  ${mark} ${check.name.padEnd(11)} ${check.detail}`);
  }
  if (!ok) {
    console.error('\n有检查未通过：产物不能原样发布。');
    process.exitCode = 1;
    return;
  }
  console.log(
    '\n通过。注意这只证明声明可用于挂载：活体是否列出「工程模式」要用 cordis_inspect_query 的\n' +
      'Config.listConfigs（name=@deepseek-ai/dsh-agent-preset）确认 include:preset-engineering。',
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
