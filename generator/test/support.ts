/** Shared helpers for the generator test suite. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Group, Operation, Spec } from '../src/ir.ts';
import { DEFAULT_SPEC_PATH, loadSpec, renderTarget, TARGETS } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = join(here, 'fixtures');
export const GOLDEN_DIR = join(here, 'golden');

export const TARGET_NAMES = Object.keys(TARGETS);

/** Every fixture name, without the `.json`, in a stable order. */
export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

const fixtureCache = new Map<string, Spec>();

export function fixture(name: string): Spec {
  let spec = fixtureCache.get(name);
  if (!spec) {
    spec = loadSpec(join(FIXTURE_DIR, `${name}.json`));
    fixtureCache.set(name, spec);
  }
  return spec;
}

let realSpec: Spec | undefined;

/** The vendored production document, parsed once for the whole suite. */
export function productionSpec(): Spec {
  realSpec ??= loadSpec(DEFAULT_SPEC_PATH);
  return realSpec;
}

/**
 * Compare a target's output against its golden file.
 *
 * `UPDATE_GOLDEN=1 npm test` rewrites them; review the diff before committing,
 * because that is the only thing standing between an emitter change and five
 * SDKs quietly changing shape.
 */
export function checkGolden(fixtureName: string, target: string): { actual: string; expected: string } {
  const actual = renderTarget(fixture(fixtureName), target);
  const path = join(GOLDEN_DIR, `${fixtureName}.${target}.txt`);

  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(path, actual);
    return { actual, expected: actual };
  }

  let expected: string;
  try {
    expected = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `missing golden file ${path}. Run 'UPDATE_GOLDEN=1 npm test' and review the result.`,
    );
  }
  return { actual, expected };
}

/** First difference between two texts, as `line N: expected ... / actual ...`. */
export function firstDifference(actual: string, expected: string): string {
  const a = actual.split('\n');
  const b = expected.split('\n');
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) {
      return [
        `line ${index + 1}`,
        `  expected: ${b[index] ?? '<end of file>'}`,
        `  actual:   ${a[index] ?? '<end of file>'}`,
        `Run 'UPDATE_GOLDEN=1 npm test' if the change is intended.`,
      ].join('\n');
    }
  }
  return 'files differ only in trailing content';
}

export function group(spec: Spec, name: string): Group {
  const found = spec.groups.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no group ${name} (have: ${spec.groups.map((g) => g.name).join(', ')})`);
  return found;
}

export function operation(spec: Spec, id: string): Operation {
  for (const candidate of spec.groups) {
    const found = candidate.operations.find((op) => op.id === id);
    if (found) return found;
  }
  throw new Error(`no operation ${id}`);
}

export function namedType(spec: Spec, name: string) {
  const found = spec.types.find((type) => type.name === name);
  if (!found) throw new Error(`no type ${name}`);
  return found;
}
