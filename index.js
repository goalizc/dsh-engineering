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