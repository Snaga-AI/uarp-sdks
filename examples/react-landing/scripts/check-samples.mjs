/** Compile the actual displayed samples. No production requests are made. */
import ts from 'typescript';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import * as content from '../src/docs/content.ts';
import { QUICKSTART } from '../src/docs/quickstarts.ts';
import { usageSnippet } from '../src/docs/usage.ts';
import { writeReferenceIfChanged } from './gen-reference.ts';
const portal = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(portal, '../..');
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
if (version !== '0.13.6') throw new Error(`Re-audit examples for SDK ${version}`);
const workspace = process.env.DOCS_CHECK_DIR ?? mkdtempSync(join(tmpdir(), 'uarp-portal-samples-'));
const samples = [];
for (const [name, values] of Object.entries(content)) if (typeof values?.ts === 'string') {
  for (const [language, code] of Object.entries(values)) samples.push({ name, language, code, program: false });
}
for (const [language, code] of Object.entries(QUICKSTART)) samples.push({ name: 'quickstart', language, code, program: true });
for (const file of ['src/content/guides.tsx', 'src/content/concepts.tsx']) {
  const source = ts.createSourceFile(file, readFileSync(join(portal, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let index = 0;
  function walk(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const props = Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(source), prop.initializer]));
      if (props.kind?.text === 'code' && props.language?.text === 'ts' && typeof props.code?.text === 'string') samples.push({ name: `${file.includes('guides') ? 'guide' : 'concept'}_${index++}`, language: 'ts', code: props.code.text, program: false });
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Code') {
      const language = node.openingElement.attributes.properties.find(prop => prop.name?.getText(source) === 'language')?.initializer?.text ?? 'ts';
      for (const child of node.children) if (language === 'ts' && ts.isJsxExpression(child) && typeof child.expression?.text === 'string') samples.push({ name: `concept_${index++}`, language: 'ts', code: child.expression.text, program: false });
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
}
// Include SDK README examples as well; build-file fragments are configuration, not programs.
for (const language of ['swift', 'kotlin', 'ada']) {
  let ordinal = 0;
  for (const file of [join(root, 'README.md'), join(root, `packages/${language}/README.md`)]) {
    const markdown = readFileSync(file, 'utf8');
    const fence = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g');
    for (const match of markdown.matchAll(fence)) {
      const code = match[1];
      if (code.includes('// Package.swift') || /^dependencies\s*\{/.test(code)) continue;
      if (language === 'ada' && !/procedure \w+ is/.test(code)) continue; // Non-program Ada fragments document declaration/statement placement.
      samples.push({ name: `readme_${ordinal++}`, language, code, program: language === 'kotlin' && /fun main\(/.test(code) || language === 'ada' });
    }
  }
}
// Never validate yesterday's reference after changing a generated SDK method.
writeReferenceIfChanged();
const reference = JSON.parse(readFileSync(join(portal, 'public/reference.json'), 'utf8'));
for (const group of reference.groups) for (const method of group.methods) samples.push({ name: `${group.accessor}_${method.name}`, language: 'ts', code: usageSnippet(group.accessor, method), method, group: group.accessor, program: false });
const splitImports = (code, regex) => ({ imports: code.split('\n').filter(line => regex.test(line)).join('\n'), body: code.split('\n').filter(line => !regex.test(line)).join('\n') });
const results = [];
let swiftBuild;
function run(language, cmd, args, cwd = workspace, env = {}) {
  console.log(`Checking ${language} (${samples.filter(sample => sample.language === language).length} displayed samples)…`);
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) { console.error(result.stdout, result.stderr); throw new Error(`${language} check failed. Workspace: ${workspace}`); }
  results.push({ language, samples: samples.filter(sample => sample.language === language).length, status: 'compiled' });
}
const execute = process.argv.includes('--run');
const wanted = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const languages = ['ts', 'python', 'rust', 'swift', 'kotlin', 'ada'];
for (const language of wanted) if (!languages.includes(language)) throw new Error(`Unknown language: ${language}`);
const wants = id => !wanted.length || wanted.includes(id);
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, 'inventory.json'), JSON.stringify(samples, null, 2));
console.log(`Workspace: ${workspace}`);
if (wants('ts')) {
  // Compile this checkout, not the last published npm package: API changes in
  // a PR must break documentation CI before they can ship.
  const build = spawnSync(join(portal, 'node_modules/.bin/tsc'), ['-p', join(root, 'packages/typescript/tsconfig.build.json')], { encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`TypeScript SDK build failed: ${build.stdout}\n${build.stderr}`);
  const dir = join(workspace, 'ts'); mkdirSync(dir, { recursive: true });
  for (const sample of samples.filter(sample => sample.language === 'ts')) {
    if (sample.program) { writeFileSync(join(dir, `${sample.name}.ts`), sample.code); continue; }
    const { imports, body } = splitImports(sample.code, /^import /);
    const context = sample.method ? sample.method.params.filter(param => param.name !== 'options').map(param => `declare const ${param.name}: Parameters<DocsClient['${sample.group}']['${sample.method.name}']>[${sample.method.params.indexOf(param)}];`).join('\n') : `
declare const id: string, agentId: string, publishedAgentId: string, teamId: string, runId: string, requestId: string, message: string;
declare const controller: AbortController;
declare const run: Awaited<ReturnType<DocsClient['runs']['create']>>;
declare const body: Parameters<DocsClient['agents']['create']>[0];
declare const request: Parameters<DocsClient['agents']['create']>[0];
declare const res: import('node:http').ServerResponse;
`;
    writeFileSync(join(dir, `${sample.name}.ts`), `import type { UarpClient as DocsClient } from 'uarp-sdk';\n${imports}\ndeclare const client: DocsClient;\n${context}\nasync function sample() {\n${body}\n}\nexport {};`);
  }
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: ['node'], typeRoots: [join(portal, 'node_modules/@types')], paths: { 'uarp-sdk': [join(root, 'packages/typescript/dist/index.d.ts')] } }, include: ['*.ts'] }));
  run('ts', join(portal, 'node_modules/.bin/tsc'), ['-p', dir]);
}
if (wants('python')) {
  const dir = join(workspace, 'python'); mkdirSync(dir, { recursive: true });
  for (const sample of samples.filter(sample => sample.language === 'python')) {
    const { imports, body } = splitImports(sample.code, /^(from|import) /);
    const code = sample.program ? sample.code : `from uarp_sdk import Client\nfrom uarp_sdk.models import CreateAgentRequest\n${imports}\n\ndef sample(client: Client, run_id: str, agent_id: str, base: str, request_id: str, request: CreateAgentRequest) -> None:\n${body.split('\n').map(line => '    ' + line).join('\n')}\n`;
    writeFileSync(join(dir, `${sample.name}.py`), code);
  }
  run('python', join(root, 'packages/python/.venv/bin/python'), ['-m', 'mypy', '--strict', '--no-incremental', dir]);
}
if (wants('rust')) {
  const dir = join(workspace, 'rust'); mkdirSync(join(dir, 'src/bin'), { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname="uarp-portal-samples"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nuarp-sdk={path=${JSON.stringify(join(root,'packages/rust'))},version="=0.13.6"}\ntokio={version="1",features=["macros","rt-multi-thread"]}\nfutures-util="0.3"\nserde_json="1"\n[workspace]\n`);
  for (const sample of samples.filter(sample => sample.language === 'rust')) {
    if (sample.program) writeFileSync(join(dir, 'src/bin/quickstart.rs'), sample.code);
    else writeFileSync(join(dir, `src/${sample.name.toLowerCase()}.rs`), `#[allow(unused, unreachable_code)]\nasync fn sample(client: uarp_sdk::Client, agent_id: String, run_id: String, id: &str, key: String, base: String, body: uarp_sdk::models::CreateAgentRequest) -> Result<(), uarp_sdk::Error> {\n${sample.code}\nOk(())\n}`);
  }
  writeFileSync(join(dir, 'src/lib.rs'), samples.filter(sample => sample.language === 'rust' && !sample.program).map(sample => `mod ${sample.name.toLowerCase()};`).join('\n'));
  run('rust', 'cargo', ['check', '--quiet', '--all-targets'], dir, { CARGO_TARGET_DIR: join(root, 'packages/rust/target') });
}
if (wants('swift')) {
  const dir = join(workspace, 'swift'); mkdirSync(dir, { recursive: true });
  const runtime = join(dir, 'runtime'); mkdirSync(join(runtime, 'Sources/Quickstart'), { recursive: true });
  writeFileSync(join(runtime, 'Package.swift'), `// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "DocsExamples", platforms: [.macOS(.v12)], dependencies: [.package(path: ${JSON.stringify(join(root, 'packages/swift'))})], targets: [.executableTarget(name: "Quickstart", dependencies: [.product(name: "UARPSDK", package: "swift")])])\n`);
  writeFileSync(join(runtime, 'Sources/Quickstart/Quickstart.swift'), QUICKSTART.swift);
  // SwiftPM handles both traditional and Xcode build layouts and links the
  // actual checkout. Do not assume an automatic library emits libUARPSDK.a.
  const build = spawnSync('swift', ['build', '--package-path', runtime, '--jobs', '2'], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Swift Quickstart build failed');
  const location = spawnSync('swift', ['build', '--package-path', runtime, '--show-bin-path'], { encoding: 'utf8' });
  if (location.status !== 0) throw new Error(location.stderr);
  swiftBuild = location.stdout.trim();
  const sdkModules = existsSync(join(swiftBuild, 'Modules')) ? join(swiftBuild, 'Modules') : swiftBuild;
  const files = [];
  for (const sample of samples.filter(sample => sample.language === 'swift')) {
    const file = join(dir, `${sample.name}.swift`); files.push(file);
    const { imports, body } = splitImports(sample.code, /^import /);
    writeFileSync(file, sample.program ? sample.code : `${imports}\nfunc sample_${sample.name}(client: UARPClient, agentId: String, id: String, runId: String, base: URL, key: String, request: CreateAgentRequest) async throws {\n${body}\n}`);
  }
  run('swift', 'swiftc', ['-typecheck', '-parse-as-library', '-I', sdkModules, ...files]);
}
if (wants('kotlin')) {
  const dir = join(workspace, 'kotlin'); mkdirSync(join(dir, 'src/main/kotlin'), { recursive: true });
  writeFileSync(join(dir, 'settings.gradle.kts'), `rootProject.name = "uarp-portal-samples"\nincludeBuild(${JSON.stringify(join(root, 'packages/kotlin'))}) {\n  dependencySubstitution { substitute(module("ai.snaga:uarp-sdk")).using(project(":uarp-sdk")) }\n}\n`);
  writeFileSync(join(dir, 'build.gradle.kts'), `plugins { kotlin("jvm") version "2.2.0"; application }\nrepositories { mavenCentral() }\ndependencies { implementation("ai.snaga:uarp-sdk:0.13.6"); implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0") }\napplication { mainClass.set("QuickstartKt") }\n`);
  for (const sample of samples.filter(sample => sample.language === 'kotlin')) {
    const { imports, body } = splitImports(sample.code, /^import /);
    writeFileSync(join(dir, `src/main/kotlin/${sample.name === 'quickstart' ? 'Quickstart' : sample.name}.kt`), sample.program ? (sample.name === 'quickstart' ? sample.code : `package audit.${sample.name.toLowerCase()}\n${sample.code}`) : `package audit.${sample.name.toLowerCase()}\n${imports}\nsuspend fun sample(client: ai.snaga.uarp.UarpClient, id: String, agentId: String, runId: String, base: String, key: String, model: String, prompt: String, myOkHttpClient: okhttp3.OkHttpClient, request: ai.snaga.uarp.models.CreateAgentRequest) {\n${body}\n}`);
  }
  run('kotlin', join(root, 'packages/kotlin/gradlew'), ['-p', dir, 'classes', '--console=plain', '--no-daemon']);
}
if (wants('ada')) {
  const dir = join(workspace, 'ada'); mkdirSync(dir, { recursive: true });
  const selected = samples.filter(sample => sample.language === 'ada');
  for (const sample of selected) {
    const folder = join(dir, sample.name.toLowerCase()); mkdirSync(folder, { recursive: true });
    const unit = sample.code.match(/procedure (\w+) is/i)?.[1]?.toLowerCase();
    if (!unit) throw new Error(`Ada sample ${sample.name} must be a complete procedure`);
    writeFileSync(join(folder, `${unit}.adb`), sample.code);
    writeFileSync(join(folder, 'sample.gpr'), `with "gnatcoll_core.gpr";\nproject Sample is\nfor Languages use ("Ada", "C");\nfor Source_Dirs use (".", "${join(root, 'packages/ada/src')}", "${join(root, 'packages/ada/src/generated')}", "${join(root, 'packages/ada/csrc')}");\nfor Object_Dir use "obj";\nfor Exec_Dir use "bin";\nfor Main use ("${unit}.adb");\npackage Compiler is for Default_Switches ("Ada") use ("-gnat2022", "-O0"); end Compiler;\npackage Linker is for Default_Switches ("Ada") use ("-lcurl"); end Linker;\nend Sample;\n`);
    console.log(`Checking ada ${sample.name}…`);
    const result = spawnSync('alr', ['exec', '--', 'gprbuild', '-q', '-p', '-c', '-u', '-P', join(folder, 'sample.gpr'), `${unit}.adb`, '-cargs:Ada', '-gnatc'], { cwd: join(root, 'packages/ada'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) { console.error(result.stdout, result.stderr); throw new Error(`Ada ${sample.name} failed. Workspace: ${workspace}`); }
  }
  results.push({ language: 'ada', samples: selected.length, status: 'type-checked' });
}
if (execute) {
  const requests = [];
  const fixture = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const path = new URL(req.url, 'http://localhost').pathname;
    requests.push({ method: req.method, path });
    if (req.headers.authorization !== 'Bearer docs-fixture-key') { res.writeHead(401).end(); return; }
    if (req.method === 'POST' && path === '/api/v1/runs') {
      const input = JSON.parse(body);
      if (input.agent_id !== 'docs-agent' || input.input?.message !== 'Summarise the last deploy.') { res.writeHead(422).end(body); return; }
    } else if (req.method !== 'GET' || path !== '/api/v1/runs/docs-run/wait') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ run_id: 'docs-run', tenant_id: 'docs-tenant', agent_id: 'docs-agent', status: 'completed', created_at: '2026-11-14T00:00:00Z', output: { response: 'docs fixture ok' } }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  const env = { ...process.env, UARP_API_KEY: 'docs-fixture-key', UARP_AGENT_ID: 'docs-agent', UARP_BASE_URL: `http://127.0.0.1:${address.port}`, CARGO_TARGET_DIR: join(root, 'packages/rust/target') };
  const asyncCommand = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const process = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', chunk => { stdout += chunk; });
    process.stderr.on('data', chunk => { stderr += chunk; });
    process.on('error', reject);
    process.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${cmd}: ${stderr} ${stdout}`)));
  });
  try {
    for (const result of results) {
      console.log(`Building and executing ${result.language} Quickstart against the local fixture…`);
      let output;
      if (result.language === 'ts') {
        const modules = join(workspace, 'ts/node_modules'); mkdirSync(modules, { recursive: true });
        if (!existsSync(join(modules, 'uarp-sdk'))) symlinkSync(join(root, 'packages/typescript'), join(modules, 'uarp-sdk'));
        writeFileSync(join(workspace, 'ts/quickstart.mjs'), QUICKSTART.ts);
        output = await asyncCommand('node', [join(workspace, 'ts/quickstart.mjs')], workspace);
      } else if (result.language === 'python') output = await asyncCommand(join(root, 'packages/python/.venv/bin/python'), [join(workspace, 'python/quickstart.py')], workspace);
      else if (result.language === 'rust') output = await asyncCommand('cargo', ['run', '--quiet', '--bin', 'quickstart'], join(workspace, 'rust'));
      else if (result.language === 'swift') {
        output = await asyncCommand(join(swiftBuild, 'Quickstart'), [], workspace);
      } else if (result.language === 'kotlin') output = await asyncCommand(join(root, 'packages/kotlin/gradlew'), ['-p', join(workspace, 'kotlin'), 'run', '--quiet', '--no-daemon'], workspace);
      else if (result.language === 'ada') {
        await asyncCommand('alr', ['exec', '--', 'gprbuild', '-q', '-p', '-j2', '-P', join(workspace, 'ada/quickstart/sample.gpr')], join(root, 'packages/ada'));
        output = await asyncCommand(join(workspace, 'ada/quickstart/bin/quickstart'), [], workspace);
      }
      if (!output.includes('docs fixture ok')) throw new Error(`${result.language} did not print the fixture result: ${output}`);
      result.quickstart = 'executed against local fixture';
      console.log(`${result.language} Quickstart executed successfully`);
    }
    if (requests.length !== results.length * 2) throw new Error(`Unexpected fixture call count: ${requests.length}`);
  } finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
}
writeFileSync(join(workspace, 'results.json'), JSON.stringify({ sdkVersion: version, results }, null, 2));
console.log(JSON.stringify({ sdkVersion: version, results, workspace }));
