#!/usr/bin/env node
/**
 * UARP SDK code generator.
 *
 *   node src/index.ts                        # regenerate every target
 *   node src/index.ts typescript rust        # regenerate a subset
 *   node src/index.ts --stats                # print IR statistics and exit
 *   node src/index.ts --check                # fail if the checked-in output is stale
 *   node src/index.ts --spec f.json --out /tmp/x   # run against a fixture
 *
 * The module also exposes `TARGETS`, `loadSpec` and `renderTarget` so the test
 * suite can drive the emitters without touching the packages.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Spec } from './ir.ts';
import { parse } from './parse.ts';
import { emitTypeScript } from './emit/typescript.ts';
import { emitRust } from './emit/rust.ts';
import { emitSwift } from './emit/swift.ts';
import { emitKotlin } from './emit/kotlin.ts';
import { emitAda } from './emit/ada.ts';

export interface GeneratedFile {
  /** Path relative to the package root. */
  path: string;
  content: string;
}

export type Emitter = (spec: Spec) => GeneratedFile[];

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');

export interface Target {
  packageDir: string;
  /** Directory wiped before writing, relative to packageDir. */
  generatedDir: string;
  emit: Emitter;
}

export const TARGETS: Record<string, Target> = {
  typescript: { packageDir: 'packages/typescript', generatedDir: 'src/generated', emit: emitTypeScript },
  rust: { packageDir: 'packages/rust', generatedDir: 'src/generated', emit: emitRust },
  swift: { packageDir: 'packages/swift', generatedDir: 'Sources/UARP/Generated', emit: emitSwift },
  kotlin: {
    packageDir: 'packages/kotlin',
    generatedDir: 'uarp-sdk/src/main/kotlin/ai/snaga/uarp/generated',
    emit: emitKotlin,
  },
  ada: { packageDir: 'packages/ada', generatedDir: 'src/generated', emit: emitAda },
};

export const DEFAULT_SPEC_PATH = join(repoRoot, 'spec/openapi.json');

/**
 * The SDK version, from the repository's `VERSION` file.
 *
 * Emitters bake it into the generated metadata so `scripts/set-version.sh` has
 * exactly one place to edit.
 */
export function sdkVersion(): string {
  try {
    return readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0-dev';
  }
}

export function loadSpec(path: string = DEFAULT_SPEC_PATH): Spec {
  return parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Render one target as a single reviewable document: every file, in order,
 * behind a `==> path <==` banner. Golden tests compare against this.
 */
export function renderTarget(spec: Spec, targetName: string): string {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`unknown target: ${targetName}`);
  return target
    .emit(spec)
    .map((file) => `==> ${file.path} <==\n${file.content}`)
    .join('\n');
}

interface Options {
  stats: boolean;
  check: boolean;
  specPath: string;
  outRoot: string;
  targets: string[];
}

/** Every file currently under `root`, as paths relative to `root`. */
function existingFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return; //  Nothing generated yet.
    }
    for (const entry of entries) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Compare what the emitters would write against what is on disk.
 *
 * Returns the complaints, most useful first. CI runs this instead of diffing
 * the working tree, so it also works locally and names the exact files.
 */
export function checkTarget(spec: Spec, name: string, outRoot: string): string[] {
  const target = TARGETS[name]!;
  const root = join(outRoot, target.packageDir);
  const generated = join(root, target.generatedDir);

  const expected = new Map(target.emit(spec).map((file) => [file.path, file.content]));
  const prefix = `${target.generatedDir}/`;
  const problems: string[] = [];

  for (const [path, content] of expected) {
    let actual: string;
    try {
      actual = readFileSync(join(root, path), 'utf8');
    } catch {
      problems.push(`missing: ${target.packageDir}/${path}`);
      continue;
    }
    if (actual !== content) problems.push(`stale:   ${target.packageDir}/${path}`);
  }

  for (const path of existingFiles(generated)) {
    if (!expected.has(prefix + path)) {
      problems.push(`extra:   ${target.packageDir}/${prefix}${path}`);
    }
  }
  return problems;
}

function parseArgs(argv: string[]): Options | undefined {
  const targets: string[] = [];
  let stats = false;
  let check = false;
  let specPath = DEFAULT_SPEC_PATH;
  let outRoot = repoRoot;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--stats') {
      stats = true;
    } else if (arg === '--check') {
      check = true;
    } else if (arg === '--spec') {
      const value = argv[++index];
      if (!value) {
        console.error('--spec needs a path');
        return undefined;
      }
      specPath = resolve(value);
    } else if (arg === '--out') {
      const value = argv[++index];
      if (!value) {
        console.error('--out needs a directory');
        return undefined;
      }
      outRoot = resolve(value);
    } else if (arg.startsWith('--')) {
      console.error(`unknown option: ${arg}`);
      return undefined;
    } else {
      targets.push(arg);
    }
  }

  for (const name of targets) {
    if (!TARGETS[name]) {
      console.error(`unknown target: ${name} (known: ${Object.keys(TARGETS).join(', ')})`);
      return undefined;
    }
  }

  return { stats, check, specPath, outRoot, targets: targets.length > 0 ? targets : Object.keys(TARGETS) };
}

function main(argv: string[]): void {
  const options = parseArgs(argv);
  if (!options) {
    process.exitCode = 1;
    return;
  }

  const spec = loadSpec(options.specPath);
  if (options.stats) {
    printStats(spec);
    return;
  }

  if (options.check) {
    let clean = true;
    for (const name of options.targets) {
      const problems = checkTarget(spec, name, options.outRoot);
      if (problems.length === 0) {
        console.log(`${name.padEnd(11)} up to date`);
        continue;
      }
      clean = false;
      console.error(`${name.padEnd(11)} ${problems.length} file(s) differ`);
      for (const problem of problems) console.error(`  ${problem}`);
    }
    if (!clean) {
      console.error("\nRun 'make generate' and commit the result.");
      process.exitCode = 1;
    }
    return;
  }

  for (const name of options.targets) {
    const target = TARGETS[name]!;
    const root = join(options.outRoot, target.packageDir);
    const generated = join(root, target.generatedDir);
    rmSync(generated, { recursive: true, force: true });

    const files = target.emit(spec);
    let bytes = 0;
    for (const file of files) {
      const full = join(root, file.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.content);
      bytes += Buffer.byteLength(file.content);
    }
    console.log(`${name.padEnd(11)} ${String(files.length).padStart(4)} files  ${(bytes / 1024).toFixed(0)} KiB`);
  }
}

function printStats(spec: Spec): void {
  const ops = spec.groups.flatMap((g) => g.operations);
  const kinds = { object: 0, enum: 0, alias: 0 };
  for (const t of spec.types) kinds[t.kind]++;
  console.log(`${spec.title} v${spec.version}`);
  console.log(`groups      ${spec.groups.length}`);
  console.log(`operations  ${ops.length}`);
  console.log(`  sse       ${ops.filter((o) => o.sse).length}`);
  console.log(`  paginated ${ops.filter((o) => o.pagination).length}`);
  console.log(`  multipart ${ops.filter((o) => o.body?.encoding === 'multipart').length}`);
  console.log(`  with body ${ops.filter((o) => o.body).length}`);
  console.log(`types       ${spec.types.length} (objects ${kinds.object}, enums ${kinds.enum}, aliases ${kinds.alias})`);
  console.log(`scopes      ${spec.scopes.length}`);
  console.log('');
  for (const g of spec.groups) {
    console.log(`  ${g.accessor.padEnd(22)} ${String(g.operations.length).padStart(3)} ops`);
  }
}

// Only run when invoked directly; importing this module must have no effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
