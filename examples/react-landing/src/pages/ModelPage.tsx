/** `/docs/reference/model/:model` — one model's fields or enum values. */
import { Link, useParams } from 'react-router-dom';
import { useReference } from '../hooks/useReference';
import { usePageTitle } from '../hooks/usePageTitle';
import { FieldsTable } from '../components/FieldsTable';
import { DocHeader } from '../components/DocPage';
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
      <DocHeader eyebrow={<><Link to="/docs/reference">API reference</Link><span>/</span><span>Models</span></>} title={model} mono>
        <p>{m.kind === 'object' ? `Object · ${m.fields.length} fields` : `Enum · ${m.values.length} values`} · SDK v{ref.sdkVersion}</p>
        <p>{m.kind === 'object' ? 'Use this schema to understand field types and which values are required. Follow linked types to inspect nested models.' : 'Use one of the values below wherever this type is expected.'}</p>
      </DocHeader>
      <h2 className="text-xl font-semibold tracking-tight">{m.kind === 'object' ? 'Fields' : 'Allowed values'}</h2>

      {m.kind === 'object' ? (
        <FieldsTable key={model} label={model} fields={m.fields} toModel={toModel} hasModel={hasModel} />
      ) : (
        <div className="flex flex-wrap gap-1">
          {m.values.map((v) => (
            <code translate="no" key={v} className="rounded-sm border border-rule-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-ink-soft">
              {v}
            </code>
          ))}
        </div>
      )}
    </section>
  );
}