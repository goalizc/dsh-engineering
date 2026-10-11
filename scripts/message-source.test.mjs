// scripts/message-source.test.mjs
//
// 会话格式 v4 拒收旧的 durable source 包装 `{ kind: 'plugin', plugin }`，报错原文是
// `format v4 message requires a producer-owned source kind`（见 harness 的
// dsh-session-format-v3-to-v4）。踩中的代价很直接：preset 能挂载、设置里也不报 broken，
// 但**选中它以后第一轮就失败**——0.2.0-rc.2 上就这样丢过一次运行。
//
// 三个插件的自测各自断言自己那条消息的 source；这一层补的是「新增注入点忘了照做」：
// 它遍历目录，而不是手写插件名单（写死名单正是新增插件被漏检的方式）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PLUGINS_DIR = fileURLToPath(new URL('../preset/plugins/', import.meta.url));

/** 每个 preset 本地插件的 index.js 源码，按目录名排序。 */
async function pluginSources() {
  const out = [];
  for (const entry of await readdir(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const index = `${PLUGINS_DIR}${entry.name}/index.js`;
    try {
      out.push({ dir: entry.name, src: await readFile(index, 'utf8') });
    } catch {
      // 没有 index.js 的目录不是插件（例如只放技能的子目录）
    }
  }
  return out;
}

/** 去掉 JS 注释：源码里的说明**故意**点名被拒收的旧形状，拿全文扫会把自己的文档当违规。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('每个注入持久消息的插件都写生产者自有 source kind', async () => {
  const plugins = await pluginSources();
  assert.ok(plugins.length >= 3, `至少应扫到三个插件，实际 ${plugins.length} 个`);
  const injecting = plugins.filter(({ src }) => /\bsource:/.test(stripComments(src)));
  assert.equal(
    injecting.length,
    3,
    `目前应是 bootstrap / caveman-command / output-language 三个注入点，实际 ${injecting.length} 个：` +
      `${injecting.map((p) => p.dir).join(', ')}。新增注入点时请一并加上断言。`,
  );
  for (const { dir, src } of injecting) {
    const code = stripComments(src);
    assert.doesNotMatch(
      code,
      /kind:\s*['"]plugin['"]/,
      `${dir}: source 用了 v4 拒收的 { kind: 'plugin', plugin } 包装——` +
        `改成 { kind: \`plugin:\${name}\` }（或该插件自己的生产者 kind）`,
    );
    assert.match(
      code,
      /kind:\s*`plugin:\$\{name\}`|kind:\s*['"]plugin:[^'"]+['"]/,
      `${dir}: source.kind 必须写出生产者（\`plugin:\${name}\`）`,
    );
  }
});
