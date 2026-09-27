import AppKit
import SceneKit
import SuiteCore

struct CartridgePreview: @unchecked Sendable {
    let image: CGImage
    let artwork: Data?
    let logo: Data?
}

enum CartridgePreviews {
    static let cache = AsyncResourceCache<CartridgeThumbnailKey, CartridgePreview>(costLimit: 40 * 1024 * 1024, countLimit: 100, concurrency: 1, cost: { $0.image.bytesPerRow * $0.image.height + ($0.artwork?.count ?? 0) + ($0.logo?.count ?? 0) })
    private static let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
    static func load(key: CartridgeThumbnailKey, game: JSONValue, api: SuiteAPI) async throws -> CartridgePreview {
        if let cached = await cache.cachedValue(for: key) { return cached }
        async let artwork = try? ROMArtworkLoader.data(key.artwork.mascot, api: api)
        async let logo = try? ROMArtworkLoader.data(key.artwork.logo, api: api)
        let images = await (artwork, logo)
        try Task.checkCancellation()
        let complete = (key.artwork.mascot == nil || images.0 != nil) && (key.artwork.logo == nil || images.1 != nil)
        let value = try await cache.value(for: key) {
            try autoreleasepool {
                try Task.checkCancellation()
                let scene = CartridgeMesh.scene(style: CartridgeStyle(game: game), artwork: images.0.flatMap(NSImage.init(data:)), logo: images.1.flatMap(NSImage.init(data:)))
                renderer.scene = scene
                defer { renderer.scene = nil }
                let snapshot = renderer.snapshot(atTime: 0, with: CGSize(width: key.width, height: key.height), antialiasingMode: .multisampling4X)
                guard let image = snapshot.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw SuiteError("Cartridge preview could not be rendered.") }
                return CartridgePreview(image: image, artwork: images.0, logo: images.1)
            }
        }
        // A partial label must retry after reconnecting instead of staying cached.
        if !complete { await cache.removeValue(for: key) }
        return value
    }
}

