// Contract runner for the Swift SDK.
//
// Performs the sequence in contract/SCENARIOS.md against the contract server.
// It asserts nothing about the traffic: the server records it and run.sh
// compares the five traces.
//
//   UARP_CONTRACT_BASE_URL=http://127.0.0.1:8940 swift run uarp-contract
import Foundation
import UARP

guard let base = ProcessInfo.processInfo.environment["UARP_CONTRACT_BASE_URL"],
      let baseURL = URL(string: base)
else {
    FileHandle.standardError.write(Data("UARP_CONTRACT_BASE_URL is not set\n".utf8))
    exit(2)
}

var configuration = Configuration(apiKey: "uarp_contract_secret", baseURL: baseURL)
configuration.maxRetries = 2
let client = UARPClient(configuration: configuration)

// A quote, a backslash, a newline, a tab, a non-ASCII letter and a character
// outside the basic plane — everything a JSON encoder has to escape or carry.
let awkward = "\"q\" \\ \n \t ы 😀"

// 1. query serialisation
_ = try await client.agents.list(limit: 2)

// 2. path encoding
_ = try await client.agents.get(agentId: "id with/slash")

// 3. JSON body and the automatic idempotency key
_ = try await client.agents.create(
    body: CreateAgentRequest(
        name: "demo"
    )
)

// 4. cursor paging, consumed to the end
for try await agent in client.agents.listAll() { _ = agent }

// 5. a 429 that is retried
_ = try await client.agents.get(agentId: "retry-me")

// 6. a 404 that is not
var refused = false
do {
    _ = try await client.agents.get(agentId: "missing")
} catch UARPError.api {
    refused = true
}
// A scenario that silently does not happen would make the traces agree for
// the wrong reason.
guard refused else { fatalError("expected a 404") }

// 7. an event stream, stopped by the caller
for try await event in client.runs.streamRunEvents(runId: "r1") {
    if event.event == "run.completed" { break }
}

// 8. binary download
_ = try await client.files.downloadFileContent(fileId: "f1")

// 9. no content
try await client.files.delete(fileId: "f1")

// 10. multipart upload
_ = try await client.registry.registryPublish(
    body: RegistryPublishRequest(
        manifest: "{\"name\":\"demo\"}",
        artifact: FilePart(filename: "artifact", data: Data([0x00, 0xFF, 0x41])),
        sha256: "abc123"
    )
)

// 11. query encoding, spaces and reserved characters included
_ = try await client.agents.list(workspaceId: "ы w&x=y+z*!()~")

// 12. a multibyte path segment
_ = try await client.agents.get(agentId: "агент/ы")

// 13. a header parameter
for try await event in client.runs.streamRunEvents(runId: "r1", lastEventId: "42") {
    if event.event == "run.completed" { break }
}

// 14. zero and false must survive, not be dropped as falsy
_ = try await client.agents.list(limit: 0, includeOffline: false)

// 15. JSON string escaping and a zero in a body
_ = try await client.runs.create(
    body: CreateRunRequest(agentId: awkward, sessionId: "", version: 0)
)

// 16. how the decoder handles a payload built to strain it
let probe = try await client.runs.get(runId: "probe")
let probes: [String: String] = [
    "status": probe.status.rawValue,
    "error_is_absent": String(probe.error == nil),
    "step_seq": probe.stepSeq.map(String.init) ?? "absent",
    "artifacts_count": probe.artifacts.map { String($0.count) } ?? "absent",
    "metadata_keys": (probe.metadata?.keys.sorted() ?? []).joined(separator: ","),
    "metrics_output_tokens": probe.metrics?.outputTokens.map(String.init) ?? "absent",
    "metrics_input_tokens": probe.metrics?.inputTokens.map(String.init) ?? "absent",
    "started_at_is_absent": String(probe.startedAt == nil),
]

struct Report: Encodable {
    let language: String
    let probes: [String: String]
}
let payload = try JSONEncoder().encode(Report(language: "swift", probes: probes))
let _: JSONValue = try await client.send(
    RequestSpec(method: "POST", path: "/__report", body: .json(payload))
)

print("swift runner done")
