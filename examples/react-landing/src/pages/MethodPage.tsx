/** `/docs/reference/:group/:method` — one operation, fully rendered. */
import type { ReactNode } from 'react';
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

/**
 * One anchored block on a method page.
 *
 * A method page has up to eight blocks and they come and go with the operation
 * — a GET has no request body, a non-paginated call has no query parameters. So
 * the blocks and the "On this page" list are built from ONE array below rather
 * than written twice: a hand-kept list would go stale the first time a block
 * gained a condition, and would do it silently, since a missing TOC entry looks
 * exactly like a section that legitimately does not apply here.
 *
 * The heading is the link target, matching the concept pages' `Section`.
 */
interface Block {
  id: string;
  title: ReactNode;
  /** What the "On this page" list shows — plain text, since `title` may be a link. */
  label: string;
  body: ReactNode;
}

function AnchoredBlock({ block }: { block: Block }) {
  return (
    <div id={block.id} className="scroll-mt-24">
      <h3 className="group mb-2 flex items-baseline gap-2 font-mono text-xs tracking-wider text-ink-soft uppercase">
        {block.title}
        <a
          href={`#${block.id}`}
          aria-label={`Link to ${block.label}`}
          className="opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        >
          #
        </a>
      </h3>
      {block.body}
    </div>
  );
}

/**
 * The "On this page" list.
 *
 * Rendered only when there is more than one place to go — a two-entry page
 * navigates faster by scrolling than by reading a list of two.
 */
function OnThisPage({ blocks }: { blocks: Block[] }) {
  if (blocks.length < 3) return null;
  return (
    <nav
      aria-label="On this page"
      className="rounded-sm border border-rule-soft bg-paper-tint px-4 py-3"
    >
      <p className="mb-2 font-mono text-[0.6rem] tracking-wider text-ink-soft uppercase">
        On this page
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {blocks.map((b) => (
          <li key={b.id}>
            <a
              href={`#${b.id}`}
              className="text-xs text-ink-soft underline-offset-2 transition hover:text-ink hover:underline"
            >
              {b.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
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

  //  Every block this operation actually has, in reading order. The TOC below
  //  and the page body both come from this one list.
  const blocks: Block[] = [
    {
      id: 'signature',
      title: <>Signature</>,
      label: 'Signature',
      body: <Code language="ts">{m.signature}</Code>,
    },
    {
      id: 'scopes',
      title: <>Required scopes</>,
      label: 'Scopes',
      body: <ScopePills scopes={m.scopes} />,
    },
    {
      id: 'returns',
      title: <>Returns</>,
      label: 'Returns',
      body: (
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
      ),
    },
  ];

  if (m.pathParams.length > 0) {
    blocks.push({
      id: 'path-parameters',
      title: <>Path parameters</>,
      label: 'Path parameters',
      body: <ParamsRows params={m.pathParams} />,
    });
  }

  if (m.queryParams.length > 0) {
    blocks.push({
      id: 'query-parameters',
      title: <>Query &amp; header parameters</>,
      label: 'Query parameters',
      body: <FieldsTable fields={m.queryParams} toModel={toModel} hasModel={hasModel} />,
    });
  }

  if (m.bodyType) {
    blocks.push({
      id: 'request-body',
      title: <>Request body — {modelRef(m.bodyType, toModel, hasModel)}</>,
      label: 'Request body',
      body:
        bodyModel && bodyModel.kind === 'object' ? (
          <FieldsTable fields={bodyModel.fields} toModel={toModel} hasModel={hasModel} />
        ) : bodyModel?.kind === 'enum' ? (
          <EnumValues values={bodyModel.values} />
        ) : (
          <p className="text-sm text-ink-soft">Free-form <Term>{m.bodyType}</Term> — no fixed shape.</p>
        ),
    });
  }

  if (responseModel) {
    blocks.push({
      id: 'response',
      title: <>Response — {modelRef(m.returnType, toModel, hasModel)}</>,
      label: 'Response',
      body:
        responseModel.kind === 'object' ? (
          <FieldsTable fields={responseModel.fields} toModel={toModel} hasModel={hasModel} />
        ) : (
          <EnumValues values={responseModel.values} />
        ),
    });
  }

  blocks.push({
    id: 'example',
    title: <>Example</>,
    label: 'Example',
    body: <Code language="ts">{usageSnippet(g.accessor, m)}</Code>,
  });

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

      <OnThisPage blocks={blocks} />

      {blocks.map((block) => (
        <AnchoredBlock key={block.id} block={block} />
      ))}
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