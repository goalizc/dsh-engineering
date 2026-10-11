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
//   specifiers 每一行的 specifier 是否真的解析得到：`@deepseek-ai/*`（含 exports
//              子路径，用 Node 自己的解析）与 `<本包名>/preset/...` 包内文件
//   porting    0.2 的两个已知陷阱：'./plugins/…' 相对行、已消失的 worker-thread 包
//
// 它不证明的事：不挂载、不跑 preset。挂载状态只能看活体宿主——
// cordis_inspect_query 的 Config.listConfigs（name=@deepseek-ai/dsh-agent-preset）
// 应列出 include:preset-engineering，新会话的模式选择器才会出现「工程模式」。
//
// 用法:
//   node scripts/verify-preset-patch.mjs [--repo <dir>] [--harness-base <dir>]
//
// 退出码 0 = 全部通过（skip 不算失败，裸检出没有 harness 时 dialect/specifiers 会 skip）；
// 1 = 有 fail；2 = 命令行用法错误（缺值等）。
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATCH_FILE, PRESET_ID, REPO, renderPresetPatch } from './build-preset-patch.mjs';

/**
 * 候选的 harness node_modules 目录（内含 `@deepseek-ai/*` 与 js-yaml）。
 *
 * 三条路线：`DSH_HARNESS_BASE`、`dsh` 启动器（部署里真正在跑的那份）、以及仓库里
 * 可能存在的 `preset/node_modules/@deepseek-ai` 本机链接（可选的本地便利，不存在也没关系）。
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

/**
 * 一个 harness specifier 能否被 Node 解析（子路径走包的 `exports`）。
 *
 * 用 `createRequire(<harness>/node_modules/)` 而不是「目录里有没有同名文件」：
 * `@deepseek-ai/dsh-tool-subagent-control/list-agents` 这类行由 exports 映射提供，
 * 磁盘上没有对应文件。实测 shipped 的四个 preset 与本仓库产物的全部 specifier 都能解析。
 *
 * 解析失败时报 fail 而不是放过：若将来某个包只声明 `import` 条件的 exports，
 * 这里会成为一条**响亮**的误报（消息里点了名），而不是一次静默漏检。
 */
function harnessSpecifierResolves(modules, name) {
  try {
    createRequire(join(modules, 'noop.js')).resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** 该 specifier 的包目录（仅用于把「包没了」与「子路径没了」分开报）。 */
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
    // 显式给了 --harness-base 却在里面找不到依赖树，是使用者指错了目录：必须报 fail，
    // 否则 dialect/specifiers 一起退化成 skip，脚本仍然打印「通过」——一次静默失效。
    checks.push(
      modules !== undefined
        ? {
            name: 'dialect',
            status: 'fail',
            detail: `--harness-base 指向的 ${modules} 下没有 js-yaml：那不是一个 harness 根目录`,
          }
        : {
            name: 'dialect',
            status: 'skip',
            detail: '找不到已安装 harness 提供的 js-yaml（用 --harness-base 指一份）',
          },
    );
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
            const hit = candidates.some((dir) => harnessSpecifierResolves(dir, name));
            if (!hit) {
              const pkgDir = candidates.map((dir) => harnessPackageDir(dir, name)).find(Boolean);
              unresolved.push(
                pkgDir === undefined
                  ? `${id}: harness 包不存在（0.2 是否已改名/删除？）`
                  : `${id}: 包在但 specifier 解析不到（${name} 的 exports 改过？）`,
              );
            }
          }
          continue;
        }
        unresolved.push(`${id}: 无法判定的 specifier ${name}`);
      }
      const harnessChecked = modules !== undefined || candidates.length > 0;
      checks.push(
        unresolved.length === 0
          ? {
              name: 'specifiers',
              status: harnessChecked ? 'ok' : 'skip',
              detail: harnessChecked
                ? `${config.plugins.length} 个顶层行 / 含嵌套 ${rows.length} 行全部解析得到`
                : `${config.plugins.length} 个顶层行 / 含嵌套 ${rows.length} 行，但找不到 harness 依赖树（只查了包内文件）`,
            }
          : { name: 'specifiers', status: 'fail', detail: unresolved.join('; ') },
      );
    }
  }

  const traps = [];
  // 只扫非注释行：生成物的头部注释**故意**点名这几个陷阱（worker-thread 改名、
  // './' 相对行），拿全文扫会把文档当成违规。
  const scannable = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  if (/name: ['"]\.\//.test(scannable)) traps.push("残留 preset 相对行 'name: ./…'");
  if (scannable.includes('@deepseek-ai/dsh-workflow-worker-thread'))
    traps.push('残留 @deepseek-ai/dsh-workflow-worker-thread（0.2 无此包）');
  if (scannable.includes('engineering-installer'))
    traps.push('残留 engineering-installer 行（目录植入通道已删除，0.2 只认声明行）');
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
  for (const flag of ['--repo', '--harness-base']) {
    if (argv.includes(flag) && (arg(flag) === undefined || arg(flag).startsWith('--'))) {
      console.error(`verify-preset-patch: ${flag} 需要一个值`);
      process.exitCode = 2;
      return;
    }
  }
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
