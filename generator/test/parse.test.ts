/**
 * What the parser decides about the API. These assertions are the contract the
 * five emitters rely on; a change here changes every SDK at once.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ObjectType, Spec, TypeRef } from '../src/ir.ts';
import { checkTarget } from '../src/index.ts';
import { fixture, namedType, operation, productionSpec } from './support.ts';

function object(spec: Spec, name: string): ObjectType {
  const type = namedType(spec, name);
  assert.equal(type.kind, 'object', `${name} should be an object`);
  return type as ObjectType;
}

function property(spec: Spec, typeName: string, wire: string) {
  const found = object(spec, typeName).properties.find((p) => p.wire === wire);
  assert.ok(found, `${typeName} has no property ${wire}`);
  return found;
}

// --------------------------------------------------------------- optionality

test('required, optional and nullable are three different things', () => {
  const spec = fixture('nullability');

  const required = property(spec, 'Thing', 'id');
  assert.equal(required.required, true);
  assert.equal(required.nullable, false);

  // `type: ["string", "null"]` on a required property: always present, may be null.
  const requiredNullable = property(spec, 'Thing', 'required_nullable');
  assert.equal(requiredNullable.required, true);
  assert.equal(requiredNullable.nullable, true);

  const optional = property(spec, 'Thing', 'optional_plain');
  assert.equal(optional.required, false);
  assert.equal(optional.nullable, false);

  const optionalNullable = property(spec, 'Thing', 'optional_nullable');
  assert.equal(optionalNullable.required, false);
  assert.equal(optionalNullable.nullable, true);

  // The OpenAPI 3.0 spelling has to work too.
  assert.equal(property(spec, 'Thing', 'legacy_nullable').nullable, true);
});

test('maps scalar formats onto distinct primitives', () => {
  const spec = fixture('nullability');
  assert.deepEqual(property(spec, 'Thing', 'id').type, { kind: 'prim', prim: 'uuid' });
  assert.deepEqual(property(spec, 'Thing', 'created_at').type, { kind: 'prim', prim: 'datetime' });
  assert.deepEqual(property(spec, 'Thing', 'count').type, { kind: 'prim', prim: 'integer' });
  assert.deepEqual(property(spec, 'Thing', 'optional_plain').type, { kind: 'prim', prim: 'number' });
  assert.deepEqual(property(spec, 'Thing', 'tags').type, {
    kind: 'array',
    items: { kind: 'prim', prim: 'string' },
  });
  // A bare `type: object` is free-form JSON, not an empty model.
  assert.deepEqual(property(spec, 'Thing', 'free_form').type, { kind: 'prim', prim: 'jsonObject' });
  assert.deepEqual(property(spec, 'Thing', 'anything').type, { kind: 'prim', prim: 'jsonObject' });
});

test('carries const, default and deprecated through to the emitters', () => {
  const spec = fixture('nullability');
  assert.equal(property(spec, 'Thing', 'kind').constValue, 'thing');
  assert.equal(property(spec, 'Thing', 'deprecated_field').deprecated, true);
});

// --------------------------------------------------------------------- enums

test('hoists enums and shares identical value sets', () => {
  const spec = fixture('enums');

  const status = property(spec, 'Report', 'status');
  assert.equal(status.type.kind, 'named');

  const statusType = namedType(spec, (status.type as { name: string }).name);
  assert.equal(statusType.kind, 'enum');
  assert.deepEqual(
    (statusType as { values: string[] }).values,
    ['active', 'other', '2fa', 'run.completed', 'in progress'],
  );

  // The same value set really is the same type; sharing `SortOrder` is a feature.
  const first = property(spec, 'Report', 'shared_order').type;
  const second = property(spec, 'Report', 'also_order').type;
  assert.deepEqual(first, second);
});

test('does not merge unrelated objects that happen to match', () => {
  // Two `{ name }` bodies in different operations must keep their own names,
  // otherwise a method advertises a request type from another resource.
  const spec = fixture('method-names');
  const names = spec.types.map((type) => type.name);
  assert.equal(new Set(names).size, names.length, 'type names must be unique');
});

// ---------------------------------------------------------------- pagination

test('detects the canonical cursor envelope', () => {
  const spec = fixture('pagination');
  const pagination = operation(spec, 'listItems').pagination;
  assert.ok(pagination, 'listItems should be paginated');
  assert.equal(pagination.itemsProp, 'items');
  assert.equal(pagination.cursorProp, 'cursor');
  assert.equal(pagination.hasMoreProp, 'has_more');
  assert.equal(pagination.cursorParam, 'cursor');
  assert.equal(pagination.limitParam, 'limit');
  // The emitters guard on these: `cursor` is nullable, `has_more` is not.
  assert.equal(pagination.itemsOptional, false);
  assert.equal(pagination.cursorOptional, true);
  assert.equal(pagination.hasMoreOptional, false);
  assert.deepEqual(pagination.itemType, { kind: 'named', name: 'Item' });
});

test('detects a differently named envelope with a single array', () => {
  const spec = fixture('pagination');
  const pagination = operation(spec, 'listBoxes').pagination;
  assert.ok(pagination);
  assert.equal(pagination.itemsProp, 'boxes');
  assert.equal(pagination.hasMoreProp, undefined);
  assert.equal(pagination.itemsOptional, true);
});

// --------------------------------------------------------------method names

test('shortens a method name only when the result stays honest', () => {
  const spec = fixture('method-names');
  assert.equal(operation(spec, 'listAgents').method, 'list');
  assert.equal(operation(spec, 'createAgent').method, 'create');
  assert.equal(operation(spec, 'deleteRun').method, 'delete');
  // Stripping `Runs` here would leave `listAgent`, which is about agents.
  assert.equal(operation(spec, 'listAgentRuns').method, 'listAgentRuns');
});

test('keeps full ids when shortening would collide', () => {
  const spec = fixture('method-names');
  // Both `getRun` and `getRuns` want to become `get`.
  assert.equal(operation(spec, 'getRun').method, 'getRun');
  assert.equal(operation(spec, 'getRuns').method, 'getRuns');
});

// -------------------------------------------------------------- composition

test('flattens allOf into one object', () => {
  const spec = fixture('composition');
  const response = operation(spec, 'createEmbedding').response.type;
  assert.equal(response?.kind, 'named');

  const detail = property(spec, (response as { name: string }).name, 'detail');
  const merged = object(spec, (detail.type as { name: string }).name);
  assert.deepEqual(
    merged.properties.map((p) => p.wire).sort(),
    ['extra', 'id', 'note'],
  );
  assert.equal(merged.properties.find((p) => p.wire === 'id')!.required, true);
  assert.equal(merged.properties.find((p) => p.wire === 'extra')!.required, true);
  assert.equal(merged.properties.find((p) => p.wire === 'note')!.required, false);
});

test('turns oneOf into a union', () => {
  const spec = fixture('composition');
  const request = operation(spec, 'createEmbedding').body!.type;
  const input = property(spec, (request as { name: string }).name, 'input');
  assert.equal(input.type.kind, 'union');
  assert.deepEqual((input.type as { variants: TypeRef[] }).variants, [
    { kind: 'prim', prim: 'string' },
    { kind: 'array', items: { kind: 'prim', prim: 'string' } },
  ]);
});

// -------------------------------------------------------------------- bodies

test('describes multipart bodies part by part', () => {
  const spec = fixture('bodies');
  const body = operation(spec, 'uploadBundle').body;
  assert.ok(body);
  assert.equal(body.encoding, 'multipart');
  assert.deepEqual(body.parts, [
    { wire: 'manifest', required: true, role: 'field', description: 'JSON-stringified manifest.' },
    { wire: 'artifact', required: true, role: 'file', description: undefined },
    { wire: 'sha256', required: false, role: 'field', description: undefined },
  ]);
});

test('distinguishes no content from undocumented content', () => {
  const spec = fixture('bodies');
  // 204 really is empty.
  assert.equal(operation(spec, 'deleteUpload').response.type, undefined);
  // A 200 documented without a body still returns something; raw JSON beats
  // throwing the payload away.
  assert.deepEqual(operation(spec, 'getUploadMetadata').response.type, { kind: 'prim', prim: 'json' });
  assert.deepEqual(operation(spec, 'downloadBundle').response.type, { kind: 'prim', prim: 'binary' });
  assert.deepEqual(operation(spec, 'getMetrics').response.type, { kind: 'prim', prim: 'string' });
});

test('marks mutating /api/v1 requests idempotent', () => {
  const spec = productionSpec();
  assert.equal(operation(spec, 'createAgent').idempotent, true);
  assert.equal(operation(spec, 'listAgents').idempotent, false);
});

// ----------------------------------------------------------------- streaming

test('recognises event streams and leaves transport headers alone', () => {
  const spec = fixture('streaming');
  const op = operation(spec, 'streamRunEvents');

  assert.equal(op.sse, true);
  assert.deepEqual(op.scopes, ['events:read']);
  assert.deepEqual(op.pathParams.map((p) => p.wire), ['runId']);
  assert.deepEqual(op.queryParams.map((p) => p.wire), ['token']);
  // `Idempotency-Key` belongs to the transport, not to the generated signature.
  assert.deepEqual(op.headerParams.map((p) => p.wire), ['Last-Event-ID']);
});

// ---------------------------------------------- invariants on the real spec

test('parses the production document into the expected shape', () => {
  const spec = productionSpec();
  const ops = spec.groups.flatMap((g) => g.operations);

  assert.equal(ops.length, 557);
  assert.equal(spec.groups.length, 43);
  assert.equal(spec.types.length, 575);
  assert.equal(spec.scopes.length, 31);
  assert.equal(ops.filter((o) => o.sse).length, 11);
  assert.equal(ops.filter((o) => o.pagination).length, 14);
  assert.equal(ops.filter((o) => o.body?.encoding === 'multipart').length, 2);
});

test('every named type reference resolves', () => {
  const spec = productionSpec();
  const known = new Set(spec.types.map((type) => type.name));
  const dangling: string[] = [];

  const visit = (ref: TypeRef | undefined, where: string): void => {
    if (!ref) return;
    switch (ref.kind) {
      case 'named':
        if (!known.has(ref.name)) dangling.push(`${where} -> ${ref.name}`);
        return;
      case 'array':
        return visit(ref.items, where);
      case 'map':
        return visit(ref.values, where);
      case 'union':
        ref.variants.forEach((variant) => visit(variant, where));
        return;
      default:
        return;
    }
  };

  for (const type of spec.types) {
    if (type.kind === 'object') for (const p of type.properties) visit(p.type, `${type.name}.${p.wire}`);
    if (type.kind === 'alias') visit(type.target, type.name);
  }
  for (const group of spec.groups) {
    for (const op of group.operations) {
      visit(op.response.type, `${op.id} response`);
      if (op.body) visit(op.body.type, `${op.id} body`);
      for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
        visit(p.type, `${op.id} param ${p.wire}`);
      }
      if (op.pagination) visit(op.pagination.itemType, `${op.id} page item`);
    }
  }

  assert.deepEqual(dangling, []);
});

test('method names are unique inside every group', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    const names = group.operations.map((op) => op.method);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], `${group.name} has duplicate method names`);
  }
});

test('never exposes a transport-owned header as a parameter', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    for (const op of group.operations) {
      for (const header of op.headerParams) {
        assert.doesNotMatch(header.wire, /^(authorization|idempotency-key)$/i, `${op.id} leaks ${header.wire}`);
      }
    }
  }
});

test('gives every operation and group a usable name', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    assert.match(group.name, /^[A-Za-z][A-Za-z0-9]*$/, `bad group name ${group.name}`);
    assert.ok(group.operations.length > 0, `${group.name} has no operations`);
    for (const op of group.operations) {
      assert.match(op.method, /^[a-z][A-Za-z0-9]*$/, `bad method name ${op.method} (${op.id})`);
      assert.match(op.path, /^\//, `bad path ${op.path}`);
    }
  }
});

test('paginated operations always expose the cursor they need', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    for (const op of group.operations) {
      if (!op.pagination) continue;
      const cursor = op.queryParams.find((p) => p.wire === op.pagination!.cursorParam);
      assert.ok(cursor, `${op.id} is paginated but has no ${op.pagination.cursorParam} parameter`);
      assert.equal(op.response.type?.kind, 'named', `${op.id} page response should be a model`);
    }
  }
});

test('--check reports what is missing rather than guessing', () => {
  // Pointed at an empty tree, every file the emitters would write is missing.
  const problems = checkTarget(fixture('nullability'), 'typescript', mkdtempSync(join(tmpdir(), 'uarp-check-')));
  assert.ok(problems.length > 0);
  assert.ok(
    problems.every((problem) => problem.startsWith('missing:')),
    problems.slice(0, 3).join('\n'),
  );
});

test('parsing is deterministic', () => {
  const first = fixture('nullability');
  const again = fixture('nullability');
  assert.equal(JSON.stringify(first), JSON.stringify(again));
});
