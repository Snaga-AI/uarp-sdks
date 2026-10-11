# Contract scenarios

Every runner performs exactly these calls, in this order, against
`contract/server.py`. The server answers identically for all five and records
what it received; `contract/run.sh` then compares the five traces.

The point is not that each call succeeds — the unit tests cover that — but that
all five SDKs put **the same bytes on the wire** for the same logical request.

| # | Call | What it pins down |
| --- | --- | --- |
| 1 | `agents.list(limit = 2)` | query serialisation, omitted optional parameters |
| 2 | `agents.get("id with/slash")` | percent-encoding of a path segment |
| 3 | `agents.create(name + model)` | JSON body shape, automatic idempotency key |
| 4 | `agents.listAll()`, consumed fully | cursor paging: two requests, second carries the cursor |
| 5 | `agents.get("retry-me")` | a 429 is retried once and the retry looks identical |
| 6 | `agents.get("missing")`, error swallowed | a 404 is not retried |
| 7 | `runs.streamRunEvents("r1")` until `run.completed` | `Accept: text/event-stream`, no reconnect after the caller stops |
| 8 | `files.downloadFileContent("f1")` | binary download |
| 9 | `files.delete("f1")` | a 204 request |
| 10 | `registry.registryPublish(manifest + artifact + sha256)` | multipart encoding |
| 11 | `agents.list(workspaceId = "ы w&x=y+z*!()~")` | percent-encoding of a query value: spaces, reserved and sub-delimiter characters |
| 12 | `agents.get("агент/ы")` | percent-encoding of a multibyte path segment |
| 13 | `runs.streamRunEvents("r1", lastEventId = "42")` | a header parameter reaching the wire |
| 14 | `agents.list(limit = 0, includeOffline = false)` | zero and false are sent, not dropped as falsy |
| 15 | `runs.create(agentId = awkward string, sessionId = "", version = 0)` | JSON string escaping and a zero in a body |
| 16 | `runs.get("probe")` | how the decoder handles an awkward response |
| 17 | `streamPost("/api/v1/llm/chat/completions", {model, stream: true, messages})` until `data: [DONE]` | a POST read as an event stream: `Accept: text/event-stream`, a JSON body, an idempotency key, `[DONE]` not delivered |
| 18 | `streamPost("/api/v1/llm/chat/completions/refused", …)`, error caught | a refusal before the stream is an API error with its problem document, and a streamed POST is never retried — not even on 429 |
| 19 | `streamPost("/api/v1/llm/chat/completions/plain", …)`, error caught | a 2xx that is not `text/event-stream` is an error, not a stream that ended with no events |
| 20 | `auth.completeOAuthLoginFormPost("apple", {code, state, user})` | an `application/x-www-form-urlencoded` body, byte for byte |
| 21 | `public.listPublicJobs(seniority = [junior, senior], country = ["UA"])` | array query parameters (`style: form, explode: true`): the key once per item, in declaration order |
| 22 | `public.applyToJob("dev", {name, email, consent, links: [two urls]})` | an array in a multipart body: one text part holding a compact JSON array, `/` unescaped |

Total: **24 requests**: scenarios 4 and 5 make two each, the rest one.

### A form body (20)

