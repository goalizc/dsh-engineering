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
