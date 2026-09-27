import Foundation

public struct ROMArtworkResource: Hashable, Sendable {
    public let path: String
    public let fingerprint: String
    public init(game: String, kind: String, key: String, fingerprint: String) {
        self.path = "/api/rom-art/\(game)/\(kind)/\(key).png"
        self.fingerprint = fingerprint
    }
}

/// Only source artwork changes invalidate a cart, including compatible ROM
/// fallbacks. Live battle telemetry and another cart's identity do not.
public struct CartridgeArtwork: Hashable, Sendable {
    public let mascot: ROMArtworkResource?
    public let logo: ROMArtworkResource?
    public init(game: JSONValue, artwork: JSONValue) {
        let id = game["id"].string
        func has(_ game: String, _ kind: String) -> Bool { artwork[game]["assets"].array.contains(.string(kind)) }
        func resource(_ game: String, _ kind: String, _ key: String) -> ROMArtworkResource {
            ROMArtworkResource(game: game, kind: kind, key: key, fingerprint: artwork[game]["fingerprint"].string)
        }
        let mascots = ["red":6, "blue":9, "green":3, "yellow":25, "gold":250, "silver":249, "lets-go-pikachu":25, "lets-go-eevee":133]
        if has(id, "mascot") { mascot = resource(id, "mascot", "front") }
        else if has(id, "game") { mascot = resource(id, "game", "icon") }
        else if let number = mascots[id], let source = ["crystal", "firered", "leafgreen", "emerald"].first(where: { has($0, "pokemon") }) {
            mascot = resource(source, "pokemon", String(number))
        } else { mascot = nil }
        logo = [id, "emerald"].first(where: { has($0, "logo") }).map { resource($0, "logo", "pokemon") }
    }
}

public enum ROMArtworkLoader {
    private struct Key: Hashable, Sendable { let connection: UUID; let resource: ROMArtworkResource }
    private static let cache = AsyncResourceCache<Key, Data>(costLimit: 12 * 1024 * 1024, countLimit: 256, concurrency: 4, cost: { $0.count })
    public static func data(_ resource: ROMArtworkResource?, api: SuiteAPI) async throws -> Data? {
        guard let resource else { return nil }
        return try await cache.value(for: Key(connection: api.cacheIdentity, resource: resource)) {
            let data = try await api.data(resource.path)
            guard data.starts(with: [137,80,78,71,13,10,26,10]) else { throw SuiteError("ROM artwork is unavailable.") }
            return data
        }
    }
}
