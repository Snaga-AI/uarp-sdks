/**
 * Turn a run into a document a backend team can act on.
 *
 * The audience is not the SDK author: it is whoever owns the API. So findings
 * are grouped by cause rather than by endpoint, each one says why it matters to
 * a caller, and identical problems across dozens of routes collapse into a
 * single entry with the routes listed underneath.
 *
 *   node smoke/src/report.ts --in smoke/out/results.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CallRecord } from './run.ts';
import type { Divergence } from './validate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

type Level = 'blocker' | 'major' | 'minor' | 'info';

interface Finding {
  id: string;
  level: Level;
  category: string;
  title: string;
  /** Why a caller cares. Written for someone who did not run the probe. */
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

const LEVEL_ORDER: Level[] = ['blocker', 'major', 'minor', 'info'];

const LEVEL_LABEL: Record<Level, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
  info: 'Informational',
};

function where(record: CallRecord): string {
  return `\`${record.method} ${record.path}\``;
}

/** Collapse the same problem seen on many routes into one entry. */
class Collector {
  readonly #groups = new Map<string, Finding>();
  #next = 1;

  add(
    key: string,
    seed: Omit<Finding, 'id' | 'evidence' | 'operations'>,
    record: CallRecord,
    evidence?: string,
  ): void {
    let group = this.#groups.get(key);
    if (!group) {
      group = { ...seed, id: '', evidence: [], operations: [] };
      this.#groups.set(key, group);
    }
    const route = where(record);
    if (!group.operations.includes(route)) group.operations.push(route);
    if (evidence && group.evidence.length < 4 && !group.evidence.includes(evidence)) {
      group.evidence.push(evidence);
    }
  }

  finish(): Finding[] {
    const all = [...this.#groups.values()].sort((a, b) => {
      const level = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
      if (level !== 0) return level;
      return b.operations.length - a.operations.length;
    });
    for (const finding of all) finding.id = `UARP-${String(this.#next++).padStart(3, '0')}`;
    return all;
  }
}

const DIVERGENCE_META: Record<
  string,
  { level: Level; category: string; title: (d: Divergence) => string; impact: string; suggestion: string }
> = {
  'missing-required': {
    level: 'major',
    category: 'Response does not match its schema',
    title: (d) => `Required property \`${d.pointer.split('/').pop()}\` is missing from the response`,
    impact:
      'The Rust, Swift and Kotlin SDKs decode strictly. A required property that the server omits makes them throw, so the call fails for the user even though the request succeeded.',
    suggestion: 'Either always send the property, or move it out of `required` in the schema.',
  },
  'type-mismatch': {
    level: 'major',
    category: 'Response does not match its schema',
    title: (d) => `Property \`${d.pointer || '/'}\` has a different type than documented`,
    impact: 'Strictly typed SDKs fail to decode the response; generated model fields have the wrong type in every language.',
    suggestion: 'Correct whichever of the two is wrong — the handler or the schema.',
  },
  'null-not-allowed': {
    level: 'major',
    category: 'Response does not match its schema',
    title: (d) => `Property \`${d.pointer || '/'}\` is null but the schema does not allow it`,
    impact: 'Non-nullable fields become non-optional types in Rust, Swift, Kotlin and Ada. A null makes decoding fail.',
    suggestion: 'Mark the property nullable in the schema, or stop sending null.',
  },
  'no-variant-matched': {
    level: 'major',
    category: 'Response does not match its schema',
    title: (d) => `No documented variant accepts what the server sent at \`${d.pointer || '/'}\``,
    impact: 'A `oneOf`/`anyOf` that matches nothing leaves every SDK without a type to decode into.',
    suggestion: 'Add the missing variant, or correct the value the handler returns.',
  },
  'unknown-enum': {
    level: 'minor',
    category: 'Enumerations are out of date',
    title: (d) => `Undocumented value at \`${d.pointer || '/'}\``,
    impact:
      'The SDKs survive this on purpose — every generated enum carries a catch-all — but callers who switch on the value have no way to know the case exists.',
    suggestion: 'Add the value to the enum in the schema.',
  },
  'const-mismatch': {
    level: 'minor',
    category: 'Enumerations are out of date',
    title: (d) => `Fixed value at \`${d.pointer || '/'}\` differs from the document`,
    impact: 'A `const` tells generators the value can be relied on. When it is wrong, any code that trusts it is wrong.',
    suggestion: 'Update the `const`, or return the documented value.',
  },
  'undocumented-property': {
    level: 'minor',
    category: 'Schema is incomplete',
    title: (d) => `Undocumented property \`${d.pointer.split('/').pop()}\``,
    impact:
      'Generated models leave the field out, so callers cannot reach data the server is already sending. Nothing breaks; the SDK is simply poorer than the API.',
    suggestion: 'Add the property to the response schema.',
  },
  'format-mismatch': {
    level: 'minor',
    category: 'Schema is incomplete',
    title: (d) => `Value at \`${d.pointer || '/'}\` does not satisfy its declared format`,
    impact: 'Callers that parse by format — dates, UUIDs — fail on values that do not match it.',
    suggestion: 'Correct the value or drop the `format` annotation.',
  },
  'precision-loss': {
    level: 'minor',
    category: 'Numbers that do not survive JSON',
    title: () => 'Integer larger than 2^53 sent as a JSON number',
    impact:
      'JavaScript and Ada cannot represent it exactly, so the value silently changes in transit. This is a data-corruption bug, not a formatting one.',
    suggestion: 'Send the value as a string, as Stripe and others do for large identifiers.',
  },
  'schema-forbids-everything': {
    level: 'major',
    category: 'Schema is incomplete',
    title: (d) => `Schema at \`${d.pointer || '/'}\` is \`false\`, so no response can be valid`,
    impact: 'Generators have nothing to emit and validators reject every payload.',
    suggestion: 'Replace the schema with the real shape.',
  },
};

