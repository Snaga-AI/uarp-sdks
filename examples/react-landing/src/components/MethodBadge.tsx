/** The small markers that follow a method around — SSE, paginated, deprecated. */
import type { MethodInfo } from '../data/reference';

export function MethodBadge({ method }: { method: MethodInfo }) {
  return (
    <>
      {method.sse && (
        <span className="rounded-sm border border-accent/40 px-1 py-0.5 font-mono text-[0.55rem] tracking-wider text-accent uppercase">
          sse
        </span>
      )}
      {method.paginated && (
        <span className="rounded-sm border border-rule-soft px-1 py-0.5 font-mono text-[0.55rem] tracking-wider text-ink-soft uppercase">
          paginate
        </span>
      )}
      {method.deprecated && (
        <span className="rounded-sm border border-accent/50 px-1 py-0.5 font-mono text-[0.55rem] tracking-wider text-accent uppercase">
          deprecated
        </span>
      )}
    </>
  );
}