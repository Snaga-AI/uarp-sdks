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

// 1. query serialisation
await client.agents.list({ limit: 2 });

// 2. path encoding
await client.agents.get('id with/slash');

// 3. JSON body and the automatic idempotency key
await client.agents.create({
  name: 'demo',
  model: { provider: 'openai_compat', model_ref: 'gpt-x', capabilities: {} },
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

console.log('typescript runner done');