function analyse(results: Results): Finding[] {
  const collector = new Collector();
  const ran = results.records.filter((r) => !r.skipped);

  for (const record of ran) {
    //  1. The server broke.
    if (record.status !== null && record.status >= 500) {
      collector.add(
        `5xx:${record.operationId}`,
        {
          level: 'blocker',
          category: 'Server errors',
          title: `${record.status} from ${record.method} ${record.path}`,
          impact:
            'A 5xx is a fault on the server side, not a rejected request. Callers can only retry and hope.',
          suggestion: 'Reproduce with the request below and fix the handler; if the input really is invalid, answer 4xx instead.',
        },
        record,
        `${record.status} in ${record.durationMs} ms; body: ${JSON.stringify(record.responseBody)?.slice(0, 300)}`,
      );
      continue;
    }

    //  2. No answer at all.
    if (record.status === null && record.transportError) {
      collector.add(
        `transport:${record.transportError.slice(0, 40)}`,
        {
          level: 'blocker',
          category: 'No usable response',
          title: 'Request produced no decodable response',
          impact: 'The call never completes: the client times out, loses the connection, or cannot parse what came back.',
          suggestion: 'Check the handler for hangs and make sure the response is valid JSON with the documented content type.',
        },
        record,
        record.transportError,
      );
      continue;
    }

    //  3. A status the document never mentions.
    if (record.status !== null && !record.documentedStatuses.includes(String(record.status))) {
      const family = `${Math.floor(record.status / 100)}XX`;
      if (!record.documentedStatuses.includes(family) && !record.documentedStatuses.includes('default')) {
        const speculative = record.speculative && record.status === 404;
        if (!speculative) {
          collector.add(
            `status:${record.status}`,
            {
              level: 'major',
              category: 'Undocumented status codes',
              title: `${record.status} is returned but not documented`,
              impact:
                'Generated SDKs map documented statuses to typed errors. An undocumented one falls through to a generic failure, and callers cannot handle it deliberately.',
              suggestion: `Add ${record.status} to the responses for these operations, with the body schema it actually returns.`,
            },
            record,
            `documented: ${record.documentedStatuses.join(', ') || 'none'}`,
          );
        }
      }
    }

    //  4. A body built strictly from the schema was refused.
    if (record.status === 400 || record.status === 422) {
      if (record.bodyStrategy === 'synth' && !record.speculative) {
        collector.add(
          `constraint:${record.operationId}`,
          {
            level: 'major',
            category: 'Constraints that are enforced but not documented',
            title: `${record.method} ${record.path} rejects a body that satisfies its schema`,
            impact:
              'The probe sends exactly the properties the schema marks required, and nothing else. A rejection means the endpoint enforces a rule the document does not state, so no generated client can construct a valid request from the spec alone.',
            suggestion:
              'Add the rule to the schema — required properties, formats, patterns, minimums — or relax the handler to match what is published.',
          },
          record,
          `sent per schema, got ${record.status}: ${JSON.stringify(record.responseBody)?.slice(0, 300)}`,
        );
      }
      if (record.bodyStrategy === 'echo-get') {
        collector.add(
          `asymmetry:${record.operationId}`,
          {
            level: 'major',
            category: 'Read and write shapes disagree',
            title: `${record.method} ${record.path} rejects the body its own GET returned`,
            impact:
              'Read-modify-write is the normal way to change configuration. If the write refuses what the read produced, callers must hand-craft a different shape, and any round-trip tool breaks.',
            suggestion: 'Accept the read shape on write, ignoring read-only fields, or document the two shapes separately.',
          },
          record,
          `echoed GET response, got ${record.status}: ${JSON.stringify(record.responseBody)?.slice(0, 300)}`,
        );
      }
    }

    //  5. Errors that are not the documented problem document.
    if (record.status !== null && record.status >= 400 && record.errorBodyShape && record.errorBodyShape !== 'rfc9457') {
      collector.add(
        `problem:${record.errorBodyShape}`,
        {
          level: 'major',
          category: 'Error bodies are not problem documents',
          title:
            record.errorBodyShape === 'empty'
              ? 'Failure responses arrive with an empty body'
              : 'Failure responses are not RFC 9457 problem documents',
          impact:
            'Every SDK decodes errors as RFC 9457, which is what the rest of the API returns. These endpoints leave callers with a status code and nothing else.',
          suggestion: 'Return `application/problem+json` with `type`, `title`, `status` and `detail`, as the other endpoints do.',
        },
        record,
        `${record.status} body: ${JSON.stringify(record.responseBody)?.slice(0, 200)}`,
      );
    }

    //  6. Refused despite a key that carries every scope.
    if (record.status === 401 || record.status === 403) {
      collector.add(
        `auth:${record.status}`,
        {
          level: 'major',
          category: 'Authorisation disagrees with the document',
          title: `${record.status} for a key holding every scope`,
          impact:
            'The run used an owner key with `*`. Either the endpoint requires something the scope catalogue does not describe, or its own security block is wrong — and callers cannot tell which scope to ask for.',
          suggestion: 'Document the real requirement in the operation `security` block, or fix the check.',
        },
        record,
        `declared scopes: ${record.scopes.join(', ') || 'none'}; got ${record.status}`,
      );
    }

    //  7. Schema drift, grouped by the shape of the problem rather than the route.
    for (const divergence of record.divergences) {
      const meta = DIVERGENCE_META[divergence.kind];
      if (!meta) continue;
      //  `/rules/0/rule_id` and `/rules/1/rule_id` are one problem, not two.
      //  Without this a single malformed list produces a finding per element.
      const normalised = { ...divergence, pointer: divergence.pointer.replace(/\/\d+(?=\/|$)/g, '/*') };
      collector.add(
        `${divergence.kind}:${normalised.pointer}:${record.path}`,
        {
          level: meta.level,
          category: meta.category,
          title: meta.title(normalised),
          impact: meta.impact,
          suggestion: meta.suggestion,
        },
        record,
        divergence.detail,
      );
    }
  }

  //  8. Endpoints slow enough that callers will notice.
  const slow = ran.filter((r) => r.durationMs > 3000).sort((a, b) => b.durationMs - a.durationMs);
  for (const record of slow.slice(0, 15)) {
    collector.add(
      'slow',
      {
        level: 'info',
        category: 'Response times',
        title: 'Endpoints slower than three seconds',
        impact: 'The SDKs time out at 60 s by default, but calls this slow are felt by users and are the first to fail under load.',
        suggestion: 'Profile these handlers; several are simple reads that should not take seconds.',
      },
      record,
      `${record.durationMs} ms`,
    );
  }

  return collector.finish();
}

