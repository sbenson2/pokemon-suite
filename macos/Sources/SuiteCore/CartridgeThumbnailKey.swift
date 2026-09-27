import Foundation

public struct CartridgeThumbnailKey: Hashable, Sendable {
    public let connection: UUID
    public let gameID: String
    public let title: String
    public let platform: String
    public let artwork: CartridgeArtwork
    public let width: Int
    public let height: Int
    public init(api: SuiteAPI, game: JSONValue, artwork: CartridgeArtwork, width: Double, height: Double) {
        connection = api.cacheIdentity; gameID = game["id"].string
        title = game["label"].string.nonempty ?? game["title"].string
        platform = game["platform"].string; self.artwork = artwork
        // Bucket two-pixel-per-point previews to avoid rendering every resize pixel.
        self.width = max(64, min(768, Int(ceil(width / 8)) * 16))
        self.height = max(64, min(768, Int(ceil(height / 8)) * 16))
    }
}
