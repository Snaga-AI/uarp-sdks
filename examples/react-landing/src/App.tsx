/**
 * An ordinary marketing page. It exists so the widget has somewhere to live:
 * the interesting code is in AgentWidget.tsx and server/handlers.ts.
 */
import { AgentWidget } from './AgentWidget';

const features = [
  {
    title: 'Answers from your own data',
    body: 'The agent reads the same knowledge bases your team does, so it stops inventing part numbers.',
  },
  {
    title: 'Streams as it thinks',
    body: 'Replies arrive token by token over server-sent events, and reconnect where they left off if the connection drops.',
  },
  {
    title: 'Runs are auditable',
    body: 'Every run keeps its steps, inputs and outputs, so a wrong answer can be traced rather than argued about.',
  },
];

export function App() {
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-semibold tracking-tight">Northwind Robotics</span>
        <nav className="hidden gap-6 text-sm text-slate-600 sm:flex dark:text-slate-400">
          <a href="#features" className="hover:text-slate-900 dark:hover:text-slate-100">Features</a>
          <a href="#how" className="hover:text-slate-900 dark:hover:text-slate-100">How it works</a>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="border-b border-slate-200 py-20 dark:border-slate-800">
          <p className="font-mono text-xs tracking-[0.2em] text-slate-500 uppercase dark:text-slate-400">
            Support that knows the machine
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            Your customers ask the robot. The robot actually knows.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            An agent trained on your manuals, part numbers and service history — answering in the
            corner of this page. Try it: the button is bottom right.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#how" className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
              See how it is wired
            </a>
            <a href="https://github.com/Snaga-AI/uarp-sdks" className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium dark:border-slate-700">
              Read the SDK
            </a>
          </div>
        </section>

        <section id="features" className="grid gap-8 border-b border-slate-200 py-16 sm:grid-cols-3 dark:border-slate-800">
          {features.map((feature) => (
            <article key={feature.title}>
              <h2 className="text-base font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{feature.body}</p>
            </article>
          ))}
        </section>

        <section id="how" className="py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How this page is wired</h2>
          <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
            The widget never sees an API key. It posts to <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm dark:bg-slate-800">/api/uarp/chat</code> on
            this same origin; the server holds the key, calls the platform with the SDK, and forwards
            the reply as it arrives.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed dark:border-slate-800 dark:bg-slate-900">
{`browser  ──POST /api/uarp/chat──▶  your server  ──uarp-sdk──▶  api.snaga.ai
   ▲                                    │
   └──────── text/event-stream ─────────┘        the key lives here, only here`}
          </pre>
          <p className="mt-6 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            That shape is not ceremony. A key in front-end code is readable by every visitor, and the
            platform only allows cross-origin browser calls from its own site — so the proxy is both
            the safe way and the working way.
          </p>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500 dark:text-slate-400">
        A worked example for the UARP SDKs. Northwind Robotics is not a real company.
      </footer>

      <AgentWidget />
    </div>
  );
}
