/**
 * Displayed SDK samples. Run scripts/check-samples.mjs to compile these strings,
 * the standalone Quickstarts, authored TypeScript snippets and generated usage.
 * Fragments reuse the context documented by SnippetSetup; Ada examples are complete units.
 */

import { VERSION } from 'uarp-sdk';

export const LANGUAGES = [
  { id: 'ts', name: 'TypeScript', registry: 'npm' },
  { id: 'python', name: 'Python', registry: 'PyPI' },
  { id: 'rust', name: 'Rust', registry: 'crates.io' },
  { id: 'swift', name: 'Swift', registry: 'SwiftPM' },
  { id: 'kotlin', name: 'Kotlin', registry: 'Maven Central' },
  { id: 'ada', name: 'Ada', registry: 'Alire' },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]['id'];

export type Samples = Record<LanguageId, string>;

/**
 * The version the install lines quote.
 *
 * Read from the package this page is built against rather than typed here, so
 * a release cannot leave the documentation behind: the registries all
 * carry the same number, and `VERSION` is that number. Measured 2026-09-21 —
 * npm, crates.io and Maven Central all serve 0.6.0.
 */
const PUBLISHED = VERSION;

/**
 * Swift is quoted separately because SwiftPM is not a registry we publish to —
 * it is a git mirror, Snaga-AI/uarp-swift, and it has fallen behind before:
 * stuck at 0.5.13 from 2026-08-21 until 2026-09-23, when `SWIFT_MIRROR_TOKEN`
 * had expired and 0.5.15 through 0.6.0 never arrived. 0.7.0 reached it on
 * 2026-09-23, pushed by hand from the v0.7.0 tag with the release job's own
 * steps, because the replacement token still could not write. Since 0.8.0 the
 * release job pushes it with a deploy key; 0.9.0 arrived that way on
 * 2026-10-11, 0.10.0 on 2026-10-12, 0.11.0 and 0.12.0 on 2026-10-18, 0.13.0 on
 * 2026-10-30. Measured against the mirror's tags, not taken from the release
 * notes.
 *
 * Keep it separate from `PUBLISHED` for that reason: `from: "${PUBLISHED}"`
 * is a line that cannot resolve whenever the mirror lags. Raise it when the
 * mirror has the tag, and not before — a snippet a person cannot run is worse
 * than a snippet that gives them an older SDK.
 */
// Verified against Snaga-AI/uarp-swift tags on 2026-11-14.
const SWIFT_MIRROR = '0.13.6';

/** The install line, and what it needs. */
export const INSTALL: Record<LanguageId, { command: string; shell: boolean; needs: string }> = {
  ts: { command: 'npm install uarp-sdk@0.13.6', shell: true, needs: 'Node 18+' },
  python: { command: 'python -m pip install uarp-sdk==0.13.6', shell: true, needs: 'Python 3.10+' },
  rust: { command: 'cargo add uarp-sdk@=0.13.6 tokio --features tokio/macros,tokio/rt-multi-thread', shell: true, needs: 'Rust 1.88+' },
  swift: {
    command: `.package(url: "https://github.com/Snaga-AI/uarp-swift", exact: "${SWIFT_MIRROR}")`,
    shell: false,
    needs: 'Swift 5.9+, macOS 12 / iOS 15',
  },
  kotlin: {
    command: `implementation("ai.snaga:uarp-sdk:${PUBLISHED}")`,
    shell: false,
    needs: 'Kotlin 2.2+, JVM 11+, Android 21+',
  },
  ada: { command: 'git clone --branch v0.13.6 --depth 1 https://github.com/Snaga-AI/uarp-sdks.git ../uarp-sdk-0.13.6\nalr with uarp_sdk --use ../uarp-sdk-0.13.6/packages/ada', shell: true, needs: 'GNAT 2022, libcurl' },
};

/**
 * The shortest thing that actually does something: ask an agent, get its answer.
 *
 * These are flow previews. QUICKSTART contains complete programs with imports,
 * entry points and status checks. A wait timeout can return still_running.
 */
