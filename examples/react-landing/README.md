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

This example is running at **<https://dev.snaga.ai>**.

It is the same code, with `server/serve.ts` instead of Vite: that file serves
the built page and mounts the same `handleUarp`, which is the example's own
claim about the proxy being ordinary Node put to the test.

```
Caddy (dev.snaga.ai)  ──▶  snaga-dev-portal:3001  ──uarp-sdk──▶  api.snaga.ai
```

A container on the same host as the API, behind the same Caddy, in its own
block — nothing about the existing hosts changed.

Because it is public, `/api/uarp/session` answers "is this key valid?" to
anyone who asks, which makes it a guessing oracle. It is rate limited to ten
attempts a minute per address. The keys visitors paste are their own; this
deployment holds no key of its own.

To redeploy:

Two things in that command are not stylistic, and the previous version of it
could not work:

**Built from the repo root**, with `-f`, not from this directory. The Dockerfile
says so in its own header — the build-time generators read SDK sources that live
outside the landing (`packages/typescript/src/generated/`, `contract/SCENARIOS.md`
and the five runners). Running `docker build .` from here fails with
`"/examples/react-landing/package.json": not found`.

**`fetch` + `reset --hard`, not `pull`.** The checkout on the droplet has twice
been found with its working tree deleted — 547 files staged as `D`, HEAD intact.
`git pull` reports success on such a tree and changes nothing, so the build runs
against files that are not there.

```sh
ssh root@<host> "cd /opt/snaga/dev-portal/repo &&
  git fetch -q origin && git reset --hard origin/main &&
  docker build -q -f examples/react-landing/Dockerfile -t snaga-dev-portal:latest . &&
  docker rm -f snaga-dev-portal &&
  docker run -d --name snaga-dev-portal --restart unless-stopped \
    --network snaga-net -e PORT=3001 snaga-dev-portal:latest"
```

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
