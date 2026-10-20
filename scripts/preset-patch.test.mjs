// scripts/preset-patch.test.mjs
//
// 守护 cordis.patch.yml（0.2 的 preset 声明行）与它的源码 preset/agent.cordis.yml 不漂移，
// 并守住三条改写规则的结果：产物里出现的是包内子路径插件行、workflow-ptc、带
// customSkillDirs 的 skill-filesystem。
//
// 这一层之所以必要：0.2 的 preset 是一个组合声明，改错（相对行、改名包、丢 skills 目录）
// 不会在仓库里报错，只会让新会话少一块能力——正是本项目此前反复踩的那类静默退化。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { REPO, renderPresetPatch, transformComposition } from './build-preset-patch.mjs';
import { verifyPresetPatch } from './verify-preset-patch.mjs';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('cordis.patch.yml 与生成物一致（漂移守卫）', async () => {
  const [committed, generated] = await Promise.all([
    read('../cordis.patch.yml'),
    renderPresetPatch(),
  ]);
  assert.equal(
    committed,
    generated,
    'cordis.patch.yml 是生成物：改 preset/agent.cordis.yml 或 preset/preset.yml 后运行 ' +
      'node scripts/build-preset-patch.mjs --write',
  );
});

test('声明行是 0.2 的 @deepseek-ai/dsh-agent-preset，带显示名与排序', async () => {
  const patch = await read('../cordis.patch.yml');
  assert.match(patch, /^\s+- id: preset-engineering$/m);
  assert.match(patch, /^\s+name: "@deepseek-ai\/dsh-agent-preset"$/m);
  assert.match(patch, /^\s+id: engineering$/m);
  assert.match(patch, /^\s+name: '工程模式'$/m);
  assert.match(patch, /^\s+order: 5$/m);
});

test('persona 只引用 harness 真的注册了的 prompt 变量', async () => {
  const source = await read('../preset/agent.cordis.yml');
  const persona = source.match(/(?:^|\n)(- id: persona\n[\s\S]*?)(?=\n- id: )/);
  assert.ok(persona, 'preset/agent.cordis.yml 里找不到 persona 行');
  // harness 0.2.1-rc.2 的 dsh-agent-loop 只注册这两个变量（working directory 走
  // dsh-working-directory 的必需 user-role context，不是 prompt 变量）。模板里出现
  // 别的 `{{…}}` 不会在挂载时报错，只会在会话第一轮渲染 system prompt 时抛
  // `unknown prompt variable`——正是 0.2.0/0.2.1 之间漏掉的那类静默退化。
  const registered = new Set(['model', 'provider']);
  const refs = [...persona[1].matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((m) => m[1]);
  for (const ref of refs) {
    assert.ok(
      registered.has(ref),
      `persona 引用了未注册的 prompt 变量 {{${ref}}}；` +
        `harness 只注册 ${[...registered].map((n) => `{{${n}}}`).join('、')}`,
    );
  }
});

test('三条改写的结果都在产物里', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  const patch = await read('../cordis.patch.yml');
  // 头部注释**故意**点名这两个陷阱，所以只拿非注释行做否定断言。
  const body = patch
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const local = [...patch.matchAll(/^\s+name: '([^']*\/preset\/plugins\/[^']+)'$/gm)].map(
    (m) => m[1],
  );
  assert.equal(
    local.length,
    3,
    `三个 preset 本地插件都要改写成包内子路径，实际:\n${local.join('\n')}`,
  );
  for (const name of local) {
    assert.ok(
      name.startsWith(`${pkg.name}/preset/plugins/`),
      `本地插件行必须走包内子路径（0.2 的 preset 子树 baseUrl 是 profile 目录）: ${name}`,
    );
  }
  assert.match(patch, /^\s+name: '@deepseek-ai\/dsh-workflow-ptc'$/m);
  assert.match(patch, /^\s+- id: workflow-ptc$/m);
  assert.match(patch, /^\s+name: '@deepseek-ai\/dsh-skill-filesystem'$/m);
  assert.match(patch, /customSkillDirs:/);
  assert.doesNotMatch(body, /name: ['"]\.\//);
  assert.doesNotMatch(body, /worker-thread/);
});

test('生成器对「skills 表达式不认识」报错，而不是静默产出一个 skills 指向错误的 preset', async () => {
  const source = await read('../preset/agent.cordis.yml');
  const doctored = source.replace(
    /!!js "process\.getBuiltinModule\('node:url'\)\.fileURLToPath\(new URL\('skills\/', baseUrl\)\)"/,
    `!!js "new URL('skills/', baseUrl)"`,
  );
  assert.notEqual(doctored, source, '测试夹具没能改掉 skills 表达式');
  assert.throws(
    () => transformComposition({ composition: doctored, packageName: 'pkg' }),
    /skills 目录表达式未命中/,
  );
});

test('生成器对 preset.yml 缺字段报错', async () => {
  await assert.rejects(
    () => renderPresetPatch({ meta: 'name: 工程模式\norder: 5\n' }),
    /缺少字段 description/,
  );
});

test('静态校验全部通过（drift/dialect/specifiers/porting）', async () => {
  const { ok, checks } = await verifyPresetPatch({ repo: REPO });
  const failed = checks.filter((check) => check.status === 'fail');
  assert.deepEqual(
    failed,
    [],
    `preset patch 静态校验失败:\n${failed.map((c) => `  ${c.name}: ${c.detail}`).join('\n')}`,
  );
  assert.ok(ok);
  // 本地有 harness 依赖树（本机可选的 preset/node_modules 链接）时，YAML 方言解析
  // 必须真的跑过；裸检出没有 harness 时允许 skip，但不允许静默变成 fail。
  if (existsSync(fileURLToPath(new URL('../preset/node_modules/@deepseek-ai', import.meta.url)))) {
    const dialect = checks.find((check) => check.name === 'dialect');
    assert.equal(dialect?.status, 'ok', `本机应能解析 YAML 方言: ${JSON.stringify(dialect)}`);
  }
});

test('两个 CLI 对坏旗标与坏目录报错，而不是静默给出结论', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const status = async (rel, args) => {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    try {
      await run(process.execPath, [file, ...args]);
      return 0;
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(
    await status('../scripts/build-preset-patch.mjs', ['--write', '--out', '/tmp/never.yml']),
    2,
    '--write 与 --out 同时给出必须拒绝',
  );
  assert.equal(
    await status('../scripts/build-preset-patch.mjs', ['--out']),
    2,
    '--out 缺值必须拒绝',
  );
  assert.equal(
    await status('../scripts/verify-preset-patch.mjs', ['--harness-base']),
    2,
    '--harness-base 缺值必须拒绝',
  );
  assert.equal(
    await status('../scripts/verify-preset-patch.mjs', ['--harness-base', '/tmp']),
    1,
    '--harness-base 指到没有依赖树的目录必须 FAIL（退出 1），不能退化成 skip 后报「通过」',
  );
});
