/**
 * The samples the portal shows, one set per language.
 *
 * Every one of these was compiled against the package as published — the
 * TypeScript ones by `scripts/check-docs.ts` on each build, the other four by
 * hand against crates.io, the SwiftPM mirror, Maven Central and the Alire
 * tarball. Nothing here is written from memory: this documentation has been
 * wrong before, in exactly the way that reads perfectly well.
 */

export const LANGUAGES = [
  { id: 'ts', name: 'TypeScript', registry: 'npm' },
  { id: 'rust', name: 'Rust', registry: 'crates.io' },
  { id: 'swift', name: 'Swift', registry: 'SwiftPM' },
  { id: 'kotlin', name: 'Kotlin', registry: 'Maven Central' },
  { id: 'ada', name: 'Ada', registry: 'Alire' },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]['id'];

export type Samples = Record<LanguageId, string>;

/** The install line, and what it needs. */
export const INSTALL: Record<LanguageId, { command: string; shell: boolean; needs: string }> = {
  ts: { command: 'npm install uarp-sdk', shell: true, needs: 'Node 18+' },
  rust: { command: 'cargo add uarp-sdk tokio --features tokio/macros,tokio/rt-multi-thread', shell: true, needs: 'Rust 1.88+' },
  swift: {
    command: '.package(url: "https://github.com/Snaga-AI/uarp-swift", from: "0.5.1")',
    shell: false,
    needs: 'Swift 5.9+, macOS 12 / iOS 15',
  },
  kotlin: { command: 'implementation("ai.snaga:uarp-sdk:0.5.1")', shell: false, needs: 'Kotlin 2.2+, JVM 11+, Android 21+' },
  ada: { command: 'alr with uarp_sdk', shell: true, needs: 'GNAT 2022, libcurl' },
};

/**
 * The shortest thing that actually does something: ask an agent, get its answer.
 *
 * Three statements in every language — `waitRun` polls to a terminal status
 * server-side, so nothing here has to loop. Streaming, which is what you want
 * once this works, is further down the page.
 */
export const HELLO: Samples = {
  ts: `const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
const run = await client.runs.create({ agent_id: agentId, input: { message: 'Summarise the last deploy.' } });
console.log((await client.runs.waitRun(run.run_id)).output);`,

  rust: `let client = uarp_sdk::Client::from_env()?;
let run = client.runs().create(&CreateRunRequest { agent_id, ..Default::default() }).await?;
println!("{:?}", client.runs().wait_run(&run.run_id, &Default::default()).await?.output);`,

  swift: `let client = try UARPClient.fromEnvironment()
let run = try await client.runs.create(body: CreateRunRequest(agentId: agentId))
print(try await client.runs.waitRun(runId: run.runId).output as Any)`,

  kotlin: `val client = UarpClient.fromEnvironment()
val run = client.runs.create(CreateRunRequest(agentId = agentId))
println(client.runs.waitRun(run.runId).output)`,

  ada: `Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
Run    : constant UARP.Models.Run := UARP.API.Runs.Create (Client, Request);
Done   : constant UARP.Models.Run := UARP.API.Runs.Wait_Run (Client, +Run.Run_Id);`,
};

export const AUTHENTICATE: Samples = {
  ts: `import { UarpClient } from 'uarp-sdk';

// Explicit
const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });

// Or from the environment: UARP_API_KEY, then SNAGA_API_KEY.
// The base URL falls back to UARP_BASE_URL, then production.
const fromEnv = new UarpClient({});`,

  rust: `// From the environment: UARP_API_KEY, UARP_BASE_URL
let client = uarp_sdk::Client::from_env()?;

// Or explicitly
let client = uarp_sdk::Client::builder()
    .api_key(key)
    .max_retries(3)
    .build()?;`,

  swift: `import UARPSDK

// From the environment: UARP_API_KEY, UARP_BASE_URL
let client = try UARPClient.fromEnvironment()

// Or explicitly
let client = UARPClient(apiKey: "uarp_…")`,

  kotlin: `import ai.snaga.uarp.UarpClient

// From the environment: UARP_API_KEY, UARP_BASE_URL
val client = UarpClient.fromEnvironment()

// Or explicitly
val client = UarpClient.builder().apiKey(key).build()`,

  ada: `with UARP.Client;

--  From the environment: UARP_API_KEY, UARP_BASE_URL
Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;`,
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

  rust: `use uarp_sdk::models::CreateAgentRequest;

// The platform selects the model itself, so a create is just a name.
let agent = client
    .agents()
    .create(&CreateAgentRequest { name: "support".into(), ..Default::default() })
    .await?;

let page = client.agents().list(&Default::default()).await?;`,

  swift: `// The platform selects the model itself, so a create is just a name.
let agent = try await client.agents.create(body: CreateAgentRequest(name: "support"))

let page = try await client.agents.list(limit: 20)`,

  kotlin: `import ai.snaga.uarp.models.CreateAgentRequest

// The platform selects the model itself, so a create is just a name.
val agent = client.agents.create(CreateAgentRequest(name = "support"))

val page = client.agents.list(limit = 20)`,

  ada: `Request : UARP.Models.Create_Agent_Request;
Agent   : UARP.Models.Agent;
begin
   --  The platform selects the model itself, so a create is just a name.
   Request.Name := +"support";
   Agent := UARP.API.Agents.Create (Client, Request);`,
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
    console.error(error.status, error.problem.title, error.correlationId);
  } else {
    throw error;  // not from the API — a timeout or a dropped connection
  }
}`,

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

  swift: `do {
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

  kotlin: `try {
    client.agents.get(id)
} catch (error: ApiException) {
    when (error.kind) {
        ApiErrorKind.NOT_FOUND -> showMessage("No such agent")
        ApiErrorKind.UNPROCESSABLE_ENTITY -> showFieldErrors(error.validationErrors)
        ApiErrorKind.RATE_LIMIT -> retryAfter(error.retryAfterSeconds)
        else -> report(error.status, error.correlationId)
    }
} catch (error: TimeoutException) {   // ai.snaga.uarp.TimeoutException,
    showMessage("Timed out")           // not the one in java.util.concurrent
}`,

  ada: `--  Generated calls raise UARP.Errors.API_Error. The escape hatch reports
--  the status instead of raising, when that suits better.
UARP.Client.Execute
  (Client, "GET", "/api/v1/agents/missing",
   Status => Status, Body_Text => Body_Text, Problem => Problem);

if Status /= 200 then
   Ada.Text_IO.Put_Line (UARP.Errors.Image (Problem, Status));
   for Failure of Problem.Errors loop
      Ada.Text_IO.Put_Line ((+Failure.Field) & ": " & (+Failure.Message));
   end loop;
end if;`,
};

