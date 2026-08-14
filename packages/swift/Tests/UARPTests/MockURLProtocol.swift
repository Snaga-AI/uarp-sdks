import Foundation
@testable import UARP

/// Serves canned responses so the transport can be exercised without a network.
final class MockURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (HTTPURLResponse, Data)

    private static let lock = NSLock()
    private static var _handler: Handler?
    private static var _requests: [URLRequest] = []

    static var handler: Handler? {
        get { lock.withLock { _handler } }
        set { lock.withLock { _handler = newValue } }
    }

    static var requests: [URLRequest] {
        lock.withLock { _requests }
    }

    static func reset() {
        lock.withLock {
            _handler = nil
            _requests = []
        }
    }

    /// Build a session that routes everything through this protocol.
    static func session() -> URLSession {
        reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.withLock { Self._requests.append(request) }
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if !data.isEmpty {
                client?.urlProtocol(self, didLoad: data)
            }
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

extension MockURLProtocol {
    static func response(_ request: URLRequest, status: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers.merging(["Content-Type": "application/json"]) { current, _ in current }
        )!
    }
}

extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}

/// A complete `Agent` payload — models decode strictly, so every required
/// field the spec declares has to be present.
func agentJSON(id: String) -> [String: Any] {
    [
        "agent_id": id,
        "tenant_id": "t1",
        "name": "demo",
        "model": ["provider": "openai_compat", "model_ref": "gpt-x", "capabilities": [:]],
        "created_at": "2026-01-01T00:00:00Z",
    ]
}

/// A complete `RegistryPublishResponse`; the model decodes strictly.
func publishResponseJSON() -> [String: Any] {
    [
        "scope": "@demo",
        "name": "bundle",
        "version": "1.0.0",
        "publisher_tenant_id": "t1",
        "manifest": ["name": "demo"],
        "sha256": "abc123",
        "size_bytes": 3,
        "visibility": "public",
        "published_at": "2026-01-01T00:00:00Z",
    ]
}

func jsonData(_ value: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: value)
}

func makeClient(maxRetries: Int = 0) -> UARPClient {
    let configuration = Configuration(
        apiKey: "uarp_test1234_secret",
        baseURL: URL(string: "https://api.example.test")!,
        maxRetries: maxRetries
    )
    return UARPClient(configuration: configuration, session: MockURLProtocol.session())
}
