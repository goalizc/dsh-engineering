// scripts/caveman-default-level.test.mjs
//
// Guard for a value that is duplicated across two files on purpose, with no
// link between them:
//
//   - `scripts/build-bootstrap.sh`'s FOOTER writes the session-start level into
//     the generated `preset/bootstrap.md` ("Default compression level: **full**");
//   - `preset/plugins/caveman-command/index.js` carries its own `DEFAULT_LEVEL`
//     and reports it for a bare `/caveman`.
//
// Nothing else ties the two together, so a one-sided edit would make the
// no-arg `/caveman` output contradict the level the session actually starts at
// — silently, because both are still valid levels. This test is the tie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LEVEL } from '../preset/plugins/caveman-command/index.js';

const BOOTSTRAP = fileURLToPath(new URL('../preset/bootstrap.md', import.meta.url));

test('plugin DEFAULT_LEVEL is the level build-bootstrap.sh injects', async () => {
  const bootstrap = await readFile(BOOTSTRAP, 'utf8');
  const expected = `Default compression level: **${DEFAULT_LEVEL}**`;
  assert.ok(
    bootstrap.includes(expected),
    `preset/bootstrap.md must contain ${JSON.stringify(expected)}, ` +
      `the level a bare /caveman reports. It states something else: change the ` +
      `FOOTER in scripts/build-bootstrap.sh and re-run it, or change DEFAULT_LEVEL ` +
      `in preset/plugins/caveman-command/index.js — the two must agree.`,
  );
});
