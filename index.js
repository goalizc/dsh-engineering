// 本包的 ≤0.1.5 通道：启动该 profile 时把 preset/ 植入
// `${DSH_HOME}/.agent-presets/engineering/`，那时的 harness 用
// @deepseek-ai/dsh-agent-presets 扫描这个目录。
//
// harness 0.2 删除了那套目录机制，preset 改为组合里的 @deepseek-ai/dsh-agent-preset
// 声明行，因此 cordis.patch.yml **不再插入本插件**（见 scripts/build-preset-patch.mjs）；
// 0.2 上这些文件由声明行的包内子路径直接引用，无需植入。保留本文件与 scripts/plant-core.mjs
// 只为让使用 ≤0.1.5 的人继续走 `scripts/install.sh`，0.2 上不会被加载。
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
