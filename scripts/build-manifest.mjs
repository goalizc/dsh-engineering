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