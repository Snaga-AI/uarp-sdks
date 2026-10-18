# The SDKs' documentation, which runs an SDK

A React, Tailwind and TypeScript page documenting all five UARP clients —
install, authentication, errors, pagination, streaming, idempotency, per-call
overrides and the limits — with a live agent answering in the corner.

Pick a language in the header and every sample on the page follows it. The
choice is remembered, and `#rust` in the URL selects one for a link you share.
The samples are the ones compiled during the audit, per language, against the
packages as published — not written from memory, which is how this
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
