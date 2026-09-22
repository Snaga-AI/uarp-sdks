# Changelog

All five SDKs share one version, cut from one tag. Set it with
`scripts/set-version.sh <version>`, which also regenerates.

The format follows [Keep a Changelog](https://keepachangelog.com/1.1.0/), and
the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.0 — 2026-09-22

Build `34cc8169`, canonical digest `0ed418c24110c039` — sorted keys, no
whitespace, which is what `check-spec-freshness.sh` compares and what the
release refuses to proceed without. Against 0.6.0, the last release published
to any registry: 535 → 543 paths, 723 → 734 operations (+14, −3), 352 → 352
schemas (+3, −3).

**The minor moves, and that is the point.** A caret under 1.0 does not cross
the minor, so `^0.6.0` admits 0.6.1 automatically and refuses 0.7.0. This
release removes exported names and adds required request fields; on a patch
those would have arrived in builds nobody touched, and the first anyone heard
of it would have been a red compile. The number is the announcement.

### Removed — three operations and eighteen exported names

The SPEC-package surface is withdrawn on the platform (uarp `f058b582`), so
it leaves the clients:

- `GET` and `PUT /admin/config/spec-packages`, and
  `POST /admin/config/spec-packages/{packageId}/stripe-price`.
- Eighteen names disappear from the TypeScript models (1679 exports → 1720,
  with these gone): `SpecPackage`, `SpecPackagePricing`,
  `SpecPackagePricingBillingInterval`, `SpecPackageIncludedInPlan`,
  `SpecPackageProgram`, `SpecPackageProgramNav`, `SpecPackageProgramPage`,
  `AdminSpecPackagesList`, `UpdateAdminSpecPackagesRequest`,
  `CreateAdminSpecPackageStripePriceResponse`,
  `CreateSpecPackageCheckoutSessionRequest`,
  `ListBillingSpecPackagesResponsePackage` and its `…Entitlement`,
  `DeleteCustomPlanForce`, and the four `*_VALUES` consts of those enums.

`GET /billing/spec-packages` and its checkout do NOT leave: the withdrawal
left the list answering `[]` and the checkout answering 410, both marked
deprecated, and both stay generated for clients that still call them.

### Changed — six operations now require body fields they did not

Breaking for any call site that compiled without them:

| Operation | Newly required |
|---|---|
| `POST /governance/goals` | `title`, `description`, `rationale`, `expected_impact`, `alignment_justification`, `resource_estimate_usd` |
| `POST /governance/improvement/{agentId}` | `title`, `description`, `rationale`, `changes`, `baseline_success_rate`, `failed_run_ids` |
| `POST /governance/arbiter/cases` | `description`, `rule_ids` |
| `POST /bridge/delegate` | `message` |
| `POST /marketplace/listings/{listingId}/subscribe` | `stripe_subscription_id` |
| `POST /programs/{programId}/apply` | `start_date` |

The first three were unusable in 0.6.0 rather than merely under-declared:
`CreateGoalRequest` shipped with one field beside a doc comment naming seven,
so no client generated from that document could form a valid request. They
compile differently here because they now describe what the handler actually
demands.

### Added — a failed run says why, in a field

- `Run.error_code` and `Run.error_details`, and the same pair on
  `TenantOverviewRunsRecentItem` — the thinner shape the fleet board reads.
  `error_code` is absent when the failure carries nothing to branch on, which
  is deliberate; `error_details` carries what the code cannot
  (`retry_after_ms`, `quota_exhausted`, `stale_seconds`).
- `ErrorCode` and `ERROR_CODE_VALUES`, 76 values. **New, not widened**: 0.6.0
  declared no `code` on `Error` at all, in the tag or in the published
  tarball, so there was nothing for a client to branch on.

Until this release no generated client could learn why a run failed except by
matching English in `error` — a sentence with no `Accept-Language` behind it.

### Added — the rest of the surface

- `SpecToolCatalogSpec` with `tools_waiting` and
  `status: 'ready' | 'needs_connection'`: an installed SPEC that is waiting on
  a connection says so instead of vanishing.
- `UsageQuotaCounter` and its eight kinds (`runs`, `tokens`, `tokens_daily`,
  `tool_calls`, `agents`, `teams`, `knowledge_bases`, `workspaces`).
- `GET|PUT /agents/{agentId}/mcp-servers` with `McpServerAuth` — the connect
  surface between an agent and the MCP servers its tenant has installed.
- Billing: `GET|PUT|DELETE /billing/budget`, `GET|PUT /billing/overage`,
  `GET /billing/promo`, `POST /billing/promo/redeem`.
- `GET /admin/data-explorer/export`, `POST /admin/data-explorer/import`,
  `POST /auth/oauth/nonce` (served undocumented until uarp #487),
  `GET /bridge/agent-specs`, `GET /companies/{companyId}/events`.
- `SubjectSweep`, `TenantSocialLinks`.

### Fixed — the tooling that made the last cut cost two attempts

- `scripts/update-spec.sh` gains `--allow-shrink "<reason>"`. Its guard
  correctly refuses a document smaller than the vendored copy, but its advice
  on refusal was to pass a different url, which cannot work: the guard weighs
  whatever is fetched, so the only url that satisfies it is a document stale
  enough to still carry the withdrawn surface. The override requires a reason
  and NAMES what leaves — paths, operations and schemas, each listed.
- `scripts/set-version.sh` now moves three things it silently left behind:
  `generator/package-lock.json`, the crate's own version in
  `packages/rust/Cargo.lock`, and the generator goldens, which bake
  `SDK_VERSION` in four languages. That last one is why the first `v0.6.0` tag
  published nothing — 40 of 100 generator tests red at the tag, every language
  job dead before its publish step. Measured again here: 48 of 114 red
  immediately after the bump, before the refresh.
- `scripts/check-prose-schema.ts` reports 0 divergences over all 734
  operations.

### Known

- The SwiftPM mirror is stuck at 0.5.13 (2026-08-21) because
  `SWIFT_MIRROR_TOKEN` expired; 0.5.15, 0.5.21, 0.5.24 and 0.6.0 never reached
  it. Swift consumers do not get this release until that token is reissued —
  this is not something the tag can fix.
- `examples/react-landing` still asks for `uarp-sdk: ^0.6.0`. It cannot ask
  for `^0.7.0` before 0.7.0 exists on npm, so that bump follows the publish
  rather than preceding it.

## 0.6.0 — 2026-09-14

`spec/openapi.json` is `https://api.snaga.ai/api/v1/openapi.json` normalised
by `python3 -m json.tool`, which is what `scripts/update-spec.sh` writes.
Earlier entries quoted a sha256 of the served bytes; this one does not,
because the vendored file is no longer those bytes. The identity that means
something is the canonical digest — sorted keys, no whitespace —
`d281e0b33c55a670`, which is exactly what `check-spec-freshness.sh` compares
and what the release refuses to proceed without. Build `d19c367e`
(uarp #456–#477). Against 0.5.24 (the last release published to any
registry): 709 → 723 operations (+14, none removed), 142 with a changed
shape; 271 → 352 schemas (+81, one member removed — see below), 31 with a
changed shape.

This tag is cut a second time. `v0.6.0` was first tagged on 2026-09-12 from
a tree whose generated TypeScript did not compile (`agents.ts` had a string
cursor reaching a number parameter) and whose generator goldens still said
`0.5.24`; every job of the release run failed before its publish step, so
npm, crates.io, Maven Central and the SwiftPM mirror never saw it — 0.5.24
remained the latest everywhere. Nothing consumed the number, so the number
is reused rather than burned. The tag now points at a tree that compiles.

### Removed — one field, and it is a breaking change

- `Invite.secret` is gone from the schema (uarp #471). The accept token is
  not something an administrator reading the invite list is given; only the
  invitee's own link carries it. Code that read `invite.secret` compiled
  against 0.5.24 and does not compile here — that is the whole of the
  breakage in this release, and the reason to read the note before bumping.

### Added — the Drawings surface (uarp #472, stage 1)

- Nine paths and twelve operations: `GET|POST /sessions/{sessionId}/drawings`,
  `GET|DELETE /drawings/{drawingId}`, `GET|POST /drawings/{drawingId}/ops`,
  `GET /drawings/{drawingId}/render`,
  `GET /drawings/{drawingId}/tiles/{layerId}/{tx}/{ty}`,
  `POST /drawings/{drawingId}/masks`, `GET /drawings/{drawingId}/masks/{maskId}`
  and its `/content`. `listSessionDrawings` pages on the list convention.
- Eight schemas: `Drawing`, `DrawingLayer`, `DrawingOp`, `DrawingBrush`,
  `DrawingMask`, `DrawingStrokePoint`, `DrawingSelectionShape`,
  `DrawingJournalEntry`.

### Added — deletions the API grew

- `DELETE /sessions/{sessionId}/branches/{branchId}` (uarp #472).
- `DELETE /runs/{runId}/feedback` and
  `DELETE /sessions/{sessionId}/runs/{runId}/feedback` (uarp #474, #477):
  a reaction can be taken back, and the feedback reason now comes back on
  the read rather than only on the write.

### Changed — the versions cursor is an opaque string

- `GET /agents/{agentId}/versions`: `cursor` is a string, in the request and
  in the answer, where the first draft of this paging made it the version
  number (uarp #471). Treat it as opaque and pass it back unchanged. No
  published release ever carried the integer form — it existed only in the
  0.6.0 tag that failed to publish — so for anyone upgrading from 0.5.24
  this parameter is simply new.

### Changed — typed responses (121 operations, 73 new schemas)

- Operations that decoded to a bare object now have a model: the whole
  `admin/config` family (Auth, Guardrails, FeatureFlags, RateLimits,
  Retention, SSE, WorkerPool, ToolSecurity, LlmAdapters, Logging,
  CodeInterpreter, RunCommand, Stripe, Smtp…), admin audit, marketplace
  reviews and subscriptions, company objectives and activity, workspace
  trash, activity-stats, public states and agents, team-run messages.

### Changed — types

- `Error`: `title` is an enum of the twenty HTTP reason phrases (422 is
  "Validation Error"), `detail` is required, `code` is the machine code.
- `ConversationEntry.message_id` is required — the derived id of every
  transcript entry (`{run_id}`, `{run_id}-reply[-N]`, `{run_id}-user-N`,
  `{run_id}-tool-N`, `{run_id}-system-N`), the canonical key for reactions,
  bookmarks and annotations; `content` is a string on v1. The session detail
  (`Session.conversation_history`) carries `message_id` too.
- `ConstitutionRule.advisory` (true when no code path can raise the rule;
  on `GET /governance/constitution` and `/governance/obligations/{agentId}`)
  and `obligated_action`.
- `TenantOverview`: nine members are optional — `usage`, `cost`, `system`,
  `runs.cost_24h_usd`, `fleet.top_by_cost`, `fleet.by_execution_mode`,
  `fleet.bridge`, `fleet.head_agent_id`, `schedules.at_risk`. v1 still
  serves all nine; readers must tolerate absence.
- Additive fields on `Agent`, `AgentUpdate`, `RunMetrics`, `Session`,
  `Company`, `A2ATask`, `PublicSessionView`, `PublicAgentCard`
  (`tenant_slug`, `tenant_name`), `PublicState`, `RunCheckpoint`,
  `McpServer*`; `RunOutput.search_sources`.
- `AgentVersion.changelog` names the eleven values the server writes.

### Added — parameters and fields

- `GET /agents/{agentId}/versions`: `limit`, `cursor`, `fields=summary`;
  with `limit` the answer carries `cursor` and `has_more` (the document's
  list convention). Without `limit` the answer is unchanged.
- `GET /governance/ledger`: `category`, `action` (they filter now).
- `POST /admin/config/stripe/test` success: `active_key_matches` (required)
  and `warning` — whether the billing manager serving checkout holds the
  key the panel stores; `livemode` is derived from the key prefix.
- `PUT /workspaces/{workspaceId}/files`: `If-Match` / `If-None-Match`;
  the 412 is `Error` plus an optional `current_etag` (absent when the file
  does not exist).

### Documented — what the wire always did

- `PUT /admin/config/stripe` body: omit = unchanged, empty string = clear,
  a redacted read-back is ignored.
- Billing `return_url` / `success_url` / `cancel_url` accept the app scheme
  (`snaga://`) beside same-origin URLs.
- The public chat's 401 and 410 carry the bare fact
  "This conversation has expired."
- `message_id` on feedback, bookmarks and annotations is stored as sent; a
  non-canonical one is counted, never refused.
- Workspace move/copy/overwrite and what they do to `file_id`.

## 0.5.24 — 2026-09-10

The copy follows the served document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`ba6417e34fcafb5a…`, build `5011669e` (uarp #453, #454), `info.version`
0.4.0. 709 operations, 271 schemas. This is the first release since 0.5.21;
0.5.22 and 0.5.23 were cut as commits and never tagged — everything listed
under them ships here, including the generator fix below. From now on one
SDK release follows one deployed batch.

### Fixed — all five clients

- The generator regression of 0.5.21 (see 0.5.23): fifteen 204 operations
  were typed by the in-flight 202 body. Fixed here for every registry.

### Changed — source-breaking, though nothing that works today breaks

- Nineteen path parameters are named after their resource: `{id}` became
  `{companyId}`, `{knowledgeBaseId}`, `{integrationId}`, `{proposalId}`,
  `{ambassadorId}`, `{requestId}`, `{caseId}`, `{goalId}`. Method parameter
  names follow; the URLs are unchanged.
- 56 responses that decoded to a bare object now decode into models:
  `RunOutput` (with `search_sources` — the URLs a real `web_search` returned,
  at most 8, present only when non-empty — and `output_truncated`),
  `UsageQuota`, `EvalDataset`, `EvalRun`, `AgentScorer`, `PublicAgentCard`,
  `PublicSessionView`, `JsonRpcResponse` (MCP and A2A envelopes),
  `SearchResult`, `ReplayResult`, `CreatedTask`, `MarketplaceSubscription`,
  `DeadlockReport`, `RootAttestation`, `DataSubjectAccessReport`,
  `DataSubjectErasureResult`, `SessionAnnotation`, `A2AAgentCard`,
  `OpenAiChatCompletion`, `TenantUser` on `getUser`, `Tenant` on
  `PUT`/`PATCH /tenants/me`, and the team/squad graph node and edge records.
- `GET /agents/{agentId}/memory/{entryId}` returns a `MemoryEntry`. Until
  build `5011669e` the server answered the agent's list on that path; no
  client had called it.
- Response codes corrected at the source, so a call that used to land in
  "unexpected status" now decodes: `DELETE /agents/{agentId}/integrations/{integrationId}`
  204; `DELETE /mcp/servers/{serverId}` 200 with `{ ok, cascade }`;
  `POST /runs/{runId}/replay` 200; ambassador `bootstrap` and `requests` 201;
  billing without Stripe 501 (was documented as 502).
- Scope `analytics:read` replaces `read:analytics` in the catalogue (the
  server accepts both); `billing:write` enters the catalogue; `api_keys:read`
  / `api_keys:write` are declared on the key operations.
- `Agent.metadata.ui` is typed (`AgentMetadataUi`: `avatar`, `drop_genome`,
  `drop_genome_source`); a partial `PATCH` of `metadata.ui.avatar` keeps the
  avatar fields it does not name.

## 0.5.23 — 2026-09-10 (never tagged; shipped in 0.5.24)

### Fixed — all five clients

- Fifteen operations whose answer is a `204` — `files.delete`,
  `workspaces.delete`, `companies.delete`, `integrations.delete`,
  `knowledge.deleteKnowledgeBase`, `knowledge.deleteKbDocument`,
  `users.deleteInvite`, `agents.deleteAgentIdentity`,
  `memory.deleteMemoryEntry`, `sessions.deleteSessionAnnotation`,
  `sessions.revokeSessionShare`, `marketplace.unpublishListing`,
  `registry.registryYankVersion`, `registry.registryUnyankVersion`,
  `admin.deleteAndroidTester` (TypeScript spelling) — were typed in 0.5.21 and
  0.5.22 by the body of the `202 IdempotencyInFlight` reply that uarp #444
  attached to every idempotent operation (`{ error: "Accepted", message,
  retry_after_seconds }`). The generator took the lowest 2xx as the answer.
  Rust failed to decode the empty 204 it actually received (`invalid type:
  null, expected struct DeleteFileResponse`); Ada did not compile; TypeScript,
  Swift and Kotlin returned a model no response ever carries. The generator
  now types an operation by its settled status: a 202 next to another 2xx is
  the idempotency layer saying "still in flight", not the result. The sixteen
  models that existed only for this (`Delete*Response`,
  `RevokeSessionShareResponse`, `UnpublishListingResponse`,
  `RegistryYankVersionResponse`, `RegistryUnyankVersionResponse` and their
  shared `error` enum) are gone; the fifteen methods return nothing again, as
  they did in 0.5.20. The cross-SDK contract check caught it in CI on
  `ca08686` and `697d02d`; a parser test now pins all fifteen against the
  served document.

## 0.5.22 — 2026-09-10 (never tagged; shipped in 0.5.24)

The copy follows the served document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`22c24643fbacbc35027e5058cc08433610fa7d77adf7a83971350a9049adf76f`, build `4c12c94a`, `info.version` 0.4.0. 709 operations, 249 schemas.

### Changed

- `Run.execution_mode` is documented (`async` | `bridge`); the descriptions on
  it and on the overview row say what production writes: `bridge` by the
  platform, `async` only as an echo of a client value — never stored so far
  (8605 run records measured: absent 7738, bridge 867, async 0).

## 0.5.21 — 2026-09-10

The copy follows the served document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`ba5a7338214ddbe6cb76b9cac203ddf726f7f52692ee637bf8c1cd64125112ca`, build `eaa42cb2`, `info.version` 0.4.0. 709 operations, 249 schemas.

### Added

- `execution_mode` (`async` | `bridge`) on `GET /analytics/overview` →
  `runs.recent[]`, passed through from the run record — a bridge report with
  no transcript is now distinguishable from "nothing ran".

### Changed

- uarp #450 (CTR-07 tranche 2a): 48 responses on governance, teams/squads,
  a2a, public, playground, files, programs, users, webhooks, mfa, guardrails,
  marketplace, workspaces, notifications and tenant keys now have the shape
  they serve — new `ReadinessReport`, `FileRecord`, `TeamRunDetail`,
  `PlaygroundAgentState`, `PlaygroundTemplate`, `MfaEnrolment`.
- Status codes the wire actually answers: `POST /governance/ambassador/
  ambassadors`, `POST /governance/goals`, `POST /governance/improvement/
  {agentId}` are **201** (not 200); `POST /playground/agents/{agentId}/run`
  is **202**; `DELETE /marketplace/listings/{listingId}` is **204**.

## 0.5.20 — 2026-09-10

The copy follows the served document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`8d6c371c0ade9c233c57c9048758bbbc29ab1f7412e0ed02d6aca025571d9015`, build `bccf5ef4`, `info.version` 0.4.0. 709 operations, 243 schemas.

### Changed

- uarp #448 (CTR-07 tranche 1): 39 responses on agents, sessions, runs and
  workspaces now have the shape they serve — new `AuditLogEntry`,
  `AgentCapabilities`, `RunFeedbackList`/`RunFeedbackOne`/`RunFeedbackSet`;
  `MemoryEntry`, `Session`, `Workspace` gained served keys; run
  approve/cancel/pause/reject/continue/resume/checkpoint, session delete/
  todos, agent activate/suspend/versions/rollback/traffic, workspace
  assign/share/move are typed.
- `POST /runs/{runId}/resume` and `…/checkpoint` answer **202** (the document
  said 200 / 201); generated clients now expect the code the wire gives.
- `DELETE /workspaces/{workspaceId}` is 204 with no body.

## 0.5.19 — 2026-09-10

The copy follows the served document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`c212d1f94faa8a5c665b5bca17a5432e9ef82f53cd2e04dde2a221025e7ce34c`, build `ae8a2d2e`, `info.version` 0.4.0. 709 operations, 238 schemas.

### Changed

- uarp #447 settled every schema no operation reached: `Schedule` now has the
  keys `GET /agents/{agentId}/schedule` serves (`status`, `next_fire_at`,
  `consecutive_failures`; `next_run_at` is gone) and the response is
  `Schedule | null`; `PUT` returns the new `ScheduleEntry` with
  `AgentScheduleConfig`; `EnforcementResult`, `VetoRecord`,
  `ConstitutionDocument`, `MarketplaceListingRating`, `VoteResult` and
  `BridgeTaskEvent` are what their operations return or accept.
- `GET /usage/timeseries` rows carry `label` (an `M/D` bucket label), not
  `date`.
- `PUT /governance/permissions/{agentId}` takes `PermissionSetUpdate`;
  `PUT …/spawn-policy` takes `SpawnPolicyUpdate`.

### Removed

- Schemas `Constitution`, `Veto`, `AgentFleetSummary`, `LlmCredential`,
  `TeacherRef` (no operation produced or consumed them).

## 0.5.18 — 2026-09-10

Training (LLM Studio) and the Creativity canvas are gone from the API
(uarp #445, deployed as build `e0da8c83`), and the copy follows the served
document byte for byte: `spec/openapi.json` is
`curl https://api.snaga.ai/api/v1/openapi.json` verbatim, sha256
`4a1a5f9c0a11d827c9cb6fe682c4b06da7e0c2bb7fe838809330b5162b0c0267`, `info.version` 0.4.0,
`X-API-Version` 2026-09-10. 709 operations and 239 schemas, down from 710
and 242 — the sixteen operations uarp #444 described from their bytes arrived
in the same document.

### Removed

- Every `/api/v1/training-jobs/*` and `/api/v1/creativity/sessions/*`
  operation — the generated `training` and `creativity` resources are deleted
  in all five SDKs.
- Schemas `TrainingDroplet`, `TrainingGate`, `TrainingHyperparams`,
  `TrainingJob`, `TrainingJobMetrics`, `TrainingJobRequest`,
  `TrainingPersona`, `TrainingQuote`, `TrainingSettings`.

### Added

- The sixteen operations described in uarp #444: run feedback (`PUT`/`GET`
  `/runs/{runId}/feedback`), `PATCH /me`, workspace file history and version
  content, the three public-session operations (`share`, `upload`,
  `runs/{runId}/cancel`), agent bookmarks, `POST /sessions/bulk-delete`,
  `POST /workspaces/{id}/publish`, `POST /agents/{id}/memory/import` — with
  their real bodies and responses; every authenticated mutating operation now
  declares the `202` in-flight response and the `X-Idempotency-Replayed`
  header.

## 0.5.17 — 2026-09-10

The Commerce surface is gone from the API (uarp #441, deployed as build
`4d323a8b`), and this copy follows the served document byte for byte:
`spec/openapi.json` is `curl https://api.snaga.ai/api/v1/openapi.json`
verbatim, sha256
`5647eb801f794ef9d5ca2eecf15c1f122cfd6f8935d00e8537c5a76b93ecaff8`, `info.version`
0.3.0, `X-API-Version` 2026-09-10. 710 operations and 242 schemas, down from
725 and 251.

### Removed

- Every `/api/v1/commerce/*` operation (products, customers, orders,
  enrollments, analytics) and `POST /api/v1/webhooks/shopify` — the generated
  `commerce` resource is deleted in all five SDKs (TypeScript
  `resources/commerce.ts`, Rust `api/commerce.rs`, Swift `CommerceAPI.swift`,
  Kotlin `CommerceApi.kt`, Ada `uarp-api-commerce`).
- Schemas `Customer`, `CustomerUpdate`, `Product`, `ProductUpdate`, `Order`,
  `Enrollment`.

## 0.5.16 — 2026-09-10

Cut from the bytes production serves, not from a copy of the source document.
`spec/openapi.json` is now `curl https://api.snaga.ai/api/v1/openapi.json`
verbatim, sha256 `2d0119336bb7b507343b9b2ec41b80b2d6bafc6863ecddfdc54597e4f682e938`,
build `53ab19ed`. The previous copy had drifted to 712 operations against the
platform's 725 — the three Android closed-testing routes, the public blog, the
link-preview pair, `/api/v1/health`, the knowledge-base retrieval routes and
the `410` a public session now answers when its TTL has passed.

- 712 operations to **725**, 242 schemas to **248**.
- Every `nullable: true` from OpenAPI 3.0 is gone; null is a type union now, so
  generated optionals stop depending on a keyword 3.1 does not define. Seven
  enums that sat beside a nullable gained `null` as a member — without it a
  strict decoder rejects the very value the field exists to carry.
- `OAuthLoginProviderItem.id` lists `apple` beside `github` and `google`. The
  wire has answered all three for months; a generated Swift or Kotlin decoder
  throws on a value outside an enum, and this is the login screen's provider
  list, where a throw means no buttons at all.
- `info.license` carries an SPDX `identifier`, so the document validates as 3.1
  rather than failing at the first schema check.

Verified both directions rather than by count: every method+path pair in the
document has a call site in `packages/typescript/dist`, and every call site in
`dist` is in the document — 725 to 725, none missing, none extra.

## 0.5.15 — 2026-08-28

The first release cut from a document that matches what the platform serves.
559 operations to 641, 163 schemas to 219 — the 0.5.14 tag was cut before the
document refresh landed, so everything below has been on `main` and in no
installable package.

### Fixed — all five clients

- **`quota_overrides` stopped being a copy of the plan's quotas.** It was
  declared `$ref: TenantQuotas`, which requires sixteen fields, and overrides
  are partial by definition — a tenant that overrides six sends six. So every
  strict client failed to decode `GET /tenants/me` outright. Measured against
  the released 0.5.14 model and a live production body:

      before   DECODE FAILED: missing field `max_workers_per_team`
      after    DECODED OK

  Rust, Swift and Kotlin all generated the sixteen as non-optional. To be
  precise about the blast radius, since an earlier draft of this entry
  overstated it: no PUBLISHED package was affected. 0.5.13 predates the
  refresh that introduced `TenantQuotas` and does not model `quota_overrides`
  at all, so it decodes the same body cleanly — verified against the crate
  pulled from crates.io, not against a local tree. The defect lived in `main`
  from the document refresh onward and would have shipped with this release.
  It was caught first. The fix is a dedicated all-optional
  `TenantQuotaOverrides`; `TenantQuotas` is correct as it stands for the
  effective set and is unchanged.

- **`cursor` is nullable on `/files` and `/public/tenants`.** Both were
  declared a plain string and both serve `null` on the last page — the same
  strict-decoder hazard, on pagination, which every consumer touches.

- **Workspace file upload sent no body at all.** `uploadWorkspaceFile` had no
  body parameter, so the route's `arrayBuffer()` received zero bytes and wrote
  an EMPTY file under a 200. `downloadWorkspaceFile` ran binary responses
  through a JSON parser, corrupting any png or pdf into something that still
  opens.

- **Team runs.** `startTeamRun` takes `input` and `metadata` instead of four
  top-level fields the handler was discarding in silence; `listTeamRuns` gained
  the `limit` and `cursor` the handler has always read, so a client is no longer
  stuck on the first fifty; `streamTeamRunEvents` takes `teamRunId` like every
  sibling under that prefix.

### Added

- **82 operations and 56 schemas** the vendored document had been missing.
- **`getAgentActivityStats` declares the fourteen fields it serves**, not three.
  `cancelledRuns`, `guardrailBlockedRuns`, `errorRatePercent`, `avgStepsPerRun`,
  `avgDurationMs`, `avgInputTokens`, `avgOutputTokens`, `avgThinkingTokens`,
  `toolBreakdown`, `topErrorMessages` and `runsByDay` were being served and were
  invisible in all five clients.

### Changed — source-breaking, though nothing that works today breaks

- `uploadWorkspaceFile` gains a required body parameter and
  `downloadWorkspaceFile` returns binary (`Blob` / `bytes::Bytes` / `Data` /
  `ByteArray` / `UARP.Types.Text`). Calling either today writes an empty file
  or corrupts a download, so there is no working call site to regress.
- `Tenant.quota_overrides` changes type from `TenantQuotas` to
  `TenantQuotaOverrides`. Anyone naming that type in a signature must rename it.
- `getGovernanceLedger`'s `from` and `to` change from string to integer. They
  are ledger SEQUENCE NUMBERS, not timestamps, and were declared as strings —
  so callers reasonably sent an ISO timestamp, the server ran it through
  `parseInt`, and `2026-08-28T18:00:00Z` silently became sequence 2026. The
  request then answered 200 with an empty page over a ledger holding thousands
  of entries. Non-integer values are now rejected with 400 instead. The
  parameter also gained `count`, which is what most callers actually want.

### Internal

- The freshness gate hashes the whole document canonically rather than its
  schema and path NAMES. The name digest could not see a request body being
  declared, a media type added or a false `required` dropped, and it reported
  `current` over a document three fixes behind.
- The generator refuses two operations in one group that would emit the same
  method name — five compiler errors' worth of information, available before
  any of them run. It checks the emitted name, not the `operationId`: the live
  document has a duplicate id across two groups and it is harmless.
- A route-coverage gate compares the BUILT client against the operations the
  platform serves, because the Ada manifest is generated from the TypeScript
  declarations rather than from openapi — so a gate on the spec alone goes
  green while the last link stays stale.
- CI enforces the commit-trailer rule the repository documents. There was no
  `commit-msg` hook and never had been.
- `scripts/set-version.sh` writes the version into `package-lock.json`, which
  it never did, so every release left the lockfile a version behind (#42).
- The contract gate no longer dies on macOS's `/usr/bin/java` stub, which
  exists and fails; it now runs four SDKs where it ran none.

## 0.5.14 — 2026-08-26

### Fixed — Ada

- **The models unit compiles on Windows.** A PE-COFF object header holds its
  section count in 16 bits, so 65535 is the ceiling, and `uarp-models.o` asked
  for 164648 — every Windows runner on the index PR stopped at
  `as: too many sections` (alire-project/alire-index#2059). It asked because
  `uarp-models.ads` declares 1824 subprograms and instantiates
  `Ada.Containers.Vectors` 126 times, all of it landing in that one object,
  and because Alire's profiles pass `-ffunction-sections -fdata-sections` —
  one section per subprogram, plus its `.pdata$` and `.xdata$` unwind sections
  on x86-64 Windows. ELF has no such ceiling, which is why Linux and macOS
  built it all along. The two switches are now off for that unit alone,
  which costs only the linker's dead-code stripping inside it; the rest of
  the crate stays sectioned as the profile asks.

  Verified on Windows 10 against the index's own toolchain (alr 2.1.1,
  gnat_native 15.3.1, gprbuild 26.0.1): 176494 sections before, 100 after,
  `libuarp_sdk.a` archived, the test suite 127/127 green over real HTTP and
  SSE, and all three examples linked against libcurl.

- **The Ada CI job now also builds on Windows.** It ran on `ubuntu-latest`
  alone, so a break of this class had nowhere to surface but the index PR.

No generated code changed — this is the version the index submission moves to.

## 0.5.13 — 2026-08-21

### Fixed — Ada

- **`libcurl` is declared, conditionally.** The crate links libcurl through
  a small C shim; on macOS it ships with the system, on Linux and Windows it
  is a real dependency that the manifest mentioned only in a comment. The
  community index builds the crate on ten Linux/Windows runners where the
  development package was absent, and every one failed to link
  (alire-project/alire-index#2059). The manifest now carries the
  maintainers' own spelling:

      [[depends-on]]
      [depends-on."case(os)"."linux|windows"]
      libcurl = "*"

  `alr show` lists `when Linux => libcurl*`, `when Windows => libcurl*`;
  macOS resolves without it (#39). No generated code changed — this is the
  version the index submission moves to.

## 0.5.12 — 2026-08-20

### Added — every SDK

- **The AI Act documents are typed.** `AISystemCard` (with its nested
  `technical_specifications`), `FRIAReport` and `FRIARight` — the
  `GET /agents/{id}/system-card` JSON answer and the `GET`/`POST
  /agents/{id}/fria` record. Both operations returned bare objects in every
  SDK before; a client that wrote the FRIA by hand used field names the
  server does not have and got 400 on every save.
- **`RegistryVersionEntry` and `ResolvedDep`** — the element of `versions[]`
  on the sparse index and the spec metadata. `dependencies` is an ARRAY of
  `{scope, name, version_req}`; a client that typed it as the manifest's
  name→range map would have iterated indices as names.
- **`ConnectorConfigField`** — the value type of `IntegrationCatalogItem.
  config_schema`, named; it was the generator's `Value` placeholder. The
  catalog item also gained `oauth_provider` and `required_oauth_scopes`.
- **`ApiKeySummary`** gained `last_used_at`, `expires_at`, and `kind` as the
  enum `session | api_key`; **`GET /governance/ledger`** gained
  `tenant_total` (the tenant's share of the whole chain — `total` is and was
  the page length); **`AgentPublicConfig`** fields a settings form can clear
  are nullable (`null` is the clear over a shallow-merging PUT).

### Changed — every SDK

- **Seven list elements described from the platform types, not from a
  two-row capture**: `Todo`, `FeedEntry`, `KnowledgeBaseDocument`,
  `ConstitutionViolation`, `TeamGraphNode`, `TeamGraphEdge`, `AgentScorer`
  now carry the fields the server stores (Todo.recurrence/delivery/
  parent_task_id, FeedEntry.team_*/company_*/summary/error,
  KnowledgeBaseDocument.error_message, …), closed enums where the type has
  them, and `required` as the record is rather than as one sample happened
  to be. Where 0.5.11 made a web client's hand-written type strictly richer
  than the generated one, 0.5.12 is the one to alias to.
- `required` tightened where the server always sends the field:
  `AgentBridgeState` (all seven), `UsageMarginSummary` (all five),
  `BridgeConnection.version`/`last_heartbeat`, `Workspace.assigned_agents`/
  `created_at`, the `/me/tenants` membership and invite rows, and
  `ExportAdminConfigResponse`. `PUT …/branches/{id}/activate` answers
  `{session_id, active_branch}`; the session share `share_url`/`role` are
  nullable.

## 0.5.11 — 2026-08-20

### Fixed — Ada

- **The crate declared the gnatcoll it was built on, not the one it needs.**
  `alire.toml` pinned `gnatcoll ^26.0.0`; the crate uses exactly one unit from
  it, `GNATCOLL.JSON`, which 25.0.0 has. Any consumer that also depends on
  `aws` (25.2.0 is the newest in the index, and it wants `gnatcoll ~25.0.0`)
  got an unsolvable graph — `Missing: +! gnatcoll (^26.0.0) & (~25.0.0)` — and
  could not use the SDK at all. The range is now `>=25.0.0 & <27.0.0`. Built
  and tested at both ends: 26.0.0 (what the range still picks on its own) and
  25.0.0 pinned, both 0 warnings. Found by the Svitlo migration (#35).

- **The Ada client no longer follows redirects.** `uarp_curl.c` set
  `CURLOPT_FOLLOWLOCATION` with five hops and no host check, so a 302 from
  the API host would have carried the bearer token to whatever host the
  `Location` named — a hop nobody authorised. The API documents exactly
  three 3xx answers and all three are browser-side OAuth hops
  (`/auth/oauth/{provider}/start` and the two callbacks); no data endpoint
  redirects. A 302 now reaches the caller as a 302 with `Location` in
  `Problem.Headers`, and a test against the mock proves it (and fails when
  the old flag is put back). Also corrected: `Problem.Headers` claimed its
  names were lower-cased; they arrive as the server sent them, and
  `UARP.Types.Lookup` does the case-insensitive match (#36).

### Added — every SDK

- **Twenty-five schemas the document gained since 0.5.10 was cut**, regenerated
  from the API's own document (`api.snaga.ai/api/v1/openapi.json`, not the
  builder's mirror): `Todo`, `KnowledgeBaseDocument`, `ConstitutionViolation`,
  `TeamGraphNode`, `TeamGraphEdge`, `FeedEntry`, `FileEntry`, `Invite`,
  `TenantUser`, `RunCheckpoint`, `LlmModel`, `LlmUsageSummary`,
  `PlatformLlmDefaults`, `PublicState`, `PublicTenant`, `PublicPlan`,
  `LandingStats`, `VoiceConfig`, `VoiceProviderList`, `VideoProvider`,
  `ImageProviderList`, `AgentScorer`, `ArbiterRegistry`, `AuthProvider`,
  `TeamChatTurn` — with the enums and nested objects they carry (674 → 705
  named types). The web client held all of these as hand-written types and
  asked for the first five by name; every other consumer was reading them as
  untyped JSON.

## 0.5.10 — 2026-08-20

### Added — every SDK

- **`LedgerIntegrity`, and the operation that returns it.** 0.5.9 shipped this
  schema and referenced it from nothing: the type existed, and
  `verifyGovernanceLedger` still answered an untyped `{valid, errors[]}`. A
  type no call returns is the same dead declaration this release series exists
  to remove, so it is worth saying plainly that we shipped one. Now
  `verifyGovernanceLedger()` returns `LedgerIntegrity`, with `entries_checked`
  and `checked_at` as the wire actually carries them, and `first_invalid_seq`
  documented as present only when `valid` is false — it names the entry where
  the chain broke, and a client without it can report that something is wrong
  but not where.

- **`EmergencyState`** — the emergency-stop indicator, previously
  `{"type": "object"}`. There are **four** modes, not the two implied by having
  an activate and a deactivate endpoint: `normal`, `safe_mode`,
  `arbitration_safe_mode`, `bootstrap`. A client that cannot name a mode must
  say so rather than fall back to `normal`, because that fallback reports
  "running" during a stop.

- **`GovernanceLedgerHead`** — `head` was declared `string` and is
  `{seq, hash}` on the wire. That is a contradiction rather than an omission,
  and a generated typed client broke on it away from the cause. `head.seq` is
  global across all tenants, not the newest row of your page — measured at 6698
  while the page's newest entry was 6697 — so it cannot be used to test whether
  you hold the latest page.

- **`AgentVersion`** — `GET /agents/{agentId}/versions` had an untyped element
  behind both the canonical `items` and the deprecated `versions` alias.
  `config` stays deliberately opaque: it carries the entire agent, thirteen
  versions came to 537 KB on the canon tenant, and pinning the shape here would
  duplicate `Agent` and then drift from it.

### Changed — every SDK

- **`getGovernanceLedger` now documents that walking the chain is not a
  verification.** This reaches you in the generated code, not only in the
  OpenAPI document, because the failure it prevents is one a careful client
  walks straight into.

  `seq` is global across all tenants while the ledger list is scoped to one, so
  consecutive rows in a page are usually not consecutive in the ledger, and a
  row's `prev_hash` names an entry belonging to another tenant that is never
  returned. Measured against production over three independent samples on
  2026-08-20, correlation total with no exceptions: every pair with adjacent
  `seq` chained, every pair with a gap did not, while
  `GET /governance/ledger/verify` answered `valid: true` at the same moment.

  So a client that honestly walks `prev_hash` across a page reports tampering
  in a ledger the server certifies as intact — the worst direction for this
  particular alarm to fail in, since it is the audit trail and its intended
  reader is an auditor. Integrity has exactly one authority, the verify
  endpoint. A page-local walk may say "adjacent and chained" or "cannot be
  checked from here"; it may never say "broken".

  Found by the Ada consumer, which measured the chain independently and modelled
  four link states rather than two, deliberately offering no "page intact"
  verdict it could not honestly compute.

- **`total` on the ledger response is the size of the window, not of the
  ledger** — 16 against `entries_checked: 6698`. Rendering it as "events
  recorded" understates the ledger by three orders of magnitude.

## 0.5.9 — 2026-08-20

### Added — every SDK

- **Six governance types the document had never carried at all.** The web
  session's audit reported these as "fields the SDK lacks"; the truth was
  gentler on the SDK and worse on the document — the schemas did not exist, so
  every client touching voting, the constitution or the ambassador surface had
  been transcribing the platform types by hand.

  `VoteResult` — the tally written once when voting closes. Its `status` is a
  distinct enum from the proposal's own: this one is the arithmetic's verdict,
  and the proposal record is updated from it.

  `HumanAmbassador` and `AmbassadorPermissions` — the human on the other side
  of an ambassador request. This is where `ambassador_id` lives; a client
  reading that field off the request was reading one that does not exist.

  `VetoRecord` — a human overruling the collective, immutable once issued.

  `ConstitutionDocument` and `ConstitutionAmendment` — `amendments` is audit
  history rather than a pending queue, and an amendment's `rule` is absent for
  `remove` and present otherwise.

### Changed

- The release now refuses to build from a vendored document the platform no
  longer serves. 0.5.7 shipped a fixed generator against a spec last refreshed
  for 0.5.6, and it took two consuming sessions reading a published tarball to
  notice. The guard caught this release's own staleness before the build,
  which is the whole point of it.

## 0.5.8 — 2026-08-19

### Fixed — every SDK

- **0.5.7 shipped the fixed generator against a stale document.** The
  generator change and the platform's document work both landed, and they did
  not meet in that artifact: `spec/openapi.json` had last been refreshed for
  0.5.6, so none of the night's schema work reached the packages. Reported by
  the Playground session, which updated to 0.5.7, checked each promise
  separately, and found two of three missing — `approveRun` still had no body
  parameter and `createSessionBranch` still took a `JsonObject`.

  Nothing is wrong with 0.5.7's code. This release is the same generator run
  against the current document, which is why it carries no generator change of
  its own.

### Added — every SDK

- Typed request bodies where the document previously described none:
  `RunApproveRequest` (an operator's note when approving a paused tool call —
  the asymmetry with `rejectRun` was an omission) and
  `CreateSessionBranchRequest`.
- `SessionBranch` as a described response, eight fields rather than three, and
  `ListSessionBranchesResponse` with the `session_id` and `total` the envelope
  actually carries.
- The governance block rewritten from the platform types. `VotingProposal`
  shared two of its five status values with the server and was keyed on an
  invented `id`; `ArbitrationCase` and `AmbassadorRequest` had the same defect.
  A client generated from the old document could not recognise a proposal that
  had passed, been rejected, or expired, and `Ballot.vote` sent `yes` where the
  server accepts `approve`.
- `UsageSummary` — the operation declared no response body at all, so every
  consumer hand-wrote the shape.
- `Agent` gained `visibility`, `status`, `autonomy`, `tool_overrides`,
  `public_config`, `bridge`, and `knowledge_base_ids`. The document had carried
  only the deprecated singular `knowledge_base_id`, so a client could link one
  knowledge base to an agent that supports several and never know.
- `ValidationPolicy` gained `auto_revise` and `selective`. The first drives the
  revision loop; without it declared, a client could not turn the loop off.
- List elements that were bare objects now name their type: `Run` in the runs
  list, `KnowledgeBase`, `ActiveSession`, `TeamRunSummary`.
- `POST /auth/oauth/exchange` — the second half of the mobile sign-in
  hand-off, which releases the session only to a caller holding the verifier.

## 0.5.7 — 2026-08-19

### Fixed — every SDK

- **A documented response body decoded to nothing.** The generator chose the
  payload type by walking a list of media types, and anything the list did not
  name fell past every branch and arrived with no type at all. The emitters
  read that as "this operation answers with nothing", and the TypeScript
  transport then cancelled a response that had already arrived intact.

  Four operations were affected, measured against the live document rather
  than guessed: `exportRunEvents` (`application/x-ndjson`),
  `registryGetArtifact` (`application/zstd`), `getPublicTenantStylesheet`
  (`text/css`), and `llmSynthesizeSpeech` (`audio/*`). The last one is the
  expensive one — speech synthesis called a paid provider, received the audio,
  and dropped every byte of it without failing.

  The list is gone; one rule decides, and the branch that produced an empty
  type no longer exists, so a media type the generator has never seen cannot
  become nothing again.

- **The text path was missing in four of the five languages.** Fixing the type
  alone would have been a half-fix that reads as a whole one: the signatures
  would have said `String` while the body was still decoded as JSON. The
  payload encoding is now carried through the IR, because the type cannot say
  it — a `string` reaches the emitters both from a JSON schema of
  `{"type": "string"}`, whose body must be parsed, and from a text media type,
  whose body must not be.

  TypeScript emits `responseType: 'text'`; Rust gained `request_text` and
  Swift `sendText`, neither of which existed; Kotlin's `requestText` already
  existed and nothing had ever selected it; Ada was already correct.

  Concretely, this is why it mattered: a JSONL export holding exactly one
  event is valid JSON, so the default path parsed it cleanly and returned an
  object from a method declared to return a string. It lied on short runs and
  behaved on long ones.

- **`getMetrics` (`text/plain`) had the same defect before any of this.** It
  survived because Prometheus text nearly always throws on parse — it was not
  working, it was lucky.

### Changed

- `scripts/update-spec.sh` pulls the document from `api.snaga.ai` rather than
  from the website that mirrors it, and refuses to write a document with fewer
  paths or schemas than the vendored one, naming the url it fetched.

## 0.5.6 — 2026-08-18

### Fixed — every SDK

- **`ProductUpdate` named a field the server does not accept.** It declared
  `title`; the handler's whitelist contains `name` and copies only whitelisted
  keys before answering 200 either way. A client renaming a product through the
  generated model sent `title`, received a success, and the name never changed.
  The model now declares the nineteen fields the handler accepts, copied from
  the code rather than composed.

### Added — every SDK

- **`getAgentRiskClassification`.** The server has served
  `GET /agents/{agentId}/risk-classification` since the sub-resource was split
  out, but the document never declared it, so the EU AI Act classification could
  be WRITTEN through the SDK and never read back — a compliance field clients
  could set but not verify. Returns `RiskClassification`.

- **`RiskClassificationUpdate`** as the PATCH body, replacing an untyped
  `JsonObject`. `level` and `annex_iii_category` are the unions they have always
  been in the platform types; `assessed_at` is optional because the handler
  defaults it, which is the one field where the request and the stored record
  genuinely differ.

- **`TeamGoalConfig`, `TeamSwarmConfig`, `TeamObjectiveBudget`.** `goal_config`
  and `swarm_config` were `{"type": ["object", "null"]}`, so reading
  `swarm_config.handoff_context_strategy` or `goal_config.budget.max_cost_usd`
  gave `JsonValue`. These landed in the document after 0.5.5 was cut.

### Notes

- Both fixes come from clients that found the gaps by BUILDING against the
  generated code — the playground client reached 203 of 287 operations and
  diffed every body it sent against the handlers. Neither gap was visible from
  the document, because the document was the thing that was wrong.

## 0.5.5 — 2026-08-18

### Fixed — every SDK

- **A failure the server did not phrase as RFC 9457 is no longer thrown away.**
  `{"error": "Insufficient role: owner required"}` reached callers as a failure
  carrying no message at all. Every field of `Problem` is optional, so that body
  DECODES SUCCESSFULLY into an empty document, and each client fell back to the
  raw bytes only when decoding THREW — which it never did. The fallback was dead
  code for exactly the input it was written for, in TypeScript, Swift, Rust and
  Kotlin alike. 32 API handlers answer with that bare shape.

  Each client now checks for RFC 9457 keys before treating a body as a problem
  document, and otherwise keeps the message: `error` as a string,
  `error.message` nested, `message`, or the raw text. A genuine problem document
  is still used as-is; an HTML gateway page keeps its text.

  Ada is NOT covered — its error path was not inspected, so it is unknown
  rather than clean.

### Added — every SDK

- **`Team.workers` and `Team.policies` are described types.** They were
  `{"type": "object"}` in the document, so the generator could only render them
  as free-form JSON — `JsonObject[]` and `JsonObject`. Consumers that model
  those shapes precisely had to keep hand-written types, and adopting the
  generated `Team` would have DELETED type information rather than added it.
  Now `workers: TeamWorker[]` and `policies: TeamPolicies`, with
  `TeamWorkerPermissions`, `TeamWorkerExternalA2A`, `ValidationPolicy` and
  `ValidationCriterion` alongside.

### Notes

- `required` on the new schemas is the intersection of what the platform types
  mark mandatory and what a production response actually carries. Marking a
  field required that the server sometimes omits makes Rust, Swift, Kotlin and
  Ada throw on a successful 200.

## 0.5.4 — 2026-08-18

### Added — every SDK

- **`Agent` gains five fields that were on the wire and in no model.**
  `specs`, `auto_approve_tools`, `command_relationships`, `access_control` and
  `metadata`. The server has always sent them; the OpenAPI document never named
  them; and an undeclared field is absent from generated code, so no caller in
  any of the five languages could read `agent.specs` — the field that drives
  installed SPECs — however correctly it was written.

  Fixed upstream in the API document (chabanov/uarp#135) and pulled here with
  `scripts/update-spec.sh`. `Agent` goes from 30 to 35 properties.

### Notes

- The gap survived because the API's conformance walk checked only the top
  level of a response. For a list endpoint that is the `{items, cursor,
  has_more}` envelope — three keys that have never drifted — while everything an
  SDK actually models sits inside `items`. The walk now descends one level; a
  future field added to a list item will fail CI upstream rather than reaching
  this repository as a silently poorer model.

- No behaviour changed. The additions are optional properties, so code written
  against 0.5.3 compiles unchanged in every language.

## 0.5.3 — 2026-08-17

### Fixed — Swift only

- **A path carrying an inline query no longer crashes the process.**
  `UARPClient.buildRequest` assigned `spec.path` straight to
  `URLComponents.percentEncodedPath`. A caller passing the query inline
  (`"runs?limit=50"`) tripped Foundation's precondition and raised
  `EXC_BAD_INSTRUCTION` — the iOS app died at boot. `joinPaths` now strips
  everything from the first `?`, so malformed input degrades to "the request is
  sent without the query" instead of killing the process. `spec.query` (or
  `spec.options.query`) remains the correct way to pass one.

### Notes

This fix reached the published Swift package in 0.5.2 but not this repository:
it had been committed directly to the generated `Snaga-AI/uarp-swift` mirror,
which is rebuilt from here on every release and would have silently dropped it.
0.5.3 restores the invariant that the tag, the source and the mirror describe
the same code. The 0.5.2 tag is left exactly as published.

The TypeScript, Rust, Kotlin and Ada packages are re-versioned to 0.5.3 to keep
the single shared version, with no code change.

## 0.5.2 — 2026-08-17

Swift drew a line in 0.5.1: an empty `apiKey` means "this client carries no
credentials", and sending `Bearer ` with nothing after it is not the same as
sending no header — a server that validates the value can refuse it, and in a
browser it overrides the cookie that would otherwise be attached. This release
brings TypeScript, Rust and Kotlin to that same behaviour.

The immediate consumer is the browser app, which is authenticated by an HttpOnly
`uarp_auth_token` cookie: it never sees an API key, so it could not construct a
client at all.

### Added — TypeScript, Rust, Kotlin

- **A client whose credentials travel another way.** An *explicitly empty*
  `apiKey` (`apiKey: ""`, `.api_key("")`, `.apiKey("")`) is now a statement
  rather than a mistake: no `Authorization` header is sent, and no `?token=` is
  appended on the SSE query. An *omitted* key still throws — "forgot to set
  `UARP_API_KEY`" is the common mistake and a 401 is a much worse way to learn
  about it. The TypeScript error message now names the alternative.

### Changed — Rust, Kotlin

- **`from_env` / `fromEnvironment` refuse a set-but-empty variable.**
  `UARP_API_KEY=""` is a variable that *exists*, so both previously built a
  credential-less client from it. That used to surface as a visible 401; with
  the guard above it would have become a silent unauthenticated request
  instead. Going keyless stays a deliberate act on the builder.

### Notes

Ada is deliberately unchanged: its constructor already refuses an empty key
outright ("the API key must not be empty"), so neither `Bearer ` nor an empty
`?token=` is reachable there. A guard for a state that cannot occur would be
dead code.

No existing caller changes behaviour — a real key is sent exactly as before,
and every path that previously threw still throws.

## 0.5.1 — 2026-08-16

### Added — Swift only

- **`UARPClient.sendRaw(_ spec:) -> (Data, HTTPURLResponse)`**, a transport-only
  primitive that retries transient failures (the retryable status codes, timeouts,
  dropped connections) exactly as `send` does but returns the terminal response —
  success OR failure — instead of throwing on a non-2xx. A consumer that decodes
  responses through its own tolerant decoder (notably the iOS app, which keeps its
  own model layer) needs the raw bytes of an error body: some endpoints refuse
  with a bare `{"error":"…"}` rather than an RFC 9457 document, and `send`/`sendData`
  discard that body when they throw `UARPError.api`. `sendRaw` hands it back. The
  existing `send`/`sendData`/`sendVoid` thin over the same retry core, unchanged.

### Changed — Swift only

- **An empty `apiKey` now omits the `Authorization` header** instead of sending
  `Bearer ` with nothing after it. A guest or public client (`Configuration(apiKey:
  "")`) carries no credentials; `Bearer ` is not the same as no header, and a server
  that validates the header value can refuse it.

The TypeScript, Rust, Kotlin and Ada packages are re-versioned to 0.5.1 to keep the
single shared version, with no code change.

## 0.5.0 — 2026-08-16

### Changed — breaking (Swift only)

- **The Swift package's module is now `UARPSDK`.** It was `UARP`, the same name
  as the iOS app target that is its first consumer — a Swift app cannot `import`
  a module with the same name as its own module, so the two could not coexist.
  Renaming the SDK module (rather than the app) is the cheaper fix and aligns
  Swift with the other four SDKs, which all ship as `uarp-sdk` / `uarp_sdk` /
  `ai.snaga:uarp-sdk`. `import UARP` becomes `import UARPSDK`. There were no
  Swift consumers before this release, so nothing breaks. The package directory
  (`Sources/UARP`), the generated output and the request wire are unchanged; the
  rename is compile-time only.

The TypeScript, Rust, Kotlin and Ada packages are re-versioned to 0.5.0 to keep
the single shared version, with no code change.

## 0.4.0 — 2026-08-16

Every SDK now reads the platform's real event stream. Until this release only
the Kotlin parser handled the three wire shapes the platform emits; the other
four silently dropped everything that was not a standard `text/event-stream`
frame, so a run that looked complete on Kotlin was empty on TypeScript, Rust,
Swift and Ada.

### Added

- **SSE parser parity across all five SDKs.** The TypeScript, Rust, Swift and
  Ada parsers now handle the three wire shapes the platform emits — standard
  `text/event-stream`; a JSON object carried in an SSE comment
  (`:{"type":"…","event_id":"…"}`); and bare NDJSON (`{"type":"…","event_id":"…"}`)
  — plus the `data: [DONE]` hard terminal. A shared decode-parity fixture
  (`contract/sse-fixtures/`) is replayed field-by-field by every SDK and locked
  against the Kotlin reference, so the five cannot drift apart again.
- **Reconnect loop, opt-in.** `StreamOptions` (each language's idiomatic name)
  adds: terminal events that stop the stream without reconnect; an inactivity
  watchdog that reconnects on a silent-but-open socket; HTTP 401 surfacing
  without retry; `Last-Event-ID` resume that replaces a caller-supplied id only
  once an event has been delivered; a stability reset of the reconnect attempt
  counter; and a `Connecting → Connected → Reconnecting → Disconnected` state
  callback. Defaults preserve standard-SSE behaviour, so existing callers see
  no change.

## 0.3.0 — 2026-08-14

Regenerated from a corrected API document, and one fix that matters more
than the rest.

### Fixed

- **Paginated collections came back empty.** Every `*All` walker stopped at
  the first page with no items, and this API returns exactly that: it applies
  the page size before filtering, so a request for two items answers with none
  while `has_more` is still true. Callers were told a collection was empty when
  it was not — silently, with no error to notice. An empty page no longer ends
  the walk; a server that never yields anything is stopped after three empty
  pages in a row, and the repeated-cursor guard still bounds a server that never
  clears its cursor. Affects TypeScript, Rust, Swift and Kotlin; the Ada walker
  was already correct.

### Changed — breaking

The API document changed shape and the generated surface followed it.

- **`AgentModelConfig` no longer carries `provider`, `model_ref`,
  `endpoint_url` or `api_key_ref`**, and the `AgentModelConfigProvider`
  enumeration is gone with them. The platform selects the model itself; the
  response now describes capabilities only. Requests take
  `AgentModelConfigInput`, which the document states is accepted and ignored —
  so creating an agent is just a name.
- **`GetHealthResponse.status` is an enumeration** (`healthy`, `degraded`,
  `unhealthy`) rather than free text, and the four properties `/health` always
  returned are described at last.
- Required properties corrected across `ConstitutionRule`, `Integration`,
  `BridgeConnection`, `GovernanceLedgerEntry` and `DesignRequest`, and twelve
  input schemas added. 603 models where 0.2.0 had 575.

Code written against 0.2.0 that sets a model on create, or reads a provider
off an agent, will not compile. Both were already ignored by the platform.

### Known

The API document declares itself `0.2.0` in both releases although its content
changed between them, so the SDK version is the only thing that tracks it.

## 0.2.0 — 2026-08-14

First release. Generated from UARP spec version 0.2.0: 557 operations across
43 resource groups, 575 models, 11 event streams, 14 cursor-paginated
endpoints.

### Added

- **TypeScript / Node** (`uarp-sdk` on npm) — ESM, no runtime dependencies,
  Node 18+.
- **Rust** (`uarp-sdk` on crates.io) — `reqwest` + `serde` + `tokio`, rustls by
  default, MSRV 1.88.
- **Swift** (`UARP` via SwiftPM) — `async`/`await` over `URLSession`, macOS 12 /
  iOS 15 and up, no dependencies.
- **Kotlin / Android** (`ai.snaga:uarp-sdk`) — coroutines, OkHttp,
  kotlinx.serialization, Java 11 bytecode.
- **Ada** (`uarp_sdk` on Alire) — Ada 2022 over libcurl with GNATCOLL.JSON.

Every SDK covers the whole API surface and shares the same behaviour:

- Bearer authentication, falling back to `UARP_API_KEY` / `SNAGA_API_KEY`.
- An `Idempotency-Key` on every mutating `/api/v1/*` request, which is also
  what makes a write safe to retry.
- Retries for `408`, `409`, `429`, `500`, `502`, `503`, `504` and dropped
  connections, with
  full-jitter backoff honouring `Retry-After` and `X-Should-Retry: false`.
- RFC 9457 problem documents parsed into typed errors carrying the status,
  detail, `correlationId` and field-level validation failures.
- Event streams as a native async type, reconnecting with `Last-Event-ID`.
- An extra method per paginated endpoint that walks every page.
- Enum values the server adds later decode instead of failing.


### Fixed before release

Nothing below shipped to anyone: these are defects found while building the
five SDKs against each other and against the live API, kept because each one
documents behaviour a caller can rely on.

- **Rust:** `rust-version` said 1.75 and the crate had never been built with it.
  The floor is 1.88, set by the `icu_*` crates that `url` pulls in, not by
  anything in this SDK — a caller on 1.75 would have got a failure inside a
  dependency's manifest. CI now builds the crate with whatever version the
  manifest promises, so the two cannot drift apart again.
- **Ada:** streaming is reentrant. The parser and handler used to live in a
  package-level variable, so only one event stream could run per process.
  Handlers are now an `Event_Sink` interface whose state lives on the caller's
  stack — which also removes the rule that a handler had to be a library-level
  subprogram. libcurl's global initialisation is serialised behind a protected
  object.
- **Swift:** a query value containing `+` was sent unescaped, and a server
  applying form-decoding rules read it back as a space. Query components are now
  percent-encoded by hand rather than by `URLQueryItem`.
- **All five:** query names and values are percent-encoded to the same rule —
  everything outside the RFC 3986 unreserved set is escaped, spaces included
  (`%20`, not `+`). The SDKs previously used three different sets of "safe"
  characters, which decoded the same under form rules but not under RFC 3986.
- **Kotlin:** JSON bodies are sent as `Content-Type: application/json` rather
  than `application/json; charset=utf-8`. OkHttp appends the charset to a
  string body; the other four SDKs send it bare.
- **Ada:** a required free-form `object` field defaults to `{}` rather than
  JSON null, so a caller who leaves it unset no longer sends a value of the
  wrong type.
- **Kotlin:** models whose schema declares `additionalProperties` keep the keys
  they do not model and send them back unchanged, matching Swift, Rust and Ada.
- **Ada:** event streams now reopen with `Last-Event-ID` when the connection
  ends, which the documentation already claimed for all five SDKs. A connection
  that delivered at least one event earns a fresh reconnect budget;
  `Request_Options.Reconnect` and `.Max_Reconnects` bound it.
- **Ada:** failures now carry the response headers, so `Retry-After` and the
  rate-limit hints are reachable through `UARP.Errors.Retry_After_Seconds`,
  `Rate_Limit_Remaining` and `Rate_Limit_Reset`. They were parsed by the
  transport and then discarded.
- **Ada:** a binary download containing a NUL byte was truncated at that byte.
  `Interfaces.C.Strings.Value` stops at the first NUL regardless of the length
  it is given, so the response body is now copied through an address overlay of
  the exact length libcurl reported.

### Changed

- **Rust:** per-call overrides, which the other four SDKs already had. Rust has
  no default arguments, so rather than an options parameter on all 557 methods
  they ride on a cheap clone of the client that shares its connection pool:
  `client.with_idempotency_key(..)`, `.with_timeout(..)`, `.with_max_retries(..)`,
  `.with_header(..)`, `.with_query(..)`, `.with_stream_options(..)`, or
  `.with_options(RequestOptions { .. })`. Generated streaming methods no longer
  take a `StreamOptions` argument; it comes from the clone.
- The SDK version now comes from the repository `VERSION` file, which the
  generator bakes into each package's metadata; `scripts/set-version.sh` sets
  it everywhere at once.

### Also in this release

- **Publishing is documented and the Swift package is reachable.** SwiftPM
  resolves a git URL and expects `Package.swift` at the repository root, so a
  package in a monorepo subdirectory cannot be depended upon at all. The release
  now copies `packages/swift` into `Snaga-AI/uarp-swift` and tags it there.
  PUBLISHING.md covers the accounts, the DNS record that proves the Maven
  namespace, the signing key, and the order to publish in.
- **Every package carries its LICENCE.** All five declared MIT in their metadata
  and shipped no licence text; npm even listed a file that was not there.
- **Live conformance probe** (`smoke/`, `make smoke`). Calls the whole
  documented surface against a running server in dependency order, validates
  every response against the schema that promised it, and writes a report for
  the backend team. Requests carry the documented minimum — each required
  property and nothing else — so a rejection means the endpoint enforces a rule
  the document never states. Writes that have a matching read echo it back
  unchanged, which exercises configuration endpoints without altering them.
  Deletes only target identifiers the run created; `smoke/quarantine.json` names
  the calls it will not make on its own. Requests go through the TypeScript
  SDK's own transport, so the run exercises shipped code.
- **Live SDK scenario** (`smoke/live/`). One fixed sequence through all five
  SDKs against a real server, comparing what each decoded. It is the only check
  that puts the Rust, Swift, Kotlin and Ada transports against real TLS and real
  infrastructure rather than a local mock, and a value an SDK cannot decode is
  reported rather than raised, so the disagreement shows up in the comparison
  instead of a stack trace.
- Release workflow covering npm, crates.io, Maven Central, a GitHub release and
  an Alire submission tarball, with a dry run through `workflow_dispatch`.
- `node generator/src/index.ts --check` (also `make check`) reports every
  generated file that is missing, stale or left over. CI runs it instead of
  diffing the working tree, so the same check works locally without a commit.
- An emitter that meets a request body encoding it cannot render now stops the
  build instead of falling back to JSON. Only TypeScript implements
  `application/x-www-form-urlencoded`; no endpoint uses it yet.
- Generator test suite: unit tests for naming, IR assertions, golden files for
  all five emitters, and compile checks for the emitted TypeScript, Rust and
  Swift.
- Coverage for paths that had none: `X-Should-Retry: false`, `Retry-After` in
  its HTTP-date form, connection-failure retries, and the SSE token query
  parameter in all five SDKs.
- Multipart uploads and binary downloads are exercised end to end in all five
  SDKs, with a NUL and a high byte in the payload. Three of the five encoders
  are hand-written and had no coverage at all.
- Rate-limit and retry accessors are covered in every SDK, including the
  fallback from the problem document to the `X-Correlation-Id` header.
- A cross-SDK contract check (`make contract`): all five SDKs run the same
  seventeen-request scenario against one server, which records what each put on
  the wire, and the traces must match exactly — raw query string included, so
  `a+b` and `a%20b` are not treated as equal. It found every wire-format
  difference fixed above, including the Swift `+` bug. The scenario covers
  percent-encoding, multipart, binary bodies, retries, paging, event streams,
  falsy values that must not be dropped, and a string with a quote, a
  backslash, a newline, a tab and a character outside the basic plane. A final
  scenario compares decoding rather than sending: each SDK reports what it read
  out of one awkward payload — an unseen enum value, an explicit null, an
  absent optional, an empty array and an integer beyond 2^53 — and the reports
  are compared too. Differences that cannot be fixed are recorded in
  `contract/known-differences.json` with a reason.
- Every behavioural claim the READMEs make is now backed by a test in every
  SDK that makes it: stream reopening with `Last-Event-ID`, writes retrying
  only when they carry an idempotency key, caller-supplied keys, the cursor
  guard that stops a server which never clears its cursor, and enum values the
  API adds after generation.

### Tooling

- `generator/` turns `spec/openapi.json` into all five SDKs; the transport,
  error, retry, pagination and SSE layers are hand-written per package.
- Generator test suite: unit tests for naming, IR assertions against fixtures
  and the production document, golden files for all five emitters, and
  compile checks for the emitted TypeScript and Rust.
- `make test` builds and tests everything; CI runs the same matrix and fails if
  the checked-in output drifts from the emitters.