`POST /api/v1/auth/oauth/{provider}/callback` takes
`application/x-www-form-urlencoded` (Sign in with Apple on the web posts it).
The fields are, in schema order: `code = "c 1+2"`, `state = "s/ы&=~*"`, and
`user = {"name":"А Б","email":"a@b.c"}` (a JSON blob, as the field's description says);
`id_token` and `error` are absent and must not appear at all. The body is
compared as bytes, so every SDK encodes the way the WHATWG URL standard's
`application/x-www-form-urlencoded` serializer does — the one `URLSearchParams`
uses:

- fields in the order the schema declares them, absent and null fields skipped;
- a space becomes `+`; `A-Z a-z 0-9 * - . _` stay as they are; every other
  byte of the UTF-8 encoding becomes `%XX` with upper-case hex — `~` included,
  which RFC 3986 would leave alone and this serializer does not;
- `Content-Type: application/x-www-form-urlencoded`, exactly.

Expected body: `code=c+1%2B2&state=s%2F%D1%8B%26%3D%7E*&user=%7B%22name%22%3A%22%D0%90+%D0%91%22%2C%22email%22%3A%22a%40b.c%22%7D`.
Each runner reports `form_post_email` — the `email` it decoded from the answer
(`"a@b.c"`).

### Streaming a POST (17, 18)

`streamPost` is the one hand-written operation every SDK adds to its client
for an answer that arrives as server-sent events to a POST — an LLM
completion with `"stream": true`. The served spec describes that operation's
200 as `application/json` only; the wire answers `text/event-stream` when the
body asks for it, and the streamed answer is what survives a long generation:
the platform cuts a silent non-streamed request at 120 s (measured
2026-10-05), a streamed one started in 3 s and ran 438 s.

- **Wire:** `POST`, `Accept: text/event-stream`, `Content-Type:
  application/json`, the JSON body, and the automatic `Idempotency-Key` every
  POST of that SDK carries.
- **One attempt.** No reconnect and no retry, whatever the status: replaying
  a POST would run the model again and bill it twice.
- **End:** `data: [DONE]` (not delivered as an event), a clean end of body,
  or the caller stopping.
- **Broken connection:** a transport failure after the stream began is an
  error, not an end — a cut-off completion must not read as a finished one.
- **No overall timeout:** the client's request timeout does not apply; a long
  generation is the reason to stream. The caller limits it by stopping.
- **Refusal:** a non-2xx answer is the SDK's API error carrying the status and
  the problem document from the body; the body is not delivered as events.
- **Not a stream:** a 2xx whose `Content-Type` is not `text/event-stream`
  (plain JSON, an empty body) is an error too — the SDK's API error with the
  status as received — and its body is not delivered as events. An answer
  with no events must never read as a finished stream.

Each runner reports three probes, in the same single `/__report` call as
scenario 16 (the server keeps one report per language): `post_stream_text` —
the `delta.content` of every delivered event concatenated (`"hello"`),
`post_stream_refusal` — `"<status> <detail>"` of the error from scenario 18
(`"429 llm quota exhausted"`), and `post_stream_plain` — `"error <status>"`
for scenario 19 (`"error 200"`), or `"events <n>"` if no error was raised.

JSON bodies are compared after decoding, not byte for byte: key order and the
choice between a raw `ы` and `\u044b` are free, but the value that arrives has
to be identical.

Both the decoded query pairs and the raw query string are compared: `a+b` and
`a%20b` decode to the same thing but are not the same bytes, and a server that
does not apply form-decoding rules would see two different values.

## What is normalised

The server masks what is allowed to differ:

- `User-Agent` is dropped — each SDK names itself.
- `Idempotency-Key` becomes `<uuid>`; only its presence and shape are compared.
- A multipart boundary becomes `<boundary>`.
- Multipart part filenames are compared as present/absent, since the spec does
  not name the file and each language picks its own default.

Everything else — method, path, query, `Accept`, `Content-Type`,
`Authorization`, body bytes — must match exactly.

## Decoding

Scenario 16 answers the mirror-image question: given one payload, do the five
SDKs read the same values out of it? The payload carries an enum value none of
them has seen, an explicit `null`, an absent optional, an empty array, a nested
object and an integer larger than a double holds exactly.

Each runner posts what it decoded to `/__report` under agreed keys, and the
harness compares those reports the same way it compares the traffic.

## Known differences

- **`step_seq` beyond 2^53.** The payload carries `9007199254740993`. Rust,
  Swift, Kotlin and Ada read it exactly; TypeScript reads `9007199254740992`,
  because a JavaScript `number` is a double and cannot represent that integer.
  Fixing it would mean typing every `integer` in the spec as `bigint` or as a
  string, which would make the ordinary case worse for the sake of a value the
  platform does not currently send. Recorded rather than fixed.