export const HELLO: Samples = {
  ts: `import { UarpClient } from 'uarp-sdk';

const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
const run = await client.runs.create({ agent_id: agentId, input: { message: 'Summarise the last deploy.' } });
const result = await client.runs.waitRun(run.run_id);
if (result.status !== 'completed') throw new Error('Run is not completed: ' + result.status);
console.log(result.output);`,

  python: `from uarp_sdk import Client
from uarp_sdk.models import CreateRunRequest

client = Client()  # UARP_API_KEY, UARP_BASE_URL
run = client.runs.create(CreateRunRequest(agent_id=agent_id))
result = client.runs.wait_run(run.run_id)
if result.status != "completed":
    raise RuntimeError(f"Run is not completed: {result.status}")
print(result.output)`,

  rust: `use uarp_sdk::models::{CreateRunRequest, RunStatus};

let client = uarp_sdk::Client::from_env()?;
let run = client.runs().create(&CreateRunRequest { agent_id, ..Default::default() }).await?;
let result = client.runs().wait_run(&run.run_id, &Default::default()).await?;
if matches!(result.status, RunStatus::Completed) {
    println!("{:?}", result.output);
} else { eprintln!("Run is not completed: {:?}", result.status); }`,

  swift: `import Foundation
import UARPSDK

let client = try UARPClient.fromEnvironment()
let run = try await client.runs.create(body: CreateRunRequest(agentId: agentId))
let result = try await client.runs.waitRun(runId: run.runId)
if result.status.rawValue == "completed" { print(result.output as Any) }
else { print("Run is not completed: " + result.status.rawValue) }`,

  kotlin: `import ai.snaga.uarp.api.runs
import ai.snaga.uarp.UarpClient
import ai.snaga.uarp.models.CreateRunRequest
import ai.snaga.uarp.models.RunStatus

val client = UarpClient.fromEnvironment()
val run = client.runs.create(CreateRunRequest(agentId = agentId))
val result = client.runs.waitRun(run.runId)
check(result.status == RunStatus.COMPLETED) { "Run is not completed: " + result.status }
println(result.output)`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Runs;
with UARP.Client;
with UARP.JSON_Support;
with UARP.Models;
with UARP.Types;

procedure Quickstart is
   use UARP.Types;
   use type UARP.Models.Run_Status_Kind;
   Client  : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Request : UARP.Models.Create_Run_Request;
begin
   Request.Agent_Id := +Ada.Environment_Variables.Value ("UARP_AGENT_ID");
   Request.Has_Input := True;
   Request.Input.Has_Message := True;
   Request.Input.Message := +"Summarise the last deploy.";
   declare
      Run : constant UARP.Models.Run := UARP.API.Runs.Create (Client, Request);
      Done : constant UARP.Models.Run := UARP.API.Runs.Wait_Run (Client, +Run.Run_Id);
   begin
      if Done.Status.Kind /= UARP.Models.Run_Status_Completed then
         raise Program_Error with "Run is not completed: " & UARP.Models.Image (Done.Status);
      end if;
      if Done.Has_Output then
         Ada.Text_IO.Put_Line
           (UARP.JSON_Support.Serialize (UARP.Models.To_JSON (Done.Output)));
      end if;
   end;
end Quickstart;`,
};

export const AUTHENTICATE: Samples = {
  ts: `import { UarpClient } from 'uarp-sdk';

// Explicit
const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });

// Or from the environment: UARP_API_KEY, then SNAGA_API_KEY.
// The base URL falls back to UARP_BASE_URL, then production.
const fromEnv = new UarpClient({});`,

  python: `import os
from uarp_sdk import Client

# From the environment: UARP_API_KEY, then SNAGA_API_KEY.
# The base URL falls back to UARP_BASE_URL, then production.
client = Client()

