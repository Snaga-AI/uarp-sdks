/**
 * The ten conceptual sections, each one a routed page now rather than an anchor.
 *
 * The bodies are lifted verbatim from the old single-page App — only the source
 * of the active language changed, from a `useState` hook to the URL-backed
 * `useLanguage` (so `?lang=swift` carries into any deep route). The prose, the
 * `Note`s, the language-conditional warnings and the hand-written TS snippets
 * are untouched.
 */
import type { ReactElement } from 'react';
import { Code, Shell } from '../docs/Code';
import { Note, Term } from '../docs/Section';
import {
  AUTHENTICATE,
  CALLING,
  ERRORS,
  INSTALL,
  LANGUAGES,
  OVERRIDES,
  PAGINATION,
  STREAMING,
} from '../docs/content';
import { useLanguage } from '../hooks/useLanguage';

export interface Concept {
  slug: string;
  title: string;
  Body: () => ReactElement;
}

function InstallBody(): ReactElement {
  const { language } = useLanguage();
  const install = INSTALL[language];
  const current = LANGUAGES.find((entry) => entry.id === language)!;
  return (
    <>
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
    </>
  );
}

function AuthenticateBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
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
        <a className="underline" href="/docs/concepts/browser">In the browser</a>.
      </Note>
    </>
  );
}

function CallingBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
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
    </>
  );
}

function ErrorsBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
      <p className="text-ink-soft">
        Failures arrive as RFC 9457 problem documents and are parsed into typed errors, with
        a subclass per status so you can catch the one you mean.
      </p>
      <Code language={language}>{ERRORS[language]}</Code>
    </>
  );
}

function PaginationBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
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
    </>
  );
}

function StreamingBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
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
    </>
  );
}

function IdempotencyBody(): ReactElement {
  return (
    <>
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
    </>
  );
}

function OverridesBody(): ReactElement {
  const { language } = useLanguage();
  return (
    <>
      <p className="text-ink-soft">
        Timeout, retry budget, headers and an abort signal can be set for one call without
        building another client.
      </p>
      <Code language={language}>{OVERRIDES[language]}</Code>
    </>
  );
}

function BrowserBody(): ReactElement {
  return (
    <>
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
    </>
  );
}

function LimitsBody(): ReactElement {
  return (
    <>
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
    </>
  );
}

export const CONCEPT_ORDER = [
  'install',
  'authenticate',
  'calling',
  'errors',
  'pagination',
  'streaming',
  'idempotency',
  'overrides',
  'browser',
  'limits',
] as const;

export const CONCEPTS: Record<string, Concept> = {
  install: { slug: 'install', title: 'Install', Body: InstallBody },
  authenticate: { slug: 'authenticate', title: 'Authenticate', Body: AuthenticateBody },
  calling: { slug: 'calling', title: 'Calling the API', Body: CallingBody },
  errors: { slug: 'errors', title: 'Errors', Body: ErrorsBody },
  pagination: { slug: 'pagination', title: 'Pagination', Body: PaginationBody },
  streaming: { slug: 'streaming', title: 'Streaming', Body: StreamingBody },
  idempotency: { slug: 'idempotency', title: 'Idempotency and retries', Body: IdempotencyBody },
  overrides: { slug: 'overrides', title: 'Per-call overrides', Body: OverridesBody },
  browser: { slug: 'browser', title: 'In the browser', Body: BrowserBody },
  limits: { slug: 'limits', title: 'Limits', Body: LimitsBody },
};