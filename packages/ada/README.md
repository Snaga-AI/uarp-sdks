# uarp_sdk (Ada)

Ada 2022 client for the **UARP — Universal Agent Runtime Platform** API. Full
coverage of all 557 endpoints, HTTP over libcurl, JSON via GNATCOLL.

```toml
# alire.toml
[[depends-on]]
uarp_sdk = "^0.2.0"
```

Needs GNAT (Ada 2022), GNATCOLL, and **libcurl** on the system:

| Platform | libcurl |
| --- | --- |
| macOS | ships with the OS |
| Debian/Ubuntu | `apt install libcurl4-openssl-dev` |
| Fedora | `dnf install libcurl-devel` |
| Alpine | `apk add curl-dev` |

The crate links `-lcurl` through `Linker_Options`, so importing `uarp_sdk.gpr`
is enough.

## Quick start

```ada
with UARP.API.Agents;
with UARP.Client;
with UARP.Models;
with UARP.Types;

procedure Demo is
   use UARP.Types;

   Client : constant UARP.Client.Client_Type := UARP.Client.From_Environment;
   Params : UARP.API.Agents.List_Agents_Params;
begin
   Params.Has_Limit := True;
   Params.Limit := 20;

   for Agent of UARP.API.Agents.List_All (Client, Params) loop
      Ada.Text_IO.Put_Line ((+Agent.Agent_Id) & "  " & (+Agent.Name));
   end loop;
end Demo;
```

`From_Environment` reads `UARP_API_KEY` (or `SNAGA_API_KEY`) and
`UARP_BASE_URL`; `UARP.Client.Create` takes them directly.

Operations live in one child package per API tag: `UARP.API.Agents`,
`UARP.API.Runs`, `UARP.API.Sessions`, … 43 in all. Models and their JSON
conversions are in `UARP.Models`.

## Records and optional fields

Optional properties carry a `Has_` flag beside the value, so every record
default-initialises and compares with `=`:

```ada
Request : UARP.Models.Create_Agent_Request;
...
Request.Name := +"demo";                            --  required
Request.Model.Provider :=
  UARP.Models.To_Agent_Model_Config_Provider ("openai_compat");
Request.Has_Description := True;                    --  optional
Request.Description := +"Answers questions.";
```

`+` converts between `String` and `UARP.Types.Text` (an `Unbounded_String`).

Enums are a `Kind` discriminant plus the original text, so a value the server
adds later still round-trips:

```ada
if Agent.Execution_Mode.Kind = UARP.Models.Agent_Execution_Mode_Worker then ...
Ada.Text_IO.Put_Line (UARP.Models.Image (Agent.Execution_Mode));
```

## Streaming

SSE endpoints dispatch every event to a *sink*: derive from
`UARP.SSE.Event_Sink`, keep whatever state you need in the derived type, and
pass the object.

```ada
type Printer is limited new UARP.SSE.Event_Sink with record
   Chunks : Natural := 0;
end record;

overriding procedure Handle
  (Self : in out Printer; Event : UARP.SSE.Server_Event; Continue : in out Boolean)
is
   Name : constant String := UARP.Types.SU.To_String (Event.Name);
begin
   if Name = "llm.chunk" then
      Self.Chunks := Self.Chunks + 1;
      Ada.Text_IO.Put (UARP.Types.SU.To_String (Event.Data));
   end if;
   Continue := Name /= "run.completed";
end Handle;

Output : Printer;
...
UARP.API.Runs.Stream_Run_Events (Client, Run_Id, Sink => Output);
```

Setting `Continue` to `False` closes the connection and returns.

The sink may be a local variable, and each streaming call keeps its parser on
the caller's stack, so several tasks may stream at the same time without
sharing anything.

`Stream` blocks. When the connection ends it is reopened, replaying the last
`id` it saw as `Last-Event-ID`; a connection that delivered at least one event
earns a fresh reconnect budget, so a healthy stream is followed indefinitely
and the call returns when the sink sets `Continue` to `False`:

```ada
Options : UARP.Client.Request_Options;
...
Options.Reconnect := False;      --  return as soon as the stream ends
Options.Max_Reconnects := 3;     --  give up after three fruitless attempts
```

## Pagination

`<Operation>_All` collects every page into a vector, following the cursor:

```ada
Everything : constant UARP.Models.Agent_Vectors.Vector :=
  UARP.API.Agents.List_All (Client, Params, Max_Items => 500);
```

`Max_Items => 0` (the default) means no limit.

## Errors

Generated operations raise on failure:

| Exception | Meaning |
| --- | --- |
| `UARP.Errors.API_Error` | non-2xx response; the message carries status, title, detail and `correlationId` |
| `UARP.Errors.Transport_Error` | the request never produced a response |
| `UARP.Errors.Decoding_Error` | the body was not the JSON the SDK expected |
| `UARP.Errors.Configuration_Error` | missing key, bad base URL |

For the structured problem document, use the non-raising entry point:

```ada
UARP.Client.Execute
  (Client, "GET", "/api/v1/agents/missing",
   Status => Status, Body_Text => Body_Text, Problem => Problem);

if Status /= 200 then
   Ada.Text_IO.Put_Line (UARP.Errors.Image (Problem, Status));
   for Failure of Problem.Errors loop
      Ada.Text_IO.Put_Line ((+Failure.Field) & ": " & (+Failure.Message));
   end loop;
end if;
```

The retry and rate-limit hints travel in headers rather than in the problem
document, so `Problem` carries those too:

```ada
UARP.Errors.Retry_After_Seconds (Problem)   --  seconds, or -1.0 when absent
UARP.Errors.Rate_Limit_Remaining (Problem)  --  requests left, or -1
UARP.Errors.Rate_Limit_Reset (Problem)      --  unix seconds, or -1
Problem.Headers                             --  every response header
```

## Configuration

```ada
Client : constant UARP.Client.Client_Type :=
  UARP.Client.Create
    (API_Key            => Key,
     Base_URL           => "http://localhost:8080",
     Timeout_Ms         => 30_000,     --  0 disables the timeout
     Max_Retries        => 3,
     User_Agent_Suffix  => "my-app/1.2.3",
     SSE_Token_In_Query => False);
```

Per-call overrides go in `Options`:

```ada
Options : UARP.Client.Request_Options;
...
Options.Idempotency_Key := +"order-4711";
Options.Timeout_Ms := 5_000;
UARP.Types.Add (Options.Extra_Headers, "X-Trace", Trace_Id);
```

**Retries.** `408`, `409`, `429` and `5xx` retry with full-jitter backoff
(0.5 s → 8 s) and honour `Retry-After`. Reads always retry; writes only when
they carry an idempotency key, which every mutating `/api/v1/*` call sends.

## Escape hatch

`UARP.Client.Call`, `Call_And_Discard` and `Call_Raw` take a method and path
directly, for endpoints the generated surface does not fit.

## Notes

- Each `Character` of a `Text` value is one byte, so binary downloads and
  multipart uploads work without extra encoding.
- Bodies that are a bare scalar, array or free-form object (62 endpoints) take
  a `JSON_Value` rather than a generated record.
- Streaming and unary calls are both safe to run from several tasks at once;
  libcurl's one-time global initialisation is serialised behind a protected
  object.
- Nothing here allocates a task or requires a runtime beyond the standard one.

## Development

```sh
alr build              # the library
cd tests && alr build  # the suite
./tests/run-tests.sh   # unit tests plus HTTP/SSE against a local mock server
cd examples && alr build && alr run quickstart
```

Files under `src/generated/` come from `generator/` in the repository root;
edit the emitter, not the output.
