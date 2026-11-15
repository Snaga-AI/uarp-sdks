import type { Samples, LanguageId } from './content';

/** Standalone programs. The audit compiles these exact displayed strings. */
export const QUICKSTART: Samples = {
  ts: `import { UarpClient } from 'uarp-sdk';

const agentId = process.env.UARP_AGENT_ID;
if (!agentId) throw new Error('Set UARP_AGENT_ID to an existing agent ID.');
const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
const run = await client.runs.create({
  agent_id: agentId,
  input: { message: 'Summarise the last deploy.' },
});
const result = await client.runs.waitRun(run.run_id);
if (result.status !== 'completed') {
  throw new Error('Run is not completed: ' + result.status);
}
console.log(result.output);`,
  python: `import os
from uarp_sdk import Client
from uarp_sdk.models import CreateRunRequest, CreateRunRequestInput

agent_id = os.environ["UARP_AGENT_ID"]
with Client() as client:
    run = client.runs.create(CreateRunRequest(
        agent_id=agent_id,
        input=CreateRunRequestInput(message="Summarise the last deploy."),
    ))
    result = client.runs.wait_run(run.run_id)
    if result.status != "completed":
        raise RuntimeError(f"Run is not completed: {result.status}")
    print(result.output)`,
  rust: `use uarp_sdk::models::{CreateRunRequest, CreateRunRequestInput, RunStatus};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let agent_id = std::env::var("UARP_AGENT_ID")?;
    let client = uarp_sdk::Client::from_env()?;
    let run = client.runs().create(&CreateRunRequest {
        agent_id,
        input: Some(CreateRunRequestInput {
            message: Some("Summarise the last deploy.".into()),
            ..Default::default()
        }),
        ..Default::default()
    }).await?;
    let result = client.runs().wait_run(&run.run_id, &Default::default()).await?;
    if !matches!(result.status, RunStatus::Completed) {
        return Err(format!("Run is not completed: {:?}", result.status).into());
    }
    println!("{:?}", result.output);
    Ok(())
}`,
  swift: `import Foundation
import UARPSDK

@main
struct Quickstart {
    static func main() async throws {
        guard let agentId = ProcessInfo.processInfo.environment["UARP_AGENT_ID"],
              !agentId.isEmpty else {
            throw NSError(domain: "Quickstart", code: 1, userInfo: [NSLocalizedDescriptionKey: "Set UARP_AGENT_ID."])
        }
        let client = try UARPClient.fromEnvironment()
        let run = try await client.runs.create(body: CreateRunRequest(
            agentId: agentId,
            input: CreateRunRequestInput(message: "Summarise the last deploy.")
        ))
        let result = try await client.runs.waitRun(runId: run.runId)
        guard result.status.rawValue == "completed" else {
            throw NSError(domain: "Quickstart", code: 2, userInfo: [NSLocalizedDescriptionKey: "Run is not completed: " + result.status.rawValue])
        }
        print(result.output as Any)
    }
}`,
  kotlin: `import ai.snaga.uarp.UarpClient
import ai.snaga.uarp.api.runs
import ai.snaga.uarp.models.CreateRunRequest
import ai.snaga.uarp.models.CreateRunRequestInput
import ai.snaga.uarp.models.RunStatus
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val agentId = requireNotNull(System.getenv("UARP_AGENT_ID")) {
        "Set UARP_AGENT_ID to an existing agent ID."
    }
    val client = UarpClient.fromEnvironment()
    val run = client.runs.create(CreateRunRequest(
        agentId = agentId,
        input = CreateRunRequestInput(message = "Summarise the last deploy."),
    ))
    val result = client.runs.waitRun(run.runId)
    check(result.status == RunStatus.COMPLETED) {
        "Run is not completed: " + result.status
    }
    println(result.output)
}`,
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

export const QUICKSTART_RUN: Record<LanguageId, { file: string; command: string }> = {
  ts: { file: 'quickstart.mjs', command: 'node quickstart.mjs' },
  python: { file: 'quickstart.py', command: 'python quickstart.py' },
  rust: { file: 'src/main.rs', command: 'cargo run' },
  swift: { file: 'Sources/Quickstart/Quickstart.swift', command: 'swift run Quickstart' },
  kotlin: { file: 'src/main/kotlin/Quickstart.kt', command: './gradlew run' },
  ada: { file: 'src/quickstart.adb', command: 'alr build --profiles=\"*=development\"\nalr run --skip-build quickstart' },
};

export const QUICKSTART_PROJECT: Partial<Record<LanguageId, { file: string; language: string; code: string }>> = {
  swift: { file: 'Package.swift', language: 'swift', code: `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Quickstart",
    platforms: [.macOS(.v12)],
    dependencies: [
        .package(url: "https://github.com/Snaga-AI/uarp-swift", exact: "0.13.6"),
    ],
    targets: [
        .executableTarget(name: "Quickstart", dependencies: [
            .product(name: "UARPSDK", package: "uarp-swift"),
        ]),
    ]
)` },
  kotlin: { file: 'build.gradle.kts', language: 'kotlin', code: `plugins {
    kotlin("jvm") version "2.2.0"
    application
}
repositories { mavenCentral() }
dependencies {
    implementation("ai.snaga:uarp-sdk:0.13.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}
application { mainClass.set("QuickstartKt") }` },
  ada: { file: 'quickstart.gpr', language: 'ada', code: `with "uarp_sdk.gpr";
project Quickstart is
   for Source_Dirs use ("src");
   for Object_Dir use "obj";
   for Exec_Dir use "bin";
   for Main use ("quickstart.adb");
   package Compiler is
      for Default_Switches ("Ada") use ("-gnat2022");
   end Compiler;
end Quickstart;` },
};
