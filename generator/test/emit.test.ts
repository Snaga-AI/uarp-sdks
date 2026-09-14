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

test('Ada declares a cycle member before the record that holds its vector', () => {
  // Ada has no forward references and Ada.Containers.Vectors cannot be
  // instantiated over an incomplete type, so a recursive schema needs the
  // incomplete-type/access/vector dance. Without it GNAT says
  // `"Tree_Vectors" not declared in "Models"` and the whole Ada SDK fails to
  // build — which is what shipped from 2026-09-10 until this test existed.
  //
  // The assertion is on ORDER, not on presence: every declaration below was
  // already emitted by the broken generator, just in the losing sequence.
  const ada = renderTarget(fixture('recursion'), 'ada');

  const ordering = (name: string): void => {
    const incomplete = ada.indexOf(`type ${name};`);
    const access = ada.indexOf(`type ${name}_Access is access ${name};`);
    const vector = ada.indexOf(`package ${name}_Vectors is new Ada.Containers.Vectors`);
    const record = ada.indexOf(`type ${name} is record`);

    assert.ok(incomplete >= 0, `${name} has no incomplete declaration`);
    assert.ok(access >= 0, `${name} has no access type`);
    assert.ok(vector >= 0, `${name} has no vector package`);
    assert.ok(record >= 0, `${name} has no record`);

    assert.ok(incomplete < access, `${name}: the access type precedes the incomplete type`);
    assert.ok(access < vector, `${name}: the vector precedes the access type it is built over`);
    assert.ok(vector < record, `${name}: ${name}_Vectors is used by the record declared before it`);
  };

  //  Tree holds `children : Tree[]`, so it is always the cycle member.
  ordering('Tree');
  assert.match(
    ada,
    /package Tree_Vectors is new Ada\.Containers\.Vectors\s*\n\s*\(Index_Type => Positive, Element_Type => Tree_Access\);/,
    'the element type must be the access, not the value — a vector of the value is exactly what cannot be instantiated',
  );

  //  Folder and Leaf point at each other. Which of the two gets broken open
  //  falls out of the emission order and is not worth pinning; that exactly
  //  one of them does, and that it is well formed, is the invariant.
  const broken = ['Folder', 'Leaf'].filter((n) => ada.includes(`type ${n}_Access is access ${n};`));
  assert.equal(broken.length, 1, `mutual recursion should open exactly one side, opened: ${broken.join(', ') || 'none'}`);
  const opened = broken[0];
  assert.ok(opened !== undefined, 'neither side of the mutual recursion was opened');
  ordering(opened);

  const intact = opened === 'Folder' ? 'Leaf' : 'Folder';
  assert.ok(
    ada.includes(`(Index_Type => Positive, Element_Type => ${intact});`),
    `${intact} is outside the cycle break and should keep the plain instantiation over its value`,
  );

  // The body has to match the shape: dereference on write, allocate on read.
  assert.match(ada, /To_JSON \(Element\.all\)/);
  assert.match(ada, /Append \(new Tree'\(From_JSON/);
});
