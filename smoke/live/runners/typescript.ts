/**
 * Live runner for the TypeScript SDK.
 *
 * Performs smoke/live/SCENARIO.md against the real server and prints one JSON
 * object. It asserts almost nothing itself: compare.py decides whether the five
 * languages agree.
 *
 *   UARP_API_KEY=… node smoke/live/runners/typescript.ts
 */
import { APIError, UarpClient } from '../../../packages/typescript/dist/index.js';

const apiKey = process.env.UARP_API_KEY;
if (!apiKey) throw new Error('UARP_API_KEY is not set');

const client = new UarpClient({
  apiKey,
  baseURL: process.env.UARP_BASE_URL ?? 'https://api.snaga.ai',
  maxRetries: 2,
});

const LANGUAGE = 'typescript';
const AGENT_NAME = `smoke-live-${LANGUAGE}`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Reported in place of a value the SDK could not read. The wording is shared by
// all five runners so that "both failed" compares equal; the reason goes to
// stderr, where it does not affect the comparison.
const DECODE_FAILED = 'decode failed';

/** TypeScript decodes leniently, so this only fires on malformed JSON. */
function isDecodeFailure(error: unknown): boolean {
  return !(error instanceof APIError) && error instanceof Error;
}

const report: Record<string, unknown> = { language: LANGUAGE };

// 1. public health, no authorisation needed
report.health = (await client.health.get()).status;

// 2. the key resolves to an identity
const me = await client.auth.getMe();
report.role = me.role;
report.auth_method = (me as Record<string, unknown>).auth_method;

// 3. a list with query parameters.
//
//    A decode failure is reported rather than thrown: the whole point of
//    running five SDKs against one server is to see which of them cannot read
//    what it sends, and a crash here would hide that behind a stack trace
//    instead of putting it in the comparison.
try {
  const page = await client.agents.list({ limit: 2 });
  report.page_size = Math.min(page.items.length, 2);
} catch (error) {
  if (!isDecodeFailure(error)) throw error;
  console.error('page_size:', error);
  report.page_size = DECODE_FAILED;
}

// 4. a 404 that must arrive as a typed error carrying a problem document
try {
  await client.agents.get(MISSING_ID);
  report.not_found_status = 'no error';
} catch (error) {
  if (!(error instanceof APIError)) throw error;
  report.not_found_status = error.status;
  report.problem_has_title = typeof error.problem.title === 'string' && error.problem.title.length > 0;
}

// 5. a write, with the idempotency key the SDK attaches on its own
let createdId: string | undefined;
try {
  const created = await client.agents.create({
    name: AGENT_NAME,
    model: { provider: 'openai_compat', model_ref: 'gpt-4o-mini', capabilities: {} },
  });
  createdId = (created as Record<string, unknown>).agent_id as string | undefined;
  report.created = typeof createdId === 'string' && createdId.length > 0;
} catch (error) {
  report.created = false;
  report.create_error = error instanceof APIError ? error.status : String(error);
}

// 6. read it back
if (createdId) {
  try {
    const fetched = await client.agents.get(createdId);
    report.name_round_trips = fetched.name === AGENT_NAME;
  } catch (error) {
    if (!isDecodeFailure(error)) throw error;
    console.error('name_round_trips:', error);
    report.name_round_trips = DECODE_FAILED;
  }
}

// 7. and remove it again
if (createdId) {
  try {
    await client.agents.delete(createdId);
    report.deleted = true;
  } catch (error) {
    report.deleted = false;
    report.delete_error = error instanceof APIError ? error.status : String(error);
  }
}

// 8. cursor pagination, stopped by the caller after six items
let seen = 0;
try {
  for await (const _agent of client.agents.listAll({ limit: 2 })) {
    void _agent;
    seen++;
    if (seen >= 6) break;
  }
  report.paged_items = seen;
} catch (error) {
  if (!isDecodeFailure(error)) throw error;
  console.error('paged_items:', error);
  report.paged_items = DECODE_FAILED;
}

console.log(JSON.stringify(report));
