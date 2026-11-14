# The SDKs' documentation, which runs an SDK

A React, Tailwind and TypeScript page documenting all six UARP clients —
install, authentication, errors, pagination, streaming, idempotency, per-call
overrides and the limits — with a live agent answering in the corner.

Choose an example language beside a multi-language code block or in the sidebar;
all shared samples follow it. TypeScript-only reference examples stay explicitly labeled. The
choice is remembered, and `#rust` in the URL selects one for a link you share.
The samples are checked by `npm run check:samples`, against SDK 0.13.6 — not written from memory, which is how this
documentation was wrong before.

The widget is not an illustration. It runs the code the page describes, against
whichever tenant's key you paste into it, which is the point: a documented
pattern that is also executing on the page it is documented on cannot quietly
drift out of date.

```sh
npm install
npm run dev            # http://localhost:5173
```

Open the page, click **Ask the agent**, paste a UARP API key, and ask something.
The reply streams in token by token.

## What this is actually demonstrating

The page is the documentation; `server/handlers.ts` is the pattern it
documents.

```
browser  ──POST /api/uarp/chat──▶  your server  ──uarp-sdk──▶  api.snaga.ai
   ▲                                    │
   └──────── text/event-stream ─────────┘        the key lives here, only here
```

The browser never holds a key and never calls the platform. It posts to
`/api/uarp/*` on its own origin; the server holds the key, calls the API with
the SDK, and forwards the answer as it arrives.

**Do not put an API key in front-end code.** On a landing page, "the front end"
means every visitor, and a key that reaches them can spend your tenant's tokens.
This is the one thing to take away from this example.

There is a second, more mechanical reason: the API sends
`Access-Control-Allow-Origin` only for its own site, so a browser on any other
origin has the response blocked before your code sees it. Checked while writing
this:

```
Origin: https://snaga.ai       → access-control-allow-origin: https://snaga.ai
Origin: http://localhost:5173  → no header, browser blocks it
```

So the proxy is both the safe way and the working way. The security reason is
the one that would still apply if CORS were wide open.

## Where the key goes

1. You paste it into the widget.
2. It is posted once to `/api/uarp/session` on **this** project's server.
3. That server checks it by calling `auth.getMe()`, keeps a `UarpClient` in
   memory, and answers with a random session id.
4. The browser stores only the session id. Restarting the dev server forgets
   every key.

The session id is a bearer of that key's power for the life of the dev server,
which is fine for a playground on your own machine and is *not* a pattern to
ship. In production the key comes from the server's own environment and no one
types it into a page at all.

## Taking it to production

`server/handlers.ts` imports nothing from Vite — they are plain Node request
handlers, so the same file drops into a Next.js route handler, an Express app,
a Cloudflare Worker or a Lambda with a thin adapter. `vite.config.ts` mounts
them on the dev server; that is the only Vite-specific line.

What changes in production:

- The key comes from the environment, not from a form. Delete the session code
  and construct one `UarpClient` at startup.
- Add whatever authentication your own site uses, so that only your visitors can
  spend your tokens.
- Rate-limit. A chat endpoint backed by a paid model is worth abusing.

## The stream

The server consumes the SDK's event stream and re-emits a much smaller one — the
browser gets text and state, not the platform's full event envelope:

| Platform event | Sent to the browser |
|---|---|
| `llm.chunk` | `delta` with `payload.delta`, the text |
| `run.completed` / `run.failed` | `done` |
| anything else | `step`, so the widget can show progress before the first token |

That keeps the widget simple, and it means the platform's wire format is not
baked into your front end. `EventSource` cannot send a POST body, so the browser
reads the stream from an ordinary `fetch` response; `useAgent.ts` has the parser,
which splits on the blank line that terminates an SSE frame rather than on
newlines — a detail most hand-rolled parsers get wrong.

## How the page is built

- `src/App.tsx` — the documentation itself. Sections carry stable anchors so a
  reply in a chat can point at one.
- `src/docs/Code.tsx` — code blocks with a copy button, which is the primary
  action on a page whose whole purpose is to be taken away.
- `src/docs/highlight.ts` — a fifty-line TypeScript tokeniser. A highlighter
  from a CDN would be a third-party script on a page that asks people to paste
  an API key, and bundling a full one costs more than every sample here put
  together. It handles comments, strings, numbers, keywords and type names, and
  when it meets something it does not know the worst outcome is a plain word.

## Deployed

This example is running at **<https://dev.snaga.ai>**, as a Cloudflare Worker
that serves the built page as static assets (`wrangler.jsonc`,
`worker/index.ts`). It moved there on 2026-10-18, when the droplet that ran it
as a container went offline. The custom-domain binding owns the `dev` DNS
record, so a deploy does not touch any other record in the zone.

The live widget is **not** running there. Its proxy, `handleUarp`, keeps each
visitor's key in the memory of one Node process, and a Worker has no such
process: isolates come and go. Until the proxy is ported (a Durable Object would
hold the same state), `/api/uarp/*` answers `503` with a message saying so,
rather than falling through to `index.html`, which the widget would try to read
as JSON. Everything else on the page is static.

To redeploy, build from the **repo root's** checkout (the build-time generators
read `packages/typescript/src/generated/`, `contract/SCENARIOS.md` and the
runners, which live outside this directory), then deploy:

```sh
npm ci && npm run build
npx -y wrangler@4.147.0 deploy      # after `wrangler login` to the account that owns snaga.ai
```

