/**
 * Compile the fixture output.
 *
 * Golden files lock in whatever the emitters produce — including code that does
 * not compile. These tests close that gap for TypeScript and Rust: every
 * fixture is emitted into a throwaway tree beside a copy of the hand-written
 * core, and the lot is checked in a single compiler pass.
 *
 * Kotlin and Ada are covered by the production spec, which their package builds
 * compile in CI.
 *
 * Each check skips itself when its toolchain is missing, and
 * `UARP_COMPILE_TARGETS=swift` narrows the run to one language — CI uses that
 * to check Swift on the macOS runner it already pays for.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { repoRoot, TARGETS } from '../src/index.ts';
import { fixture, fixtureNames } from './support.ts';

const here = dirname(fileURLToPath(import.meta.url));
const generatorRoot = dirname(here);
const tsPackage = join(repoRoot, 'packages/typescript');
const rustPackage = join(repoRoot, 'packages/rust');
const swiftPackage = join(repoRoot, 'packages/swift');

/** True when a command is on PATH. */
function available(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Why this target cannot run, or false when it can. */
function skipReason(target: string, command: string): string | false {
  const selected = process.env.UARP_COMPILE_TARGETS;
  if (selected && !selected.split(',').includes(target)) return `not in UARP_COMPILE_TARGETS`;
  return available(command) ? false : `${command} is not installed`;
}

/** `method-names` -> `MethodNames`, for use as a Swift module name. */
function moduleName(fixtureName: string): string {
  return fixtureName
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

const workspace = mkdtempSync(join(tmpdir(), 'uarp-codegen-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

test('every fixture emits TypeScript that type-checks', { skip: skipReason('typescript', 'node') }, () => {
  const target = TARGETS.typescript!;

  for (const name of fixtureNames()) {
    const root = join(workspace, name);
    // The generated resources import `../../core/*`, so each tree needs the
    // hand-written runtime beside them.
    cpSync(join(tsPackage, 'src/core'), join(root, 'src/core'), { recursive: true });
    cpSync(join(tsPackage, 'src/index.ts'), join(root, 'src/index.ts'));

    for (const file of target.emit(fixture(name))) {
      const full = join(root, file.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.content);
    }
  }

  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'fixtures', type: 'module' }));
  writeFileSync(
    join(workspace, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          lib: ['es2023', 'dom', 'dom.iterable'],
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
          typeRoots: [join(generatorRoot, 'node_modules/@types')],
        },
        include: ['*/src/**/*.ts'],
      },
      null,
      2,
    ),
  );

  const tsc = join(generatorRoot, 'node_modules/.bin/tsc');
  try {
    execFileSync(tsc, ['-p', workspace], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const output = (error as { stdout?: string; stderr?: string }).stdout ?? '';
    assert.fail(`generated TypeScript does not compile:\n${output}`);
  }
});

test(
  'every fixture emits Rust that compiles',
  { skip: skipReason('rust', 'cargo') },
  () => {
    const target = TARGETS.rust!;
    const root = join(workspace, 'rust');
    const members: string[] = [];

    // One crate per fixture, all in one workspace so the dependency graph is
    // built once. The target directory is shared with the real package, whose
    // dependencies are already compiled.
    const manifest = readFileSync(join(rustPackage, 'Cargo.toml'), 'utf8');

    for (const name of fixtureNames()) {
      const crate = name.replace(/[^a-z0-9]+/g, '_');
      const crateRoot = join(root, crate);
      members.push(crate);

      cpSync(join(rustPackage, 'src'), join(crateRoot, 'src'), { recursive: true });
      rmSync(join(crateRoot, 'src/generated'), { recursive: true, force: true });
      for (const file of target.emit(fixture(name))) {
        const full = join(crateRoot, file.path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, file.content);
      }

      writeFileSync(
        join(crateRoot, 'Cargo.toml'),
        manifest
          .replace(/^name = "uarp-sdk"$/m, `name = "${crate}"`)
          .replace(/^\[dev-dependencies\][\s\S]*$/m, ''),
      );
    }

    writeFileSync(
      join(root, 'Cargo.toml'),
      `[workspace]\nresolver = "2"\nmembers = [${members.map((m) => `"${m}"`).join(', ')}]\n`,
    );

    try {
      execFileSync('cargo', ['check', '--workspace', '--quiet'], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, CARGO_TARGET_DIR: join(rustPackage, 'target') },
      });
    } catch (error) {
      const details = (error as { stderr?: string; stdout?: string });
      assert.fail(`generated Rust does not compile:\n${details.stderr ?? details.stdout ?? ''}`);
    }
  },
);

test(
  'every fixture emits Swift that compiles',
  { skip: skipReason('swift', 'swift') },
  () => {
    const target = TARGETS.swift!;
    const root = join(workspace, 'swift');
    const modules: string[] = [];

    // One module per fixture inside a single package, so `swift build` compiles
    // them all in one parallel pass.
    for (const name of fixtureNames()) {
      const module = moduleName(name);
      modules.push(module);
      const moduleRoot = join(root, 'Sources', module);

      cpSync(join(swiftPackage, 'Sources/UARP/Core'), join(moduleRoot, 'Core'), { recursive: true });
      for (const file of target.emit(fixture(name))) {
        const full = join(root, file.path.replace('Sources/UARP/', `Sources/${module}/`));
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, file.content);
      }
    }

    const targets = modules.map((module) => `        .target(name: "${module}"),`).join('\n');
    writeFileSync(
      join(root, 'Package.swift'),
      [
        '// swift-tools-version: 5.9',
        'import PackageDescription',
        '',
        'let package = Package(',
        '    name: "Fixtures",',
        '    platforms: [.macOS(.v12)],',
        '    targets: [',
        targets,
        '    ]',
        ')',
        '',
      ].join('\n'),
    );

    try {
      execFileSync('swift', ['build', '--package-path', root], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const details = error as { stderr?: string; stdout?: string };
      assert.fail(`generated Swift does not compile:\n${details.stderr ?? details.stdout ?? ''}`);
    }
  },
);
