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
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Paste a UARP API key to try this against your own tenant.
      </p>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Do not have one? Sign in at{' '}
        <a
          href="https://snaga.ai"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-slate-400 underline-offset-2 hover:text-slate-900 dark:hover:text-slate-100"
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
        className="rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <button
        type="submit"
        disabled={!token.trim() || checking}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        {checking ? 'Checking…' : 'Connect'}
      </button>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
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
        className="fixed right-5 bottom-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
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
    <section className="fixed right-5 bottom-5 z-50 flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {connection ? connection.tenant : 'Connect a tenant'}
          </p>
          {connection && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {connection.agents.length} agents · {connection.role}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {connection && (
            <button
              onClick={disconnect}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Disconnect
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded px-2 py-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          >
            ×
          </button>
        </div>
      </header>

      {!connection ? (
        <KeyForm onSubmit={connect} error={error} />
      ) : (
        <>
          <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-800">
            <select
              value={agentId}
              onChange={(change) => setAgentId(change.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Ask anything. The reply streams in token by token over SSE.
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === 'you'
                    ? 'ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-slate-900 px-3 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'mr-auto max-w-[85%] rounded-lg rounded-bl-sm bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                }
              >
                {message.text}
                {message.streaming && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
              </div>
            ))}
            {status && (
              <p className="font-mono text-xs text-slate-400">{status.replace(/[._]/g, ' ')}…</p>
            )}
            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          <form
            className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
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
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
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
