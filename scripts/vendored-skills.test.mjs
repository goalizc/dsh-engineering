// scripts/vendored-skills.test.mjs
//
// Guards the vendee against a half-synced tree.
//
// `scripts/build-bootstrap.sh` already asserts that the three whitelisted
// caveman skills exist, but only `scripts/sync-caveman-skills.sh` runs it: a
// `sync-superpowers-skills.sh`-only or interrupted sync leaves a tree missing a
// caveman skill, and `npm test`'s `pretest` (the manifest rebuild) never looks
// at skill bodies — so the loss is silent until a session loads a skill that is
// not there. Superpowers owns the whole `skills/` tree and is restored wholesale
// by its own sync; the caveman whitelist is the partial vendee that a wholesale
// replace actually deletes, which is why these three are the pinned set.
//
// The whitelist is pinned to literals on purpose: it must match `CAVEMAN_IDS`
// in `scripts/sync-caveman-skills.sh`, and a change to that list should have to
// change this test too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CAVEMAN_IDS = ['caveman', 'caveman-commit', 'caveman-review'];

test('every whitelisted caveman skill is vendored with a non-empty SKILL.md', async () => {
  for (const id of CAVEMAN_IDS) {
    const path = fileURLToPath(new URL(`../preset/skills/${id}/SKILL.md`, import.meta.url));
    let body;
    await assert.doesNotReject(
      async () => { body = await readFile(path, 'utf8'); },
      `${path} is missing (or unreadable) — the tree is half-synced. ` +
        `Re-run scripts/sync-caveman-skills.sh (or sync-superpowers-skills.sh, ` +
        `which re-runs it) to restore the whitelisted skills.`,
    );
    assert.ok(body.trim().length > 0, `${path} is empty`);
  }
});
