# Live SDK scenario

The probe in `smoke/src` drives one SDK's transport. This scenario drives all
five, against the real server, and checks they agree — the last place a
per-language transport bug could still hide.

`contract/` already proves the five put identical bytes on the wire, but it
proves it against a mock written in Python. Real infrastructure differs: TLS,
HTTP/2 negotiation, chunked transfer, proxies, compression, redirects, real
latency. A runner that passes here has talked to production.

Each runner performs the steps below in order and prints one JSON object on
stdout. `compare.py` checks the objects match.

| # | Step | Reported as |
|---|---|---|
| 1 | `GET /health`, unauthenticated | `health` — the `status` string |
| 2 | `GET /api/v1/me` | `role`, `auth_method` |
| 3 | `GET /api/v1/agents?limit=2` | `page_size` — items returned, capped at 2 |
| 4 | `GET /api/v1/agents/{a uuid that does not exist}` | `not_found_status`, `problem_has_title` |
| 5 | `POST /api/v1/agents`, named `smoke-live-<language>` | `created` — whether an id came back |
| 6 | `GET` that agent | `name_round_trips` |
| 7 | `DELETE` that agent | `deleted` |
| 8 | Paginate agents, `limit=2`, stopping after six items | `paged_items` |

Nothing that varies between runners — identifiers, timings, the tenant's own
data — is reported: the point is to compare decoding, not the account.

Step 5 creates a real agent on the target tenant and step 7 removes it. If a
runner fails between the two, an agent named `smoke-live-<language>` is left
behind and can be deleted by hand.

## Running

```sh
UARP_API_KEY=… smoke/live/run.sh              # every SDK whose toolchain is present
UARP_API_KEY=… smoke/live/run.sh rust ada     # a subset
```
