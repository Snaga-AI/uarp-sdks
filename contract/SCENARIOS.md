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

Total: **15 requests**: scenarios 4 and 5 make two each, the rest one.

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

## Known differences

None. A difference either gets fixed or gets recorded here with the reason.