export const PAGINATION: Samples = {
  ts: `for await (const agent of client.agents.listAll({ limit: 100 })) {
  console.log(agent.name);
}

// Or take the first N
import { collect } from 'uarp-sdk';
const first50 = await collect(client.agents.listAll(), 50);`,

  rust: `use futures_util::StreamExt;

let agents = client.agents();
let params = uarp_sdk::api::ListAgentsParams { limit: Some(100), ..Default::default() };
let mut all = std::pin::pin!(agents.list_all(&params));

while let Some(agent) = all.next().await {
    println!("{}", agent?.name);
}`,

  swift: `for try await agent in client.agents.listAll(limit: 100) {
    print(agent.name)
}

let firstPage = try await client.agents.listAll().collect(limit: 50)`,

  kotlin: `client.agents.listAll(limit = 100).collect { agent ->
    println(agent.name)
}

val first50 = client.agents.listAll().take(50).toList()`,

  ada: `Everything : constant UARP.Models.Agent_Vectors.Vector :=
  UARP.API.Agents.List_All (Client, Params, Max_Items => 500);`,
};

export const STREAMING: Samples = {
  ts: `const stream = client.runs.streamRunEvents(runId);

for await (const event of stream) {
  if (event.event === 'llm.chunk') {
    const { payload } = event.json<{ payload: { delta: string } }>();
    process.stdout.write(payload.delta);
  }
  if (event.event === 'run.completed') break;  // leaving the loop closes the request
}`,

  rust: `use futures_util::StreamExt;

let runs = client.runs();
let params = Default::default();
let mut events = std::pin::pin!(runs.stream_run_events(&run_id, &params));

while let Some(event) = events.next().await {
    let event = event?;
    if event.event == "llm.chunk" {
        let chunk = event.json::<serde_json::Value>()?;
        if let Some(delta) = chunk["payload"]["delta"].as_str() {
            print!("{delta}");
        }
    }
    if event.event == "run.completed" { break; }
}`,

  swift: `struct Chunk: Decodable {
    struct Payload: Decodable { let delta: String }
    let payload: Payload
}

for try await event in client.runs.streamRunEvents(runId: id) {
    if event.event == "llm.chunk" {
        print(try event.json(as: Chunk.self).payload.delta, terminator: "")
    }
    if event.event == "run.completed" { break }
}`,

  kotlin: `@Serializable data class Chunk(val payload: Payload) {
    @Serializable data class Payload(val delta: String)
}

client.runs.streamRunEvents(runId)
    .onEach { event ->
        if (event.event == "llm.chunk") append(event.decode<Chunk>().payload.delta)
    }
    .takeWhile { it.event != "run.completed" }
    .collect()`,

  ada: `type Printer is limited new UARP.SSE.Event_Sink with record
   Chunks : Natural := 0;
end record;

overriding procedure Handle
  (Self : in out Printer; Event : UARP.SSE.Server_Event; Continue : in out Boolean)
is
   Name : constant String := UARP.Types.SU.To_String (Event.Name);
begin
   if Name = "llm.chunk" then
      --  Event.Data is the whole envelope; the text is at payload.delta.
      Self.Chunks := Self.Chunks + 1;
      Ada.Text_IO.Put (UARP.Types.SU.To_String (Event.Data));
   end if;
   Continue := Name /= "run.completed";
end Handle;`,
};

export const OVERRIDES: Samples = {
  ts: `await client.agents.create({ name: 'support' }, { idempotencyKey: 'onboarding-42' });

await client.runs.create(body, {
  timeout: 120_000,
  maxRetries: 0,
  headers: { 'X-Request-Id': requestId },
  signal: controller.signal,
});`,

  rust: `// Rust has no default arguments, so overrides ride on a cheap clone of the
// client that shares its connection pool.
client.with_idempotency_key("order-4711").agents().create(&body).await?;
client.with_timeout(Duration::from_secs(5)).agents().get(id).await?;
client.with_max_retries(0).agents().get(id).await?;`,

  swift: `try await client.agents.create(
    body: request,
    options: RequestOptions(timeout: 5, maxRetries: 0, idempotencyKey: "order-4711")
)`,

  kotlin: `client.agents.create(request, options = RequestOptions(idempotencyKey = "order-4711"))`,

  ada: `Options : UARP.Client.Request_Options;
begin
   Options.Reconnect := False;      --  return as soon as the stream ends
   Options.Max_Reconnects := 3;     --  give up after three fruitless attempts`,
};
