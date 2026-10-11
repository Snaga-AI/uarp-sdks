/**
 * Contract runner for the TypeScript SDK.
 *
 * Performs the sequence in ../SCENARIOS.md against the contract server. It
 * asserts nothing: the server records the traffic and run.sh compares it.
 *
 *   UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 node contract/runners/typescript.ts
 */
import { APIError, UarpClient } from '../../packages/typescript/dist/index.js';

const baseURL = process.env.UARP_CONTRACT_BASE_URL;
if (!baseURL) throw new Error('UARP_CONTRACT_BASE_URL is not set');

const client = new UarpClient({ apiKey: 'uarp_contract_secret', baseURL, maxRetries: 2 });

// A quote, a backslash, a newline, a tab, a non-ASCII letter and a character
// outside the basic plane — everything a JSON encoder has to escape or carry.
const AWKWARD = '"q" \\ \n \t ы 😀';

/** Send what this SDK decoded, for the harness to compare across languages. */
async function report(language: string, probes: Record<string, string>): Promise<void> {
  await fetch(`${baseURL}/__report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language, probes }),
  });
}

// 1. query serialisation
await client.agents.list({ limit: 2 });

// 2. path encoding
await client.agents.get('id with/slash');

// 3. JSON body and the automatic idempotency key
await client.agents.create({
  name: 'demo',
});

// 4. cursor paging, consumed to the end
for await (const _agent of client.agents.listAll()) void _agent;

// 5. a 429 that is retried
await client.agents.get('retry-me');

// 6. a 404 that is not
let refused = false;
try {
  await client.agents.get('missing');
} catch (error) {
  if (!(error instanceof APIError)) throw error;
  refused = true;
}
// The runners assert nothing about traffic, but a scenario that silently does
// not happen would make the traces agree for the wrong reason.
if (!refused) throw new Error('expected a 404');

// 7. an event stream, stopped by the caller
for await (const event of client.runs.streamRunEvents('r1')) {
  if (event.event === 'run.completed') break;
}

// 8. binary download
await client.files.downloadFileContent('f1');

// 9. no content
await client.files.delete('f1');

// 10. multipart upload
await client.registry.registryPublish({
  manifest: '{"name":"demo"}',
  artifact: new Uint8Array([0, 255, 65]),
  sha256: 'abc123',
});

// 11. query encoding, spaces and reserved characters included
await client.agents.list({ workspace_id: "ы w&x=y+z*!()~" });

// 12. a multibyte path segment
await client.agents.get('агент/ы');

// 13. a header parameter
for await (const event of client.runs.streamRunEvents('r1', { 'Last-Event-ID': '42' })) {
  if (event.event === 'run.completed') break;
}

// 14. zero and false must survive, not be dropped as falsy
await client.agents.list({ limit: 0, include_offline: false });

// 15. JSON string escaping and a zero in a body
await client.runs.create({
  agent_id: AWKWARD,
  session_id: '',
  version: 0,
});

// 16. how the decoder handles a payload built to strain it
const probe = await client.runs.get('probe');

// 17. a POST read as an event stream, consumed to `data: [DONE]`
const COMPLETION = {
  model: 'contract/model',
  stream: true,
  messages: [{ role: 'user', content: 'hi' }],
};
let postStreamText = '';
for await (const event of client.streamPost('/api/v1/llm/chat/completions', COMPLETION)) {
  const chunk = event.json<{ choices: Array<{ delta?: { content?: string } }> }>();
  postStreamText += chunk.choices[0]?.delta?.content ?? '';
}

// 18. a refusal before the stream: the API error, and no retry even on 429
let postStreamRefusal = 'no error';
try {
  for await (const _event of client.streamPost('/api/v1/llm/chat/completions/refused', COMPLETION)) void _event;
} catch (error) {
  if (!(error instanceof APIError)) throw error;
  postStreamRefusal = `${error.status} ${error.problem.detail}`;
}

// 19. a 2xx that is not an event stream: an error, not an empty stream
let plainEvents = 0;
let postStreamPlain: string | undefined;
try {
  for await (const _event of client.streamPost('/api/v1/llm/chat/completions/plain', COMPLETION)) plainEvents++;
} catch (error) {
  if (!(error instanceof APIError)) throw error;
  postStreamPlain = `error ${error.status}`;
}
postStreamPlain ??= `events ${plainEvents}`;

// 20. a form body, compared byte for byte; fields in schema order
const signedIn = await client.auth.completeOAuthLoginFormPost('apple', {
  code: 'c 1+2',
  state: 's/ы&=~*',
  user: '{"name":"А Б","email":"a@b.c"}',
});

// 21. array query parameters: the key once per item, in declaration order
const jobs = await client.public.listPublicJobs({ seniority: ['junior', 'senior'], country: ['UA'] });

// 22. an array in a multipart body: one JSON array text part
const applied = await client.public.applyToJob('dev', {
  name: 'А Б',
  email: 'a@b.c',
  consent: 'true',
  links: ['https://a.example/x?y=1', 'https://b.example/'],
});

// One report: the server keeps the last one per language, so probes from
// 16 to 22 travel together.
await report('typescript', {
  status: probe.status,
  error_is_absent: String(probe.error === undefined || probe.error === null),
  step_seq: String(probe.step_seq),
  artifacts_count: String(probe.artifacts?.length ?? 'absent'),
  metadata_keys: Object.keys(probe.metadata ?? {}).sort().join(','),
  metrics_output_tokens: String(probe.metrics?.output_tokens ?? 'absent'),
  metrics_input_tokens: String(probe.metrics?.input_tokens ?? 'absent'),
  started_at_is_absent: String(probe.started_at === undefined || probe.started_at === null),
  post_stream_text: postStreamText,
  post_stream_refusal: postStreamRefusal,
  post_stream_plain: postStreamPlain,
  form_post_email: signedIn.email,
  jobs_total: String(jobs.total),
  application_id: applied.application.id,
});

console.log('typescript runner done');
