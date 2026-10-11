#!/usr/bin/env node
// scripts/build-preset-patch.mjs
//
// 把 legacy preset（preset/agent.cordis.yml 的插件表 + preset/preset.yml 的显示元数据）
// 渲染成 harness 0.2 的 preset 声明行，也就是 cordis.patch.yml 的**全部内容**。
//
// 为什么需要它：harness ≤0.1.5 的 preset 是 `$DSH_HOME/.agent-presets/<id>/` 目录，
// 由 `@deepseek-ai/dsh-agent-presets` 扫描（那套目录机制连同包在 0.2 一起被删掉了）。
// 0.2 的 preset 是组合树里的一行 `@deepseek-ai/dsh-agent-preset`，注册进
// `@deepseek-ai/dsh-agent-preset-registry`；后者自己的 README 写得很直白：
// "Definitions are ordinary plugin rows; the registry neither scans directories
//  nor accepts preset paths."
//
// 于是本仓库从「植入目录的 bundle」变成「声明 preset 的 bundle」，而声明必须出现在
// 组合里的静态行，所以 preset/agent.cordis.yml 只能作为**源码**存在，由本脚本渲染进
// cordis.patch.yml（产物入库，漂移由 scripts/preset-patch.test.mjs 守护）。
//
// 三条改写规则（每一条都对应 0.2 的一个真实差异；写错不会报错，只会静默少一块）：
//
//   1. preset 本地插件行 './plugins/<x>' → '<pkg>/preset/plugins/<x>'
//      0.1.5 里 preset 子树的 baseUrl 就是 preset 目录，相对行因此能解析；0.2 里声明行
//      由 profile 的 patch 层插入，prepareProfileEntries 拿到的 baseUrl 是 **profile
//      目录**，同样的 './plugins/...' 会指向 profile 根下不存在的文件。改走包内子路径
//      （package.json 没有 exports 字段，子路径直接映射到文件）。
//
//   2. '@deepseek-ai/dsh-workflow-worker-thread' → '@deepseek-ai/dsh-workflow-ptc'
//      （行 id 同步改）。0.2 不再提供 worker-thread；shipped 的 standard preset 用
//      workflow-ptc，且它的 Config 接受同样的 `provider` 字段。
//
//   3. skill-filesystem 的 customSkillDirs 改由运行时表达式解析包内 skills/：旧写法
//      `new URL('skills/', baseUrl)` 在 0.2 会解析到 profile 目录。表达式先用
//      createRequire(baseUrl) 解析本包 package.json 定位安装位置，失败才回落到 legacy
//      植入目录（<DSH_HOME>/.agent-presets/<id>/skills）。
//
// 用法:
//   node scripts/build-preset-patch.mjs             # 打印到 stdout
//   node scripts/build-preset-patch.mjs --write     # 写入 cordis.patch.yml
//   node scripts/build-preset-patch.mjs --check     # 与磁盘上的产物比对，不一致则退出 1
//   node scripts/build-preset-patch.mjs --out <path>
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('..', import.meta.url));
export const PATCH_FILE = 'cordis.patch.yml';
export const COMPOSITION_FILE = 'preset/agent.cordis.yml';
export const META_FILE = 'preset/preset.yml';
export const PRESET_ID = 'engineering';
export const DECLARATION_PLUGIN = '@deepseek-ai/dsh-agent-preset';

/** skill-filesystem 的 0.1.5 写法：相对 preset 目录解析 skills/。 */
export const LEGACY_SKILLS_EXPR =
  /!!js "process\.getBuiltinModule\('node:url'\)\.fileURLToPath\(new URL\('skills\/', baseUrl\)\)"/;

/** 0.2 里改名的行（包名与行 id 成对），逐条列出以免只靠一条通用规则悄悄漏掉。 */
export const RENAMED_PLUGINS = new Map([
  ['@deepseek-ai/dsh-workflow-worker-thread', '@deepseek-ai/dsh-workflow-ptc'],
  ['workflow-worker-thread', 'workflow-ptc'],
]);

const SKILLS_EXPR =
  "(() => { try { const p = process.getBuiltinModule('node:path'); " +
  "return p.join(p.dirname(process.getBuiltinModule('node:module').createRequire(baseUrl)" +
  ".resolve('{{PKG}}/package.json')), 'preset', 'skills'); } catch { " +
  "const p = process.getBuiltinModule('node:path'); " +
  "const home = process.env.DSH_HOME || p.join(process.getBuiltinModule('node:os').homedir(), '.dsh'); " +
  "return p.join(home, '.agent-presets', '{{ID}}', 'skills'); } })()";

/** `key: value` 形式的单行标量（preset.yml 的三个字段都是单行）。 */
export function metaField(text, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text);
  if (m === null) throw new Error(`${META_FILE}: 缺少字段 ${key}`);
  return m[1].trim();
}

/**
 * 把 agent.cordis.yml 的正文改写成声明行的 plugins 子表（已缩进）。
 *
 * 每次改写都断言结果，宁可在这里炸掉也不要产出一个「能加载但少一块」的 preset。
 *
 * @param composition - agent.cordis.yml 原文。
 * @param packageName - 本包名（package.json#name），用于包内子路径。
 * @param presetId - preset id，用于 skills 回落目录。
 * @returns 缩进到 `plugins:` 之下的 YAML 片段。
 */
