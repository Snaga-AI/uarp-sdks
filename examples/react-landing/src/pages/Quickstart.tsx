import { Link } from 'react-router-dom';
import { Code, Shell } from '../docs/Code';
import { AUTHENTICATE, INSTALL, LANGUAGES } from '../docs/content';
import { QUICKSTART, QUICKSTART_PROJECT, QUICKSTART_RUN } from '../docs/quickstarts';
import { CONCEPTS } from '../content/concepts';
import { useLanguage } from '../hooks/useLanguage';

const STEPS = [['install', 'Install the SDK'], ['authenticate', 'Connect your API key'], ['run', 'Run an agent'], ['result', 'Check the result']] as const;

export function Quickstart() {
  const { language } = useLanguage();
  const current = LANGUAGES.find((entry) => entry.id === language)!;
  const InstallBody = CONCEPTS.install.Body;
  const project = QUICKSTART_PROJECT[language];
  const run = QUICKSTART_RUN[language];
  return (
    <article>
      <header className="pb-8">
        <p className="eyebrow">Start here / {current.name}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Your first agent run.</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-ink-soft">Connect the SDK to your Snaga tenant, run an existing agent and read its output. Start with a regular request; add streaming once the basics work.</p>
        <div className="mt-6 rounded-lg bg-paper-tint p-5"><p className="text-sm font-medium">Before you begin</p><ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-6 text-ink-soft"><li>{INSTALL[language].needs} and a project in {current.name}.</li><li>An API key from your tenant settings at <a className="text-accent-soft underline" href="https://snaga.ai">snaga.ai</a>, with permission to create and read runs.</li><li>The ID of an existing agent in the same tenant.</li></ul></div>
      </header>
      <nav aria-label="On this page" className="mb-8 flex flex-wrap gap-2">{STEPS.map(([id, title], i) => <a key={id} className="rounded-full border border-rule-soft px-3 py-2 text-xs text-ink-soft hover:border-accent hover:text-ink" href={`#${id}`}>{i + 1}. {title}</a>)}</nav>
      <div className="flex min-w-0 flex-col gap-9">
        <section id="install" className="quick-step flex min-w-0 flex-col gap-4"><h2>01 <span className="ml-3">Install the SDK</span></h2><p>Use your language’s package manager. Add the dependency to the project where your server or command-line application runs.</p>
          {language === 'rust' && <Shell>{'cargo new uarp-quickstart\ncd uarp-quickstart'}</Shell>}
          {language === 'swift' && <Shell>{'mkdir -p uarp-quickstart/Sources/Quickstart\ncd uarp-quickstart'}</Shell>}
          {language === 'kotlin' && <p>Use a Gradle project with a Gradle 8.14.5 wrapper and JDK 11 or newer. Create src/main/kotlin if it does not exist. The build file below configures the executable entry point.</p>}
          {language === 'ada' && <Shell>{'alr init --bin quickstart\ncd quickstart'}</Shell>}
          {language === 'python' && <p>Use a Python virtual environment. The install command uses the same python executable as the run command below.</p>}
          <InstallBody />
          {project && <><p>Project configuration — save this as {project.file}. It includes the dependency and executable target, rather than only a dependency fragment.</p><Code language={project.language}>{project.code}</Code></>}
        </section>
        <section id="authenticate" className="quick-step flex min-w-0 flex-col gap-4"><h2>02 <span className="ml-3">Connect your API key</span></h2><p>Set the environment variable in the shell that launches your application. Replace the placeholder with your tenant’s API key. This example uses a POSIX shell; in other environments, set the same variable through your runtime configuration.</p><Shell>{'export UARP_API_KEY="your-api-key"'}</Shell><p>The initialization patterns below explain client configuration. Step 3 is a standalone program with its own client initialization; save it in a separate file. The default base URL points to the production API. Keep the key on your server; a browser application should call your own backend.</p><Code selectable language={language}>{AUTHENTICATE[language]}</Code><Link className="text-sm text-accent-soft" to="/docs/concepts/browser">Building a browser application? Read the backend pattern →</Link></section>
        <section id="run" className="quick-step flex min-w-0 flex-col gap-4"><h2>03 <span className="ml-3">Run an agent</span></h2><p>A run is one execution of an agent. Use an agent ID from your tenant, create a run, then wait for a result and inspect its status before reading the output. A server-side wait timeout can return still_running.</p><p>Save the complete program below as {run.file}. It includes its imports, entry point, request body and status check.</p>
          <Code selectable language={language}>{QUICKSTART[language]}</Code>
          <p>Set your existing agent’s ID, then run the file from the same shell where you set your API key. Commands here use a POSIX shell; configure the same environment variables in PowerShell or your IDE when using those environments.</p>
          <Shell>{`export UARP_AGENT_ID="your-agent-id"\n${run.command}`}</Shell>
          </section>
        <section id="result" className="quick-step flex flex-col gap-4"><h2>04 <span className="ml-3">Check the result</span></h2><p>The wait helper returns when the run reaches a terminal status or the server-side wait times out. A timeout may return still_running; call the wait helper again using the same run ID, or follow the event stream. Inspect its status before treating the output as a successful answer: a run can also fail. The output depends on the agent and may be structured data.</p><div className="grid gap-3 sm:grid-cols-2"><Link className="rounded-lg bg-paper-tint p-5 text-sm hover:bg-chip" to="/docs/concepts/errors">Request failed? <span className="mt-2 block text-ink-soft">Check authentication, scopes and API errors →</span></Link><Link className="rounded-lg bg-paper-tint p-5 text-sm hover:bg-chip" to="/docs/reference/runs">Inspect the run <span className="mt-2 block text-ink-soft">Explore run methods and response types →</span></Link></div></section>
      </div>
      <div className="mt-10 rounded-lg border border-accent/25 bg-accent/5 p-6"><p className="eyebrow">Next step</p><h2 className="mt-2 text-xl font-semibold">Show the response as it arrives.</h2><p className="mt-2 text-sm leading-6 text-ink-soft">Use the event stream to display progress and generated text without waiting for the whole run.</p><Link className="mt-5 inline-block text-sm text-accent-soft" to="/docs/guides/run-and-stream">Continue to streaming →</Link></div>
    </article>
  );
}
