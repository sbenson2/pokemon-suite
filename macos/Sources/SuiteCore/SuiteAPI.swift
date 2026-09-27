import Foundation

public actor SuiteAPI {
    public nonisolated let cacheIdentity = UUID()
    public nonisolated let baseURL: URL
    public nonisolated let certificateSHA256: String?
    private let bearerToken: String?
    private let session: URLSession
    private var cookie = ""
    public init(baseURL: URL, bearerToken: String? = nil, certificateSHA256: String? = nil) {
        self.baseURL = baseURL
        self.bearerToken = bearerToken
        self.certificateSHA256 = certificateSHA256
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 120
        configuration.allowsCellularAccess = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: SuiteTrust(fingerprint: certificateSHA256), delegateQueue: nil)
    }

    public func connect() async throws {
        if bearerToken != nil { _ = try await get("/api/state"); return }
        let (_, response) = try await session.data(from: baseURL)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              let value = response.value(forHTTPHeaderField: "Set-Cookie"),
              let sessionCookie = value.split(separator: ";").first else {
            throw SuiteError("The local Suite service could not open its session.")
        }
        cookie = String(sessionCookie)
    }

    public func request(_ path: String, body: JSONValue? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.scheme == baseURL.scheme, url.host == baseURL.host, url.port == baseURL.port else {
            throw SuiteError("The requested resource is outside this Suite.")
        }
        var request = URLRequest(url: url)
        request.allowsCellularAccess = true
        // Polling should notice a lost mobile route quickly. Mutating commands
        // retain their execution window and are never automatically replayed.
        request.timeoutInterval = bearerToken != nil && body == nil && url.path == "/api/state" ? 8 : 120
        if let bearerToken { request.setValue("Bearer " + bearerToken, forHTTPHeaderField: "Authorization") }
        else { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if bearerToken == nil { request.setValue("\(baseURL.scheme ?? "http")://\(baseURL.host ?? "127.0.0.1")\(baseURL.port.map { ":\($0)" } ?? "")", forHTTPHeaderField: "Origin") }
        }
        return request
    }

    public func data(_ path: String, body: JSONValue? = nil) async throws -> Data {
        let (data, response) = try await session.data(for: request(path, body: body))
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            let error = try? JSONDecoder().decode(JSONValue.self, from: data)
            throw SuiteError(error?["error"].string.nonempty ?? "The Suite could not complete this request.")
        }
        return data
    }

    public func get(_ path: String) async throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: await data(path))
    }
    @discardableResult public func post(_ path: String, _ body: JSONValue = .object([:])) async throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: await data(path, body: body))
    }
}

public extension String {
    var nonempty: String? { isEmpty ? nil : self }
}
