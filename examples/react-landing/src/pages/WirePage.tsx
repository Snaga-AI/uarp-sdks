/** `/docs/wire` — the 16 contract scenarios. Filled in Phase 4. */
import { Link } from 'react-router-dom';

export function WirePage() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Wire</h2>
      <p className="text-ink-soft">
        Every SDK is pinned against the same sixteen contract scenarios — the same calls
        replayed in TypeScript, Rust, Swift, Kotlin and Ada, with a gate that refuses to pass
        on fewer than two. The scenario table and the per-language call code will be rendered
        here in a later phase.
      </p>
      <p className="text-sm text-ink-soft">
        The source is{' '}
        <a className="text-accent underline underline-offset-2" href="https://github.com/Snaga-AI/uarp-sdks/tree/main/contract/SCENARIOS.md">
          contract/SCENARIOS.md
        </a>
        . Until then, the{' '}
        <Link className="text-accent underline underline-offset-2" to="/docs/concepts/streaming">Streaming</Link>{' '}
        concept covers the SSE wire shape most of these pin.
      </p>
    </section>
  );
}