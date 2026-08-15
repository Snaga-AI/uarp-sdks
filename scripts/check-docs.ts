/**
 * Type-check the TypeScript samples in the documentation.
 *
 * Every documentation error found in this repository was the same shape: a
 * sample that no longer matched the code, with nothing to notice. The samples
 * read fine — `event.text` looks exactly as plausible as `event.payload.delta`.
 * Only a compiler can tell them apart.
 *
 * So every fenced ```` ```ts ```` block is extracted and compiled against the
 * package sources. Nothing has to be marked up: imports are lifted to the top
 * and the rest of the sample is wrapped in a function, which is what lets a
 * snippet lean on a `client` the prose introduced earlier while a sample that
 * builds its own still compiles.
 *
 *   node scripts/check-docs.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose TypeScript blocks must compile. */
const SOURCES = ['README.md', 'packages/typescript/README.md'];

/**
 * Declarations a sample may lean on without introducing them.
 *
 * Documentation is written for a reader who has the surrounding prose, so a
 * snippet says `client` and means the one built two paragraphs earlier. Each
 * block is compiled inside a function, which lets a sample that does build its
 * own client shadow this one legally — so the same preamble serves both kinds
 * and nothing has to be marked up.
 */
const PREAMBLE = `
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

interface Block {
  file: string;
  line: number;
  code: string;
}

function blocks(file: string): Block[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  const found: Block[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (!/^```ts\s*$/.test(lines[index]!)) continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && lines[end] !== '```') end++;
    found.push({ file, line: start, code: lines.slice(start, end).join('\n') });
    index = end;
  }
  return found;
}

function main(): void {
  const all = SOURCES.flatMap(blocks);
  if (all.length === 0) {
    console.error('check-docs: no TypeScript blocks found — has the fence syntax changed?');
    process.exit(1);
  }

  const workspace = mkdtempSync(join(tmpdir(), 'uarp-docs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });

  //  Compiled against the package's own build output, so the check moves with
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
        //  The workspace is a temporary directory with no node_modules of its
        //  own, so both the type roots and the package itself are pointed at
        //  the real ones.
        typeRoots: [resolve(ROOT, 'packages/typescript/node_modules/@types')],
        paths: { 'uarp-sdk': [resolve(ROOT, 'packages/typescript/src/index.ts')] },
      },
      include: ['src'],
    }),
  );

  for (const [index, block] of all.entries()) {
    const name = `${block.file.replace(/[^\w]/g, '_')}_${block.line}_${index}.ts`;
    //  Imports have to be at the top of a module, so they are lifted out and
    //  the rest of the sample goes inside the function.
    const lines = block.code.split('\n');
    const imports = lines.filter((line) => /^\s*import\s/.test(line));
    const rest = lines.filter((line) => !/^\s*import\s/.test(line));
    //  A sample that constructs a client without importing the class is
    //  leaning on the import in the sample above it, the way a reader does.
    const needsClass = /\bnew UarpClient\b/.test(block.code) && !/import[^;]*\bUarpClient\b/.test(block.code);
    const classDecl = needsClass ? "declare const UarpClient: typeof import('uarp-sdk').UarpClient;\n" : '';
    const source = `${PREAMBLE}\n${classDecl}${imports.join('\n')}\nasync function sample(): Promise<void> {\n${rest.join('\n')}\n}\nvoid sample;\n`;
    writeFileSync(join(workspace, 'src', name), source);
  }

  console.log(`check-docs: ${all.length} TypeScript blocks from ${SOURCES.length} files`);

  try {
    execFileSync(
      resolve(ROOT, 'packages/typescript/node_modules/.bin/tsc'),
      ['-p', workspace],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    console.log('check-docs: every sample type-checks');
    rmSync(workspace, { recursive: true, force: true });
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    const output = [details.stdout, details.stderr].filter(Boolean).join('\n');
    //  Map the temporary file name back to the file and line a person can edit.
    console.error(
      //  tsc reports the temporary file; a person needs the markdown file and
      //  the line the sample starts on.
      output.replace(/\S*src[/\\]([\w]+)_(\d+)_\d+\.ts\((\d+),\d+\)/g, (_, file: string, line: string) => {
        const original = file.replace(/_md$/, '.md').replace(/_/g, '/').replace('/md', '.md');
        return `${original}:${line}`;
      }),
    );
    console.error('\ncheck-docs: a documented sample does not compile.');
    console.error(`workspace kept for inspection: ${workspace}`);
    process.exit(1);
  }
}

main();
