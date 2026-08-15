/**
 * The widget a visitor sees, and the panel a developer uses to hand it a key.
 *
 * The key goes to this project's own proxy and is never held here — the only
 * thing the browser keeps is a session id, which the dev server forgets when it
 * restarts.
 */
import { useEffect, useRef, useState } from 'react';
import { useAgent } from './useAgent';

function KeyForm({ onSubmit, error }: { onSubmit: (token: string) => Promise<boolean>; error: string | null }) {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);

  return (
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={async (submit) => {
        submit.preventDefault();
        setChecking(true);
        await onSubmit(token);
        setChecking(false);
      }}
    >
      <p className="text-sm text-ink-soft">
        Paste a UARP API key to try this against your own tenant.
      </p>
      <p className="text-xs leading-relaxed text-ink-soft">
        Do not have one? Sign in at{' '}
        <a
          href="https://snaga.ai"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-rule underline-offset-2 hover:text-ink"
        >
          snaga.ai
        </a>{' '}
        and create one in your tenant settings. It looks like{' '}
        <code className="font-mono">uarp_…</code> and is shown once.
      </p>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(change) => setToken(change.target.value)}
        placeholder="uarp_…"
        className="rounded-md border border-rule-soft bg-paper px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-soft focus:border-accent"
      />
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={!token.trim() || checking}
        className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-40"
      >
        {checking ? 'Checking…' : 'Connect'}
      </button>
      <p className="text-xs leading-relaxed text-ink-soft">
        The key is sent to this example's own server, which keeps it in memory and calls the API on
        your behalf. It never reaches the browser bundle. Do not put a key in front-end code —
        anyone who opens the page can read it.
      </p>
    </form>
  );
}

export function AgentWidget() {
  const { connection, messages, busy, status, error, connect, disconnect, send, stop } = useAgent();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [draft, setDraft] = useState('');
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (connection && !agentId && connection.agents[0]) setAgentId(connection.agents[0].id);
  }, [connection, agentId]);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-50 flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper shadow-lg transition hover:opacity-90"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Ask the agent
      </button>
    );
  }

  return (
    <section className="fixed right-5 bottom-5 z-50 flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-rule-soft bg-paper shadow-2xl">
      <header className="flex items-center gap-3 border-b border-rule-soft px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {connection ? connection.tenant : 'Connect a tenant'}
          </p>
          {connection && (
            <p className="truncate text-xs text-ink-soft">
              {connection.agents.length} agents · {connection.role}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {connection && (
            <button
              onClick={disconnect}
              className="rounded px-2 py-1 text-xs text-ink-soft hover:text-ink"
            >
              Disconnect
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded px-2 py-1 text-ink-soft hover:text-ink"
          >
            ×
          </button>
        </div>
      </header>

      {!connection ? (
        <KeyForm onSubmit={connect} error={error} />
      ) : (
        <>
          <div className="border-b border-rule-soft px-4 py-2">
            <select
              value={agentId}
              onChange={(change) => setAgentId(change.target.value)}
              className="w-full rounded-md border border-rule-soft bg-paper px-2 py-1.5 text-sm text-ink"
            >
              {connection.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div ref={transcript} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="text-sm text-ink-soft">
                Ask anything. The reply streams in token by token over SSE.
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === 'you'
                    ? 'ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3 py-2 text-sm text-paper '
                    : 'mr-auto max-w-[85%] rounded-lg rounded-bl-sm bg-chip px-3 py-2 text-sm whitespace-pre-wrap text-ink '
                }
              >
                {message.text}
                {message.streaming && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
              </div>
            ))}
            {status && (
              <p className="font-mono text-xs text-ink-soft">{status.replace(/[._]/g, ' ')}…</p>
            )}
            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          <form
            className="flex gap-2 border-t border-rule-soft p-3"
            onSubmit={(submit) => {
              submit.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft('');
              void send(agentId, text);
            }}
          >
            <input
              value={draft}
              onChange={(change) => setDraft(change.target.value)}
              placeholder="Ask something…"
              className="min-w-0 flex-1 rounded-md border border-rule-soft bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-md border border-rule-soft px-3 py-2 text-sm"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-40"
              >
                Send
              </button>
            )}
          </form>
        </>
      )}
    </section>
  );
}
