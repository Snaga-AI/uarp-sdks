/**
 * Compile the code samples in the documentation.
 *
 * Every documentation error found in this repository was the same shape: a
 * sample that no longer matched the code, with nothing to notice. The samples
 * read fine — `event.text` looks exactly as plausible as `event.payload.delta`,
 * and a paragraph that lands inside a code fence still reads as prose. Only a
 * compiler can tell them apart.
 *
 * So every fenced block in a known language is extracted and compiled against
 * the package sources in this repository. Nothing has to be marked up: a sample
 * is compiled inside a scope that supplies the names the surrounding prose
 * introduced, and a sample that builds its own `client` shadows the supplied one
 * legally, in both languages here.
 *
 *   node scripts/check-docs.ts          every language whose compiler is present
 *   node scripts/check-docs.ts rust     one of them
 *
 * Swift, Kotlin and Ada samples are still read by hand. Each mixes declarations
 * with statements that belong in different parts of a compilation unit, and
 * splitting them automatically is guesswork — the wrong kind of cleverness in a
 * check whose whole value is that a failure means something.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Block {
  file: string;
  /** Where the sample starts in the markdown, for the error message. */
  line: number;
  code: string;
  /** A whole program, as opposed to a fragment leaning on the prose. */
  standalone: boolean;
}

interface Language {
  fence: string;
  /** The command that must exist for a pass to mean anything. */
  tool: string;
  sources: string[];
  isStandalone: (code: string) => boolean;
  /** Fills the workspace and says how to compile it. */
  prepare: (
    workspace: string,
    blocks: Block[],
  ) => { command: string; args: string[]; locate?: (output: string) => string };
}

function extract(file: string, language: Language): Block[] {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const found: Block[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.trim() !== '```' + language.fence) continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && lines[end]!.trim() !== '```') end++;
    const code = lines.slice(start, end).join('\n');
    found.push({ file, line: start, code, standalone: language.isStandalone(code) });
    index = end;
  }
  return found;
}

/** A name unique per block, and recoverable — the error message maps it back. */
function symbol(block: Block, index: number): string {
  return `${block.file.replace(/[^\w]/g, '_')}_${block.line}_${index}`;
}

const TS_PREAMBLE = `
import type { UarpClient as DocsClient } from 'uarp-sdk';
declare const client: DocsClient;
declare const id: string;
declare const runId: string;
declare const traceId: string;
declare const body: Parameters<DocsClient['agents']['create']>[0];
declare const controller: AbortController;
declare const myInstrumentedFetch: typeof fetch;
export {};
`;

/**
 * The names a Rust fragment may lean on.
 *
 * Parameters rather than declarations, because Rust has no way to assert that a
 * binding exists without producing one. A sample that does bind `client` itself
 * shadows the parameter, which is what a fragment following prose should be
 * allowed to do.
 */
const RUST_PARAMETERS = [
  'client: uarp_sdk::Client',
  'run_id: String',
  'id: &str',
  'key: String',
  'trace_id: String',
  'body: uarp_sdk::models::CreateAgentRequest',
  'params: uarp_sdk::api::ListAgentsParams',
  'payload: serde_json::Value',
  'my_reqwest_client: reqwest::Client',
].join(', ');

