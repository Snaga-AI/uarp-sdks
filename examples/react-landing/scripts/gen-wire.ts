/**
 * Build-time generator for `/docs/wire`.
 *
 * The contract suite (`apps/sdk/contract`) proves the five SDKs put the same
 * bytes on the wire for the same logical request. This generator turns the two
 * source-of-truth artifacts — `contract/SCENARIOS.md` (the 16-row table and its
 * prose) and the five per-language runners — into `public/wire.json` so the wire
 * page renders them without drifting from the contract.
 *
 * Each runner performs the same 16 calls in the same order, and each call is
 * preceded by a comment marker `// N. …` (Ada: `--  N. …`). We split a runner
 * on those markers into one snippet per scenario. The last scenario is cut at
 * the trailing `… runner done` print line so the snippet does not carry the
 * runner's epilogue; the marker line itself is dropped, since the scenario card
 * already carries the title. Everything here is read from the real files —
 * nothing is written from memory.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '../../..');
const contractRoot = resolve(sdkRoot, 'contract');

const RUNNERS: Record<string, string> = {
  ts: resolve(contractRoot, 'runners/typescript.ts'),
  rust: resolve(sdkRoot, 'packages/rust/examples/contract.rs'),
  swift: resolve(sdkRoot, 'packages/swift/Sources/UARPContract/main.swift'),
  kotlin: resolve(sdkRoot, 'packages/kotlin/uarp-sdk/src/test/kotlin/ai/snaga/uarp/ContractRunner.kt'),
  ada: resolve(sdkRoot, 'packages/ada/examples/src/contract.adb'),
};

const MARKER = /^\s*(?:\/\/|--)\s*(\d{1,2})\.\s+.+$/;
const DONE = /runner done/i;

export interface WireScenario {
  num: number;
  call: string;
  pins: string;
  samples: Record<string, string>;
}

export interface WireSection {
  title: string;
  body: string;
}

export interface WireData {
  totalRequests: number;
  scenarios: WireScenario[];
  sections: WireSection[];
}

/** Strip a single layer of surrounding backticks, preserving inner backticks. */
function unbacktick(s: string): string {
  const t = s.trim();
  if (t.startsWith('`') && t.endsWith('`') && t.length > 2) return t.slice(1, -1);
  return t;
}

function parseScenarios(md: string): { scenarios: { num: number; call: string; pins: string }[]; totalRequests: number } {
  const scenarios: { num: number; call: string; pins: string }[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(\d{1,2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (!m) continue;
    const num = Number(m[1]);
    if (num < 1 || num > 16) continue;
    scenarios.push({ num, call: unbacktick(m[2]), pins: m[3].trim() });
  }
  scenarios.sort((a, b) => a.num - b.num);
  const total = md.match(/Total:\s*\*\*(\d+)\s*requests\*\*/i);
  return { scenarios, totalRequests: total ? Number(total[1]) : scenarios.length };
}

function parseSections(md: string): WireSection[] {
  //  The front matter before the first `## ` is the intro; the rest are the
  //  named sections, kept verbatim so the normalisation rules and the recorded
  //  bigint difference stay drift-free against the source document.
  const parts = md.split(/^## /m);
  const sections: WireSection[] = [];
  for (let i = 1; i < parts.length; i++) {
    const [titleLine, ...rest] = parts[i].split('\n');
    const body = rest.join('\n').trim();
    if (titleLine.trim()) sections.push({ title: titleLine.trim(), body });
  }
  return sections;
}

/** Split one runner file into a { num -> snippet } map. */
function splitRunner(path: string): Record<number, string> {
  const lines = readFileSync(path, 'utf8').split('\n');
  const marks: { num: number; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER);
    if (m) marks.push({ num: Number(m[1]), line: i });
  }
  const out: Record<number, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].line + 1; // drop the marker line itself
    let end: number;
    if (i + 1 < marks.length) {
      end = marks[i + 1].line;
    } else {
      //  Last scenario: cut at the trailing `… runner done` epilogue, if any.
      const done = lines.findIndex((l, idx) => idx >= start && DONE.test(l));
      end = done === -1 ? lines.length : done;
    }
    const snippet = lines
      .slice(start, end)
      .join('\n')
      .trimEnd();
    out[marks[i].num] = snippet.replace(/^\n+/, '');
  }
  return out;
}

export function generateWire(): WireData {
  const md = readFileSync(resolve(contractRoot, 'SCENARIOS.md'), 'utf8');
  const { scenarios, totalRequests } = parseScenarios(md);
  const sections = parseSections(md);

  const perRunner: Record<string, Record<number, string>> = {};
  for (const [lang, path] of Object.entries(RUNNERS)) perRunner[lang] = splitRunner(path);

  const withSamples: WireScenario[] = scenarios.map((s) => {
    const samples: Record<string, string> = {};
    for (const lang of Object.keys(RUNNERS)) samples[lang] = perRunner[lang][s.num] ?? '';
    return { num: s.num, call: s.call, pins: s.pins, samples };
  });

  return { totalRequests, scenarios: withSamples, sections };
}

export function writeWireIfChanged(): void {
  const data = generateWire();
  const out = resolve(here, '../public/wire.json');
  const json = JSON.stringify(data, null, 2) + '\n';
  let existing: string | null = null;
  try {
    existing = readFileSync(out, 'utf8');
  } catch {
    existing = null;
  }
  if (existing !== json) {
    writeFileSync(out, json);
    console.log(`[uarp-wire] wrote ${out} (${data.scenarios.length} scenarios)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = generateWire();
  console.log(`${data.scenarios.length} scenarios, ${data.totalRequests} requests, ${data.sections.length} sections`);
}