/** A table of object-model fields — shared by method and model pages. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldInfo } from '../data/reference';
import { DocText } from './DocPage';
import { Term } from '../docs/Section';

/** Split a type string into model-name tokens, for linking to model pages. */
function typeLinks(
  type: string,
  toModel: (name: string) => string,
  hasModel: (name: string) => boolean,
) {
  // Match identifiers that start with an uppercase letter and are followed by
  // `<`, `[`, `|`, space, or end — conservative, avoids matching `string`.
  return type.split(/(\s+|[|&<>,\[\]])/).map((part, i) => {
    const token = part.trim();
    if (/^[A-Z][A-Za-z0-9_]*$/.test(token) && hasModel(token)) {
      return (
        <Link key={i} to={toModel(token)} className="text-accent underline underline-offset-2">
          {part}
        </Link>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function FieldsTable({
  fields,
  toModel,
  hasModel,
  label = 'Schema',
}: {
  fields: FieldInfo[];
  label?: string;
  toModel: (name: string) => string;
  hasModel: (name: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const filtered = fields.filter(field => (!requiredOnly || !field.optional) && `${field.name} ${field.type} ${field.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (!fields.length) return <p className="text-sm text-ink-soft">No documented fields.</p>;
  return (
    <section aria-label={`${label} fields`} className="min-w-0 space-y-3">
      {fields.length > 8 && <div className="schema-filter-controls flex flex-wrap items-center gap-3 rounded-lg bg-paper-tint p-4">
        <label className="min-w-0 flex-1"><span className="sr-only">Filter {label.toLowerCase()} fields</span><input type="search" className="doc-input" placeholder="Find a field or type…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label className="flex shrink-0 items-center gap-2 text-xs text-ink-soft"><input className="accent-accent" type="checkbox" checked={requiredOnly} onChange={event => setRequiredOnly(event.target.checked)} />Required only</label>
        <p role="status" className="w-full text-xs text-ink-soft">{filtered.length} of {fields.length} fields</p>
      </div>}
      <div tabIndex={0} role="region" aria-label={`${label} schema table`} className="min-w-0 overflow-x-auto rounded-lg border border-rule-soft bg-code-bg">
      <table aria-label={label} role="table" className="fields-table w-full min-w-[540px] border-collapse text-sm">
        <thead role="rowgroup">
          <tr role="row" className="border-b border-rule-soft bg-paper-tint text-left text-xs text-ink-soft">
            <th role="columnheader" scope="col" className="px-5 py-4 font-medium">Field</th>
            <th role="columnheader" scope="col" className="px-5 py-4 font-medium">Type</th>
            <th role="columnheader" scope="col" className="px-5 py-4 font-medium">Description</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {filtered.map((f) => (
            <tr role="row" key={f.name} className="border-b border-rule-soft/60 align-top">
              <td role="cell" data-label="Field" className="px-5 py-4">
                <code translate="no" className="font-mono text-xs text-ink">{f.name}</code>
                <span className={`mt-2 block text-[0.65rem] ${f.optional ? 'text-ink-soft' : 'text-accent-soft'}`}>{f.optional ? 'optional' : 'required'}</span>
                {f.deprecated && (
                  <span className="ml-2 rounded-sm border border-accent/40 px-1 py-0.5 font-mono text-[0.5rem] tracking-wider text-accent uppercase">
                    deprecated
                  </span>
                )}
              </td>
              <td role="cell" data-label="Type" className="px-5 py-4">
                <code translate="no" className="font-mono text-xs text-ink-soft">
                  {typeLinks(f.type, toModel, hasModel)}
                </code>
                {f.default !== undefined && f.default !== '' && (
                  <div className="mt-0.5 text-[0.7rem] text-ink-soft">
                    default <Term>{f.default}</Term>
                  </div>
                )}
              </td>
              <td role="cell" data-label="Description" className="px-5 py-4 text-ink-soft"><DocText>{f.description ?? '—'}</DocText></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filtered.length && <p className="p-5 text-sm text-ink-soft">No fields match your filters. Try another name or turn off “Required only”.</p>}
      </div>
    </section>
  );
}