const LANGUAGES: Record<string, Language> = {
  ts: {
    fence: 'ts',
    tool: resolve(ROOT, 'packages/typescript/node_modules/.bin/tsc'),
    sources: ['README.md', 'packages/typescript/README.md'],
    isStandalone: () => false,
    prepare(workspace, blocks) {
      mkdirSync(join(workspace, 'src'), { recursive: true });
      //  Compiled against the package's own sources, so the check moves with
      //  the code rather than with whatever is on npm today.
      writeFileSync(
        join(workspace, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ['node'],
            //  The workspace is a temporary directory with no node_modules of
            //  its own, so both the type roots and the package itself are
            //  pointed at the real ones.
            typeRoots: [resolve(ROOT, 'packages/typescript/node_modules/@types')],
            paths: { 'uarp-sdk': [resolve(ROOT, 'packages/typescript/src/index.ts')] },
          },
          include: ['src'],
        }),
      );

      for (const [index, block] of blocks.entries()) {
        //  Imports have to be at the top of a module, so they are lifted out
        //  and the rest of the sample goes inside the function.
        const lines = block.code.split('\n');
        const imports = lines.filter((line) => /^\s*import\s/.test(line));
        const rest = lines.filter((line) => !/^\s*import\s/.test(line));
        //  A sample that constructs a client without importing the class is
        //  leaning on the import in the sample above it, the way a reader does.
        const needsClass =
          /\bnew UarpClient\b/.test(block.code) && !/import[^;]*\bUarpClient\b/.test(block.code);
        const classDecl = needsClass
          ? "declare const UarpClient: typeof import('uarp-sdk').UarpClient;\n"
          : '';
        writeFileSync(
          join(workspace, 'src', `${symbol(block, index)}.ts`),
          `${TS_PREAMBLE}\n${classDecl}${imports.join('\n')}\nasync function sample(): Promise<void> {\n${rest.join('\n')}\n}\nvoid sample;\n`,
        );
      }

      return {
        command: resolve(ROOT, 'packages/typescript/node_modules/.bin/tsc'),
        args: ['-p', workspace],
      };
    },
  },

  rust: {
    fence: 'rust',
    tool: 'cargo',
    sources: ['README.md', 'packages/rust/README.md'],
    isStandalone: (code) => /\bfn main\b/.test(code),
    prepare(workspace, blocks) {
      mkdirSync(join(workspace, 'src'), { recursive: true });
      writeFileSync(
        join(workspace, 'Cargo.toml'),
        [
          '[package]',
          'name = "uarp-doc-samples"',
          'version = "0.0.0"',
          'edition = "2021"',
          '',
          '[dependencies]',
          `uarp-sdk = { path = ${JSON.stringify(resolve(ROOT, 'packages/rust'))} }`,
          'tokio = { version = "1", features = ["macros", "rt-multi-thread"] }',
          'futures-util = "0.3"',
          'serde_json = "1"',
          'reqwest = "0.12"',
          '',
          //  Its own workspace, so it does not try to join the repository's.
          '[workspace]',
        ].join('\n'),
      );

      //  rustc reports a line in the generated file, so as the file is
      //  assembled each of its lines is recorded against the line of markdown
      //  it came from. Without this a failure names a file nobody wrote.
      const origin = new Map<number, string>();
      const source: string[] = [
        '//! Generated from the documentation — edit the markdown, not this.',
        '#![allow(unused_imports)]',
        '',
      ];

      const emit = (block: Block, prologue: string[], body: string, epilogue: string[]): void => {
        source.push(...prologue);
        for (const [offset, line] of body.split('\n').entries()) {
          origin.set(source.length + 1, `${block.file}:${block.line + offset + 1}`);
          source.push(line);
        }
        source.push(...epilogue, '');
      };

      for (const [index, block] of blocks.entries()) {
        const name = symbol(block, index);
        if (block.standalone) {
          //  A whole program cannot be nested, so it keeps its own module and
          //  loses both the runtime attribute and the name `main`, neither of
          //  which a library crate can carry.
          emit(
            block,
            ['#[allow(unused, clippy::all)]', `mod ${name} {`],
            block.code.replace(/#\[tokio::main\]\n/g, '\n').replace(/\bfn main\b/, `fn ${name}`),
            ['}'],
          );
          continue;
        }
        emit(
          block,
          [
            '#[allow(unused_variables, unused_imports, dead_code, unused_mut, unreachable_code)]',
            `async fn ${name}(${RUST_PARAMETERS}) -> Result<(), uarp_sdk::Error> {`,
            //  Two names the prose introduces before the fragment uses them.
            '    use std::time::Duration;',
            '    use uarp_sdk::StreamOptions;',
          ],
          block.code,
          ['    Ok(())', '}'],
        );
      }

      writeFileSync(join(workspace, 'src', 'lib.rs'), source.join('\n') + '\n');

      return {
        //  Kept out of the repository's target directory: a doc check should
        //  not invalidate a developer's incremental build.
        command: 'cargo',
        args: ['check', '--quiet', '--manifest-path', join(workspace, 'Cargo.toml')],
        locate: (output) =>
          output.replace(/src\/lib\.rs:(\d+)(:\d+)?/g, (whole, line: string) => origin.get(Number(line)) ?? whole),
      };
    },
  },
};

function present(tool: string): boolean {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn a generated symbol back into the file and line a person can edit.
 *
 * The compilers name the generated unit, which nobody wrote. Both spell the
 * symbol the same way, so one substitution serves both.
 */
function locate(output: string): string {
  return output.replace(/([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*_md)_(\d+)_\d+/g, (_, file: string, line: string) => {
    const path = file.replace(/_md$/, '').replace(/_/g, '/');
    return `${path}.md:${line}`;
  });
}

function check(id: string, language: Language): boolean {
  if (!present(language.tool)) {
    console.log(`check-docs: ${id} skipped — ${language.tool} is not installed`);
    return true;
  }

  const blocks = language.sources.flatMap((file) => extract(file, language));
  if (blocks.length === 0) {
    console.error(`check-docs: ${id} found no \`\`\`${language.fence} blocks — has the fence changed?`);
    return false;
  }

  const workspace = mkdtempSync(join(tmpdir(), `uarp-docs-${id}-`));
  const prepared = language.prepare(workspace, blocks);

  try {
    execFileSync(prepared.command, prepared.args, { cwd: workspace, encoding: 'utf8', stdio: 'pipe' });
    console.log(`check-docs: ${id} — ${blocks.length} samples compile`);
    rmSync(workspace, { recursive: true, force: true });
    return true;
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    const output = [details.stdout, details.stderr].filter(Boolean).join('\n');
    console.error(locate(prepared.locate ? prepared.locate(output) : output));
    console.error(`\ncheck-docs: ${id} — a documented sample does not compile.`);
    console.error(`workspace kept for inspection: ${workspace}`);
    return false;
  }
}

const wanted = process.argv.slice(2);
const chosen = Object.entries(LANGUAGES).filter(([id]) => wanted.length === 0 || wanted.includes(id));
if (chosen.length === 0) {
  console.error(`check-docs: nothing matched. Known languages: ${Object.keys(LANGUAGES).join(', ')}`);
  process.exit(2);
}

//  Every language runs even after one fails — a report that stops at the first
//  problem makes a person fix the documentation one error per commit.
const ok = chosen.map(([id, language]) => check(id, language)).every(Boolean);
process.exit(ok ? 0 : 1);
