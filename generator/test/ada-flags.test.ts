/**
 * A field's presence flag must collide-check alongside the field itself.
 *
 * The Ada emitter renders an optional property as `Has_X` beside `X`. The
 * field names were deduplicated with an `_X` suffix and the flags were not, so
 * two properties whose Ada spelling coincides — `total_runs` beside the
 * deprecated camelCase twin `totalRuns` the platform carries during a
 * compatibility window — emitted `Total_Runs` and `Total_Runs_X` next to
 * `Has_Total_Runs` twice. GNAT refuses that; nothing else in the suite did.
 *
 * It reached CI as 22 duplicated flags across 7 records, and Ada was the only
 * one of the five targets to notice: the other four spell those twins apart.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSpec, renderTarget } from '../src/index.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function adaFor(properties: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'uarp-ada-flags-'));
  const file = join(dir, 'openapi.json');
  writeFileSync(
    file,
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'flags', version: '0.0.1' },
      paths: {
        '/api/v1/stats': {
          get: {
            operationId: 'getStats',
            tags: ['stats'],
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Stats' } },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Stats: { type: 'object', properties } } },
    }),
  );
  return renderTarget(loadSpec(file), 'ada');
}

test('two wire spellings of one Ada name get two distinct presence flags', () => {
  const text = adaFor({
    total_runs: { type: 'integer' },
    totalRuns: { type: 'integer', deprecated: true },
  });

  const flags = [...text.matchAll(/^\s*(Has_Total_Runs\w*)\s*:/gm)].map((m) => m[1]);
  assert.equal(flags.length, 2, `expected two flags, got ${JSON.stringify(flags)}`);
  assert.equal(new Set(flags).size, 2, `flags collide: ${JSON.stringify(flags)}`);

  // The fields were already deduplicated; this pins the pairing, so a fix that
  // renamed flags without renaming fields would not pass either.
  const fields = [...text.matchAll(/^\s*(Total_Runs\w*)\s*:/gm)].map((m) => m[1]);
  assert.equal(new Set(fields).size, 2, `fields collide: ${JSON.stringify(fields)}`);
});

test('a reserved-word field keeps the readable flag it always had', () => {
  const text = adaFor({ type: { type: 'string' } });
  // `adaIdent` renames the FIELD to `Type_K`; `Has_Type` is not reserved and
  // must not be dragged along.
  assert.match(text, /^\s*Has_Type\s*:/m);
  assert.doesNotMatch(text, /^\s*Has_Type_K\s*:/m);
});
