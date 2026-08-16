/**
 * The ~12 task guides.
 *
 * Anti-drift policy: the only multi-language blocks here are the `Samples`
 * records in `content.ts` — INSTALL, AUTHENTICATE, HELLO, CALLING, ERRORS,
 * PAGINATION, STREAMING, OVERRIDES — each of those compiled by hand against the
 * published package in every language. Everything else is a TypeScript-only
 * block, and its method names, path params and request-body fields are taken
 * from `reference.json` (itself generated from the shipped TS), not written from
 * memory. This documentation has been wrong before, in exactly the way that
 * reads perfectly well, so the rule is: if it isn't verified, it isn't five
 * languages.
 */
import type { Samples } from '../docs/content';
import { AUTHENTICATE, ERRORS, HELLO, OVERRIDES, PAGINATION, STREAMING } from '../docs/content';

/** A single block of a guide. */
export type GuideBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; language: string; code: string; caption?: string }
  | { kind: 'samples'; record: Samples; caption?: string }
  | { kind: 'install' };

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  blocks: GuideBlock[];
}

export const GUIDES: Guide[] = [
  {
    slug: 'getting-started',
    title: 'Install & authenticate',
    summary: 'Add the SDK in any of the five languages and construct a client.',
    blocks: [
      { kind: 'prose', text: "Every SDK ships to its language's native registry. Pick the one you already build in." },
      { kind: 'install' },
      { kind: 'prose', text: 'The client takes an API key explicitly or reads one from the environment. The base URL falls back to production, so a client with an empty options object still works against api.snaga.ai.' },
      { kind: 'samples', record: AUTHENTICATE, caption: 'Construct a client' },
      { kind: 'prose', text: 'API keys are bound to the tenant they were created in; you cannot re-scope one with a header. To act on another tenant, create a key inside it.' },
    ],
  },
  {
    slug: 'run-and-stream',
    title: 'Create, run and stream an agent',
    summary: 'The shortest path to an answer, then the streaming form once that works.',
    blocks: [
      { kind: 'prose', text: 'The platform selects the model itself, so creating an agent is just a name. A run is one call; waitRun polls to a terminal status server-side, so there is no loop to write.' },
      { kind: 'samples', record: HELLO, caption: 'Create, run, wait' },
      { kind: 'prose', text: 'Once that works, stream the run instead of waiting. Leaving the loop — a break, or the iterator going out of scope — closes the request; there is no separate "stop" call.' },
      { kind: 'samples', record: STREAMING, caption: 'Stream events' },
      { kind: 'prose', text: 'The TS signature is `runs.streamRunEvents(runId, params?, options?)` and returns an EventStream. See the reference page for every event name the stream emits.' },
      {
        kind: 'code',
        language: 'ts',
        code: `import { UarpClient } from 'uarp-sdk';

const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
const run = await client.runs.create({
  agent_id: agentId,
  input: { message: 'Summarise the last deploy.' },
});

for await (const event of client.runs.streamRunEvents(run.run_id)) {
  if (event.event === 'llm.chunk') {
    const { payload } = event.json<{ payload: { delta: string } }>();
    process.stdout.write(payload.delta);
  }
  if (event.event === 'run.completed') break;
}`,
      },
    ],
  },
  {
    slug: 'hitl-run-control',
    title: 'Human-in-the-loop run control',
    summary: 'Approve, respond to, and otherwise steer a run that pauses for input.',
    blocks: [
      { kind: 'prose', text: 'A run configured for human-in-the-loop pauses with a `run.paused` event and a status that expects a decision. Approve it to continue, or respond to supply an answer it asked for.' },
      {
        kind: 'code',
        language: 'ts',
        code: `// approveRun(runId) — no body. The run resumes from the checkpoint.
await client.runs.approveRun(run.run_id);

// respondToRun(runId, { response }) — answer a question the run asked.
await client.runs.respondToRun(run.run_id, {
  response: 'Yes, ship it.',
});`,
      },
      { kind: 'prose', text: 'Both take the run id as a path parameter and return once the run has acknowledged the decision. See `runs.approveRun` and `runs.respondToRun` in the reference for the exact response shapes.' },
    ],
  },
  {
    slug: 'knowledge-bases',
    title: 'Knowledge bases',
    summary: 'Create a knowledge base, ingest documents, and list what is in it.',
    blocks: [
      { kind: 'prose', text: 'A knowledge base is created with a name; the description and embedding model are optional. `createKnowledgeBase` returns the new knowledge base, whose `id` is the path parameter for everything you do next.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const kb = await client.knowledge.createKnowledgeBase({
  name: 'Support docs',
  description: 'Guides and runbooks',
});

// Ingest inline text — content is the document body, filename is a label.
await client.knowledge.ingestKbDocument(kb.id, {
  content: 'Paste the document text here.',
  filename: 'runbook.md',
});`,
      },
      { kind: 'prose', text: 'To ingest a file you have already uploaded, pass its `file_id` instead of inline `content` — see the Files guide. List documents in the base with the page walker on `knowledge.listKbDocuments`.' },
    ],
  },
  {
    slug: 'files',
    title: 'Files',
    summary: 'Upload a binary file and download its contents back.',
    blocks: [
      { kind: 'prose', text: 'Upload takes the file data, its MIME type, and an optional filename. The response is a JSON value carrying the new file id; keep it to ingest the file into a knowledge base or attach it to a message.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const file = await client.files.upload({
  data: new Blob(['hello world'], { type: 'text/plain' }),
  mime_type: 'text/plain',
  filename: 'hello.txt',
});

// downloadFileContent(fileId) returns a Blob.
const blob = await client.files.downloadFileContent(fileId);`,
      },
      { kind: 'prose', text: 'List files with `files.list`; the page walker is `files.listAll`. The request-body field is `data` (a Blob in the browser, bytes in other runtimes), so adapt the construction to your platform.' },
    ],
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    summary: 'Subscribe to events and read delivery history.',
    blocks: [
      { kind: 'prose', text: 'A webhook subscription takes a URL and the event names to forward. The response carries the `webhook_id` you use to inspect deliveries.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const hook = await client.webhooks.create({
  url: 'https://example.com/hooks/snaga',
  events: ['run.completed', 'run.failed'],
});

