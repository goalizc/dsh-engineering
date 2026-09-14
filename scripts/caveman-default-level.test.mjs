// scripts/caveman-default-level.test.mjs
//
// Guards values that are duplicated across files on purpose, with no link
// between them:
//
//   - the default level lives in three homes: the FOOTER of
//     `scripts/build-bootstrap.sh` (which writes the generated
//     `preset/bootstrap.md`), the persona in `preset/agent.cordis.yml`, and
//     `DEFAULT_LEVEL` in `preset/plugins/caveman-command/index.js`;
//   - the seven level NAMES live in the vendored `caveman` skill body (the
//     upstream source of truth) and in the plugin's `CAVEMAN_LEVELS`.
//
// Nothing else ties the copies together, so a one-sided edit would make the
// no-arg `/caveman` output (or the persona's stated default) contradict the
// level the session actually starts at — silently, because both are still
// valid levels. These tests are the tie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CAVEMAN_LEVELS, DEFAULT_LEVEL } from '../preset/plugins/caveman-command/index.js';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('plugin DEFAULT_LEVEL is the level build-bootstrap.sh injects', async () => {
  const bootstrap = await read('../preset/bootstrap.md');
  const expected = `Default compression level: **${DEFAULT_LEVEL}**`;
  assert.ok(
    bootstrap.includes(expected),
    `preset/bootstrap.md must contain ${JSON.stringify(expected)}, ` +
      `the level a bare /caveman reports. It states something else: change the ` +
      `FOOTER in scripts/build-bootstrap.sh and re-run it, or change DEFAULT_LEVEL ` +
      `in preset/plugins/caveman-command/index.js — the two must agree.`,
  );
});

// The third home of the default level: the persona states it in prose, and
// nothing generates that line, so it drifts independently of the other two.
test('the composition persona states the same default level', async () => {
  const composition = await read('../preset/agent.cordis.yml');
  const expected = `Output style: caveman, level ${DEFAULT_LEVEL}`;
  assert.ok(
    composition.includes(expected),
    `preset/agent.cordis.yml must contain ${JSON.stringify(expected)}. ` +
      `The persona and DEFAULT_LEVEL in preset/plugins/caveman-command/index.js ` +
      `must agree; a mismatch tells the model a different start level than a ` +
      `bare /caveman reports.`,
  );
});

// The level vocabulary has two independent homes: the vendored skill (which
// this repository never edits) and the plugin's own list. Comparing the plugin
// against itself — the shape this guard used to have — restates the module and
// catches nothing.
test("the plugin's level vocabulary matches the vendored caveman skill", async () => {
  const skill = await read('../preset/skills/caveman/SKILL.md');
  const listed = /\/caveman ([a-z-]+(?:\|[a-z-]+)+)/.exec(skill)?.[1];
  assert.ok(
    listed !== undefined,
    'preset/skills/caveman/SKILL.md must declare its levels as ' +
      '`/caveman <level>|<level>|...`; the guard cannot compare against a body ' +
      'it cannot read. If upstream reworded that line, update this pattern and ' +
      'the plugin together.',
  );
  assert.deepEqual(
    [...CAVEMAN_LEVELS],
    listed.split('|'),
    'CAVEMAN_LEVELS in preset/plugins/caveman-command/index.js must be exactly ' +
      'the levels the vendored caveman skill defines.',
  );
});
