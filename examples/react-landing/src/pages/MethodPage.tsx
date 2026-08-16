/** `/docs/reference/:group/:method` — one operation, fully rendered. */
import { Link, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { getModel, isModelName, type MethodInfo } from '../data/reference';
import { Code } from '../docs/Code';
import { Term } from '../docs/Section';
import { MethodBadge } from '../components/MethodBadge';
import { FieldsTable } from '../components/FieldsTable';
import { NotFound } from './NotFound';

/** A generated TypeScript usage snippet for the method, from its signature. */
function usageSnippet(group: string, m: MethodInfo): string {
  const args: string[] = [];
  for (const p of m.pathParams) args.push(p.name);
  if (m.bodyType) args.push('body');
  if (m.queryParams.length) args.push('params');
  const call = `client.${group}.${m.name}(${args.join(', ')})`;

  if (m.sse) {
    return `for await (const event of ${call}) {\n  // event.event — see the streaming concept for the wire shape\n}`;
  }
  if (m.paginated) {
    return `for await (const item of ${call}) {\n  // item: ${m.returnType}\n}`;
  }
  if (m.returnKind === 'promise' && m.returnType !== 'void') {
    return `const result = await ${call};\n// result: ${m.returnType}`;
  }
  return `await ${call};`;
}

function ScopePills({ scopes }: { scopes: string[] }) {
  if (!scopes.length) return <span className="text-xs text-ink-soft">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <code key={s} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
          {s}
        </code>
      ))}
    </span>
  );
}

export function MethodPage() {
  const { group, method } = useParams();
  usePageTitle(group && method ? `${group}.${method}` : 'API reference');
  const { ref, error } = useReference();

  if (error) return <p className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref) return <p className="text-ink-soft">Loading…</p>;

  const g = ref.groups.find((x) => x.accessor === group);
  const m = g?.methods.find((x) => x.name === method);
  if (!g || !m) return <NotFound />;

  const toModel = (name: string) => `/docs/reference/model/${name}`;
  const hasModel = (name: string) => name in ref.models;
  const bodyModel = m.bodyType ? getModel(ref, m.bodyType) : undefined;
  const responseModel = isModelName(ref, m.returnType) ? getModel(ref, m.returnType) : undefined;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-rule-soft pb-4">
        <p className="text-sm text-ink-soft">
          <Link className="text-accent underline underline-offset-2" to="/docs/reference">Reference</Link>
          {' / '}
          <Link className="text-accent underline underline-offset-2" to={`/docs/reference/${g.accessor}`}>{g.accessor}</Link>
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-mono text-2xl tracking-tight">
            <span className="text-ink-soft">{g.accessor}.</span>{m.name}
          </h2>
          <MethodBadge method={m} />
        </div>
        {m.summary && <p className="text-ink">{m.summary}</p>}
        {m.description && <p className="text-sm text-ink-soft whitespace-pre-line">{m.description}</p>}
      </header>

      {m.httpMethod && m.path && (
        <div className="flex items-center gap-3">
          <code className="rounded-sm border border-rule-soft px-2 py-1 font-mono text-xs font-medium text-ink">
            {m.httpMethod}
          </code>
          <code className="font-mono text-xs text-ink-soft">{m.path}</code>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Signature</h3>
        <Code language="ts">{m.signature}</Code>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Required scopes</h3>
          <ScopePills scopes={m.scopes} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Returns</h3>
          <p className="text-sm text-ink-soft">
            {m.returnKind === 'sse' ? (
              <>a server-sent event stream — iterate with <Term>for await</Term></>
            ) : m.returnKind === 'iterator' ? (
              <>
                an async iterable of{' '}
                {isModelName(ref, m.returnType) ? (
                  <Link className="text-accent underline underline-offset-2" to={toModel(m.returnType)}>
                    {m.returnType}
                  </Link>
                ) : (
                  <Term>{m.returnType}</Term>
                )}{' '}
                (the <Term>listAll</Term> walker)
              </>
            ) : (
              <>
                {isModelName(ref, m.returnType) ? (
                  <Link className="text-accent underline underline-offset-2" to={toModel(m.returnType)}>
                    {m.returnType}
                  </Link>
                ) : (
                  <Term>{m.returnType}</Term>
                )}
                {m.returnType === 'void' && ' — nothing'}
              </>
            )}
          </p>
        </div>
      </div>

      {m.pathParams.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Path parameters</h3>
          <ParamsRows params={m.pathParams} />
        </div>
      )}

      {m.queryParams.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Query &amp; header parameters</h3>
          <FieldsTable fields={m.queryParams} toModel={toModel} hasModel={hasModel} />
        </div>
      )}

      {m.bodyType && (
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">
            Request body — {modelRef(m.bodyType, toModel, hasModel)}
          </h3>
          {bodyModel && bodyModel.kind === 'object' ? (
            <FieldsTable fields={bodyModel.fields} toModel={toModel} hasModel={hasModel} />
          ) : bodyModel?.kind === 'enum' ? (
            <EnumValues values={bodyModel.values} />
          ) : (
            <p className="text-sm text-ink-soft">Free-form <Term>{m.bodyType}</Term> — no fixed shape.</p>
          )}
        </div>
      )}

      {responseModel && (
        <div>
          <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">
            Response — {modelRef(m.returnType, toModel, hasModel)}
          </h3>
          {responseModel.kind === 'object' ? (
            <FieldsTable fields={responseModel.fields} toModel={toModel} hasModel={hasModel} />
          ) : (
            <EnumValues values={responseModel.values} />
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-mono tracking-wider text-ink-soft uppercase">Example</h3>
        <Code language="ts">{usageSnippet(g.accessor, m)}</Code>
      </div>
    </section>
  );
}

function ParamsRows({ params }: { params: { name: string; type: string; optional: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {params.map((p) => (
        <li key={p.name} className="flex items-baseline gap-3 text-sm">
          <code className="font-mono text-xs text-ink">{p.name}</code>
          <span className="text-xs text-ink-soft">{p.type}</span>
          {!p.optional && <span className="text-[0.6rem] text-accent">required</span>}
        </li>
      ))}
    </ul>
  );
}

function EnumValues({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <code key={v} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
          {v}
        </code>
      ))}
    </div>
  );
}

function modelRef(name: string, toModel: (n: string) => string, hasModel: (n: string) => boolean) {
  if (hasModel(name)) {
    return (
      <Link className="text-accent underline underline-offset-2" to={toModel(name)}>
        {name}
      </Link>
    );
  }
  return <Term>{name}</Term>;
}