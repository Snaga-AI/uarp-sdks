/**
 * Invariants that hold across every emitter, and the guards that stop one from
 * quietly producing the wrong thing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderTarget, TARGETS } from '../src/index.ts';
import { parse } from '../src/parse.ts';
import { fixture, fixtureNames, productionSpec, TARGET_NAMES } from './support.ts';

test('every emitted file lands inside the directory that gets wiped', () => {
  // The generated directory is deleted before each run. A file written outside
  // it would survive a rename and rot there unnoticed.
  const spec = productionSpec();
  for (const [name, target] of Object.entries(TARGETS)) {
    for (const file of target.emit(spec)) {
      assert.ok(
        file.path.startsWith(`${target.generatedDir}/`),
        `${name} writes ${file.path}, which is outside ${target.generatedDir}`,
      );
    }
  }
});

test('no emitter writes the same path twice', () => {
  const spec = productionSpec();
  for (const [name, target] of Object.entries(TARGETS)) {
    const paths = target.emit(spec).map((file) => file.path);
    const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
    assert.deepEqual(duplicates, [], `${name} emits duplicate paths`);
  }
});

test('an emitter refuses a body encoding it cannot render', () => {
  // Four of the five have no form-urlencoded support. Falling back to JSON
  // would put the wrong content type on the wire, so generation must stop.
  const document = {
    openapi: '3.1.0',
    info: { title: 'Forms', version: '1.0.0' },
    servers: [{ url: 'https://api.test' }],
    paths: {
      '/login': {
        post: {
          operationId: 'submitLogin',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  required: ['username'],
                  properties: { username: { type: 'string' }, password: { type: 'string' } },
                },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };

  const spec = parse(document);
  assert.equal(spec.groups[0]!.operations[0]!.body?.encoding, 'form');

  for (const target of ['rust', 'swift', 'kotlin', 'ada']) {
    assert.throws(
      () => renderTarget(spec, target),
      /submitLogin: request bodies encoded as 'form' are not supported yet/,
      `${target} should refuse a form body`,
    );
  }

  // TypeScript's transport does implement it.
  assert.doesNotThrow(() => renderTarget(spec, 'typescript'));
});

test('every emitter handles every fixture without throwing', () => {
  for (const name of fixtureNames()) {
    for (const target of TARGET_NAMES) {
      assert.doesNotThrow(() => renderTarget(fixture(name), target), `${target} threw on ${name}`);
    }
  }
});

test('generated files are never empty', () => {
  const spec = productionSpec();
  for (const [name, target] of Object.entries(TARGETS)) {
    for (const file of target.emit(spec)) {
      assert.ok(file.content.trim().length > 0, `${name} wrote an empty ${file.path}`);
      assert.ok(file.content.endsWith('\n'), `${name}: ${file.path} has no trailing newline`);
    }
  }
});
