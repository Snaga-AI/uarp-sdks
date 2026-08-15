# React landing page with an agent widget

A marketing page with a UARP agent answering in the corner, and — the part
worth copying — the small server that keeps the API key away from the browser.

```sh
npm install
npm run dev            # http://localhost:5173
```

Open the page, click **Ask the agent**, paste a UARP API key, and ask something.
The reply streams in token by token.

## What this is actually demonstrating

The widget is the visible half. The half that matters is `server/handlers.ts`.

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
