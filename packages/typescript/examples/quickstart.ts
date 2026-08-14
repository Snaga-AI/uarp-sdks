/**
 * Create an agent, start a run, follow it live, then page through history.
 *
 *   UARP_API_KEY=uarp_... node --experimental-strip-types examples/quickstart.ts
 */
import {
  APIError,
  RateLimitError,
  UarpClient,
  UnprocessableEntityError,
  type Agent,
} from '../src/index.js';

const client = new UarpClient({
  apiKey: process.env.UARP_API_KEY,
  // Everything below is optional; these are the defaults.
  timeout: 60_000,
  maxRetries: 2,
});

async function createAgent(): Promise<Agent> {
  return client.agents.create({
    name: 'quickstart',
    model: {
      provider: 'openai_compat',
      model_ref: 'gpt-4o-mini',
      capabilities: {},
    },
    prompts: { system: 'You are a concise assistant.' },
  });
}

async function runAndFollow(agentId: string): Promise<void> {
  const run = await client.runs.create({
    agent_id: agentId,
    input: { message: 'Summarise the last deploy.' },
  });
  const runId = run.run_id;

  // The stream reconnects with Last-Event-ID if the connection drops.
  for await (const event of client.runs.streamRunEvents(runId)) {
    if (event.event === 'llm.chunk') {
      process.stdout.write(event.json<{ text?: string }>().text ?? '');
    }
    if (event.event === 'run.completed' || event.event === 'run.failed') break;
  }
}

async function listEverything(): Promise<void> {
  // `listAll` walks every page; `list` returns one page plus its cursor.
  for await (const agent of client.agents.listAll({ limit: 50 })) {
    console.log(`${agent.agent_id}  ${agent.name}`);
  }
}

async function main(): Promise<void> {
  try {
    const agent = await createAgent();
    await runAndFollow(agent.agent_id);
    await listEverything();
  } catch (error) {
    if (error instanceof UnprocessableEntityError) {
      for (const failure of error.validationErrors) {
        console.error(`invalid ${failure.field}: ${failure.message}`);
      }
    } else if (error instanceof RateLimitError) {
      console.error(`rate limited; retry after ${error.retryAfterSeconds ?? '?'}s`);
    } else if (error instanceof APIError) {
      console.error(`${error.status} ${error.message} (${error.correlationId ?? 'no id'})`);
    } else {
      throw error;
    }
  }
}

await main();