# Or explicitly
explicit = Client(api_key=os.environ["UARP_API_KEY"], max_retries=3)`,

  rust: `// From the environment: UARP_API_KEY, UARP_BASE_URL
let client = uarp_sdk::Client::from_env()?;

// Or explicitly
let client = uarp_sdk::Client::builder()
    .api_key(key)
    .max_retries(3)
    .build()?;`,

  swift: `import Foundation
import UARPSDK

// From the environment: UARP_API_KEY, UARP_BASE_URL
let client = try UARPClient.fromEnvironment()

// Or explicitly
let explicit = UARPClient(apiKey: "uarp_…")`,

  kotlin: `import ai.snaga.uarp.UarpClient

// From the environment: UARP_API_KEY, UARP_BASE_URL
val client = UarpClient.fromEnvironment()

// Or explicitly
val explicit = UarpClient.builder().apiKey(requireNotNull(System.getenv("UARP_API_KEY"))).build()`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
begin
   null;
end Example;`,
};

/**
 * A client that carries no credentials of its own (0.5.2+ in TypeScript, Rust
 * and Kotlin; 0.5.1 in Swift).
 *
 * Ada is absent on purpose: its constructor refuses an empty key outright, so
 * there is no keyless client to show. Documenting one would be documenting a
 * call that raises.
 */
export const KEYLESS: Samples = {
  ts: `import { UarpClient } from 'uarp-sdk';

// A browser app authenticated by an HttpOnly cookie never sees a key.
// An EXPLICITLY empty key says so: no Authorization header is sent.
const client = new UarpClient({ apiKey: '', baseURL: '/api/uarp' });

// An OMITTED key still throws — "forgot to set UARP_API_KEY" is the
// common mistake, and a 401 is a much worse way to find out.`,

  python: `from uarp_sdk import Client

# No credentials of its own: the header is omitted, not sent empty.
client = Client(api_key="", base_url=base)

# Client() refuses a set-but-empty UARP_API_KEY with ConfigError.`,

  rust: `// No credentials of its own: the header is omitted, not sent empty.
let client = uarp_sdk::Client::builder()
    .api_key("")
    .base_url(base)
    .build()?;

// \`from_env\` refuses a set-but-empty UARP_API_KEY — going keyless is
// a deliberate act on the builder, not an accident of the environment.`,

  swift: `import Foundation
import UARPSDK

// A guest or public client: no Authorization header is sent.
let client = UARPClient(apiKey: "", baseURL: base)`,

  kotlin: `import ai.snaga.uarp.UarpClient

// No credentials of its own: the header is omitted, not sent empty.
val client = UarpClient.builder().apiKey("").baseUrl(base).build()

// fromEnvironment() refuses a set-but-empty UARP_API_KEY.`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
begin
   --  Ada requires a non-empty key; a keyless client is not supported.
   null;
end Example;`,
};

export const CALLING: Samples = {
  ts: `// The platform selects the model itself, so a create is just a name.
const agent = await client.agents.create({ name: 'support' });

const page = await client.agents.list({ limit: 20 });
console.log(page.items.length, page.has_more);

const run = await client.runs.create({
  agent_id: agent.agent_id,
  input: { message: 'Summarise the last deploy.' },
});`,

  python: `from uarp_sdk.models import CreateAgentRequest

# The platform selects the model itself, so a create is just a name.
agent = client.agents.create(CreateAgentRequest(name="support"))

page = client.agents.list(limit=20)
print(len(page.items), page.has_more)`,

  rust: `use uarp_sdk::models::CreateAgentRequest;

// The platform selects the model itself, so a create is just a name.
let agent = client
    .agents()
    .create(&CreateAgentRequest { name: "support".into(), ..Default::default() })
    .await?;

let page = client.agents().list(&Default::default()).await?;`,

  swift: `import Foundation
import UARPSDK

// The platform selects the model itself, so a create is just a name.
let agent = try await client.agents.create(body: CreateAgentRequest(name: "support"))

let page = try await client.agents.list(limit: 20)`,

  kotlin: `import ai.snaga.uarp.api.agents
import ai.snaga.uarp.models.CreateAgentRequest

// The platform selects the model itself, so a create is just a name.
val agent = client.agents.create(CreateAgentRequest(name = "support"))

val page = client.agents.list(limit = 20)`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Request : UARP.Models.Create_Agent_Request;
   Agent : UARP.Models.Agent;
begin
   Request.Name := +"support";
   Agent := UARP.API.Agents.Create (Client, Request);
   Ada.Text_IO.Put_Line (+Agent.Agent_Id);
end Example;`,
};

