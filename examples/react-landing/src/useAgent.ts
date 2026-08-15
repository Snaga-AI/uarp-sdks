/**
 * Everything the widget needs, and nothing about the platform.
 *
 * This half never sees an API key and never talks to api.snaga.ai. It calls
 * `/api/uarp/*` on its own origin, which is why there is no CORS problem and
 * no key in the bundle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Agent {
  id: string;
  name: string;
}

export interface Connection {
  sessionId: string;
  tenant: string;
  role: string;
  agents: Agent[];
}

export interface Message {
  role: 'you' | 'agent';
  text: string;
  /** Set while the agent is still writing, so the bubble can show a cursor. */
  streaming?: boolean;
}

const STORAGE_KEY = 'uarp-demo-session';

/**
 * Read an event stream out of a `fetch` response.
 *
 * `EventSource` cannot send a POST body, so the request is an ordinary fetch
 * and the frames are parsed here. A frame ends at a blank line — which is
 * exactly what most naive line-splitting drops, so the buffer is split on the
 * separator rather than on newlines.
 */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');

      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) yield { event, data: data.join('\n') };
    }
  }
}

export function useAgent() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  //  The session id survives a reload; the key it stands for never left the
  //  server, so there is nothing sensitive in storage.
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setConnection(JSON.parse(stored) as Connection);
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connect = useCallback(async (token: string): Promise<boolean> => {
    setError(null);
    const response = await fetch('/api/uarp/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = (await response.json()) as Connection & { message?: string };
    if (!response.ok) {
      setError(body.message ?? 'That key was refused.');
      return false;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(body));
    setConnection(body);
    return true;
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    const id = connection?.sessionId;
    setConnection(null);
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
    if (id) {
      await fetch('/api/uarp/session', { method: 'DELETE', headers: { 'x-uarp-session': id } });
    }
  }, [connection]);

  const send = useCallback(
    async (agentId: string, text: string): Promise<void> => {
      if (!connection || busy) return;
      setError(null);
      setBusy(true);
      setStatus('sending');
      setMessages((prior) => [...prior, { role: 'you', text }, { role: 'agent', text: '', streaming: true }]);

      const controller = new AbortController();
      abort.current = controller;

      try {
        const response = await fetch('/api/uarp/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-uarp-session': connection.sessionId },
          body: JSON.stringify({ agentId, message: text }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `The proxy answered ${response.status}.`);
        }

        for await (const frame of readEvents(response.body)) {
          const payload = JSON.parse(frame.data) as Record<string, string>;
          if (frame.event === 'delta') {
            setMessages((prior) => {
              const next = [...prior];
              const last = next[next.length - 1];
              if (last?.streaming) next[next.length - 1] = { ...last, text: last.text + payload.text };
              return next;
            });
            setStatus(null);
          } else if (frame.event === 'step') {
            setStatus(payload.event ?? null);
          } else if (frame.event === 'error') {
            throw new Error(payload.message);
          }
        }
      } catch (failure) {
        if ((failure as Error).name !== 'AbortError') {
          setError((failure as Error).message);
        }
      } finally {
        setMessages((prior) => {
          const next = [...prior];
          const last = next[next.length - 1];
          if (last?.streaming) {
            next[next.length - 1] = last.text
              ? { ...last, streaming: false }
              : { role: 'agent', text: 'No answer came back.' };
          }
          return next;
        });
        setStatus(null);
        setBusy(false);
        abort.current = null;
      }
    },
    [connection, busy],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  return { connection, messages, busy, status, error, connect, disconnect, send, stop };
}
