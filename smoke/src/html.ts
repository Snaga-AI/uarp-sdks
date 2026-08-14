/**
 * Render a run as a page a backend team can work from.
 *
 * The Markdown report is for reading top to bottom; this one is for working:
 * severity is encoded in form as well as words, the serious findings sit above
 * the fold, and the six hundred cosmetic notes stay collapsed until wanted.
 *
 *   node smoke/src/html.ts --in smoke/out/BACKEND-REPORT.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CallRecord } from './run.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

interface Finding {
  id: string;
  level: 'blocker' | 'major' | 'minor' | 'info';
  category: string;
  title: string;
  impact: string;
  suggestion: string;
  evidence: string[];
  operations: string[];
}

interface Results {
  spec: { title: string; version: string };
  baseURL: string;
  runId: string;
  finishedAt: string;
  totalOperations: number;
  skippedStreams: { operationId: string; path: string; reason: string }[];
  created: { path: string; name: string; value: string }[];
  records: CallRecord[];
}

const LEVELS = ['blocker', 'major', 'minor', 'info'] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_LABEL: Record<Level, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
  info: 'Note',
};

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turn the `\`GET /path\`` spans the findings use into real markup. */
function code(text: string): string {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function route(operation: string): string {
  const cleaned = operation.replace(/`/g, '');
  const [method, ...rest] = cleaned.split(' ');
  return `<span class="route"><span class="verb verb-${(method ?? '').toLowerCase()}">${escape(method ?? '')}</span>${escape(rest.join(' '))}</span>`;
}

const STYLE = `
/*  Tokens carry both themes. Nothing below sets a colour any other way: a
    value defined only inside a media query never applies in the default
    "system" state, which is what most readers are in.  */
:root {
  --paper: #f4f6f4;
  --surface: #ffffff;
  --sunken: #eceff0;
  --ink: #171b1a;
  --muted: #5b6462;
  --faint: #8a9391;
  --rule: #dbe0dd;
  --signal: #0f6f64;
  --blocker: #a83527;
  --major: #9a6413;
  --minor: #5b6462;
  --info: #8a9391;
  --shadow: 0 1px 2px rgb(23 27 26 / 6%);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #101312;
    --surface: #171b1a;
    --sunken: #1d2221;
    --ink: #e6ebe8;
    --muted: #9aa4a1;
    --faint: #6d7876;
    --rule: #262d2b;
    --signal: #3fbdac;
    --blocker: #e87a68;
    --major: #d9a44c;
    --minor: #9aa4a1;
    --info: #6d7876;
    --shadow: none;
  }
}
:root[data-theme="dark"] {
  --paper: #101312;
  --surface: #171b1a;
  --sunken: #1d2221;
  --ink: #e6ebe8;
  --muted: #9aa4a1;
  --faint: #6d7876;
  --rule: #262d2b;
  --signal: #3fbdac;
  --blocker: #e87a68;
  --major: #d9a44c;
  --minor: #9aa4a1;
  --info: #6d7876;
  --shadow: none;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.wrap {
  max-width: 62rem;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 6rem;
  display: flex;
  flex-direction: column;
  gap: 3.5rem;
}

/*  Monospace is the display voice: the whole subject is paths, verbs and
    status codes, and setting the structure in the same face as the data keeps
    the page in the world it describes.  */
.mono, code, th, .verb, .stat-value, .id, .eyebrow {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

header { display: flex; flex-direction: column; gap: 1rem; }

.eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.25rem;
}

h1 {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
  margin: 0;
  text-wrap: balance;
}

.lede { margin: 0; max-width: 62ch; color: var(--muted); font-size: 1.05rem; }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
  border-radius: 3px;
  overflow: hidden;
}
.stat { background: var(--surface); padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.15rem; }
.stat-value { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { font-size: 0.78rem; color: var(--muted); }
.stat[data-level="blocker"] .stat-value { color: var(--blocker); }
.stat[data-level="major"] .stat-value { color: var(--major); }

section { display: flex; flex-direction: column; gap: 1.25rem; }

h2 {
  font-size: 0.8rem;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--signal);
  margin: 0;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--rule);
}

p { margin: 0; max-width: 68ch; }
.prose { display: flex; flex-direction: column; gap: 0.9rem; }

/*  Start here: the list that decides whether the rest gets read.  */
.priority { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; }
.priority li { background: var(--surface); padding: 0.7rem 1rem; display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
.priority .id { font-size: 0.78rem; color: var(--faint); }
.priority .what { flex: 1 1 18rem; }
.priority .where { color: var(--muted); font-size: 0.85rem; }

.dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex: none; align-self: center; }
.dot-blocker { background: var(--blocker); }
.dot-major { background: var(--major); }

/*  Each category is one problem explained once, then every place it occurs.  */
.group {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--level, var(--rule));
  border-radius: 3px;
  box-shadow: var(--shadow);
}
.group[data-level="blocker"] { --level: var(--blocker); }
.group[data-level="major"] { --level: var(--major); }
.group[data-level="minor"] { --level: var(--minor); }
.group[data-level="info"] { --level: var(--info); }

