/**
 * Does the machine half of the document agree with the prose half?
 *
 * On 2026-09-17 the platform's `POST /governance/goals` had carried, for as
 * long as anyone had looked, a description that read:
 *
 *   `agent_id`, `title`, `description`, `rationale`, `alignment_justification`,
 *   `expected_impact` and `resource_estimate_usd` are all required (422)
 *
 * beside a request schema whose `required` was `["agent_id"]` and whose
 * `properties` held that one key and nothing else. The handler's validator
 * wanted all seven. So a client generated from this document took one field,
 * sent one field, and collected a 422 on every call — while the doc comment
 * emitted ten lines above it, in the same generated file, listed all seven and
 * said "422" out loud.
 *
 * That is the shape this check is for, and it is a nastier shape than it looks:
 * a human reading the document was told the truth. Only the generator was lied
 * to, and the generator is the half that becomes code.
 *
 * Why not the obvious check. The obvious one — collect the backticked names in
 * the prose, flag any the operation does not define — is GREEN on that exact
 * defect, because the response schema `Goal` carries all seven fields. Every
 * name in the sentence resolves somewhere in the operation. Verified before
 * writing this, which is the only reason it is not what is below.
 *
 * So the claim is read, not the vocabulary: a sentence that says certain named
 * fields are REQUIRED is a promise, and `requestBody.required` is where that
 * promise is kept or broken. Nothing else in the prose is inspected — a check
 * that guesses at prose it does not understand is a check that gets muted.
 *
 * Falsified against the document of 2026-09-17, both numbers read:
 *
 *   - 8 operations reported, 19 fields. Repair `POST /governance/goals`'s schema
 *     to the seven fields and ONLY that operation drops out — 7 remain, byte for
 *     byte. So it is reading the schema, not pattern-matching the sentence.
 *   - 726 of 734 operations stay silent, which is the number that matters: the
 *     defect is invisible to everything else, or the check would be noise.
 *   - Delete the parameter-satisfaction line and 3 further fields appear across
 *     2 operations. That guard carries weight.
 *
 *   node scripts/check-prose-schema.ts            # report, exit 0 (CI)
 *   node scripts/check-prose-schema.ts --strict   # fail on divergence (release)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Json = any;

/** A name the prose says the caller must send. */
interface Claim {
  field: string;
  /** The clause it was read from, for an error message that can be judged. */
  clause: string;
}

interface Finding {
  method: string;
  path: string;
  field: string;
  clause: string;
  /** `absent` ships a client that cannot send the field at all. */
  kind: 'absent' | 'optional' | 'param-optional';
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const NAME = '`[A-Za-z_][A-Za-z0-9_]*`';
/** A run of backticked names joined by commas and a final "and"/"or". */
const RUN = `(?:${NAME}(?:\\s*,\\s*|\\s+and\\s+|\\s+or\\s+)?)+`;

/**
 * "`a`, `b` and `c` are all required", "`x` is mandatory".
 *
 * The negation group is UNEXERCISED, and saying so is the point: this document
 * contains zero negated requirement sentences today, and deleting the guard
 * changes no finding. It is kept because upstream prose is rewritten weekly and
 * "is not required" costs nothing to survive — not because anything here proves
 * it works.
 */
const ASSERTS = new RegExp(
  `(${RUN})\\s*(?:are|is)\\s+(not\\s+|no\\s+longer\\s+|never\\s+)?(?:all\\s+|both\\s+)?(?:required|mandatory)\\b`,
  'g',
);
/**
 * Not read: "requires `a` and `b`". Tried, measured, removed — across 734
 * operations it produced exactly one finding, and that one was wrong:
 * `POST /missions` says the planner "requires `available_agents`", which is
 * true only when `plan` is omitted. A conditional requirement is not something
 * `required` can express, so a check that reports it is reporting a correct
 * document.
 */

function namesIn(run: string): string[] {
  return [...run.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1]);
}

function claims(prose: string): Claim[] {
  const out: Claim[] = [];
  for (const m of prose.matchAll(ASSERTS)) {
    if (m[2]) continue; // negated — the prose is describing what is NOT demanded
    for (const field of namesIn(m[1])) out.push({ field, clause: m[0] });
  }
  return out;
}

