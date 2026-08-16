// Create an agent, start a run, follow it live, then page through history.
//
//   UARP_API_KEY=uarp_... swift run uarp-example
import Foundation
import UARPSDK

func createAgent(_ client: UARPClient) async throws -> Agent {
    try await client.agents.create(
        body: CreateAgentRequest(
            name: "quickstart",
            prompts: ["system": .string("You are a concise assistant.")]
        )
    )
}

func runAndFollow(_ client: UARPClient, agentId: String) async throws {
    let run = try await client.runs.create(body: CreateRunRequest(agentId: agentId))

    // The stream reconnects with Last-Event-ID if the connection drops.
    for try await event in client.runs.streamRunEvents(runId: run.runId) {
        switch event.event {
        case "llm.chunk":
            print(event.data, terminator: "")
        case "run.completed", "run.failed":
            return
        default:
            break
        }
    }
}

func listEverything(_ client: UARPClient) async throws {
    // `listAll` walks every page; `list` returns one page plus its cursor.
    for try await agent in client.agents.listAll(limit: 50) {
        print("\(agent.agentId)  \(agent.name)")
    }
}

do {
    let client = try UARPClient.fromEnvironment()
    let agent = try await createAgent(client)
    try await runAndFollow(client, agentId: agent.agentId)
    try await listEverything(client)
} catch let UARPError.api(error) {
    switch error.kind {
    case .unprocessableEntity:
        for failure in error.validationErrors {
            FileHandle.standardError.write(
                Data("invalid \(failure.field ?? "?"): \(failure.message ?? "?")\n".utf8))
        }
    case .rateLimit:
        FileHandle.standardError.write(
            Data("rate limited; retry after \(error.retryAfterSeconds ?? 0)s\n".utf8))
    default:
        FileHandle.standardError.write(Data("\(error)\n".utf8))
    }
    exit(1)
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