// Delivery history is scoped to the webhook id.
const deliveries = await client.webhooks.listDeliveries(hook.webhook_id);`,
      },
      { kind: 'prose', text: 'Delivery rows have a 7-day TTL, so treat history as a debugging aid, not an audit log. See `webhooks` in the reference for list, get, update and delete.' },
    ],
  },
  {
    slug: 'a2a-tasks',
    title: 'A2A tasks',
    summary: 'Create an agent-to-agent task and follow it to completion.',
    blocks: [
      { kind: 'prose', text: 'An A2A task is created against an agent with a set of messages and optional metadata. The response carries the task record.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const task = await client.a2a.createA2ATask({
  agent_id: agentId,
  messages: [{ role: 'user', content: 'Draft the weekly report.' }],
  metadata: { source: 'portal-guide' },
});`,
      },
      { kind: 'prose', text: 'Stream a task with `a2a.streamA2ATaskEvents` (SSE) or reconcile its status with `a2a.getA2ATask`. See the `a2a` group in the reference for the full task lifecycle.' },
    ],
  },
  {
    slug: 'team-runs',
    title: 'Team runs',
    summary: 'Fan a message out to a team of agents and collect the results.',
    blocks: [
      { kind: 'prose', text: 'A team run is started against a team id. The body takes an optional `message`, an `addressed_to` member, and a chat mode; the platform routes the message through the team.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const teamRun = await client.teams.startTeamRun(teamId, {
  message: 'Review this PR for security.',
  addressed_to: 'security-reviewer',
});`,
      },
      { kind: 'prose', text: 'Stream a team run with `teams.streamTeamRunEvents`. The stream fans in: per-agent events arrive interleaved, and `team_run_done` is the terminal event. See `teams` in the reference for the full set.' },
    ],
  },
  {
    slug: 'public-chat',
    title: 'Public chat',
    summary: 'Let a guest talk to a published agent without an API key of their own.',
    blocks: [
      { kind: 'prose', text: "A public session is created against a published agent. The response carries a `session_id` you use to send messages on the guest's behalf." },
      {
        kind: 'code',
        language: 'ts',
        code: `const session = await client.public.createPublicSession({
  agent_id: publishedAgentId,
});

const reply = await client.public.sendPublicMessage(session.session_id, {
  content: 'What does this agent do?',
});`,
      },
      { kind: 'prose', text: 'Public sessions carry their own SSE token in the query string — see `public.streamPublicMessage` in the reference for the streaming form and the `sseTokenInQuery` detail.' },
    ],
  },
  {
    slug: 'tenants-and-keys',
    title: 'Tenants & API keys',
    summary: 'Mint and revoke API keys scoped to a tenant.',
    blocks: [
      { kind: 'prose', text: 'An API key is created with a name and an optional list of scopes. The response carries the `key_id` and the secret — the secret is shown once, so store it immediately.' },
      {
        kind: 'code',
        language: 'ts',
        code: `const key = await client.tenants.createAPIKey({
  name: 'ci-runner',
  scopes: ['agents:read', 'runs:write'],
});

// Revoke by id when the key is no longer needed.
await client.tenants.revokeAPIKey(key.key_id);`,
      },
      { kind: 'prose', text: 'Keys are bound to the tenant they were created in; there is no header to re-scope one. See the `tenants` group in the reference for listing keys and switching tenants with a user-scoped session.' },
    ],
  },
  {
    slug: 'errors-retries-overrides',
    title: 'Errors, pagination, idempotency & overrides',
    summary: 'Handle failures, walk long lists, and override per-call behaviour.',
    blocks: [
      { kind: 'prose', text: 'API errors carry a kind, a status, and where relevant a problem document with validation errors or a retry-after. Catch by kind, and re-throw anything that is not from the API.' },
      { kind: 'samples', record: ERRORS, caption: 'Handle errors' },
      { kind: 'prose', text: 'List endpoints return a page; the page walker iterates every page for you so the loop reads as "all of them".' },
      { kind: 'samples', record: PAGINATION, caption: 'Walk every page' },
      { kind: 'prose', text: 'Per-call overrides ride on an options argument — an idempotency key for safe retries, a timeout, max retries, custom headers, or an AbortSignal.' },
      { kind: 'samples', record: OVERRIDES, caption: 'Override per call' },
    ],
  },
];

export const GUIDE_SLUGS = GUIDES.map((g) => g.slug);