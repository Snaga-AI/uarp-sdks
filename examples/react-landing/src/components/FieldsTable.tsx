/** A table of object-model fields — shared by method and model pages. */
import { Link } from 'react-router-dom';
import type { FieldInfo } from '../data/reference';
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
}: {
  fields: FieldInfo[];
  toModel: (name: string) => string;
  hasModel: (name: string) => boolean;
}) {
  if (!fields.length) return <p className="text-sm text-ink-soft">No documented fields.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
            <th className="py-2 pr-4 font-medium">Field</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 pr-4 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name} className="border-b border-rule-soft/60 align-top">
              <td className="py-2 pr-4">
                <code className="font-mono text-xs text-ink">{f.name}</code>
                {f.optional && <span className="ml-1 text-xs text-ink-soft">?</span>}
                {f.deprecated && (
                  <span className="ml-2 rounded-sm border border-accent/40 px-1 py-0.5 font-mono text-[0.5rem] tracking-wider text-accent uppercase">
                    deprecated
                  </span>
                )}
              </td>
              <td className="py-2 pr-4">
                <code className="font-mono text-xs text-ink-soft">
                  {typeLinks(f.type, toModel, hasModel)}
                </code>
                {f.default !== undefined && f.default !== '' && (
                  <div className="mt-0.5 text-[0.7rem] text-ink-soft">
                    default <Term>{f.default}</Term>
                  </div>
                )}
              </td>
              <td className="py-2 pr-4 text-ink-soft">{f.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}