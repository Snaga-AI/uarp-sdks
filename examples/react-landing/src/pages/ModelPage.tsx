/** `/docs/reference/model/:model` — one model's fields or enum values. */
import { Link, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { FieldsTable } from '../components/FieldsTable';
import { NotFound } from './NotFound';

export function ModelPage() {
  const { model } = useParams();
  usePageTitle(model ? `${model} model` : 'API reference');
  const { ref, error } = useReference();

  if (error) return <p className="text-ink-soft">Could not load the reference: {error.message}</p>;
  if (!ref) return <p className="text-ink-soft">Loading…</p>;

  const m = model ? ref.models[model] : undefined;
  if (!m) return <NotFound />;

  const toModel = (name: string) => `/docs/reference/model/${name}`;
  const hasModel = (name: string) => name in ref.models;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-rule-soft pb-4">
        <p className="text-sm text-ink-soft">
          <Link className="text-accent underline underline-offset-2" to="/docs/reference">Reference</Link>
          {' / '}
          <span className="text-ink-soft">model</span>
        </p>
        <h2 className="font-mono text-2xl tracking-tight">{model}</h2>
        <p className="font-mono text-xs text-ink-soft">
          {m.kind === 'object' ? `object · ${m.fields.length} fields` : `enum · ${m.values.length} values`}
        </p>
      </header>

      {m.kind === 'object' ? (
        <FieldsTable fields={m.fields} toModel={toModel} hasModel={hasModel} />
      ) : (
        <div className="flex flex-wrap gap-1">
          {m.values.map((v) => (
            <code key={v} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-soft">
              {v}
            </code>
          ))}
        </div>
      )}
    </section>
  );
}