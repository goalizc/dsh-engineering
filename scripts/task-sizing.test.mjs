// scripts/task-sizing.test.mjs
//
// Guards the harness-authored "Task sizing" section that build-bootstrap.sh
// injects into every session. That section is the only local override of the
// vendored `using-superpowers` body — and that body forbids the very judgement
// the section requires (`| "The skill is overkill" | ... | Use it. |`). Losing
// the section silently restores the every-task-full-process treadmill, so
// these assertions read the generated artifact, not the source that writes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// Scope every text assertion to the section itself: preset/bootstrap.md also
// carries the vendored bodies, which are full of prose that would mask a
// missing or polluted section.
const sectionOf = (bootstrap) =>
  bootstrap.slice(bootstrap.indexOf('## Task sizing (harness override)')).split('\n## ')[0];

test('bootstrap.md carries the three tracks and the four hard gates', async () => {
  const bootstrap = await read('../preset/bootstrap.md');
  for (const needle of [
    '## Task sizing (harness override)',
    '| A direct |',
    '| B light |',
    '| C full |',
    '**G1**',
    '**G2**',
    '**G3**',
    '**G4**',
  ]) {
    assert.ok(
      bootstrap.includes(needle),
      `preset/bootstrap.md must contain ${JSON.stringify(needle)}. It is a ` +
        `generated file: add the section to the FOOTER here-doc in ` +
        `scripts/build-bootstrap.sh and re-run it.`,
    );
  }

  // The section is injected into arbitrary workspaces, so it must stay
  // project-agnostic. How this repository instantiates the gates belongs in
  // docs/superpowers/specs/2026-09-16-task-sizing-design.md §8, not in the
  // injected text.
  const section = sectionOf(bootstrap);
  for (const noun of [
    'cordis',
    'manifest.json',
    'preset/',
    'dsh-engineering',
    'engineering-dsh',
    'npm test',
  ]) {
    assert.ok(
      !section.includes(noun),
      `the injected "Task sizing" section must not name ${JSON.stringify(noun)}: ` +
        `it is injected into arbitrary workspaces, so it must stay ` +
        `project-agnostic. Move the project-specific wording into the spec.`,
    );
  }
});

// The load-bearing sentence. Without it this section is one more opinion next
// to an unconditional vendored rule, and the vendored text wins by being
// closer to the decision. The test names both upstream things it overrides so
// a future reword cannot quietly soften it into a suggestion.
test('the injected section overrides the vendored Red Flags decision', async () => {
  const bootstrap = await read('../preset/bootstrap.md');
  const section = sectionOf(bootstrap);
  assert.ok(
    section.includes('overrides the "1% chance" rule') &&
      section.includes('"The skill is overkill" Red'),
    'the "Task sizing" section must name what it overrides — the "1% chance" ' +
      'rule and the "The skill is overkill" Red Flags row. Without that ' +
      'sentence the unconditional vendored text still wins and the tracks are ' +
      'a suggestion. Edit the FOOTER here-doc in scripts/build-bootstrap.sh ' +
      'and re-run it.',
  );
});