/** Follows `$ref` and flattens the `allOf` the document uses for bodies. */
function deref(doc: Json, schema: Json, seen = new Set<string>()): Json {
  if (!schema || typeof schema !== 'object') return {};
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return {};
    seen.add(schema.$ref);
    const parts = schema.$ref.replace(/^#\//, '').split('/');
    let node: Json = doc;
    for (const p of parts) node = node?.[p];
    return deref(doc, node, seen);
  }
  if (Array.isArray(schema.allOf)) {
    const props: Json = {};
    const required: string[] = [];
    for (const sub of schema.allOf) {
      const f = deref(doc, sub, seen);
      Object.assign(props, f.properties ?? {});
      required.push(...(f.required ?? []));
    }
    return {
      ...schema,
      properties: { ...props, ...(schema.properties ?? {}) },
      required: [...required, ...(schema.required ?? [])],
    };
  }
  return schema;
}

function bodySchema(doc: Json, op: Json): Json | null {
  const content = op?.requestBody?.content;
  if (!content) return null;
  const media =
    content['application/json'] ??
    content[Object.keys(content).find((k) => k.includes('json')) ?? ''];
  if (!media?.schema) return null;
  return deref(doc, media.schema);
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const doc: Json = JSON.parse(readFileSync(resolve(ROOT, 'spec/openapi.json'), 'utf8'));

  const findings: Finding[] = [];
  let operations = 0;
  let asserting = 0;
  let checked = 0;
  /** Named in prose, no body, no parameter — see the note at the report below. */
  let unprovable = 0;

  for (const [path, item] of Object.entries<Json>(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      operations++;

      const prose = [op.summary, op.description].filter(Boolean).join(' ');
      const found = claims(prose);
      if (found.length === 0) continue;
      asserting++;

      const body = bodySchema(doc, op);
      // Required PARAMETERS satisfy the promise too: "`agentId` is required"
      // in a prose block belongs to the path, not the body.
      const declared = new Map<string, boolean>();
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p: Json = raw?.$ref ? deref(doc, raw) : raw;
        if (p?.name) declared.set(p.name, Boolean(p.required));
      }

      for (const { field, clause } of found) {
        if (declared.get(field) === true) continue; // the promise is kept by a parameter
        checked++;
        if (!body) {
          // No body, so the field can only have been meant as a parameter. If
          // one is declared and optional, that is provable and reported. If
          // none is declared, the sentence is far more often about the
          // RESPONSE — `GET /me` says `scopes` and `auth_method` "are
          // required", and means the payload it returns. This check cannot
          // tell that apart from an undeclared query parameter, so it says
          // nothing rather than teaching people to skim past it.
          if (declared.has(field)) {
            findings.push({ method, path, field, clause, kind: 'param-optional' });
          } else {
            unprovable++;
          }
          continue;
        }
        const props = body.properties ?? {};
        const required = new Set<string>(body.required ?? []);
        if (required.has(field)) continue;
        findings.push({
          method,
          path,
          field,
          clause,
          kind: field in props ? 'optional' : 'absent',
        });
      }
    }
  }

  console.log(
    `prose-schema: ${operations} operations, ${asserting} assert a requirement in prose, ${checked} named fields checked` +
      (unprovable ? `, ${unprovable} left alone (no body and no such parameter — prose about the response reads the same)` : ''),
  );

  if (findings.length === 0) {
    console.log('prose-schema: every field the prose calls required is required in the schema.');
    return;
  }

  const byOp = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.method.toUpperCase()} ${f.path}`;
    (byOp.get(key) ?? byOp.set(key, []).get(key)!).push(f);
  }

  console.log(
    `prose-schema: ${findings.length} field(s) across ${byOp.size} operation(s) the prose demands and the schema does not.`,
  );
  for (const [op, fs] of byOp) {
    console.log(`\n  ${op}`);
    for (const f of fs) {
      const why =
        f.kind === 'absent'
          ? 'not in the request schema at all'
          : f.kind === 'optional'
            ? 'in the request schema, but optional'
            : 'a declared parameter, but not required';
      console.log(`    ${f.field} — ${why}`);
    }
    console.log(`    prose: ${fs[0].clause}`);
  }

  if (strict) {
    console.log('\nprose-schema: failing — a client generated from this takes a body the server rejects.');
    process.exit(1);
  }
  console.log(
    '\nprose-schema: not failing here — the document is upstream, and a red CI on every upstream defect is a red CI nobody reads.',
  );
}

main();
