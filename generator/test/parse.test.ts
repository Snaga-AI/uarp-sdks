/**
 * What the parser decides about the API. These assertions are the contract the
 * five emitters rely on; a change here changes every SDK at once.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ObjectType, Spec, TypeRef } from '../src/ir.ts';
import { checkTarget } from '../src/index.ts';
import { fixture, namedType, operation, productionSpec } from './support.ts';

function object(spec: Spec, name: string): ObjectType {
  const type = namedType(spec, name);
  assert.equal(type.kind, 'object', `${name} should be an object`);
  return type as ObjectType;
}

function property(spec: Spec, typeName: string, wire: string) {
  const found = object(spec, typeName).properties.find((p) => p.wire === wire);
  assert.ok(found, `${typeName} has no property ${wire}`);
  return found;
}

// --------------------------------------------------------------- optionality

test('required, optional and nullable are three different things', () => {
  const spec = fixture('nullability');

  const required = property(spec, 'Thing', 'id');
  assert.equal(required.required, true);
  assert.equal(required.nullable, false);

  // `type: ["string", "null"]` on a required property: always present, may be null.
  const requiredNullable = property(spec, 'Thing', 'required_nullable');
  assert.equal(requiredNullable.required, true);
  assert.equal(requiredNullable.nullable, true);

  const optional = property(spec, 'Thing', 'optional_plain');
  assert.equal(optional.required, false);
  assert.equal(optional.nullable, false);

  const optionalNullable = property(spec, 'Thing', 'optional_nullable');
  assert.equal(optionalNullable.required, false);
  assert.equal(optionalNullable.nullable, true);

  // The OpenAPI 3.0 spelling has to work too.
  assert.equal(property(spec, 'Thing', 'legacy_nullable').nullable, true);
});

test('maps scalar formats onto distinct primitives', () => {
  const spec = fixture('nullability');
  assert.deepEqual(property(spec, 'Thing', 'id').type, { kind: 'prim', prim: 'uuid' });
  assert.deepEqual(property(spec, 'Thing', 'created_at').type, { kind: 'prim', prim: 'datetime' });
  assert.deepEqual(property(spec, 'Thing', 'count').type, { kind: 'prim', prim: 'integer' });
  assert.deepEqual(property(spec, 'Thing', 'optional_plain').type, { kind: 'prim', prim: 'number' });
  assert.deepEqual(property(spec, 'Thing', 'tags').type, {
    kind: 'array',
    items: { kind: 'prim', prim: 'string' },
  });
  // A bare `type: object` is free-form JSON, not an empty model.
  assert.deepEqual(property(spec, 'Thing', 'free_form').type, { kind: 'prim', prim: 'jsonObject' });
  assert.deepEqual(property(spec, 'Thing', 'anything').type, { kind: 'prim', prim: 'jsonObject' });
});

test('carries const, default and deprecated through to the emitters', () => {
  const spec = fixture('nullability');
  assert.equal(property(spec, 'Thing', 'kind').constValue, 'thing');
  assert.equal(property(spec, 'Thing', 'deprecated_field').deprecated, true);
});

// --------------------------------------------------------------------- enums

test('hoists enums and shares identical value sets', () => {
  const spec = fixture('enums');

  const status = property(spec, 'Report', 'status');
  assert.equal(status.type.kind, 'named');

  const statusType = namedType(spec, (status.type as { name: string }).name);
  assert.equal(statusType.kind, 'enum');
  assert.deepEqual(
    (statusType as { values: string[] }).values,
    ['active', 'other', '2fa', 'run.completed', 'in progress'],
  );

  // The same value set really is the same type; sharing `SortOrder` is a feature.
  const first = property(spec, 'Report', 'shared_order').type;
  const second = property(spec, 'Report', 'also_order').type;
  assert.deepEqual(first, second);
});

test('does not merge unrelated objects that happen to match', () => {
  // Two `{ name }` bodies in different operations must keep their own names,
  // otherwise a method advertises a request type from another resource.
  const spec = fixture('method-names');
  const names = spec.types.map((type) => type.name);
  assert.equal(new Set(names).size, names.length, 'type names must be unique');
});

// ---------------------------------------------------------------- pagination

test('detects the canonical cursor envelope', () => {
  const spec = fixture('pagination');
  const pagination = operation(spec, 'listItems').pagination;
  assert.ok(pagination, 'listItems should be paginated');
  assert.equal(pagination.itemsProp, 'items');
  assert.equal(pagination.cursorProp, 'cursor');
  assert.equal(pagination.hasMoreProp, 'has_more');
  assert.equal(pagination.cursorParam, 'cursor');
  assert.equal(pagination.limitParam, 'limit');
  // The emitters guard on these: `cursor` is nullable, `has_more` is not.
  assert.equal(pagination.itemsOptional, false);
  assert.equal(pagination.cursorOptional, true);
  assert.equal(pagination.hasMoreOptional, false);
  assert.deepEqual(pagination.itemType, { kind: 'named', name: 'Item' });
});

test('detects a differently named envelope with a single array', () => {
  const spec = fixture('pagination');
  const pagination = operation(spec, 'listBoxes').pagination;
  assert.ok(pagination);
  assert.equal(pagination.itemsProp, 'boxes');
  assert.equal(pagination.hasMoreProp, undefined);
  assert.equal(pagination.itemsOptional, true);
});

// --------------------------------------------------------------method names

test('shortens a method name only when the result stays honest', () => {
  const spec = fixture('method-names');
  assert.equal(operation(spec, 'listAgents').method, 'list');
  assert.equal(operation(spec, 'createAgent').method, 'create');
  assert.equal(operation(spec, 'deleteRun').method, 'delete');
  // Stripping `Runs` here would leave `listAgent`, which is about agents.
  assert.equal(operation(spec, 'listAgentRuns').method, 'listAgentRuns');
});

test('keeps full ids when shortening would collide', () => {
  const spec = fixture('method-names');
  // Both `getRun` and `getRuns` want to become `get`.
  assert.equal(operation(spec, 'getRun').method, 'getRun');
  assert.equal(operation(spec, 'getRuns').method, 'getRuns');
});

// -------------------------------------------------------------- composition

test('flattens allOf into one object', () => {
  const spec = fixture('composition');
  const response = operation(spec, 'createEmbedding').response.type;
  assert.equal(response?.kind, 'named');

  const detail = property(spec, (response as { name: string }).name, 'detail');
  const merged = object(spec, (detail.type as { name: string }).name);
  assert.deepEqual(
    merged.properties.map((p) => p.wire).sort(),
    ['extra', 'id', 'note'],
  );
  assert.equal(merged.properties.find((p) => p.wire === 'id')!.required, true);
  assert.equal(merged.properties.find((p) => p.wire === 'extra')!.required, true);
  assert.equal(merged.properties.find((p) => p.wire === 'note')!.required, false);
});

test('turns oneOf into a union', () => {
  const spec = fixture('composition');
  const request = operation(spec, 'createEmbedding').body!.type;
  const input = property(spec, (request as { name: string }).name, 'input');
  assert.equal(input.type.kind, 'union');
  assert.deepEqual((input.type as { variants: TypeRef[] }).variants, [
    { kind: 'prim', prim: 'string' },
    { kind: 'array', items: { kind: 'prim', prim: 'string' } },
  ]);
});

// -------------------------------------------------------------------- bodies

test('describes multipart bodies part by part', () => {
  const spec = fixture('bodies');
  const body = operation(spec, 'uploadBundle').body;
  assert.ok(body);
  assert.equal(body.encoding, 'multipart');
  assert.deepEqual(body.parts, [
    { wire: 'manifest', required: true, role: 'field', description: 'JSON-stringified manifest.' },
    { wire: 'artifact', required: true, role: 'file', description: undefined },
    { wire: 'sha256', required: false, role: 'field', description: undefined },
  ]);
});

test('distinguishes no content from undocumented content', () => {
  const spec = fixture('bodies');
  // 204 really is empty.
  assert.equal(operation(spec, 'deleteUpload').response.type, undefined);
  // A 200 documented without a body still returns something; raw JSON beats
  // throwing the payload away.
  assert.deepEqual(operation(spec, 'getUploadMetadata').response.type, { kind: 'prim', prim: 'json' });
  assert.deepEqual(operation(spec, 'downloadBundle').response.type, { kind: 'prim', prim: 'binary' });
  assert.deepEqual(operation(spec, 'getMetrics').response.type, { kind: 'prim', prim: 'string' });
  // A 202 next to a 204 is the idempotency layer saying "still in flight" for
  // a replayed key — a body shaped like an error, with `retry_after_seconds`.
  // The operation's answer is the 204; the 202 must not become its type.
  assert.equal(operation(spec, 'unlockUpload').response.status, 204);
  assert.equal(operation(spec, 'unlockUpload').response.type, undefined);
});

test('the in-flight 202 of an idempotent operation is never its response type', () => {
  // uarp #444 attached `202 IdempotencyInFlight` to every idempotent operation.
  // Where the real answer is a 204, the lowest 2xx became the 202 and 0.5.21
  // shipped fifteen methods typed as `{ error, message, retry_after_seconds }`
  // — the Rust `files.delete` then failed to decode the empty 204 it actually
  // got. These fifteen are the operations whose only 2xx besides the 202 is a
  // 204 in the served document.
  const spec = productionSpec();
  for (const id of [
    'deleteFile',
    'deleteWorkspace',
    'deleteCompany',
    'deleteKnowledgeBase',
    'deleteKbDocument',
    'deleteIntegration',
    'deleteInvite',
    'deleteAgentIdentity',
    'deleteMemoryEntry',
    'deleteSessionAnnotation',
    'revokeSessionShare',
    'unpublishListing',
    'registryYankVersion',
    'registryUnyankVersion',
    'deleteAndroidTester',
  ]) {
    const op = operation(spec, id);
    assert.equal(op.response.status, 204, `${id} answers with a 204`);
    assert.equal(op.response.type, undefined, `${id} has no response body`);
  }
});

test('marks mutating /api/v1 requests idempotent', () => {
  const spec = productionSpec();
  assert.equal(operation(spec, 'createAgent').idempotent, true);
  assert.equal(operation(spec, 'listAgents').idempotent, false);
});

// ----------------------------------------------------------------- streaming

test('recognises event streams and leaves transport headers alone', () => {
  const spec = fixture('streaming');
  const op = operation(spec, 'streamRunEvents');

  assert.equal(op.sse, true);
  assert.deepEqual(op.scopes, ['events:read']);
  assert.deepEqual(op.pathParams.map((p) => p.wire), ['runId']);
  assert.deepEqual(op.queryParams.map((p) => p.wire), ['token']);
  // `Idempotency-Key` belongs to the transport, not to the generated signature.
  assert.deepEqual(op.headerParams.map((p) => p.wire), ['Last-Event-ID']);
});

// ---------------------------------------------- invariants on the real spec

test('parses the production document into the expected shape', () => {
  const spec = productionSpec();
  const ops = spec.groups.flatMap((g) => g.operations);

  // 557 -> 558 on 2026-08-18: `GET /agents/{agentId}/risk-classification` was
  // added to the document. The handler had served it all along; undeclared, it
  // was absent from every SDK, so the EU AI Act classification could be written
  // through the client and never read back.
  // 558 -> 559 on 2026-08-19: `POST /auth/oauth/exchange`, the second half of
  // the mobile sign-in hand-off. The callback used to put the session key in a
  // fragment on `snaga://callback` — a custom scheme any installed app can
  // claim — so the key is now released only to a caller holding the verifier.
  // 559 -> 641 on 2026-08-27: the vendored document was refreshed against the
  // platform for the first time since 0.5.6, and eighty-two operations arrived
  // at once. They are not scattered — they are seven whole subsystems that had
  // never had a client in any language: squads (22), missions (12), training
  // jobs (10), canvas (7), projects (5), plus `me`, feedback and singles across
  // notifications, admin, analytics and public. A consuming app could reach
  // none of it, which is how three finished screens sat waiting on a release
  // rather than on code.
  // 641 -> 652 on 2026-08-31: six paths the catalogue had been silent about
  // while the platform served them — `/billing/trial`, `/usage/media` and the
  // whole `creativity/sessions` subtree with its events. They were never
  // missing features; they were live surfaces no generated client could reach,
  // which is the same shape as the 559 -> 641 refresh and the reason this
  // count is asserted at all.
  // 652 -> 725 on 2026-09-10 (0.5.16): the copy became the bytes production
  // serves, verbatim. This assertion was not updated with it — the generator
  // suite did not run for that release, which is its own lesson.
  // 725 -> 710 on 2026-09-10 (0.5.17): the Commerce surface was removed from
  // the API (uarp #441) — fourteen `/commerce/*` operations and the Shopify
  // webhook. The first shrink this count has recorded.
  // 710 -> 709 on 2026-09-10 (0.5.18): +16 operations described from their
  // bytes (uarp #444) and -19 with Training and Creativity removed (#445);
  // two more paths gained operations along the way, hence the net of one.
  assert.equal(ops.length, 709);
  // 43 -> 50: Canvas, Feedback, Me, Missions, Projects, Squads, Training.
  // 50 -> 51 on 2026-08-31: Creativity, from the sessions subtree above.
  // 51 -> 50 on 2026-09-10: Commerce is gone with its operations.
  // 50 -> 48 on 2026-09-10 (0.5.18): Training and Creativity gone too.
  assert.equal(spec.groups.length, 48);
  // 603 -> 608 on 2026-08-18: the Agent schema gained `specs`,
  // `auto_approve_tools`, `command_relationships`, `access_control` and
  // `metadata`, each nested object becoming its own named type. The server had
  // always sent all five; the document named none of them, so every generated
  // model was blind to `agent.specs` in particular.
  // 608 -> 617 on 2026-08-18: `Team.workers` and `Team.policies` stopped being
  // `{"type": "object"}` and gained described schemas (TeamWorker,
  // TeamWorkerPermissions, TeamWorkerExternalA2A, TeamPolicies,
  // ValidationPolicy, ValidationCriterion), each nested object becoming its own
  // named type. Before that the generator could only render them as free-form
  // JSON bags, which made the models poorer than the wire they describe.
  // 617 -> 625 on 2026-08-18: eight named types across two document fixes —
  // `TeamGoalConfig`, `TeamObjectiveBudget`, `TeamSwarmConfig` and its handoff
  // enum (the team configs stopped being `{"type": "object"}`), plus
  // `RiskClassification`, `RiskClassificationUpdate` and their two enums. The
  // team configs land here for the first time because 0.5.5 was cut before that
  // API change deployed.
  // 625 -> 635: ten named types from two document fixes, all of them list
  // shapes that were `{"type": "object"}` before. Seven from the four lists
  // that did not say what they return (`Guardrail`, `ApiKeySummary`,
  // `LLMProvider` and four envelopes), three from programs (`ProgramStep`,
  // `Program`, `ListProgramsResponse`).
  // 635 -> 659 on 2026-08-19: twenty-four named types from one night of
  // document work — the governance block rewritten from the platform types
  // (`VotingProposal`, `ArbitrationCase`, `Ballot`, `AmbassadorRequest` had
  // invented keys and status values the server never sends), `UsageSummary`
  // and its margin block (the operation declared no response body at all),
  // `Run` referenced from the runs list instead of a bare object, plus
  // `SessionBranch`, `CreateSessionBranchRequest`, `RunApproveRequest`,
  // `KnowledgeBaseAttachedAgent`, `TeamRunSummary`, `ActiveSession`,
  // `AgentPublicConfig`, `AgentBridgeState` and the OAuth exchange pair.
  // 659 -> 670 on 2026-08-20: six governance schemas the document had never
  // carried at all — `VoteResult`, `HumanAmbassador`, `VetoRecord`,
  // `ConstitutionDocument`, `ConstitutionAmendment` — plus the nested types
  // the generator names in passing (ambassador permissions, the enums on veto
  // targets and amendment actions). Every client touching voting or the
  // constitution had been transcribing these from the platform by hand.
  // 670 -> 674 later the same day: `EmergencyState` (the emergency-stop
  // indicator, four modes where the endpoint pair implies two),
  // `LedgerIntegrity` (which #166 defined and referenced from nothing until
  // #168 wired it to the verify operation), `GovernanceLedgerHead` (declared
  // `string`, `{seq, hash}` on the wire) and `AgentVersion`.
  // 674 -> 705 on 2026-08-20: twenty-five schemas the document gained in the
  // uarp list-element and agent-field fixes (#159, #161, #164, #165, #173) —
  // `Todo`, `KnowledgeBaseDocument`, `ConstitutionViolation`, `TeamGraphNode`,
  // `TeamGraphEdge`, `FeedEntry`, `FileEntry`, `Invite`, `TenantUser`,
  // `RunCheckpoint`, `LlmModel`, `PublicState`/`PublicTenant`/`PublicPlan`,
  // `LandingStats`, `VoiceConfig`, `AgentScorer`, `ArbiterRegistry` and the
  // rest — plus the enums and nested objects they carry. Twenty-five of these
  // the web client held as hand-written types; five of them (the first five
  // above) it asked for by name.
  // 705 -> 723 on 2026-08-20 (second cut of the day): six schemas and the
  // types they carry — `AISystemCard` (+ its technical_specifications),
  // `FRIAReport`/`FRIARight` (the AI Act documents, which the document had
  // answered as bare objects), `RegistryVersionEntry`/`ResolvedDep` (the
  // registry's `versions[]` element, whose dependencies are an ARRAY of
  // {scope,name,version_req}, not the manifest's name→range map),
  // `ConnectorConfigField` (the value type of a connector's config_schema,
  // previously the generator's `Value` placeholder) — plus the enums that
  // uarp #178/#181 added to existing list elements (Todo.status,
  // FeedEntry.event_type, KnowledgeBaseDocument.type/status/embedding_status,
  // TeamGraph role/status/type, ConstitutionViolation rule_type/penalty,
  // ApiKeySummary.kind/status, AgentScorer.config.type).
  // 723 -> 945 on 2026-08-27: two hundred and twenty-four named types from the
  // same refresh, and TWO removed — the only removals in it. Inline
  // `SearchMarketplaceCategory` folded into the `MarketplaceListingCategory`
  // it duplicated value-for-value, and `TenantPlan` stopped being a closed
  // `free|starter|pro|enterprise` union: plans are resolved now, so `plan` is a
  // string beside a new `plan_id`. Both are source-breaking for anyone who
  // imported the NAME, which nothing else in this refresh is — operations,
  // parameters and operationIds all only grew.
  // 945 -> 946 on 2026-08-28: `UploadWorkspaceFileRequest`. `PUT
  // /workspaces/{id}/files` declared no request body at all, so the emitted
  // client had no parameter to put a file in — it sent nothing, the route's
  // `arrayBuffer()` returned zero bytes, and the file was written EMPTY under
  // a 200. The same refresh gave `downloadWorkspaceFile` a media type, which
  // turns its return from `JsonValue` into `Blob`: it was running binary
  // responses through a JSON parser and quietly corrupting png and pdf.
  // 946 -> 949 on 2026-08-28: four added, one removed, from correcting two
  // governance schemas and the team-run request against the handlers.
  // `ImprovementProposalType` — `type` was a bare string beside a `version`
  // declared as a string over a number, `diff` over a field stored as
  // `changes`, and no `title` or `description` at all, so a card generated
  // from this document came out untitled and reading "no diff" over changes
  // that were there. `StartTeamRunResponse` — the 202 was an empty object and
  // answers `{team_run_id}`. `StartTeamRunRequestInputVariant2` and its
  // `chatMode`, replacing the top-level `StartTeamRunRequestChatMode` that is
  // the removal: `addressed_to`, `message` and `chat_mode` were declared at
  // the top level of the body, and the handler's schema takes `input` and
  // `metadata` with `.strip()`. So the addressing and the chat mode were
  // discarded with no error — the run started, it just was not the run that
  // was asked for. All three live inside `input`, which is where the handler
  // reads them.
  // 949 -> 952 on 2026-08-28: three added, none removed, from the three
  // document fixes uarp deployed in #285. `TenantQuotaOverrides` is the one
  // that mattered: `quota_overrides` was declared as `TenantQuotas`, which
  // requires sixteen fields, and overrides are partial by definition — canon
  // sends six — so every strict client failed to decode `GET /tenants/me`.
  // Measured against the released 0.5.14 model: `missing field
  // max_workers_per_team` before, decodes after. The other two,
  // `GetAgentActivityStatsResponseRunsByDayItem` and
  // `...TopErrorMessage`, are the item types that come with activity-stats
  // finally declaring the fourteen fields it was already serving instead of
  // three — this count going up is the proof those eleven fields are now
  // reachable rather than invisible in all five clients.
  // 952 -> 953 on 2026-08-28: one added, none removed. `CompanyCreateBudget`,
  // and note no SCHEMA was added for it — `budget` on the company-create body
  // was an inline object the platform has always accepted and never described
  // in a way the generator could name, so every client typed it loosely. It
  // now declares `total_usd`, `daily_limit_usd`, `alert_threshold_pct` and a
  // `spent_usd` the platform meters and ignores on write.
  // 953 -> 967 on 2026-08-31: eighteen added, four removed, from the six
  // newly-declared paths and two corrections.
  //
  // `UnassignWorkspaceRequest` is the one worth naming. `DELETE
  // /workspaces/{id}/assign` was declared with NO request body while the
  // handler reads one, so all five clients sent nothing, took a 200 and
  // changed nothing — a silent no-op under a success. Its own summary gave it
  // away before the wire did: "Unassign agent/team/company from workspace"
  // names three kinds of target and the path carries none of them.
  //
  // `SetAgentIntegrationsRequest` and its `...ResponseDiff` replace
  // `CreateAgentIntegrationRequest`: assigning integrations is now one call
  // declaring "the COMPLETE set after the call", answering with
  // assigned/unassigned/unknown. That closes the older ambiguity where
  // `integrations` was an array with no description saying whether it merged
  // or replaced.
  //
  // The `CreateTaskRequest*` trio is the removal, alongside that.
  // 967 -> 1111 with the 0.5.16 refresh (measured at 0.5.17, after the six
  // commerce schemas left).
  // 1111 -> 1120 on 2026-09-10 (0.5.18): the described operations brought
  // their bodies and responses (AgentBookmark, WorkspaceFileVersion,
  // MemoryImportEntry, the feedback and public-session shapes …) and the nine
  // Training schemas left — net nine more.
  // 1120 -> 1109 on 2026-09-10 (0.5.19): uarp #447 settled the eleven orphan
  // schemas — five deleted, four added, and several inline response shapes
  // became $refs to schemas that already existed, so fewer anonymous types.
  // 1109 -> 1130 on 2026-09-10 (0.5.20): uarp #448 gave 39 responses their
  // shapes — AuditLogEntry, AgentCapabilities, RunFeedback* and the inline
  // result objects of runs/sessions/workspaces became named types.
  // 1130 -> 1148 on 2026-09-10 (0.5.21): uarp #450 typed 48 more responses
  // (ReadinessReport, FileRecord, TeamRunDetail, PlaygroundAgentState,
  // PlaygroundTemplate, MfaEnrolment and the governance/a2a/team result shapes).
  // 1148 -> 1132 on 2026-09-10 (0.5.23): the fifteen `Delete*Response`-style
  // models and their shared `error: "Accepted"` enum were the idempotency
  // layer's in-flight 202 body mistaken for the answer of a 204 operation
  // (see the in-flight test below); they were never a wire shape those
  // operations return.
  // 1132 -> 1212 on 2026-09-10 (build 5011669e, uarp #453): CTR-07 tranche
  // 2b typed the 56 non-admin responses — 21 named schemas (RunOutput,
  // UsageQuota, EvalRun, PublicAgentCard, JsonRpcResponse, …) plus the inline
  // objects nested under them (search results, eval cases, task items).
  // 1212 -> 1365 on 2026-09-11 (build fb2f530f, uarp #457): CTR-07 tranche 3
  // typed the 83 admin responses — 42 named schemas (the config sections,
  // AdminAuditList, AdminProvider, ConformityReport, AdminModelCatalog, …) and
  // the objects nested inside them (sections, catalogue rows, partners).
  // 1365 -> 1422 on 2026-09-11 (build 2b987dd8, uarp #459): CTR-07b tranche 4
  // typed the 88 array elements — 30 named element schemas (SessionBranch,
  // StrategicGoal, A2APart, Objective, TeamMessage, ChatMessage, …) and the
  // objects nested inside them; ConversationEntry grew content parts,
  // attachments and run metrics.
  assert.equal(spec.types.length, 1422);
  // 31 -> 32 on 2026-09-10 (5011669e): `billing:write` enters the catalogue
  // (billing.ts required it on four operations, the prose lacked it);
  // `read:analytics` became `analytics:read` in the same build (a rename,
  // not a count change — the old spelling stays a server-side alias).
  assert.equal(spec.scopes.length, 32);
  // 11 -> 15: mission events, squad chat, squad run events, training-job events.
  // 15 -> 14 on 2026-09-10 (0.5.18): the training-job events stream is gone.
  assert.equal(ops.filter((o) => o.sse).length, 14);
  // 14 -> 15: `GET /training-jobs`.
  // 15 -> 16 on 2026-08-28: `listTeamRuns`. The handler has read `limit`
  // (default 50, ceiling 100) and `cursor` all along and neither was
  // declared, so a client generated from this document saw the first fifty
  // runs and had no way to reach the rest. This count going up is the proof
  // the declaration took: paging is detected from the parameters, so the
  // operation could not have been counted here before they existed.
  // 16 -> 15 on 2026-09-10: `listCommerceProducts` was one of them.
  // 15 -> 14 on 2026-09-10 (0.5.18): `listTrainingJobs` was another.
  assert.equal(ops.filter((o) => o.pagination).length, 14);
  // 2 -> 3:  joins the two that were already
  // multipart. It is the reason for the type count above — a route that
  // takes a file and said so nowhere.
  assert.equal(ops.filter((o) => o.body?.encoding === 'multipart').length, 3);
});

test('every named type reference resolves', () => {
  const spec = productionSpec();
  const known = new Set(spec.types.map((type) => type.name));
  const dangling: string[] = [];

  const visit = (ref: TypeRef | undefined, where: string): void => {
    if (!ref) return;
    switch (ref.kind) {
      case 'named':
        if (!known.has(ref.name)) dangling.push(`${where} -> ${ref.name}`);
        return;
      case 'array':
        return visit(ref.items, where);
      case 'map':
        return visit(ref.values, where);
      case 'union':
        ref.variants.forEach((variant) => visit(variant, where));
        return;
      default:
        return;
    }
  };

  for (const type of spec.types) {
    if (type.kind === 'object') for (const p of type.properties) visit(p.type, `${type.name}.${p.wire}`);
    if (type.kind === 'alias') visit(type.target, type.name);
  }
  for (const group of spec.groups) {
    for (const op of group.operations) {
      visit(op.response.type, `${op.id} response`);
      if (op.body) visit(op.body.type, `${op.id} body`);
      for (const p of [...op.pathParams, ...op.queryParams, ...op.headerParams]) {
        visit(p.type, `${op.id} param ${p.wire}`);
      }
      if (op.pagination) visit(op.pagination.itemType, `${op.id} page item`);
    }
  }

  assert.deepEqual(dangling, []);
});

test('method names are unique inside every group', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    const names = group.operations.map((op) => op.method);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], `${group.name} has duplicate method names`);
  }
});

test('never exposes a transport-owned header as a parameter', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    for (const op of group.operations) {
      for (const header of op.headerParams) {
        assert.doesNotMatch(header.wire, /^(authorization|idempotency-key)$/i, `${op.id} leaks ${header.wire}`);
      }
    }
  }
});

test('gives every operation and group a usable name', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    assert.match(group.name, /^[A-Za-z][A-Za-z0-9]*$/, `bad group name ${group.name}`);
    assert.ok(group.operations.length > 0, `${group.name} has no operations`);
    for (const op of group.operations) {
      assert.match(op.method, /^[a-z][A-Za-z0-9]*$/, `bad method name ${op.method} (${op.id})`);
      assert.match(op.path, /^\//, `bad path ${op.path}`);
    }
  }
});

test('paginated operations always expose the cursor they need', () => {
  const spec = productionSpec();
  for (const group of spec.groups) {
    for (const op of group.operations) {
      if (!op.pagination) continue;
      const cursor = op.queryParams.find((p) => p.wire === op.pagination!.cursorParam);
      assert.ok(cursor, `${op.id} is paginated but has no ${op.pagination.cursorParam} parameter`);
      assert.equal(op.response.type?.kind, 'named', `${op.id} page response should be a model`);
    }
  }
});

test('--check reports what is missing rather than guessing', () => {
  // Pointed at an empty tree, every file the emitters would write is missing.
  const problems = checkTarget(fixture('nullability'), 'typescript', mkdtempSync(join(tmpdir(), 'uarp-check-')));
  assert.ok(problems.length > 0);
  assert.ok(
    problems.every((problem) => problem.startsWith('missing:')),
    problems.slice(0, 3).join('\n'),
  );
});

test('parsing is deterministic', () => {
  const first = fixture('nullability');
  const again = fixture('nullability');
  assert.equal(JSON.stringify(first), JSON.stringify(again));
});

/**
 * A documented response body must reach the emitters.
 *
 * This is written against the production document rather than a fixture on
 * purpose. The defect it guards was not a wrong decision — it was a list of
 * media types that the real API outgrew, and a fixture would have to be
 * updated by the same person who forgot the list. The production document is
 * updated by the platform, so this assertion goes red on its own.
 *
 * Without the rule in `#response`, four operations fail this: the run-event
 * export, a registry artifact, a tenant stylesheet, and speech synthesis —
 * each documented as returning a payload, each parsed as returning nothing,
 * and each therefore emitted with `responseType: 'void'`, which makes the
 * TypeScript transport cancel the body on a successful 200.
 */
