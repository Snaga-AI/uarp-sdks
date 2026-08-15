/**
 * Documentation for the TypeScript SDK, which demonstrates itself.
 *
 * The widget in the corner is not a mock-up: it runs the code described in the
 * "In the browser" section below, against whichever tenant's key you give it.
 */
import { useEffect, useState } from 'react';
import { AgentWidget } from './AgentWidget';
import { Code, Shell } from './docs/Code';
import { Note, Section } from './docs/Section';

const SECTIONS = [
  ['install', 'Install'],
  ['authenticate', 'Authenticate'],
  ['calling', 'Calling the API'],
  ['errors', 'Errors'],
  ['pagination', 'Pagination'],
  ['streaming', 'Streaming'],
  ['idempotency', 'Idempotency and retries'],
  ['overrides', 'Per-call overrides'],
  ['browser', 'In the browser'],
  ['limits', 'Limits'],
] as const;

function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0][0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    for (const [id] of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

export function App() {
  const active = useActiveSection();

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <span className="font-mono text-sm font-semibold tracking-tight">uarp-sdk</span>
          <span className="rounded-full border border-slate-300 px-2 py-0.5 font-mono text-[0.7rem] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            0.3.0
          </span>
          <nav className="ml-auto hidden gap-5 text-sm text-slate-600 sm:flex dark:text-slate-400">
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href="#browser">Browser</a>
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href="https://github.com/Snaga-AI/uarp-sdks">GitHub</a>
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href="https://www.npmjs.com/package/uarp-sdk">npm</a>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6">
        <section className="py-16 lg:py-20">
          <p className="font-mono text-xs tracking-[0.18em] text-slate-500 uppercase dark:text-slate-400">
            TypeScript client for the UARP platform
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            All 557 endpoints, typed, with streaming and retries you do not have to write.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            Generated from the platform's OpenAPI document, so every request body, response and
            enumeration is a named type. No runtime dependencies.
          </p>
          <div className="mt-8 max-w-xl">
            <Shell>npm install uarp-sdk</Shell>
          </div>
          <p className="mt-6 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            The widget in the bottom corner is running against a live tenant using exactly the code
            in <a className="underline" href="#browser">In the browser</a>. Give it your own key and it
            will answer from your agents.
          </p>
        </section>

        <div className="flex gap-12 pb-24">
          <aside className="hidden w-48 shrink-0 lg:block">
            <nav className="sticky top-20 flex flex-col gap-1 border-l border-slate-200 dark:border-slate-800">
              {SECTIONS.map(([id, title]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`-ml-px border-l py-1 pl-4 text-sm transition ${
                    active === id
                      ? 'border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {title}
                </a>
              ))}
            </nav>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col gap-12">
            <Section id="install" title="Install">
              <Shell>npm install uarp-sdk</Shell>
              <p className="text-slate-600 dark:text-slate-300">
                Node 18 or newer, or any runtime with a global <code className="rounded bg-slate-100 px-1 font-mono text-[0.85em] dark:bg-slate-800">fetch</code>.
                The package is ESM only.
              </p>
              <Note tone="warn">
                <strong>ESM only.</strong> <code>import</code> works everywhere.{' '}
                <code>require('uarp-sdk')</code> needs Node 22.12 or newer, where Node learned to
                require an ES module; below that a CommonJS caller needs{' '}
                <code>await import('uarp-sdk')</code>.
              </Note>
            </Section>

            <Section id="authenticate" title="Authenticate">
              <p className="text-slate-600 dark:text-slate-300">
                A bearer key in the form <code className="font-mono">uarp_&lt;prefix&gt;_&lt;secret&gt;</code>,
                passed explicitly or read from the environment.
              </p>
              <Code>{`import { UarpClient } from 'uarp-sdk';

// Explicit
const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });

// Or from the environment: UARP_API_KEY, then SNAGA_API_KEY.
// The base URL falls back to UARP_BASE_URL, then production.
const fromEnv = new UarpClient({});`}</Code>
              <Note tone="warn">
                Never construct a client with a key in code that reaches a browser. See{' '}
                <a className="underline" href="#browser">In the browser</a>.
              </Note>
            </Section>

            <Section id="calling" title="Calling the API">
              <p className="text-slate-600 dark:text-slate-300">
                Operations are grouped by resource. Every argument and every result is typed —
                there is no <code className="font-mono">any</code> in the generated surface.
              </p>
              <Code>{`const agent = await client.agents.create({ name: 'support' });

const page = await client.agents.list({ limit: 20 });
console.log(page.items.length, page.has_more);

const run = await client.runs.create({
  agent_id: agent.agent_id,
  input: { message: 'Summarise the last deploy.' },
});`}</Code>
              <p className="text-slate-600 dark:text-slate-300">
                The platform selects the model itself, so a create is just a name. Anything sent for{' '}
                <code className="font-mono">model</code> is accepted and ignored — the document says
                so explicitly.
              </p>
            </Section>

            <Section id="errors" title="Errors">
              <p className="text-slate-600 dark:text-slate-300">
                Failures arrive as RFC 9457 problem documents and are parsed into typed errors, with
                a subclass per status so you can catch the one you mean.
              </p>
              <Code>{`import { APIError, RateLimitError, UnprocessableEntityError } from 'uarp-sdk';

try {
  await client.agents.get(id);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.warn('retry after', error.retryAfterSeconds);
  } else if (error instanceof UnprocessableEntityError) {
    // Field-level failures, when the server sent them
    for (const failure of error.problem.errors ?? []) {
      console.error(failure.field, failure.message);
    }
  } else if (error instanceof APIError) {
    console.error(error.status, error.problem.title, error.correlationId);
  } else {
    throw error;  // not from the API — a timeout or a dropped connection
  }
}`}</Code>
            </Section>

            <Section id="pagination" title="Pagination">
              <p className="text-slate-600 dark:text-slate-300">
                Cursor-paginated endpoints get a second method that walks every page and yields
                items, so you never write the cursor loop.
              </p>
              <Code>{`for await (const agent of client.agents.listAll({ limit: 100 })) {
  console.log(agent.name);
}

// Or take the first N
import { collect } from 'uarp-sdk';
const first50 = await collect(client.agents.listAll(), 50);`}</Code>
              <Note>
                An empty page does not end the walk. This API applies the page size before
                filtering, so a request for two items can come back with none while there is more
                behind it — a walker that stops there reports an empty collection that is not empty.
                Runaway protection is a repeated-cursor check and a bound on consecutive empty
                pages instead.
              </Note>
            </Section>

            <Section id="streaming" title="Streaming">
              <p className="text-slate-600 dark:text-slate-300">
                The eleven server-sent-event endpoints return an async iterable that reopens with{' '}
                <code className="font-mono">Last-Event-ID</code> when a connection drops. A
                connection that delivered at least one event earns a fresh reconnect budget, so a
                flapping server cannot spin the loop.
              </p>
              <Code>{`const stream = client.runs.streamRunEvents(runId);

for await (const event of stream) {
  if (event.event === 'llm.chunk') {
    const { payload } = event.json<{ payload: { delta: string } }>();
    process.stdout.write(payload.delta);
  }
  if (event.event === 'run.completed') break;  // leaving the loop closes the request
}

// Or wait for one specific event
await client.runs.streamRunEvents(runId).until((e) => e.event === 'run.completed');`}</Code>
              <p className="text-slate-600 dark:text-slate-300">
                Text arrives as <code className="font-mono">payload.delta</code> on{' '}
                <code className="font-mono">llm.chunk</code>; the run ends with{' '}
                <code className="font-mono">run.completed</code> or{' '}
                <code className="font-mono">run.failed</code>.
              </p>
            </Section>

            <Section id="idempotency" title="Idempotency and retries">
              <p className="text-slate-600 dark:text-slate-300">
                Every mutating <code className="font-mono">/api/v1/*</code> call carries an{' '}
                <code className="font-mono">Idempotency-Key</code>, which is also what makes a write
                safe to retry. Transient failures — <code className="font-mono">408</code>,{' '}
                <code className="font-mono">409</code>, <code className="font-mono">429</code>,{' '}
                <code className="font-mono">5xx</code>, dropped connections — are retried with
                full-jitter backoff, honouring <code className="font-mono">Retry-After</code> and the{' '}
                <code className="font-mono">X-Should-Retry: false</code> opt-out.
              </p>
              <Code>{`// Reads always retry. Writes retry only because they carry a key.
const agent = await client.agents.create({ name: 'support' });

// Supply your own key to replay a create deliberately —
// the same key returns the same agent instead of making a second one.
await client.agents.create({ name: 'support' }, { idempotencyKey: 'onboarding-42' });`}</Code>
            </Section>

            <Section id="overrides" title="Per-call overrides">
              <p className="text-slate-600 dark:text-slate-300">
                Timeout, retry budget, headers and an abort signal can be set for one call without
                building another client.
              </p>
              <Code>{`await client.runs.create(body, {
  timeout: 120_000,
  maxRetries: 0,
  headers: { 'X-Request-Id': requestId },
  signal: controller.signal,
});`}</Code>
            </Section>

            <Section id="browser" title="In the browser">
              <p className="text-slate-600 dark:text-slate-300">
                The SDK runs in a browser — but do not put a key there. On a public page, "the front
                end" means every visitor, and a key they can read is a key they can spend.
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                There is a second, more mechanical reason. The API sends{' '}
                <code className="font-mono">Access-Control-Allow-Origin</code> only for its own site,
                so a browser on any other origin has the response blocked before your code sees it:
              </p>
              <Code language="http">{`Origin: https://snaga.ai       → access-control-allow-origin: https://snaga.ai
Origin: http://localhost:5173  → no header, the browser blocks it`}</Code>
              <p className="text-slate-600 dark:text-slate-300">
                So the shape below is both the safe way and the only working way. It is what this
                page's own widget does.
              </p>
              <Code language="text">{`browser  ──POST /api/uarp/chat──▶  your server  ──uarp-sdk──▶  api.snaga.ai
   ▲                                    │
   └──────── text/event-stream ─────────┘        the key lives here, only here`}</Code>
              <p className="text-slate-600 dark:text-slate-300">
                On the server, consume the SDK's stream and re-emit a smaller one. The browser gets
                text and state, not the platform's full event envelope — which keeps the front end
                simple and stops the platform's wire format from setting in it.
              </p>
              <Code>{`// server: an ordinary Node handler, no framework
const run = await client.runs.create({ agent_id: agentId, input: { message } });

res.writeHead(200, { 'content-type': 'text/event-stream' });

for await (const event of client.runs.streamRunEvents(run.run_id)) {
  if (event.event === 'llm.chunk') {
    const delta = event.json<{ payload?: { delta?: string } }>().payload?.delta;
    if (delta) res.write(\`event: delta\\ndata: \${JSON.stringify({ text: delta })}\\n\\n\`);
  }
  if (event.event === 'run.completed') break;
}
res.end();`}</Code>
              <p className="text-slate-600 dark:text-slate-300">
                In the browser, read it back from an ordinary <code className="font-mono">fetch</code>.{' '}
                <code className="font-mono">EventSource</code> cannot send a POST body, and an SSE
                frame ends at a <em>blank line</em> — which is exactly what naive line-splitting
                throws away.
              </p>
              <Code>{`const response = await fetch('/api/uarp/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ agentId, message }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let end = buffer.indexOf('\\n\\n');       // the frame separator, not '\\n'
  while (end !== -1) {
    handleFrame(buffer.slice(0, end));
    buffer = buffer.slice(end + 2);
    end = buffer.indexOf('\\n\\n');
  }
}`}</Code>
              <Note>
                The whole of this example — the proxy, the widget and a Playwright test that drives
                it in a real browser — is in{' '}
                <a className="underline" href="https://github.com/Snaga-AI/uarp-sdks/tree/main/examples/react-landing">
                  examples/react-landing
                </a>
                . The test asserts the key never reaches the browser's storage, so a refactor that
                started keeping it there would fail.
              </Note>
            </Section>

            <Section id="limits" title="Limits">
              <p className="text-slate-600 dark:text-slate-300">
                Two things that are easier to read here than to discover.
              </p>
              <Note tone="warn">
                <strong>Integers past 2<sup>53</sup> lose precision.</strong> A JavaScript number is
                a double. No endpoint sends one today, and typing every integer in the document as{' '}
                <code>bigint</code> would make the ordinary case worse — so this is documented
                rather than defended against.
              </Note>
              <Note tone="warn">
                <strong>Enumerations stay open.</strong> A value the API adds tomorrow decodes into
                the existing type instead of failing, so a{' '}
                <code>switch</code> over one needs a default branch.
              </Note>
            </Section>

            <Section id="next" title="Where to go next">
              <ul className="ml-4 flex list-disc flex-col gap-2 text-slate-600 dark:text-slate-300">
                <li>
                  <a className="underline" href="https://github.com/Snaga-AI/uarp-sdks">Snaga-AI/uarp-sdks</a>{' '}
                  — source, changelog, and the same client for Rust, Swift, Kotlin and Ada. All five
                  share one version and one API surface.
                </li>
                <li>
                  <a className="underline" href="https://www.npmjs.com/package/uarp-sdk">uarp-sdk on npm</a>{' '}
                  — published with provenance; TypeScript sources ship with the package, so
                  go-to-definition lands in real code rather than a declaration file.
                </li>
                <li>
                  The package README covers multipart uploads, binary downloads and the escape hatch
                  for calling an endpoint the generated surface does not cover.
                </li>
              </ul>
            </Section>
          </main>
        </div>
      </div>

      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-slate-500 dark:text-slate-400">
          Documentation for <span className="font-mono">uarp-sdk@0.3.0</span>. This page is itself the
          example: everything it describes is running here.
        </div>
      </footer>

      <AgentWidget />
    </div>
  );
}
