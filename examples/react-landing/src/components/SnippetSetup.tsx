import { Link } from 'react-router-dom';
import { useLanguage } from '../hooks/useLanguage';
import { Shell } from '../docs/Code';

/** The compile harness supplies only these documented enclosing-context values. */
export function SnippetSetup({ typescript = false }: { typescript?: boolean }) {
  const { language: selected } = useLanguage();
  const language = typescript ? 'ts' : selected;
  return <details className="operation-details text-sm leading-7 text-ink-soft">
    <summary>How to run these examples</summary>
    <p className="mt-3">The <Link className="text-accent-soft underline" to="/docs/guides/getting-started">Quickstart</Link> contains a complete executable program for each SDK. Other examples are fragments unless they include their own entry point. Reuse the initialized client, keep imports at file level, and replace resource IDs with IDs from the same tenant.</p>
    {language === 'ts' && <p className="mt-3">Run server fragments inside an async function or an ESM module. Names such as agentId, runId, teamId and requestId are application values. Human-in-the-loop examples use the run object returned when creating a run. Backend streaming examples belong inside a request handler, where res is the Node response and message is validated request input.</p>}
    {language === 'python' && <p className="mt-3">Fragments use the synchronous Client. Define agent_id and run_id from your own resources. With AsyncClient, use an async function, await API calls and use async with for event streams. Close the client using a with block or close().</p>}
    {language === 'rust' && <><p className="mt-3">Place fragments inside a Tokio async function returning Result. agent_id and run_id are Strings; id is a string slice. Streaming and pagination additionally use futures-util; JSON event decoding uses serde_json.</p><Shell>{'cargo add futures-util serde_json'}</Shell></>}
    {language === 'swift' && <p className="mt-3">Place fragments inside an async throws function in your executable target. Keep Foundation and UARPSDK imports at file level. base is a Foundation URL; id, agentId and runId are Strings. request is a CreateAgentRequest for per-call override examples.</p>}
    {language === 'kotlin' && <p className="mt-3">Place fragments inside runBlocking or another coroutine. Resource properties require imports such as ai.snaga.uarp.api.agents and ai.snaga.uarp.api.runs. Keep flow and JSON extension imports at file level. Define id, agentId and runId as Strings; request is a CreateAgentRequest. Custom @Serializable classes additionally need the Kotlin serialization compiler plugin.</p>}
    {language === 'ada' && <p className="mt-3">Ada examples are complete procedures. Save an Example procedure as src/example.adb and select it as the main unit in the GPR project; save Quickstart as src/quickstart.adb. All use UARP_API_KEY. Agent overrides need UARP_AGENT_ID; streaming needs UARP_RUN_ID. Keep the source dependency pin described in Install.</p>}
    <p className="mt-3">A successful wait request does not imply a successful run. Check the returned status: still_running means the wait timed out; completed means the result is ready. A failed run may return an error instead of output.</p>
  </details>;
}