export const ERRORS: Samples = {
  ts: `import { APIError, RateLimitError, UnprocessableEntityError } from 'uarp-sdk';

try {
  await client.agents.get(id);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.warn('retry after', error.retryAfterSeconds);
  } else if (error instanceof UnprocessableEntityError) {
    console.error(error.validationErrors);
  } else if (error instanceof APIError) {
    console.error(error.status, error.problem?.title, error.correlationId);
  } else {
    throw error;  // not from the API — a timeout or a dropped connection
  }
}`,

  python: `from uarp_sdk import APIError, APITimeoutError, NotFoundError, RateLimitError, UnprocessableEntityError

try:
    client.agents.get("missing")
except NotFoundError:
    print("no such agent")
except UnprocessableEntityError as error:
    print(error.validation_errors)
except RateLimitError as error:
    print("retry after", error.retry_after_seconds)
except APIError as error:
    print(error.status, error.code, error.correlation_id)
except APITimeoutError:
    print("timed out")`,

  rust: `use uarp_sdk::{ApiErrorKind, Error};

match client.agents().get("missing").await {
    Ok(agent) => println!("{}", agent.name),
    Err(Error::Api(api)) => match api.kind() {
        ApiErrorKind::NotFound => println!("no such agent"),
        ApiErrorKind::UnprocessableEntity => println!("{:?}", api.problem.errors),
        ApiErrorKind::RateLimit => println!("retry after {:?}", api.retry_after_seconds()),
        _ => println!("{api}"),
    },
    Err(Error::Timeout) => println!("timed out"),
    Err(other) => println!("{other}"),
}`,

  swift: `import Foundation
import UARPSDK

do {
    _ = try await client.agents.get(agentId: id)
} catch let UARPError.api(error) {
    switch error.kind {
    case .notFound:            print("no such agent")
    case .unprocessableEntity: print(error.validationErrors)
    case .rateLimit:           print(error.retryAfterSeconds ?? 0)
    default:                   print(error.status, error.correlationId ?? "")
    }
} catch UARPError.timeout {
    print("timed out")
}`,

  kotlin: `import ai.snaga.uarp.api.agents
import ai.snaga.uarp.ApiException
import ai.snaga.uarp.ApiErrorKind
import ai.snaga.uarp.TimeoutException

try {
    client.agents.get(id)
} catch (error: ApiException) {
    when (error.kind) {
        ApiErrorKind.NOT_FOUND -> println("No such agent")
        ApiErrorKind.UNPROCESSABLE_ENTITY -> println(error.validationErrors)
        ApiErrorKind.RATE_LIMIT -> println(error.retryAfterSeconds)
        else -> println("Status: " + error.status + ", correlation: " + error.correlationId)
    }
} catch (error: TimeoutException) {
    println("Timed out")
}`,


  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Status : Natural;
   Body_Text : UARP.Types.Text;
   Problem : UARP.Errors.Problem;
begin
--  Generated calls raise UARP.Errors.API_Error. The escape hatch reports
--  the status instead of raising, when that suits better.
UARP.Client.Execute
  (Client, "GET", "/api/v1/agents/missing",
   Status => Status, Body_Text => Body_Text, Problem => Problem);

if Status /= 200 then
   Ada.Text_IO.Put_Line (UARP.Errors.Image (Problem, Status));
   for Failure of Problem.Errors loop
      Ada.Text_IO.Put_Line ((+Failure.Field) & ": " & (+Failure.Message));
   end loop;
end if;
end Example;`,
};

export const PAGINATION: Samples = {
  ts: `for await (const agent of client.agents.listAll({ limit: 100 })) {
  console.log(agent.name);
}

// Or take the first N
import { collect } from 'uarp-sdk';
const first50 = await collect(client.agents.listAll(), 50);`,

  python: `from itertools import islice

for agent in client.agents.list_all(limit=100):
    print(agent.name)

# Or take the first N
first50 = list(islice(client.agents.list_all(), 50))`,

  rust: `use futures_util::StreamExt;

let agents = client.agents();
let params = uarp_sdk::api::ListAgentsParams { limit: Some(100), ..Default::default() };
let mut all = std::pin::pin!(agents.list_all(&params));

while let Some(agent) = all.next().await {
    println!("{}", agent?.name);
}`,

  swift: `import Foundation
import UARPSDK

for try await agent in client.agents.listAll(limit: 100) {
    print(agent.name)
}

let firstPage = try await client.agents.listAll().collect(limit: 50)`,

  kotlin: `import ai.snaga.uarp.api.agents
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList

client.agents.listAll(limit = 100).collect { agent ->
    println(agent.name)
}

val first50 = client.agents.listAll().take(50).toList()`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Params : UARP.API.Agents.List_Agents_Params;
begin
   Params.Has_Limit := True;
   Params.Limit := 100;
   for Agent of UARP.API.Agents.List_All (Client, Params, Max_Items => 500) loop
      Ada.Text_IO.Put_Line (+Agent.Name);
   end loop;
end Example;`,
};

