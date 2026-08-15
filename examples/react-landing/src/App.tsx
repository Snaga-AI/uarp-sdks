/**
 * Documentation for the TypeScript SDK, which demonstrates itself.
 *
 * The widget in the corner is not a mock-up: it runs the code described in the
 * "In the browser" section below, against whichever tenant's key you give it.
 */
import { useEffect, useState } from 'react';
import { VERSION } from 'uarp-sdk';
import { AgentWidget } from './AgentWidget';
import { Code, Shell } from './docs/Code';
import { Note, Section, Term } from './docs/Section';
import {
  AUTHENTICATE,
  CALLING,
  HELLO,
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
    <div className="min-h-screen bg-desk text-ink">
      {/*
        The header follows snaga.ai's own: a way back to the site on the left,
        what this page is in the middle, what you do next on the right. This
        portal is the "SDKs" entry in that site's sidebar, so crossing over
        should not feel like arriving at a different product.
      */}
      <header className="sticky top-0 z-40 border-b border-rule-soft bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-5">
          <a href="https://snaga.ai" className="flex shrink-0 items-center gap-2 text-sm font-semibold hover:text-accent">
            <span aria-hidden>←</span> Snaga
          </a>
          <div className="hidden min-w-0 flex-1 text-center sm:block">
            <p className="text-sm font-semibold">SDKs</p>
            <p className="font-mono text-[0.7rem] text-ink-soft">{VERSION}</p>
          </div>
          <div className="ml-auto flex items-center gap-0.5 overflow-x-auto rounded-sm border border-rule-soft p-0.5 sm:ml-0">
            {LANGUAGES.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setLanguage(entry.id)}
                className={`shrink-0 rounded-sm px-2 py-1 text-xs transition ${
                  language === entry.id
                    ? 'bg-ink font-medium text-paper'
                    : 'text-ink-soft hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <a
            href={REGISTRY_URL[language]}
            className="hidden shrink-0 rounded-sm border border-rule-soft px-3 py-1.5 text-sm hover:bg-ink/5 lg:block"
          >
            {current.registry}
          </a>
          <a
            href="https://github.com/Snaga-AI/uarp-sdks"
            className="hidden shrink-0 rounded-sm border border-rule-soft px-3 py-1.5 text-sm hover:bg-ink/5 lg:block"
          >
            GitHub
          </a>
        </div>
      </header>

      {/*  Paper on a desk, the way the rest of the site is laid out. */}
      <div className="mx-auto max-w-6xl p-3 sm:p-5">
       <div className="rounded-lg border border-rule-soft bg-paper px-5 py-10 sm:px-10 lg:px-12">
        <section className="pb-14">
          <p className="font-mono text-xs tracking-[0.18em] text-ink-soft uppercase">
            Client libraries for the UARP platform
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl">
            Three lines to an agent that answers.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">
            One OpenAPI document, five clients — TypeScript, Rust, Swift, Kotlin and Ada — released
            together on one version number. Around 95% of each is generated, so they cannot drift
            from the platform or from each other.
          </p>
          <div className="mt-8 grid max-w-3xl min-w-0 gap-3">
            {install.shell ? <Shell>{install.command}</Shell> : <Code language={language}>{install.command}</Code>}
            <Code language={language}>{HELLO[language]}</Code>
            <p className="font-mono text-xs text-ink-soft">
              {current.registry} · {install.needs}
            </p>
          </div>
          <p className="mt-6 max-w-2xl text-sm text-ink-soft">
            The widget in the bottom corner runs exactly the code in{' '}
            <a className="text-accent underline underline-offset-2" href="#browser">In the browser</a>.
            Give it your own key and it answers from your agents.
          </p>
        </section>

        <div className="flex gap-12 pb-8">
          <aside className="hidden w-48 shrink-0 lg:block">
            <nav className="sticky top-20 flex flex-col gap-1 border-l border-rule-soft">
              {SECTIONS.map(([id, title]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`-ml-px border-l py-1 pl-4 text-sm transition ${
                    active === id
                      ? 'border-ink font-medium text-ink'
                      : 'border-transparent text-ink-soft hover:text-ink'
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
              <p className="text-ink-soft">
                {current.name} · {current.registry} · needs {install.needs}.
              </p>
              {language === 'ts' && (
                <Note tone="warn">
                  <strong>ESM only.</strong> <Term>import</Term> works everywhere.{' '}
                  <Term>require('uarp-sdk')</Term> needs Node 22.12 or newer, where Node learned to
                  require an ES module; below that a CommonJS caller needs{' '}
                  <Term>await import('uarp-sdk')</Term>.
                </Note>
              )}
              {language === 'swift' && (
                <Note>
                  The package lives in its own repository: SwiftPM expects <Term>Package.swift</Term>{' '}
                  at a repository root, so it cannot see one inside a monorepo.{' '}
                  <Term>Snaga-AI/uarp-swift</Term> is a mirror published on every release; issues
                  belong in <Term>Snaga-AI/uarp-sdks</Term>.
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
              <p className="text-ink-soft">
                A bearer key in the form <Term>uarp_&lt;prefix&gt;_&lt;secret&gt;</Term>,
                passed explicitly or read from the environment.
              </p>
              <Code language={language}>{AUTHENTICATE[language]}</Code>
              <Note>
                <strong>Where a key comes from.</strong> Sign in at{' '}
                <a className="underline" href="https://snaga.ai">snaga.ai</a> and create one in your
                tenant settings; the secret half is shown once. With a key carrying{' '}
                <Term>tenants:write</Term> you can mint more from the SDK with{' '}
                <Term>client.tenants.createAPIKey(…)</Term>. Give each one the narrowest set of
                scopes that does its job.
              </Note>
              <Note tone="warn">
                Never construct a client with a key in code that reaches a browser. See{' '}
                <a className="underline" href="#browser">In the browser</a>.
              </Note>
            </Section>

            <Section id="calling" title="Calling the API">
              <p className="text-ink-soft">
                Operations are grouped by resource. Every argument and every result is typed —
                there is no <Term>any</Term> in the generated surface. Where
                the API document describes no shape, the SDKs say so instead of inventing one: 60
                operations take a free-form body and 243 return one, in the same places in all five
                languages.
              </p>
              <Code language={language}>{CALLING[language]}</Code>
              <p className="text-ink-soft">
                The platform selects the model itself, so a create is just a name. Anything sent for{' '}
                <Term>model</Term> is accepted and ignored — the document says
                so explicitly.
              </p>
              {/*
                The size of the surface is a fact about the platform, not a
                selling point, so it sits here rather than in the headline —
                and it is broken down, because "557 endpoints" on its own reads
                as work rather than coverage.
              */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t border-rule-soft pt-4 text-sm text-ink-soft">
                <dt className="font-medium text-ink">557 operations</dt>
                <dd>
                  across 412 paths and 43 resource groups. 314 are the ordinary five —
                  list, create, read, update, delete — on 56 resources; the other 243 are nested
                  collections and named actions like <Term>cancel</Term>, <Term>approve</Term> and{' '}
                  <Term>rollback</Term>.
                </dd>
                <dt className="font-medium text-ink">114 of them admin</dt>
                <dd>
                  the two admin groups, which the{' '}
                  <a className="text-accent underline underline-offset-2" href="https://snaga.ai/docs">API reference</a>{' '}
                  leaves out — that is why it counts around 440 where this page counts 557. The SDKs
                  generate all of them; you only ever see the group you call.
                </dd>
                <dt className="font-medium text-ink">603 models</dt>
                <dd>505 objects and 98 enumerations, each a named type in your language</dd>
              </dl>
            </Section>

            <Section id="errors" title="Errors">
              <p className="text-ink-soft">
                Failures arrive as RFC 9457 problem documents and are parsed into typed errors, with
                a subclass per status so you can catch the one you mean.
              </p>
              <Code language={language}>{ERRORS[language]}</Code>
            </Section>

            <Section id="pagination" title="Pagination">
              <p className="text-ink-soft">
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
              <p className="text-ink-soft">
                The eleven server-sent-event endpoints return an async iterable that reopens with{' '}
                <Term>Last-Event-ID</Term> when a connection drops. A
                connection that delivered at least one event earns a fresh reconnect budget, so a
                flapping server cannot spin the loop.
              </p>
              <Code language={language}>{STREAMING[language]}</Code>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm text-ink-soft">
                <dt className="font-medium text-ink">Text</dt>
                <dd>
                  arrives at <Term>payload.delta</Term> on the <Term>llm.chunk</Term> event
                </dd>
                <dt className="font-medium text-ink">End of a run</dt>
                <dd>
                  <Term>run.completed</Term> or <Term>run.failed</Term>
                </dd>
              </dl>
            </Section>

            <Section id="idempotency" title="Idempotency and retries">
              <p className="text-ink-soft">
                Every mutating <Term>/api/v1/*</Term> call carries an idempotency key, which is also
                what makes a write safe to retry. Transient failures are retried with full-jitter
                backoff.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm text-ink-soft">
                <dt className="font-medium text-ink">Retried</dt>
                <dd>
                  <Term>408 409 429 500 502 503 504</Term>, and dropped connections. Not every 5xx:{' '}
                  <Term>501</Term> is a permanent answer.
                </dd>
                <dt className="font-medium text-ink">Header sent</dt>
                <dd>
                  <Term>Idempotency-Key</Term>, on every mutating call
                </dd>
                <dt className="font-medium text-ink">Headers honoured</dt>
                <dd>
                  <Term>Retry-After</Term>, and <Term>X-Should-Retry: false</Term> to opt out
                </dd>
              </dl>
              <Code>{`// Reads always retry. Writes retry only because they carry a key.
const agent = await client.agents.create({ name: 'support' });

// Supply your own key to replay a create deliberately —
// the same key returns the same agent instead of making a second one.
await client.agents.create({ name: 'support' }, { idempotencyKey: 'onboarding-42' });`}</Code>
            </Section>

            <Section id="overrides" title="Per-call overrides">
              <p className="text-ink-soft">
                Timeout, retry budget, headers and an abort signal can be set for one call without
                building another client.
              </p>
              <Code language={language}>{OVERRIDES[language]}</Code>
            </Section>

            <Section id="browser" title="In the browser">
              <p className="text-ink-soft">
                The SDK runs in a browser — but do not put a key there. On a public page, "the front
                end" means every visitor, and a key they can read is a key they can spend.
              </p>
              <p className="text-ink-soft">
                There is a second, more mechanical reason. The API sends{' '}
                <Term>Access-Control-Allow-Origin</Term> only for its own site,
                so a browser on any other origin has the response blocked before your code sees it:
              </p>
              <Code language="http">{`Origin: https://snaga.ai       → access-control-allow-origin: https://snaga.ai
Origin: http://localhost:5173  → no header, the browser blocks it`}</Code>
              <p className="text-ink-soft">
                So the shape below is both the safe way and the only working way. It is what this
                page's own widget does.
              </p>
              <Code language="text">{`browser  ──POST /api/uarp/chat──▶  your server  ──uarp-sdk──▶  api.snaga.ai
   ▲                                    │
   └──────── text/event-stream ─────────┘        the key lives here, only here`}</Code>
              <p className="text-ink-soft">
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
              <p className="text-ink-soft">
                In the browser, read it back from an ordinary <Term>fetch</Term>.{' '}
                <Term>EventSource</Term> cannot send a POST body, and an SSE
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
              <p className="text-ink-soft">
                Two things that are easier to read here than to discover.
              </p>
              <Note tone="warn">
                <strong>Integers past 2<sup>53</sup> lose precision.</strong> A JavaScript number is
                a double. No endpoint sends one today, and typing every integer in the document as{' '}
                <Term>bigint</Term> would make the ordinary case worse — so this is documented
                rather than defended against.
              </Note>
              <Note tone="warn">
                <strong>Enumerations stay open.</strong> A value the API adds tomorrow decodes into
                the existing type instead of failing, so a{' '}
                <Term>switch</Term> over one needs a default branch.
              </Note>
            </Section>

            <Section id="next" title="Where to go next">
              <ul className="ml-4 flex list-disc flex-col gap-2 text-ink-soft">
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

        <footer className="border-t border-rule-soft pt-8 text-sm text-ink-soft">
          Documentation for the UARP client libraries at{' '}
          <span className="font-mono">{VERSION}</span> — one version across all five. This page is
          itself the example: everything it describes is running here, and the TypeScript and Rust
          samples are compiled on every build.
        </footer>
       </div>
      </div>

      <AgentWidget />
    </div>
  );
}