.group > summary {
  cursor: pointer;
  padding: 1rem 1.25rem;
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  flex-wrap: wrap;
  list-style: none;
}
.group > summary::-webkit-details-marker { display: none; }
.group > summary::after { content: "+"; margin-left: auto; color: var(--faint); font-family: ui-monospace, monospace; }
.group[open] > summary::after { content: "\\2212"; }
.group > summary:focus-visible { outline: 2px solid var(--signal); outline-offset: -2px; }

.pill {
  font-size: 0.7rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 0.15rem 0.45rem;
  border-radius: 2px;
  color: var(--level, var(--muted));
  border: 1px solid currentColor;
  font-family: ui-monospace, monospace;
  flex: none;
}
.group-title { font-weight: 600; flex: 1 1 20rem; }
.count { color: var(--faint); font-size: 0.85rem; font-variant-numeric: tabular-nums; }

.body { padding: 0 1.25rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; border-top: 1px solid var(--rule); padding-top: 1rem; }
.fix { color: var(--muted); }
.fix strong { color: var(--ink); font-weight: 600; }

.scroll { overflow-x: auto; border: 1px solid var(--rule); border-radius: 3px; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.55rem 0.8rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-size: 0.72rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); font-weight: 500; background: var(--sunken); }
tr:last-child td { border-bottom: none; }
td.id { color: var(--faint); font-size: 0.8rem; white-space: nowrap; font-variant-numeric: tabular-nums; }

.route { display: inline-flex; gap: 0.4rem; align-items: baseline; font-family: ui-monospace, monospace; font-size: 0.82rem; white-space: nowrap; }
.verb { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.04em; color: var(--muted); }
.verb-get { color: var(--signal); }
.verb-post, .verb-put, .verb-patch { color: var(--major); }
.verb-delete { color: var(--blocker); }
.routes { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; }