export const STREAMING: Samples = {
  ts: `const stream = client.runs.streamRunEvents(runId);

for await (const event of stream) {
  if (event.event === 'llm.chunk') {
    const { payload } = event.json<{ payload: { delta?: string; chunk_type?: string } }>();
    if ((payload.chunk_type ?? 'content') === 'content') {
      process.stdout.write(payload.delta ?? '');
    }
  }
  if (event.event === 'run.completed' || event.event === 'run.failed') break;  // leaving the loop closes the request
}`,

  python: `with client.runs.stream_run_events(run_id) as events:
    for event in events:
        if event.event == "llm.chunk":
            payload = event.json()["payload"]
            if payload.get("chunk_type", "content") == "content":
                print(payload.get("delta", ""), end="")
        if event.event in ("run.completed", "run.failed"):
            break  # and the end of the with block closes the request`,

  rust: `use futures_util::StreamExt;

let runs = client.runs();
let params = Default::default();
let mut events = std::pin::pin!(runs.stream_run_events(&run_id, &params));

while let Some(event) = events.next().await {
    let event = event?;
    if event.event == "llm.chunk" {
        let chunk = event.json::<serde_json::Value>()?;
        if chunk["payload"]["chunk_type"].as_str().unwrap_or("content") == "content" {
            if let Some(delta) = chunk["payload"]["delta"].as_str() { print!("{delta}"); }
        }
    }
    if event.event == "run.completed" || event.event == "run.failed" { break; }
}`,

  swift: `import Foundation
import UARPSDK

struct Chunk: Decodable {
    struct Payload: Decodable { let chunk_type: String?; let delta: String? }
    let payload: Payload
}

for try await event in client.runs.streamRunEvents(runId: id) {
    if event.event == "llm.chunk" {
        let payload = try event.json(as: Chunk.self).payload
        if (payload.chunk_type ?? "content") == "content" { print(payload.delta ?? "", terminator: "") }
    }
    if event.event == "run.completed" || event.event == "run.failed" { break }
}`,

  kotlin: `import ai.snaga.uarp.api.runs
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.takeWhile
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

client.runs.streamRunEvents(runId)
    .takeWhile { it.event != "run.completed" && it.event != "run.failed" }
    .collect { event ->
        if (event.event == "llm.chunk") {
            val payload = event.decode<JsonObject>()["payload"]?.jsonObject
            val kind = payload?.get("chunk_type")?.jsonPrimitive?.content ?: "content"
            if (kind == "content") print(payload?.get("delta")?.jsonPrimitive?.content.orEmpty())
        }
    }`,


  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   type Printer is limited new UARP.SSE.Event_Sink with null record;
   overriding procedure Handle
     (Self : in out Printer; Event : UARP.SSE.Server_Event; Continue : in out Boolean);
   overriding procedure Handle
     (Self : in out Printer; Event : UARP.SSE.Server_Event; Continue : in out Boolean)
   is
      pragma Unreferenced (Self);
      Name : constant String := +Event.Name;
   begin
      if Name = "llm.chunk" then
         declare
            Envelope : constant UARP.JSON_Support.JSON_Value := UARP.JSON_Support.Parse (+Event.Data);
            Payload : constant UARP.JSON_Support.JSON_Value := UARP.JSON_Support.Get_Value (Envelope, "payload");
         begin
            declare
               Kind : constant String := +UARP.JSON_Support.Get_Text (Payload, "chunk_type");
            begin
               if Kind = "" or else Kind = "content" then
                  Ada.Text_IO.Put (+UARP.JSON_Support.Get_Text (Payload, "delta"));
               end if;
            end;
         end;
      end if;
      Continue := Name /= "run.completed" and then Name /= "run.failed";
   end Handle;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Output : Printer;
begin
   UARP.API.Runs.Stream_Run_Events
     (Client, Ada.Environment_Variables.Value ("UARP_RUN_ID"), Sink => Output);
end Example;`,
};

export const OVERRIDES: Samples = {
  ts: `await client.agents.create({ name: 'support' }, { idempotencyKey: 'onboarding-42' });

await client.runs.create({ agent_id: agentId }, {
  timeout: 120_000,
  maxRetries: 0,
  headers: { 'X-Request-Id': requestId },
  signal: controller.signal,
});`,

  python: `from uarp_sdk import RequestOptions

client.agents.create(request, request_options=RequestOptions(idempotency_key="order-4711"))
client.agents.get(agent_id, request_options=RequestOptions(timeout=5.0, max_retries=0))

# Or bind options to a copy of the client; the connection pool is shared.
traced = client.with_options(headers={"X-Request-Id": request_id})`,

  rust: `use std::time::Duration;

// Rust has no default arguments, so overrides ride on a cheap clone of the
// client that shares its connection pool.
client.with_idempotency_key("order-4711").agents().create(&body).await?;
client.with_timeout(Duration::from_secs(5)).agents().get(id).await?;
client.with_max_retries(0).agents().get(id).await?;`,

  swift: `import Foundation
import UARPSDK

try await client.agents.create(
    body: request,
    options: RequestOptions(timeout: 5, maxRetries: 0, idempotencyKey: "order-4711")
)`,

  kotlin: `import ai.snaga.uarp.api.agents
import ai.snaga.uarp.RequestOptions

client.agents.create(request, options = RequestOptions(idempotencyKey = "order-4711"))`,

  ada: `with Ada.Environment_Variables;
with Ada.Text_IO;
with UARP.API.Agents;
with UARP.API.Runs;
with UARP.Client;
with UARP.Errors;
with UARP.JSON_Support;
with UARP.Models;
with UARP.SSE;
with UARP.Types;

procedure Example is
   use UARP.Types;
   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Options : UARP.Client.Request_Options;
   Agent : UARP.Models.Agent;
begin
   Options.Timeout_Ms := 5_000;
   Options.Max_Retries := 0;
   Agent := UARP.API.Agents.Get
     (Client, Ada.Environment_Variables.Value ("UARP_AGENT_ID"), Options => Options);
   Ada.Text_IO.Put_Line (+Agent.Name);
end Example;`,
};
