import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

/// Review renders of every main screen with frozen data, for before/after design reviews.
/// Skipped unless RENDER_OUT and RENDER_API_URL name an output folder and a Suite (use a
/// read-only fixture server that refuses every POST). RENDER_FRAME is a captured MRF1 frame
/// for the Live game screen. Windows open briefly on screen and are captured with screencapture.
@MainActor final class ScreenRenderTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    private func frameImage(_ path: String) -> CGImage? {
        guard let data = FileManager.default.contents(atPath: path), data.count > 16 else { return nil }
        let width = Int(data[4]) << 8 | Int(data[5]), height = Int(data[6]) << 8 | Int(data[7])
        let pixels = data.subdata(in: 16..<(16 + width * height * 4))
        guard let provider = CGDataProvider(data: pixels as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }

    private func capture(_ window: NSWindow, to url: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-o", "-l", String(window.windowNumber), url.path]
        try process.run(); process.waitUntilExit()
    }

    private func settle(_ window: NSWindow, seconds: Double) async throws {
        let steps = Int(seconds / 0.15)
        for _ in 0..<steps { try await Task.sleep(for: .milliseconds(150)); window.contentView?.layoutSubtreeIfNeeded() }
    }

    private func model(_ url: URL) async throws -> SuiteModel {
        let model = SuiteModel()
        let api = SuiteAPI(baseURL: url)
        try await api.connect()
        model.api = api; model.starting = false
        model.state = try await api.get("/api/state")
        model.selectedGame = env["RENDER_GAME"] ?? "firered"
        model.dex = try await api.get("/data/pokedex/\(model.selectedGame).json")
        if let frame = env["RENDER_FRAME"] { model.playback.image = frameImage(frame); model.playback.message = "" }
        return model
    }

    private func window<V: View>(_ view: V, size: CGSize, dark: Bool, toolbar: Bool) -> NSWindow {
        let controller = NSHostingController(rootView: view)
        controller.sizingOptions = []  // keep the requested window size; never grow to the content's ideal height
        if toolbar { controller.sceneBridgingOptions = .all }
        let style: NSWindow.StyleMask = toolbar ? [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView] : [.titled, .closable]
        let window = NSWindow(contentRect: NSRect(x: 60, y: 60, width: size.width, height: size.height), styleMask: style, backing: .buffered, defer: false)
        window.contentViewController = controller
        window.setContentSize(size)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        if toolbar { window.toolbarStyle = .unified }
        window.isReleasedWhenClosed = false
        window.setFrameOrigin(NSPoint(x: 60, y: 60))
        window.orderFrontRegardless()
        return window
    }

    func testRenderEveryScreen() async throws {
        guard let out = env["RENDER_OUT"], let address = env["RENDER_API_URL"], let url = URL(string: address) else {
            throw XCTSkip("Set RENDER_OUT and RENDER_API_URL to render the screens.")
        }
        let folder = URL(fileURLWithPath: out, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let model = try await model(url)
        let pages = (env["RENDER_PAGES"] ?? "").split(separator: ",").compactMap { name in SuitePage.allCases.first { $0.id == name || "\($0)" == name } }
        for page in env["RENDER_ONLY_FRESH"] != nil ? [] : pages.isEmpty ? SuitePage.allCases : pages {
            for dark in [false, true] {
                model.page = page
                let window = window(SuiteWindow().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 1280, height: 840), dark: dark, toolbar: true)
                try await settle(window, seconds: Double(env["RENDER_SETTLE"] ?? "") ?? 5)
                try capture(window, to: folder.appendingPathComponent("\(String(describing: page))-\(dark ? "dark" : "light").png"))
                window.orderOut(nil); window.close()
            }
        }
        if env["RENDER_FRESH"] != nil {
            // A first launch: the same catalog, nothing installed and no sessions.
            let saved = model.state
            var fresh = saved
            fresh["library"] = .array(saved["library"].array.map { game in var g = game; g["status"] = .string("missing"); return g })
            fresh["sessions"] = .array([]); fresh["session"] = .null
            model.state = fresh; model.page = .library
            for dark in [false, true] {
                let window = window(SuiteWindow().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 1280, height: 840), dark: dark, toolbar: true)
                try await settle(window, seconds: 3)
                try capture(window, to: folder.appendingPathComponent("first-launch-\(dark ? "dark" : "light").png"))
                window.orderOut(nil); window.close()
            }
            model.state = saved
        }
        if let path = env["RENDER_NEWSAVE_SESSION"], let data = FileManager.default.contents(atPath: path) {
            // A brand-new save right after Start game (fresh-user run): the Live page offers New Run.
            let saved = model.state
            var session = try JSONDecoder().decode(JSONValue.self, from: data)
            if session["game"].string.isEmpty { session["game"] = .string("firered") }
            var state = saved
            state["library"] = .array(saved["library"].array.map { game in var g = game; g["status"] = .string(game["id"].string == "firered" ? "installed" : "missing"); return g })
            state["sessions"] = .array([session]); state["session"] = .null
            model.state = state; model.selectedGame = "firered"; model.page = .live
            let image = model.playback.image; model.playback.image = nil; model.playback.message = "Connecting to the game…"
            for dark in [false, true] {
                let window = window(SuiteWindow().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 1280, height: 840), dark: dark, toolbar: true)
                try await settle(window, seconds: 3)
                try capture(window, to: folder.appendingPathComponent("new-save-live-\(dark ? "dark" : "light").png"))
                window.orderOut(nil); window.close()
            }
            model.state = saved; model.playback.image = image; model.playback.message = ""
        }
        if env["RENDER_SAVES"] != nil {
            // Bot settings → Saves, with the other saves that help this one.
            model.page = .bot
            for dark in [false, true] {
                model.botSectionRequest = "Saves"
                let window = window(SuiteWindow().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 1280, height: 840), dark: dark, toolbar: true)
                try await settle(window, seconds: 4)
                try capture(window, to: folder.appendingPathComponent("bot-saves-\(dark ? "dark" : "light").png"))
                window.orderOut(nil); window.close()
            }
        }
        if env["RENDER_SETTINGS"] != nil {
            for pane in ["General", "Library", "Companion", "Updates", "Support"] {
                UserDefaults.standard.set(pane, forKey: "settingsPane")
                let window = window(SuiteSettingsView().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 580, height: 600), dark: false, toolbar: false)
                try await settle(window, seconds: 2)
                try capture(window, to: folder.appendingPathComponent("settings-\(pane.lowercased()).png"))
                window.orderOut(nil); window.close()
            }
        }
    }
}
