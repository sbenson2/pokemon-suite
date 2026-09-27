import AppKit
import SwiftUI
import SuiteCore

/// Each request carries its game and source revision. A late response from the
/// previous selection cannot replace the newly selected game's artwork.
struct ROMAsset: View {
    @EnvironmentObject var model: SuiteModel
    var game: String? = nil
    let kind: String
    let key: String
    var shiny = false
    var size: CGFloat = 48
    var fallback = "questionmark.square.dashed"
    var label = "Game artwork"
    @State private var image: NSImage?
    @State private var loadedIdentity = ""
    private static let cache: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 256; cache.totalCostLimit = 16 * 1024 * 1024
        return cache
    }()
    private var selected: String { game ?? model.selectedGame }
    private var available: Bool { model.state["artwork"][selected]["assets"].array.contains { $0.string == kind } }
    private var identity: String {
        "\(model.api?.baseURL.absoluteString ?? ""): \(selected):\(kind):\(key):\(shiny):\(model.state["artwork"][selected]["fingerprint"].string):\(available)"
    }
    var body: some View {
        Group {
            if available, loadedIdentity == identity, let image {
                Image(nsImage: image).resizable().interpolation(.none).scaledToFit()
            } else {
                Image(systemName: fallback).font(.system(size: size * 0.45)).foregroundStyle(.secondary)
            }
        }.frame(width: size, height: size)
            .accessibilityLabel(label)
            .task(id: identity) {
                image = nil; loadedIdentity = ""
                guard available, !key.isEmpty, let api = model.api else { return }
                let requested = identity
                if let cached = Self.cache.object(forKey: requested as NSString) {
                    image = cached; loadedIdentity = requested; return
                }
                let component = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                guard let data = try? await api.data("/api/rom-art/\(selected)/\(kind)/\(component).png?shiny=\(shiny ? 1 : 0)"),
                      !Task.isCancelled, requested == identity,
                      data.starts(with: [137,80,78,71,13,10,26,10]), let decoded = NSImage(data: data) else { return }
                Self.cache.setObject(decoded, forKey: requested as NSString, cost: Int(decoded.size.width * decoded.size.height * 4))
                image = decoded; loadedIdentity = requested
            }
    }
}

struct ROMSprite: View {
    @EnvironmentObject var model: SuiteModel
    let id: Int
    var shiny = false
    var size: CGFloat = 64
    var body: some View {
        ROMAsset(kind: "pokemon", key: String(id), shiny: shiny, size: size,
                 label: "\(model.species.first { $0["id"].int == id }?["name"].string ?? "Pokémon \(id)")\(shiny ? ", shiny" : "")")
    }
}

struct ArtworkCoverage: View {
    @EnvironmentObject var model: SuiteModel
    let game: String
    private var art: JSONValue { model.state["artwork"][game] }
    private let names = ["game": "Game icon", "mascot": "Game mascot", "logo": "Title logo", "pokemon": "Pokémon", "trainer": "Trainers", "item": "Items", "badges": "Badges", "category": "Pokédex categories"]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ROM artwork").font(.headline)
            Text(art["message"].string.nonempty ?? "Choose a ROM folder to check available artwork.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !art["assets"].array.isEmpty {
                Text(art["assets"].array.map { names[$0.string] ?? $0.string }.joined(separator: " · "))
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
