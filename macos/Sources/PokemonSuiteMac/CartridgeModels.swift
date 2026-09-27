import AppKit
import SceneKit
import ModelIO
import SceneKit.ModelIO

/// Reviewed, texture-free models. Each scene owns its material instances.
enum CartridgeModels {
    private static var cache: [URL: SCNNode] = [:]
    private static let lock = NSLock()

    static func node(for style: CartridgeStyle) -> SCNNode? {
        let key = style.id == "crystal" ? "crystal" : style.platform == "gbc" ? "gb" : style.platform
        guard ["gb", "crystal", "gba", "nds", "3ds", "switch"].contains(key) else { return nil }
        let development = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Assets/Cartridges")
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("Suite/macos/Assets/Cartridges")
        // A packaged app must use its own resources, never a developer checkout.
        let folder = Bundle.main.bundleURL.pathExtension == "app" ? bundled : development
        guard let url = folder?.appendingPathComponent(key + ".obj"),
              FileManager.default.isReadableFile(atPath: url.path) else { return nil }
        lock.lock(); defer { lock.unlock() }
        let base: SCNNode
        if let existing = cache[url] { base = existing }
        else {
            let asset = MDLAsset(url: url)
            guard asset.count > 0 else { return nil }
            let scene = SCNScene(mdlAsset: asset)
            var hasGeometry = false
            scene.rootNode.enumerateChildNodes { node, _ in
                if let geometry = node.geometry, !geometry.elements.isEmpty { hasGeometry = true }
            }
            guard hasGeometry else { return nil }
            base = scene.rootNode; cache[url] = base
        }
        let node = base.clone(); node.name = "imported-shell"
        var meshes: [SCNNode] = []
        node.enumerateChildNodes { child, _ in if child.geometry != nil { meshes.append(child) } }
        for child in meshes {
            guard let original = child.geometry, !original.materials.isEmpty else { continue }
            child.geometry = nil
            // ModelIO merges OBJ objects into submeshes. Separate them so opaque
            // interiors and transparent case panels sort independently.
            for (index, element) in original.elements.enumerated() {
                let source = original.materials[index % original.materials.count]
                let part = SCNNode()
                let geometry = SCNGeometry(sources: original.sources, elements: [element])
                let role = source.name ?? "suite_shell"
                let color: NSColor
                var roughness: CGFloat = 0.42, metal: CGFloat = 0
                switch role {
                case "suite_clear_shell": color = NSColor(srgbRed: 0.24, green: 0.55, blue: 0.65, alpha: 1); roughness = 0.34
                case "suite_trim": color = style.shell.blended(withFraction: 0.22, of: .black) ?? style.shell
                case "suite_board": color = NSColor(srgbRed: 0.10, green: 0.33, blue: 0.24, alpha: 1)
                case "suite_chip": color = NSColor(white: 0.075, alpha: 1)
                case "suite_contact": color = NSColor(srgbRed: 0.74, green: 0.57, blue: 0.25, alpha: 1); metal = 0.72; roughness = 0.30
                case "suite_metal": color = NSColor(white: 0.66, alpha: 1); metal = 0.75; roughness = 0.28
                case "suite_sleeve": color = NSColor(srgbRed: 0.72, green: 0.55, blue: 0.13, alpha: 1)
                case "suite_fleck": color = NSColor(srgbRed: 0.73, green: 0.89, blue: 0.91, alpha: 1); metal = 0.35
                default: color = style.shell
                }
                let material = CartridgeMesh.material(color, roughness: roughness, metal: metal)
                material.name = role
                if role == "suite_clear_shell" {
                    material.transparency = 0.75
                    material.transparent.contents = NSColor.white.withAlphaComponent(0.32)
                    material.blendMode = .alpha
                    material.transparencyMode = .aOne
                    material.isDoubleSided = true
                    material.writesToDepthBuffer = false
                    part.renderingOrder = 10
                }
                geometry.materials = [material]
                part.geometry = geometry
                part.name = role
                child.addChildNode(part)
            }
        }
        return node
    }
}