Verify by comparing the `assets/index-*.js` name that `https://dev.snaga.ai/`
references with the one in `dist/assets/`.

`server/serve.ts` still runs the whole example, widget included, as ordinary
Node anywhere: `npm run build && npm run serve`. Because it is public there,
`/api/uarp/session` answers "is this key valid?" to anyone who asks, which makes
it a guessing oracle; it is rate limited to ten attempts a minute per address.
The keys visitors paste are their own; the deployment holds no key of its own.

## Tests

```sh
UARP_API_KEY=uarp_… npm run test:e2e
```

Playwright drives a real browser against the real API: it opens the page, pastes
the key, sends a message and waits for streamed text to appear. It also asserts
that the key never reaches `sessionStorage` — the test would fail if a
refactor started keeping it in the browser.

Without `UARP_API_KEY` the streaming test skips and the render test still runs,
so the suite is useful without a tenant.

## Keeping the documentation version aligned

The documentation pins `uarp-sdk` to the version it describes. The reference
build checks that the installed SDK, repository `VERSION`, TypeScript package
version and generated SDK metadata agree; a mismatch stops the build instead
of showing a stale version in the header.

When updating a release, update the documentation dependency and its lockfile
with `npm install --save-exact uarp-sdk@<version>` from this directory. Verify the
Swift mirror tag before changing `SWIFT_MIRROR` in `src/docs/content.ts`.

## Navigation and developer experience

The header switches documentation sections: Quickstart, Guides, API reference
and Concepts. Programming language is a synchronized sample preference, available
beside multilingual code blocks and in the sidebar; it is retained in local
storage and `?lang=`, without removing the current section anchor. A fixed
TypeScript reference never advertises unavailable language translations.

The reference sidebar expands resources into their methods. Search is available
on every route with Cmd/Ctrl-K, supports guides, concepts and reference entries,
and accepts arrow keys, Enter and Escape. Mobile navigation uses a modal drawer.
Long code lines can wrap without altering copied text; large schemas can be
filtered by field/type and required status. Method pages keep a section index
visible on wide screens, highlight the current reading position and restore
direct links to sections after the reference finishes loading. The resource
tree scrolls its current method into view without moving the page content.

These decisions were informed by the primary sources reviewed on 2026-11-14:

- [Mintlify navigation](https://www.mintlify.com/docs/organize/navigation): top-level sections and contextual groups.
- [Mintlify code groups](https://www.mintlify.com/docs/components/code-groups): synchronized language controls beside examples, including a compact dropdown.
- [Supabase client libraries](https://supabase.com/docs/guides/api/rest/client-libs): distinct references for individual SDKs.
- [Diátaxis](https://diataxis.fr/): separate learning, task guides, reference and conceptual explanation.

These are design precedents, rather than usability-test results for this site.

### Mobile examples

On narrow screens, code and shell commands wrap by default. Each code block can
open in a modal reading view, with synchronized language selection and copy
controls. Closing it restores focus to the original Expand button. Copy falls
back to selecting the sample if clipboard access is unavailable. Mobile controls
have a minimum 44px touch height, and language inputs use a 16px font.

The mobile agent launcher lives in the header so it does not obscure examples.
Its panel stays within the viewport. The desktop launcher also lives in the
header, so the closed widget does not overlap reference tables or navigation.

### Whole-site layout audit

Run `node scripts/audit-layout.mjs` with the local dev server on port 4318.
It visits all authored documentation and every generated resource, method and
model at 320, 390 and 1440px. The report is written to
`/tmp/sdk-layout-audit.json`. Override `AUDIT_URL`, `AUDIT_WIDTHS` or
`AUDIT_OUTPUT` when needed. Explicit code scrollers are excluded from overflow
errors; mobile schemas use stacked fields with visible type and description.

## Checking displayed code

Run `npm run check:samples` to type-check the actual strings shown in the portal
and execute the six standalone Quickstarts against an in-process local fixture.
No production API calls are made. Node 22.18+ is required for this checker.
Install the six toolchains and run `uv sync --project ../../packages/python --group dev`
first. All six checks use SDK sources from this checkout, so an unpublished SDK
change cannot hide behind a previously published package. TypeScript is built
locally (install its build dependencies with `npm ci --prefix ../../packages/typescript`);
Swift uses a local SwiftPM dependency and Kotlin a Gradle composite build.
The reference is regenerated from current SDK sources before checking every
method signature. Ada uses semantic checks and a
non-optimized executable build, keeping documentation checks out of release
library build artifacts.
The first Ada executable build can take substantially longer than the other
languages because its generated models share one large compilation unit. Set
`DOCS_CHECK_DIR` to a persistent scratch directory to reuse compiler artifacts
on subsequent checks.

For a subset: `node scripts/check-samples.mjs ts python --run`.
The temporary workspace contains `inventory.json` and `results.json` with the
samples and validation results. Generated reference usage is checked against
all method signatures; contract snippets are excerpts from the separately
executable language runners under `../../contract`.

GitHub Actions runs `.github/workflows/docs-examples.yml` on every pull request
and push to main, with an independent job for each of the six languages. Each
job compiles the displayed samples and executes its Quickstart against the
local fixture; TypeScript also checks every generated API reference example.
Failures do not cancel the other language checks. The sample inventory,
successful results and compiler log are uploaded as per-language artifacts for
14 days, including logs from failed checks. No API key or other secret is needed.
