/**
 * Golden tests: every fixture rendered by every emitter, compared against a
 * checked-in file.
 *
 * These are the safety net for emitter changes. The output is deterministic, so
 * a diff here is always a real behaviour change — review it, then refresh with
 * `UPDATE_GOLDEN=1 npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTarget } from '../src/index.ts';
import { checkGolden, firstDifference, fixture, fixtureNames, TARGET_NAMES } from './support.ts';

for (const name of fixtureNames()) {
  for (const target of TARGET_NAMES) {
    test(`${name} renders unchanged for ${target}`, () => {
      const { actual, expected } = checkGolden(name, target);
      if (actual !== expected) assert.fail(firstDifference(actual, expected));
    });
  }
}

test('rendering the same spec twice produces identical output', () => {
  // Emitters walk maps and sets; an accidental dependency on iteration order
  // would show up here rather than as a mystery diff in CI.
  const spec = fixture('nullability');
  for (const target of TARGET_NAMES) {
    assert.equal(renderTarget(spec, target), renderTarget(spec, target), `${target} is not deterministic`);
  }
});

test('every emitter produces a banner on every file it writes', () => {
  for (const name of fixtureNames()) {
    for (const target of TARGET_NAMES) {
      const rendered = renderTarget(fixture(name), target);
      const files = rendered.split(/^==> .+ <==$/m).filter((chunk) => chunk.trim().length > 0);
      for (const file of files) {
        assert.match(file.trimStart(), /DO NOT EDIT/, `${name}/${target} has a file without the banner`);
      }
    }
  }
});