code { background: var(--sunken); padding: 0.1em 0.35em; border-radius: 2px; font-size: 0.88em; }
pre { margin: 0; padding: 0.8rem 1rem; background: var(--sunken); border-radius: 3px; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
pre code { background: none; padding: 0; }

details.evidence > summary { cursor: pointer; font-size: 0.82rem; color: var(--signal); font-family: ui-monospace, monospace; }
details.evidence { display: flex; flex-direction: column; gap: 0.5rem; }

footer { color: var(--faint); font-size: 0.82rem; border-top: 1px solid var(--rule); padding-top: 1.5rem; }

@media (prefers-reduced-motion: no-preference) {
  .group { transition: border-color 120ms ease; }
}
`;

function statTiles(results: Results, findings: Finding[]): string {
  const ran = results.records.filter((r) => !r.skipped);
  const counts = Object.fromEntries(
    LEVELS.map((level) => [level, findings.filter((f) => f.level === level).length]),
  ) as Record<Level, number>;

  const tiles: [string, string | number, Level | ''][] = [
    ['operations documented', results.totalOperations, ''],
    ['called', ran.length, ''],
    ['blockers', counts.blocker, 'blocker'],
    ['major', counts.major, 'major'],
    ['minor', counts.minor, ''],
    ['held back', results.records.filter((r) => r.skipped).length, ''],
  ];

  return `<div class="stats">${tiles
    .map(
      ([label, value, level]) =>
        `<div class="stat"${level ? ` data-level="${level}"` : ''}><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`,
    )
    .join('')}</div>`;
}

function groupsFor(findings: Finding[], level: Level): string {
  const group = findings.filter((f) => f.level === level);
  if (group.length === 0) return '';

  //  Same grouping the Markdown uses: one explanation per kind of problem.
  const kinds = new Map<string, Finding[]>();
  for (const finding of group) {
    const key = `${finding.category} ${finding.impact}`;
    kinds.set(key, [...(kinds.get(key) ?? []), finding]);
  }

  const blocks = [...kinds.values()]
    .sort((a, b) => b.length - a.length)
    .map((entries) => {
      const first = entries[0]!;
      const open = level === 'blocker' || level === 'major' ? ' open' : '';
      const rows = entries
        .map(
          (finding) =>
            `<tr><td class="id">${escape(finding.id)}</td><td>${code(finding.title)}</td>` +
            `<td><div class="routes">${finding.operations.slice(0, 8).map(route).join('')}` +
            `${finding.operations.length > 8 ? `<span class="count">+${finding.operations.length - 8}</span>` : ''}</div></td></tr>`,
        )
        .join('');

      const evidence = entries
        .filter((finding) => finding.evidence.length > 0)
        .slice(0, 12)
        .map(
          (finding) =>
            `<details class="evidence"><summary>${escape(finding.id)} evidence</summary>` +
            `<pre><code>${escape(finding.evidence.join('\n'))}</code></pre></details>`,
        )
        .join('');

      return `<details class="group" data-level="${level}"${open}>
  <summary>
    <span class="pill">${LEVEL_LABEL[level]}</span>
    <span class="group-title">${escape(first.category)}</span>
    <span class="count">${entries.length}</span>
  </summary>
  <div class="body">
    <p>${escape(first.impact)}</p>
    <p class="fix"><strong>Fix.</strong> ${escape(first.suggestion)}</p>
    <div class="scroll"><table><thead><tr><th>Ref</th><th>Finding</th><th>Where</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${evidence}
  </div>
</details>`;
    })
    .join('\n');

  return `<section>
  <h2>${LEVEL_LABEL[level]} &mdash; ${group.length}</h2>
  ${blocks}
</section>`;
}

function render(results: Results, findings: Finding[]): string {
  const ran = results.records.filter((r) => !r.skipped);
  const quarantined = results.records.filter((r) => r.skipped);
  const succeeded = ran.filter((r) => r.status !== null && r.status >= 200 && r.status < 300);
  const speculative = ran.filter((r) => r.speculative);
  const blockedCreates = findings.filter((f) => f.category.startsWith('Constraints')).length;
  const serious = findings.filter((f) => f.level === 'blocker' || f.level === 'major');

  const statuses = new Map<string, number>();
  for (const record of ran) {
    const key = record.status === null ? 'none' : String(record.status);
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
  }

  const priority = serious
    .slice(0, 12)
    .map(
      (finding) =>
        `<li><span class="dot dot-${finding.level}"></span><span class="id">${escape(finding.id)}</span>` +
        `<span class="what">${code(finding.title)}</span>` +
        `<span class="where">${route(finding.operations[0] ?? '')}` +
        `${finding.operations.length > 1 ? ` +${finding.operations.length - 1}` : ''}</span></li>`,
    )
    .join('');

  return `<title>UARP Spec Drift</title>
<style>${STYLE}</style>
<div class="wrap">
  <header>
    <div class="eyebrow">
      <span>${escape(results.baseURL)}</span>
      <span>OpenAPI ${escape(results.spec.version)}</span>
      <span>${escape(results.finishedAt.slice(0, 16).replace('T', ' '))} UTC</span>
      <span>run smoke-${escape(results.runId)}</span>
    </div>
    <h1>Where the server and its OpenAPI document disagree</h1>
    <p class="lede">Every documented operation was called against the live API and every response
      checked against the schema that promised it. Requests carried the documented minimum &mdash;
      each property the schema marks required, nothing else &mdash; so a rejection means the endpoint
      enforces a rule the document never states.</p>
  </header>

  ${statTiles(results, findings)}

  <section>
    <h2>Start here</h2>
    <ul class="priority">${priority}</ul>
    ${serious.length > 12 ? `<p class="fix">${serious.length - 12} further major findings below.</p>` : ''}
  </section>

  ${LEVELS.map((level) => groupsFor(findings, level)).join('\n')}

  <section>
    <h2>What this run did not prove</h2>
    <div class="prose">
      <p>Of ${ran.length} calls, ${succeeded.length} returned a success. ${speculative.length} had to
        invent a path identifier because no resource of that kind existed to point at &mdash; those
        exercised the route, the authorisation check and the error shape, but never the endpoint
        doing its job.</p>
      <p>This is mostly one problem wearing many hats. ${blockedCreates} create endpoints rejected a
        body built strictly from their own schema, so nothing was created, so every read, update and
        delete beneath them had nothing to aim at. Fixing those &mdash; or documenting the constraints
        they enforce &mdash; would unlock most of the untested surface on the next run, with no other
        change.</p>
      <p>${new Set(ran.flatMap((r) => r.covered)).size} of the 52 named component schemas the paths
        reference were seen in a real response. Nothing is known about the rest.</p>
      <p>Statuses observed: ${[...statuses.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => `<code>${escape(status)}</code>&nbsp;&times;${count}`)
        .join(', ')}.</p>
    </div>
  </section>

  <section>
    <h2>Held back for review &mdash; ${quarantined.length}</h2>
    <p>Not called. Each one destroys the account, revokes the credential the run depends on, or
      changes state for every tenant &mdash; decisions a probe should not take on its own.</p>
    <div class="scroll"><table><thead><tr><th>Operation</th><th>Reason</th></tr></thead><tbody>${quarantined
      .map(
        (record) =>
          `<tr><td>${route(`${record.method} ${record.path}`)}</td><td>${escape(
            (record.skipped ?? '').replace('quarantined: ', ''),
          )}</td></tr>`,
      )
      .join('')}</tbody></table></div>
  </section>

  <footer>
    Generated by the UARP SDK live probe. Long-lived streams
    (${results.skippedStreams.length} endpoints) are covered by the per-language scenario instead.
  </footer>
</div>
`;
}

function main(): void {
  const argv = process.argv.slice(2);
  let findingsPath = resolve(ROOT, 'smoke/out/BACKEND-REPORT.json');
  let resultsPath = resolve(ROOT, 'smoke/out/results.json');
  let output = resolve(ROOT, 'smoke/out/backend-report.html');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') findingsPath = resolve(argv[++i]!);
    else if (argv[i] === '--results') resultsPath = resolve(argv[++i]!);
    else if (argv[i] === '--out') output = resolve(argv[++i]!);
  }

  const findings = JSON.parse(readFileSync(findingsPath, 'utf8')) as Finding[];
  const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as Results;
  writeFileSync(output, render(results, findings));
  console.log(`wrote ${output}`);
}

main();
