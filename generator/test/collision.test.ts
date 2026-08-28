/**
 * Method-name collisions, which every target language rejects and the
 * generator used to emit in silence.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadSpec, methodCollisions } from '../src/index.ts';
import { productionSpec } from './support.ts';

function ok(operationId: string, tag: string) {
  return {
    operationId,
    tags: [tag],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } },
    },
  };
}

function specFile(paths: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'uarp-collision-'));
  const file = join(dir, 'openapi.json');
  writeFileSync(
    file,
    JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'collision', version: '0.0.1' },
      paths,
      components: { schemas: {} },
    }),
  );
  return loadSpec(file);
}

test('two operations in one group sharing a method name are refused', () => {
  const spec = specFile({
    '/api/v1/widgets/alpha': { put: ok('updateWidget', 'Widgets') },
    '/api/v1/widgets/beta': { patch: ok('updateWidget', 'Widgets') },
    '/api/v1/widgets/gamma': { get: ok('listWidgets', 'Widgets') },
  });

  const problems = methodCollisions(spec);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0]!, /widgets\.update\(\) would be emitted 2 times/);
  // Both sites named, so the report says which document lines to change.
  assert.match(problems[0]!, /PUT \/api\/v1\/widgets\/alpha/);
  assert.match(problems[0]!, /PATCH \/api\/v1\/widgets\/beta/);
});

test('the same operationId in DIFFERENT groups is allowed', () => {
  // This is the live document's shape: `updateTenant` on both
  // `PUT /tenants/me` and `PATCH /admin/tenants/{tenantId}`. Names are scoped
  // per group, so both are emitted and both are reachable. Erroring here would
  // refuse the document the platform serves.
  const spec = specFile({
    '/api/v1/tenants/me': { put: ok('updateTenant', 'Tenants') },
    '/api/v1/admin/tenants/{tenantId}': { patch: ok('updateTenant', 'Admin') },
  });

  assert.deepEqual(methodCollisions(spec), []);
});

test('the vendored production document has no collision', () => {
  assert.deepEqual(methodCollisions(productionSpec()), []);
});