export function transformComposition({ composition, packageName, presetId }) {
  let out = composition.replace(
    /name: '\.\/plugins\/([^']+)'/g,
    (_all, rest) => `name: '${packageName}/preset/plugins/${rest}'`,
  );
  for (const [from, to] of RENAMED_PLUGINS) out = out.replaceAll(from, to);

  if (/name: ['"]\.\//.test(out)) {
    throw new Error(
      '仍有未改写的 preset 相对行（./…）：0.2 的 preset 子树 baseUrl 是 profile 目录，' +
        '这类行会指向不存在的文件。',
    );
  }
  if (out.includes('@deepseek-ai/dsh-workflow-worker-thread')) {
    throw new Error('@deepseek-ai/dsh-workflow-worker-thread 未被改写（0.2 已无此包）');
  }
  if (!LEGACY_SKILLS_EXPR.test(out)) {
    throw new Error(
      'skills 目录表达式未命中：preset/agent.cordis.yml 的 skill-filesystem.customSkillDirs ' +
        '已不是已知的 0.1.5 写法。不要跳过这一步——它会静默产出一个 skills 指向错误的 preset。',
    );
  }
  const skills = SKILLS_EXPR.replaceAll('{{PKG}}', packageName).replaceAll('{{ID}}', presetId);
  out = out.replace(LEGACY_SKILLS_EXPR, `!!js "${skills}"`);

  return out
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `          ${line}`))
    .join('\n')
    .replace(/\n+$/, '');
}

/**
 * 渲染 cordis.patch.yml 的完整内容。
 *
 * `composition` / `meta` / `packageName` 可注入，供测试构造非法输入。
 */
export async function renderPresetPatch({
  repo = REPO,
  composition,
  meta,
  packageName,
  presetId = PRESET_ID,
} = {}) {
  const compositionText = composition ?? (await readFile(join(repo, COMPOSITION_FILE), 'utf8'));
  const metaText = meta ?? (await readFile(join(repo, META_FILE), 'utf8'));
  const name =
    packageName ?? JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).name;
  const displayName = metaField(metaText, 'name');
  const description = metaField(metaText, 'description');
  const order = metaField(metaText, 'order');
  const plugins = transformComposition({ composition: compositionText, packageName: name, presetId });
  // 显示名与描述一律按单引号标量输出：两者来自 preset.yml 的单行文本，将来出现 `:`、
  // 前导 `-`/`#` 之类的字符时也不会把 YAML 写坏（YAML 里单引号自身写成两个）。
  const quoted = (value) => `'${value.replaceAll("'", "''")}'`;

  return `# cordis.patch.yml — 生成物，请勿手改。
# 改 preset/agent.cordis.yml 或 preset/preset.yml 后运行:
#   node scripts/build-preset-patch.mjs --write
# 漂移由 scripts/preset-patch.test.mjs 守护；静态校验: node scripts/verify-preset-patch.mjs
#
# 这是 harness 0.2（0.2.0-rc.2 起）的 preset 声明行。0.2 删除了
# \`@deepseek-ai/dsh-agent-presets\`（扫描 $DSH_HOME/.agent-presets 的目录机制），
# preset 改为组合树里的一行 \`@deepseek-ai/dsh-agent-preset\`，注册进
# \`@deepseek-ai/dsh-agent-preset-registry\`。相比 preset/agent.cordis.yml 的原文，
# 这里做了三处改写（详见 scripts/build-preset-patch.mjs 头部）：
#   1. preset 本地插件行 './plugins/<x>' → '${name}/preset/plugins/<x>'
#      （preset 子树的 baseUrl 在 0.2 是 profile 目录，相对行不再指向 preset 目录）
#   2. '@deepseek-ai/dsh-workflow-worker-thread' → '@deepseek-ai/dsh-workflow-ptc'
#   3. skill-filesystem 的 skills 目录改由运行时表达式解析包内路径
- insert:
    - id: preset-${presetId}
      name: "${DECLARATION_PLUGIN}"
      config:
        id: ${presetId}
        name: ${quoted(displayName)}
        description: ${quoted(description)}
        order: ${order}
        plugins:
${plugins}
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  if (argv.includes('--write') && outIndex !== -1) {
    console.error('build-preset-patch: --write 与 --out 不能同时给出（一个写仓库产物，一个写别处）');
    process.exitCode = 2;
    return;
  }
  if (outIndex !== -1 && (argv[outIndex + 1] === undefined || argv[outIndex + 1].startsWith('--'))) {
    console.error('build-preset-patch: --out 需要一个路径');
    process.exitCode = 2;
    return;
  }
  if (argv.includes('--check')) {
    const [text, current] = await Promise.all([
      renderPresetPatch(),
      readFile(join(REPO, PATCH_FILE), 'utf8'),
    ]);
    if (current !== text) {
      console.error(
        `${PATCH_FILE} 与生成物不一致。运行 node scripts/build-preset-patch.mjs --write 更新。`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${PATCH_FILE} 与生成物一致`);
    return;
  }
  const text = await renderPresetPatch();
  const lines = text.trimEnd().split('\n').length;
  if (argv.includes('--write')) {
    await writeFile(join(REPO, PATCH_FILE), text);
    console.log(`wrote ${PATCH_FILE} (${lines} 行)`);
    return;
  }
  if (outIndex !== -1) {
    await writeFile(argv[outIndex + 1], text);
    console.log(`wrote ${argv[outIndex + 1]}`);
    return;
  }
  process.stdout.write(text);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