function renderMarkdown(results: Results, findings: Finding[]): string {
  const ran = results.records.filter((r) => !r.skipped);
  const quarantined = results.records.filter((r) => r.skipped);
  const byLevel = (level: Level): Finding[] => findings.filter((f) => f.level === level);
  const statuses = new Map<string, number>();
  for (const record of ran) {
    const key = record.status === null ? 'no response' : String(record.status);
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
  }

  const lines: string[] = [];
  const push = (...text: string[]): void => void lines.push(...text);

  push(`# ${results.spec.title} — live conformance report`);
  push('');
  push(
    `Generated by the UARP SDK probe on ${results.finishedAt.slice(0, 19).replace('T', ' ')} UTC ` +
      `against \`${results.baseURL}\`, from OpenAPI ${results.spec.version}.`,
  );
  push('');
  push(
    'Every request was built from the published document alone: the required properties and nothing else. ' +
      'Where a `PUT` had a matching `GET`, the read response was echoed back unchanged, so configuration was ' +
      'exercised without being altered. Destructive calls were pointed only at resources this run created.',
  );
  push('');

  push('## Summary');
  push('');
  push('| | |');
  push('|---|---|');
  push(`| Operations in the document | ${results.totalOperations} |`);
  push(`| Called | ${ran.length} |`);
  push(`| Held back for review | ${quarantined.length} |`);
  push(`| Long-lived streams, covered separately | ${results.skippedStreams.length} |`);
  push(`| Findings | ${findings.length} |`);
  for (const level of LEVEL_ORDER) {
    const count = byLevel(level).length;
    if (count > 0) push(`| — ${LEVEL_LABEL[level].toLowerCase()} | ${count} |`);
  }
  push('');
  push(
    'Status codes seen: ' +
      [...statuses.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => `\`${status}\` ×${count}`)
        .join(', ') +
      '.',
  );
  push('');

  if (findings.length === 0) {
    push('No divergences were found. The document and the server agree everywhere the probe could reach.');
    return lines.join('\n');
  }

  //  The most expensive thing a report like this can do is bury two blockers
  //  under six hundred cosmetic notes, so the serious findings are named up
  //  front and everything else is summarised rather than recited.
  const serious = findings.filter((f) => f.level === 'blocker' || f.level === 'major');
  if (serious.length > 0) {
    push('## Start here');
    push('');
    for (const finding of serious.slice(0, 12)) {
      push(`- **${finding.id}** ${finding.title} — ${finding.operations[0]}` +
        (finding.operations.length > 1 ? ` and ${finding.operations.length - 1} more` : ''));
    }
    if (serious.length > 12) push(`- …and ${serious.length - 12} further major findings below.`);
    push('');
  }

  push('## Findings');
  push('');
  for (const level of LEVEL_ORDER) {
    const group = byLevel(level);
    if (group.length === 0) continue;
    push(`### ${LEVEL_LABEL[level]} (${group.length})`);
    push('');

    //  One explanation per kind of problem, not per occurrence: the impact and
    //  the fix are identical for every instance, and repeating them is what
    //  turns a report into something nobody reads.
    const kinds = new Map<string, Finding[]>();
    for (const finding of group) {
      const key = `${finding.category} ${finding.impact}`;
      const list = kinds.get(key) ?? [];
      list.push(finding);
      kinds.set(key, list);
    }

    for (const [, entries] of [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const first = entries[0]!;
      push(`#### ${first.category} — ${entries.length} finding${entries.length === 1 ? '' : 's'}`);
      push('');
      push(first.impact);
      push('');
      push(`**Suggested fix.** ${first.suggestion}`);
      push('');
      push('| | Finding | Where |');
      push('|---|---|---|');
      for (const finding of entries) {
        const shown = finding.operations.slice(0, 4).join(', ');
        const more = finding.operations.length > 4 ? ` +${finding.operations.length - 4}` : '';
        push(`| ${finding.id} | ${finding.title.replace(/\|/g, '\\|')} | ${shown}${more} |`);
      }
      push('');

      //  Evidence is only worth the space for problems someone has to reproduce.
      if (level === 'blocker' || level === 'major') {
        for (const finding of entries) {
          if (finding.evidence.length === 0) continue;
          push(`<details><summary>${finding.id} evidence</summary>`);
          push('');
          push('```');
          for (const line of finding.evidence) push(line);
          push('```');
          push('');
          push('</details>');
          push('');
        }
      }
    }
  }

  //  A report that does not say what it failed to reach invites the reader to
  //  assume it reached everything.
  const speculative = ran.filter((r) => r.speculative);
  const succeeded = ran.filter((r) => r.status !== null && r.status >= 200 && r.status < 300);
  const blockedCreates = findings.filter((f) => f.category.startsWith('Constraints')).length;
  push('## What this run did not prove');
  push('');
  push(
    `Of ${ran.length} calls, ${succeeded.length} returned a success. The remainder were mostly refusals, and ` +
      `${speculative.length} of the calls had to invent a path identifier because no resource of that kind existed ` +
      'to point at — those exercised the route, the authorisation check and the error shape, but never the ' +
      'endpoint doing its job.',
  );
  push('');
  if (blockedCreates > 0) {
    push(
      `This is mostly one problem wearing many hats. ${blockedCreates} create endpoints rejected a body built ` +
        'strictly from their own schema, so nothing was created, so every read, update and delete beneath them ' +
        'had nothing to aim at. Fixing those — or documenting the constraints they enforce — would unlock most ' +
        'of the untested surface on the next run, without any other change.',
    );
    push('');
  }
  push(
    `${new Set(ran.flatMap((r) => r.covered)).size} of the 52 named component schemas the paths reference were ` +
      'seen in a real response. The rest were never returned, so nothing is known about whether they match.',
  );
  push('');

  if (quarantined.length > 0) {
    push('## Held back for review');
    push('');
    push(
      'These were not called. Each one either destroys the account, revokes the credential the run depends on, ' +
        'or changes state for every tenant — decisions a probe should not take on its own.',
    );
    push('');
    push('| Operation | Reason |');
    push('|---|---|');
    for (const record of quarantined) {
      push(`| \`${record.method} ${record.path}\` | ${record.skipped?.replace('quarantined: ', '')} |`);
    }
    push('');
  }

  if (results.skippedStreams.length > 0) {
    push('## Streams');
    push('');
    push(
      'Long-lived endpoints are not part of a request/response sweep; they are exercised by the per-language ' +
        'SDK smoke runners, which know when to stop reading.',
    );
    push('');
    for (const stream of results.skippedStreams) push(`- \`${stream.path}\``);
    push('');
  }

  if (results.created.length > 0) {
    push('## Resources this run created');
    push('');
    push(
      `Everything is named after run \`smoke-${results.runId}\`. Deletes ran in the last phase; anything listed ` +
        'here whose delete failed is still present and can be removed by hand.',
    );
    push('');
    for (const item of results.created) push(`- \`${item.path}\` → ${item.name} \`${item.value}\``);
    push('');
  }

  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  let input = resolve(ROOT, 'smoke/out/results.json');
  let output = resolve(ROOT, 'smoke/out/BACKEND-REPORT.md');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') input = resolve(argv[++i]!);
    else if (argv[i] === '--out') output = resolve(argv[++i]!);
  }

  const results = JSON.parse(readFileSync(input, 'utf8')) as Results;
  const findings = analyse(results);
  writeFileSync(output, renderMarkdown(results, findings) + '\n');
  writeFileSync(output.replace(/\.md$/, '.json'), JSON.stringify(findings, null, 2) + '\n');

  console.log(`${findings.length} findings → ${output}`);
  for (const level of LEVEL_ORDER) {
    const count = findings.filter((f) => f.level === level).length;
    if (count > 0) console.log(`  ${LEVEL_LABEL[level].padEnd(14)} ${count}`);
  }
}

main();
