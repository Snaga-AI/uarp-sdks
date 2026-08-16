/**
 * Search over the reference — methods, groups and models in one index.
 *
 * MiniSearch is imported dynamically so it lands in its own chunk and never
 * reaches a reader who never opens the search box. The index is built from the
 * already-fetched reference payload, so there is no second round-trip.
 */
import { loadReference } from './reference';

export type SearchKind = 'method' | 'group' | 'model';

export interface SearchHit {
  kind: SearchKind;
  label: string;       // what to show: "agents.create" / "Agents" / "CreateAgentRequest"
  detail?: string;     // summary, or the VERB /path, or "object · 12 fields"
  to: string;          // route
}

let indexPromise: Promise<{ search: (q: string) => SearchHit[] }> | null = null;

export function useSearch(): Promise<{ search: (q: string) => SearchHit[] }> {
  if (!indexPromise) indexPromise = buildIndex();
  return indexPromise;
}

async function buildIndex() {
  const [{ default: MiniSearch }, ref] = await Promise.all([
    import('minisearch'),
    loadReference(),
  ]);

  interface Doc {
    id: string;
    kind: SearchKind;
    label: string;
    detail: string;
    to: string;
    // denormalised, for the searcher to re-hydrate the hit
    group: string;
    method: string;
    model: string;
  }

  const docs: Doc[] = [];
  for (const g of ref.groups) {
    docs.push({
      id: `g:${g.accessor}`,
      kind: 'group',
      label: g.accessor,
      detail: g.description,
      to: `/docs/reference/${g.accessor}`,
      group: g.accessor, method: '', model: '',
    });
    for (const m of g.methods) {
      docs.push({
        id: `m:${g.accessor}.${m.name}`,
        kind: 'method',
        label: `${g.accessor}.${m.name}`,
        detail: m.summary || (m.httpMethod && m.path ? `${m.httpMethod} ${m.path}` : ''),
        to: `/docs/reference/${g.accessor}/${m.name}`,
        group: g.accessor, method: m.name, model: '',
      });
    }
  }
  for (const [name, model] of Object.entries(ref.models)) {
    docs.push({
      id: `d:${name}`,
      kind: 'model',
      label: name,
      detail: model.kind === 'object' ? `object · ${model.fields.length} fields` : `enum · ${model.values.length} values`,
      to: `/docs/reference/model/${name}`,
      group: '', method: '', model: name,
    });
  }

  const ms = new MiniSearch<Doc>({
    fields: ['label', 'detail', 'group', 'method', 'model'],
    storeFields: ['kind', 'label', 'detail', 'to'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { label: 3, method: 2, group: 2, model: 2 },
    },
  });
  ms.addAll(docs);

  return {
    search: (q: string): SearchHit[] => {
      const query = q.trim();
      if (!query) return [];
      return ms.search(query).map((r) => ({
        kind: r.kind,
        label: r.label,
        detail: r.detail,
        to: r.to,
      }));
    },
  };
}