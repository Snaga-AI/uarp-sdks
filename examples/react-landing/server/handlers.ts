/**
 * The half of the example that holds the API key.
 *
 * Nothing here knows about Vite. These are plain Node request handlers so the
 * same file can be mounted on a dev server, an Express app or a serverless
 * function — which is the point: in production this is the piece you deploy,
 * and the browser half does not change.
 *
 * Why a proxy at all, when the SDK runs in a browser perfectly well:
 *
 *   1. A key that reaches the browser is readable by every visitor. On a
 *      landing page that is everyone on the internet, and the key can spend the
 *      tenant's tokens.
 *   2. The API only sends `Access-Control-Allow-Origin` for its own site, so a
 *      browser on any other origin has its response blocked before your code
 *      sees it.
 *
 * The first reason is the one that matters. The second only makes it obvious.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { APIError, UarpClient } from 'uarp-sdk';

type Request = IncomingMessage;
type Response = ServerResponse;

interface Session {
  client: UarpClient;
  tenant: string;
  lastUsed: number;
}

/**
 * Tokens live here and nowhere else — not on disk, not in the bundle, not in
 * the browser. Restarting the dev server forgets them, which is the intended
 * lifetime for a playground.
 */
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Rate limit on exchanging a key for a session.
 *
 * This endpoint answers "is this key valid?", which makes it a guessing oracle
 * the moment the portal is on the public internet. Ten attempts a minute is
 * generous for a person typing their own key and useless for a machine trying
 * many.
 */
const attempts = new Map<string, number[]>();
const ATTEMPT_WINDOW_MS = 60 * 1000;
const ATTEMPT_LIMIT = 10;

function tooManyAttempts(req: Request): boolean {
  //  Behind a reverse proxy the socket address is the proxy, so prefer the
  //  forwarded chain when there is one.
  const forwarded = req.headers['x-forwarded-for'];
  const who =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ??
    req.socket.remoteAddress ??
    'unknown';

  const now = Date.now();
  const recent = (attempts.get(who) ?? []).filter((at) => at > now - ATTEMPT_WINDOW_MS);
  recent.push(now);
  attempts.set(who, recent);

  //  The map would otherwise grow with every address ever seen.
  if (attempts.size > 5000) {
    for (const [key, times] of attempts) {
      if (times.every((at) => at <= now - ATTEMPT_WINDOW_MS)) attempts.delete(key);
    }
  }
  return recent.length > ATTEMPT_LIMIT;
}

function sweep(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) sessions.delete(id);
  }
}

function json(res: Response, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function session(req: Request): Session | undefined {
  const id = req.headers['x-uarp-session'];
  if (typeof id !== 'string') return undefined;
  const found = sessions.get(id);
  if (found) found.lastUsed = Date.now();
  return found;
}

/** Turn any failure into something the browser can render without guessing. */
function describe(error: unknown): { status: number; message: string } {
  if (error instanceof APIError) {
    return {
      status: error.status,
      message: error.problem.detail ?? error.problem.title ?? `HTTP ${error.status}`,
    };
  }
  return { status: 502, message: error instanceof Error ? error.message : String(error) };
}

/**
 * Exchange a key for a session id.
 *
 * The key is checked by actually calling the API — a typo should fail here,
 * with a readable message, rather than on the first message the visitor sends.
 */
async function openSession(req: Request, res: Response): Promise<void> {
  if (tooManyAttempts(req)) {
    return json(res, 429, { message: 'Too many attempts. Wait a minute and try again.' });
  }
  const body = await readJson(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return json(res, 400, { message: 'No token supplied.' });

  const client = new UarpClient({ apiKey: token, maxRetries: 1 });
  try {
    const [me, agents] = await Promise.all([
      client.auth.getMe(),
      client.agents.list({ limit: 50 }),
    ]);
    sweep();
    const id = randomUUID();
    sessions.set(id, { client, tenant: me.tenant.name, lastUsed: Date.now() });
    json(res, 200, {
      sessionId: id,
      tenant: me.tenant.name,
      role: me.role,
      agents: agents.items.map((agent) => ({ id: agent.agent_id, name: agent.name })),
    });
  } catch (error) {
    const { status, message } = describe(error);
    json(res, status === 401 ? 401 : 400, { message });
  }
}

function closeSession(req: Request, res: Response): void {
  const id = req.headers['x-uarp-session'];
  if (typeof id === 'string') sessions.delete(id);
  json(res, 200, { ok: true });
}

/**
 * Run an agent and forward its output to the browser as it arrives.
 *
 * The SDK's event stream is consumed here and re-emitted as a much smaller one:
 * the browser gets the text and the state changes, not the platform's full
 * event envelope. That keeps the widget simple and means the wire format of the
 * platform is not baked into your front end.
 */
async function chat(req: Request, res: Response): Promise<void> {
  const current = session(req);
  if (!current) return json(res, 401, { message: 'Session expired. Enter your key again.' });

  const body = await readJson(req);
  const agentId = typeof body.agentId === 'string' ? body.agentId : '';
  const message = typeof body.message === 'string' ? body.message : '';
  if (!agentId || !message) return json(res, 400, { message: 'agentId and message are required.' });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  //  A client abandoning the page must not leave a run being read forever.
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  try {
    const run = await current.client.runs.create({ agent_id: agentId, input: { message } });
    send('run', { runId: run.run_id });

    const stream = current.client.runs.streamRunEvents(run.run_id, undefined, { signal: abort.signal });
    for await (const event of stream) {
      if (abort.signal.aborted) break;
      switch (event.event) {
        case 'llm.chunk': {
          //  The text arrives as `payload.delta`; everything else in the
          //  envelope is platform bookkeeping the widget does not need.
          const delta = event.json<{ payload?: { delta?: string } }>().payload?.delta;
          if (delta) send('delta', { text: delta });
          break;
        }
        case 'run.completed':
          send('done', { status: 'completed' });
          break;
        case 'run.failed':
          send('done', { status: 'failed' });
          break;
        default:
          //  Coarse progress, so the widget can say something during the pause
          //  between sending and the first token.
          send('step', { event: event.event });
      }
      if (event.event === 'run.completed' || event.event === 'run.failed') break;
    }
  } catch (error) {
    if (!abort.signal.aborted) send('error', { message: describe(error).message });
  } finally {
    res.end();
  }
}

/**
 * Mount at `/api/uarp`. Returns true when it handled the request, so a caller
 * can fall through to whatever else it serves.
 */
export async function handleUarp(req: Request, res: Response): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/uarp/')) return false;

  const route = `${req.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'POST /api/uarp/session':
        await openSession(req, res);
        return true;
      case 'DELETE /api/uarp/session':
        closeSession(req, res);
        return true;
      case 'POST /api/uarp/chat':
        await chat(req, res);
        return true;
      default:
        json(res, 404, { message: `No route for ${route}` });
        return true;
    }
  } catch (error) {
    if (!res.headersSent) json(res, 500, { message: describe(error).message });
    else res.end();
    return true;
  }
}
