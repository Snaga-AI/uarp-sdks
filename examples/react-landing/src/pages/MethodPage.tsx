/** `/docs/reference/:group/:method` — one operation, fully rendered. */
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { getModel, isModelName } from '../data/reference';
import { usageSnippet } from '../docs/usage';
import { Code } from '../docs/Code';
import { Term } from '../docs/Section';
import { MethodBadge } from '../components/MethodBadge';
import { FieldsTable } from '../components/FieldsTable';
import { DocHeader, DocText, PageContents } from '../components/DocPage';
import { CopyButton } from '../components/CopyButton';
import { NotFound } from './NotFound';

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
    <div id={block.id} className="doc-reference-section">
      <h2 className="group mb-5 flex flex-wrap items-baseline gap-2 text-lg font-semibold tracking-tight">
        {block.title}
        <a
          href={`#${block.id}`}
          aria-label={`Link to ${block.label}`}
          className="opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        >
          #
        </a>
      </h2>
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
function ScopePills({ scopes }: { scopes: string[] }) {
  if (!scopes.length) return <span className="text-xs text-ink-soft">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <code translate="no" key={s} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
          {s}
        </code>
      ))}
    </span>
  );
}

export function MethodPage() {
  const { group, method } = useParams();
  const location = useLocation();
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
      body: <FieldsTable label="Query parameters" fields={m.queryParams} toModel={toModel} hasModel={hasModel} />,
    });
  }

  if (m.bodyType) {
    blocks.push({
      id: 'request-body',
      title: <>Request body — {modelRef(m.bodyType, toModel, hasModel)}</>,
      label: 'Request body',
      body:
        bodyModel && bodyModel.kind === 'object' ? (
          <FieldsTable label="Request body" fields={bodyModel.fields} toModel={toModel} hasModel={hasModel} />
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
          <FieldsTable label="Response" fields={responseModel.fields} toModel={toModel} hasModel={hasModel} />
        ) : (
          <EnumValues values={responseModel.values} />
        ),
    });
  }

  blocks.push({
    id: 'example',
    title: <>Example</>,
    label: 'Example',
    body: <><p className="mb-4 text-sm leading-7 text-ink-soft">This snippet shows the calling pattern. Supply the values described in the parameter sections.</p><Code language="ts">{usageSnippet(g.accessor, m)}</Code></>,
  });

  // Keep the calling pattern close to the signature, before potentially long schemas.
  const example = blocks.pop()!;
  blocks.splice(1, 0, example);

  return (
    <section className="method-page">
      <div className="method-intro">
      <DocHeader
        eyebrow={<><Link to="/docs/reference">API reference</Link><span>/</span><Link to={`/docs/reference/${g.accessor}`}>{g.accessor}</Link></>}
        title={<><span className="text-ink-soft">{g.accessor}.</span>{m.name}</>}
        mono
      >
        <div className="flex flex-wrap gap-2"><MethodBadge method={m} /></div>
        {m.summary && <p className="text-ink">{m.summary}</p>}
        {m.description && (m.description.length > 400
          ? <details className="operation-details"><summary>Operation details</summary><p className="mt-4 whitespace-pre-line"><DocText>{m.description}</DocText></p></details>
          : <p className="whitespace-pre-line"><DocText>{m.description}</DocText></p>)}
      </DocHeader>

      {m.httpMethod && m.path && (
        <div className="flex items-start gap-3 rounded-lg bg-paper-tint p-5">
          <code translate="no" className="http-verb">
            {m.httpMethod}
          </code>
          <code translate="no" className="min-w-0 break-all font-mono text-xs leading-6 text-ink-soft">{m.path}</code>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a className="contents-link" href="#example">Jump to example ↓</a>
        <CopyButton label="Copy method name" value={`client.${g.accessor}.${m.name}`} />
        <CopyButton label="Copy page link" value={`${window.location.origin}${location.pathname}${location.search}`} />
      </div>
      <p className="text-sm leading-7 text-ink-soft">Signatures and examples below use TypeScript. Initialize a client first; replace named arguments such as body, params and resource IDs with your own values.</p>
      </div>
      <PageContents rail entries={blocks.map((block) => ({ id: block.id, label: block.label }))} />
      <div className="method-sections">
        {blocks.map((block) => <AnchoredBlock key={`${g.accessor}.${m.name}.${block.id}`} block={block} />)}
        <nav aria-label="Related methods" className="grid gap-3 border-t border-rule-soft pt-7 sm:grid-cols-2">
          <Link className="doc-card" to={`/docs/reference/${g.accessor}`}><span className="eyebrow">Resource overview</span><span className="mt-3 block break-words font-mono text-sm">{g.accessor} →</span></Link>
          {g.methods.filter(entry => Boolean(m.path) && entry.name !== m.name && entry.path === m.path).slice(0, 1).map(entry => <Link key={entry.name} className="doc-card" to={`/docs/reference/${g.accessor}/${entry.name}`}><span className="eyebrow">Same endpoint</span><span translate="no" className="mt-3 block break-all font-mono text-sm">{entry.name} →</span></Link>)}
        </nav>
      </div>
    </section>
  );
}

function ParamsRows({ params }: { params: { name: string; type: string; optional: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {params.map((p) => (
        <li key={p.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-2 text-sm">
          <code translate="no" className="min-w-0 break-all font-mono text-xs text-ink">{p.name}</code>
          <span className="min-w-0 break-words text-xs text-ink-soft">{p.type}</span>
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
        <code translate="no" key={v} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-soft">
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