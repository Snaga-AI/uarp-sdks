//  Live runner for the Swift SDK.
//
//  Performs smoke/live/SCENARIO.md against the real server and prints one JSON
//  object. It asserts almost nothing itself: compare.py decides whether the
//  five languages agree.
//
//    UARP_API_KEY=… swift run uarp-live

import Foundation
import UARP

let language = "swift"
let agentName = "smoke-live-\(language)"
let missingId = "00000000-0000-4000-8000-000000000000"

//  Reported in place of a value the SDK could not read. The wording is shared
//  by all five runners so that "both failed" compares equal; the reason goes to
//  stderr, where it does not affect the comparison.
let decodeFailed = "decode failed"

func note(_ step: String, _ error: Error) {
    FileHandle.standardError.write(Data("\(step): \(error)\n".utf8))
}

guard let apiKey = ProcessInfo.processInfo.environment["UARP_API_KEY"] else {
    FileHandle.standardError.write(Data("UARP_API_KEY is not set\n".utf8))
    exit(1)
}
guard let baseURL = URL(string: ProcessInfo.processInfo.environment["UARP_BASE_URL"] ?? "https://api.snaga.ai")
else {
    FileHandle.standardError.write(Data("UARP_BASE_URL is not a URL\n".utf8))
    exit(2)
}

var configuration = Configuration(apiKey: apiKey, baseURL: baseURL)
configuration.maxRetries = 2
let client = UARPClient(configuration: configuration)
var report: [String: Any] = ["language": language]

// 1. public health, no authorisation needed
report["health"] = try await client.health.get().status

// 2. the key resolves to an identity
let me = try await client.auth.getMe()
report["role"] = me.role
report["auth_method"] = me.authMethod.rawValue

// 3. a list with query parameters.
//
//    A decode failure is reported rather than thrown: the whole point of
//    running five SDKs against one server is to see which of them cannot read
//    what it sends, and a crash here would hide that behind a stack trace
//    instead of putting it in the comparison.
do {
    let page = try await client.agents.list(limit: 2)
    report["page_size"] = min(page.items.count, 2)
} catch let UARPError.decoding(underlying, _) {
    note("page_size", underlying)
    report["page_size"] = decodeFailed
}

// 4. a 404 that must arrive as a typed error carrying a problem document
do {
    _ = try await client.agents.get(agentId: missingId)
    report["not_found_status"] = "no error"
} catch UARPError.api(let error) {
    report["not_found_status"] = error.status
    report["problem_has_title"] = !(error.problem.title ?? "").isEmpty
}

// 5. a write, with the idempotency key the SDK attaches on its own
var createdId: String?
do {
    let created = try await client.agents.create(
        body: CreateAgentRequest(
            name: agentName,
            model: AgentModelConfig(provider: .openaiCompat, modelRef: "gpt-4o-mini", capabilities: [:])
        )
    )
    createdId = created.agentId
    report["created"] = !created.agentId.isEmpty
} catch UARPError.api(let error) {
    report["created"] = false
    report["create_error"] = error.status
} catch let UARPError.decoding(underlying, _) {
    note("created", underlying)
    report["created"] = decodeFailed
}

// 6. read it back, then 7. remove it again
if let id = createdId {
    do {
        let fetched = try await client.agents.get(agentId: id)
        report["name_round_trips"] = fetched.name == agentName
    } catch let UARPError.decoding(underlying, _) {
        note("name_round_trips", underlying)
        report["name_round_trips"] = decodeFailed
    }
    do {
        _ = try await client.agents.delete(agentId: id)
        report["deleted"] = true
    } catch UARPError.api(let error) {
        report["deleted"] = false
        report["delete_error"] = error.status
    }
}

// 8. cursor pagination, stopped by the caller after six items
var seen = 0
do {
    for try await _ in client.agents.listAll(limit: 2) {
        seen += 1
        if seen >= 6 { break }
    }
    report["paged_items"] = seen
} catch let UARPError.decoding(underlying, _) {
    note("paged_items", underlying)
    report["paged_items"] = decodeFailed
}

let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
