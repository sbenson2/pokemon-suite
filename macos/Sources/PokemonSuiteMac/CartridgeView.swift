import AppKit
import SceneKit
import SwiftUI
import SuiteCore

/// The grid uses images of the actual meshes. Only the hovered cart owns a live
/// renderer; scrolling never builds scenes on the UI thread.
struct CartridgeView: View {
    @EnvironmentObject var model: SuiteModel
    let game: JSONValue
    var compact = false
    var body: some View {
        if let api = model.api {
            CartridgeContent(game: game, artwork: CartridgeArtwork(game: game, artwork: model.state["artwork"]), api: api, compact: compact).equatable()
        }
    }
}

private struct CartridgeContent: View, Equatable {
    let game: JSONValue
    let artwork: CartridgeArtwork
    let api: SuiteAPI
    let compact: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var hovering = false
    @State private var preview: CartridgePreview?
    @State private var loaded: CartridgeThumbnailKey?
    @State private var liveScene: SCNScene?
    static func == (a: Self, b: Self) -> Bool { a.game == b.game && a.artwork == b.artwork && a.api === b.api && a.compact == b.compact }
    private var active: Bool { hovering && !compact && !reduceMotion && scenePhase == .active }
    var body: some View {
        GeometryReader { geometry in
            let key = CartridgeThumbnailKey(api: api, game: game, artwork: artwork, width: geometry.size.width, height: geometry.size.height)
            ZStack {
                if loaded == key, let preview { Image(decorative: preview.image, scale: 2).resizable().scaledToFit().opacity(active && liveScene != nil ? 0 : 1) }
                if active, let liveScene { CartridgeScene(scene: liveScene).allowsHitTesting(false) }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .contentShape(Rectangle()).onHover { hovering = $0 }
            .task(id: key) {
                do {
                    let result = try await CartridgePreviews.load(key: key, game: game, api: api)
                    try Task.checkCancellation(); preview = result; loaded = key
                } catch { /* Disappeared cells and disconnected sources retry on appearance. */ }
            }
            .task(id: active && loaded == key ? key : nil) {
                liveScene = nil
                guard active, loaded == key, let preview else { return }
                let job = Task.detached(priority: .userInitiated) {
                    CartridgeMesh.scene(style: CartridgeStyle(game: game), artwork: preview.artwork.flatMap(NSImage.init(data:)), logo: preview.logo.flatMap(NSImage.init(data:)))
                }
                let scene = await job.value
                guard !Task.isCancelled else { return }; liveScene = scene
            }
        }.accessibilityHidden(true).onDisappear { hovering = false; liveScene = nil }
    }
}

private struct CartridgeScene: NSViewRepresentable {
    let scene: SCNScene
    func makeNSView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero, options: [SCNView.Option.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue])
        view.backgroundColor = .clear; view.antialiasingMode = .multisampling4X
        view.rendersContinuously = false; view.preferredFramesPerSecond = 30
        view.allowsCameraControl = false; view.setAccessibilityElement(false)
        return view
    }
    func updateNSView(_ view: SCNView, context: Context) {
        guard view.scene !== scene else { return }
        view.scene = scene
        guard let object = scene.rootNode.childNode(withName: "cartridge", recursively: false) else { return }
        let up = SCNAction.move(to: SCNVector3(0, 0.09, 0), duration: 1.5); up.timingMode = .easeInEaseOut
        let down = SCNAction.move(to: SCNVector3(0, 0.025, 0), duration: 1.5); down.timingMode = .easeInEaseOut
        let turn = SCNAction.rotateTo(x: 0.10, y: -0.12, z: -0.015, duration: 0.35, usesShortestUnitArc: true); turn.timingMode = .easeInEaseOut
        object.runAction(turn); object.runAction(.repeatForever(.sequence([up, down])))
        view.isPlaying = true
    }
    static func dismantleNSView(_ view: SCNView, coordinator: ()) {
        view.isPlaying = false; view.scene?.rootNode.enumerateChildNodes { node, _ in node.removeAllActions() }; view.scene = nil
    }
}