test('no documented response body is parsed away', () => {
  const spec = productionSpec();
  const empty: string[] = [];
  for (const group of spec.groups) {
    for (const op of group.operations) {
      const status = op.response.status;
      // 204/205/304 genuinely carry no body; everything else claimed one.
      if (status === 204 || status === 205 || status === 304) continue;
      if (!op.response.type) empty.push(`${op.id} (${status})`);
    }
  }
  assert.deepEqual(empty, [], `these operations answer with a body the parser dropped: ${empty.join(', ')}`);
});

/**
 * The rule that replaced the list, stated as behaviour rather than as the
 * media types that happen to be in the document today.
 */
test('a response media type decodes to text only when every declared type is text', () => {
  const spec = productionSpec();
  const byId = new Map<string, string>();
  for (const group of spec.groups) {
    for (const op of group.operations) {
      const type = op.response.type;
      if (type?.kind === 'prim') byId.set(op.id, type.prim);
    }
  }
  // JSONL and CSS are text; a compressed artifact and audio keep their bytes.
  const expectations: Array<[string, string]> = [
    ['exportRunEvents', 'string'],
    ['getPublicTenantStylesheet', 'string'],
    ['registryGetArtifact', 'binary'],
    ['llmSynthesizeSpeech', 'binary'],
  ];
  for (const [id, prim] of expectations) {
    // Skip rather than fail if the platform retires an operation: the
    // invariant above is what must hold, this test only illustrates it.
    if (!byId.has(id)) continue;
    assert.equal(byId.get(id), prim, `${id} should decode as ${prim}`);
  }
});
