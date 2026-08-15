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
import {
  AUTHENTICATE,
  CALLING,
  ERRORS,
  INSTALL,
  LANGUAGES,
  OVERRIDES,
  PAGINATION,
  STREAMING,
  type LanguageId,
} from './docs/content';

const LANGUAGE_KEY = 'uarp-docs-language';

/** Where each package actually lives, for the link in the header. */
const REGISTRY_URL: Record<LanguageId, string> = {
  ts: 'https://www.npmjs.com/package/uarp-sdk',
  rust: 'https://crates.io/crates/uarp-sdk',
  swift: 'https://github.com/Snaga-AI/uarp-swift',
  kotlin: 'https://central.sonatype.com/artifact/ai.snaga/uarp-sdk',
  ada: 'https://github.com/alire-project/alire-index/pull/2059',
};

/**
 * The chosen language sticks.
 *
 * Someone who works in Rust should not have to pick it again on every visit,
 * and a link shared into a Swift team should be able to carry `#swift`.
 */
function useLanguage(): [LanguageId, (next: LanguageId) => void] {
  const [language, setLanguage] = useState<LanguageId>('ts');

  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '');
    const known = LANGUAGES.map((entry) => entry.id) as string[];
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (known.includes(fromHash)) setLanguage(fromHash as LanguageId);
    else if (stored && known.includes(stored)) setLanguage(stored as LanguageId);
  }, []);

  return [
    language,
    (next: LanguageId) => {
      setLanguage(next);
      localStorage.setItem(LANGUAGE_KEY, next);
    },
  ];
}

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
  const [language, setLanguage] = useLanguage();
  const current = LANGUAGES.find((entry) => entry.id === language)!;
  const install = INSTALL[language];

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <span className="font-mono text-sm font-semibold tracking-tight">UARP SDKs</span>
          <span className="rounded-full border border-slate-300 px-2 py-0.5 font-mono text-[0.7rem] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            0.3.0
          </span>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
            {LANGUAGES.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setLanguage(entry.id)}
                className={`rounded px-2 py-1 text-xs transition ${
                  language === entry.id
                    ? 'bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <nav className="hidden gap-5 text-sm text-slate-600 lg:flex dark:text-slate-400">
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href="#browser">Browser</a>
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href="https://github.com/Snaga-AI/uarp-sdks">GitHub</a>
            <a className="hover:text-slate-900 dark:hover:text-slate-100" href={REGISTRY_URL[language]}>
              {current.registry}
            </a>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6">
        <section className="py-16 lg:py-20">
          <p className="font-mono text-xs tracking-[0.18em] text-slate-500 uppercase dark:text-slate-400">
            Client libraries for the UARP platform
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            All 557 endpoints, typed, with streaming and retries you do not have to write.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            Five clients — TypeScript, Rust, Swift, Kotlin and Ada — generated from one OpenAPI
            document, so every request body, response and enumeration is a named type and all five
            share a version. Pick a language; the samples below follow.
          </p>
          <div className="mt-8 max-w-2xl">
            {install.shell ? <Shell>{install.command}</Shell> : <Code language={language}>{install.command}</Code>}
            <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
              {current.registry} · {install.needs}
            </p>
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
              {install.shell ? <Shell>{install.command}</Shell> : <Code language={language}>{install.command}</Code>}
              <p className="text-slate-600 dark:text-slate-300">
                {current.name} · {current.registry} · needs {install.needs}.
              </p>
              {language === 'ts' && (
                <Note tone="warn">
                  <strong>ESM only.</strong> <code>import</code> works everywhere.{' '}
                  <code>require('uarp-sdk')</code> needs Node 22.12 or newer, where Node learned to
                  require an ES module; below that a CommonJS caller needs{' '}
                  <code>await import('uarp-sdk')</code>.
                </Note>
              )}
              {language === 'swift' && (
                <Note>
                  The package lives in its own repository: SwiftPM expects <code>Package.swift</code>{' '}
                  at a repository root, so it cannot see one inside a monorepo.{' '}
                  <code>Snaga-AI/uarp-swift</code> is a mirror published on every release; issues
                  belong in <code>Snaga-AI/uarp-sdks</code>.
                </Note>
              )}
              {language === 'kotlin' && (
                <Note tone="warn">
                  Built with <strong>Kotlin 2.2</strong>. A project on 2.0 fails with "Module was
                  compiled with an incompatible version of Kotlin" before it reaches any of the API.
                </Note>
              )}
              {language === 'ada' && (
                <Note tone="warn">
                  Not in the Alire community index yet — the submission is open as{' '}
                  <a className="underline" href="https://github.com/alire-project/alire-index/pull/2059">
                    alire-index#2059
                  </a>
                  . Until it lands, depend on the release tarball directly.
                </Note>
              )}
            </Section>

            <Section id="authenticate" title="Authenticate">
              <p className="text-slate-600 dark:text-slate-300">
                A bearer key in the form <code className="font-mono">uarp_&lt;prefix&gt;_&lt;secret&gt;</code>,
                passed explicitly or read from the environment.
              </p>
              <Code language={language}>{AUTHENTICATE[language]}</Code>
              <Note>
                <strong>Where a key comes from.</strong> Sign in at{' '}
                <a className="underline" href="https://snaga.ai">snaga.ai</a> and create one in your
                tenant settings; the secret half is shown once. With a key carrying{' '}
                <code>tenants:write</code> you can mint more from the SDK with{' '}
                <code>client.tenants.createAPIKey(…)</code>. Give each one the narrowest set of
                scopes that does its job.
              </Note>
              <Note tone="warn">
                Never construct a client with a key in code that reaches a browser. See{' '}
                <a className="underline" href="#browser">In the browser</a>.
              </Note>
            </Section>

            <Section id="calling" title="Calling the API">
              <p className="text-slate-600 dark:text-slate-300">
                Operations are grouped by resource. Every argument and every result is typed —
                there is no <code className="font-mono">any</code> in the generated surface. Where
                the API document describes no shape, the SDKs say so instead of inventing one: 60
                operations take a free-form body and 243 return one, in the same places in all five
                languages.
              </p>
              <Code language={language}>{CALLING[language]}</Code>
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
              <Code language={language}>{ERRORS[language]}</Code>
            </Section>

            <Section id="pagination" title="Pagination">
              <p className="text-slate-600 dark:text-slate-300">
                Cursor-paginated endpoints get a second method that walks every page and yields
                items, so you never write the cursor loop.
              </p>
              <Code language={language}>{PAGINATION[language]}</Code>
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
              <Code language={language}>{STREAMING[language]}</Code>
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
                <code className="font-mono">500</code>, <code className="font-mono">502</code>,{' '}
                <code className="font-mono">503</code>, <code className="font-mono">504</code>,
                dropped connections — are retried with
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
              <Code language={language}>{OVERRIDES[language]}</Code>
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
          Documentation for the UARP client libraries at <span className="font-mono">0.3.0</span> —
          one version across all five. This page is itself the example: everything it describes is
          running here, and the TypeScript samples are compiled on every build.
        </div>
      </footer>

      <AgentWidget />
    </div>
  );
}
