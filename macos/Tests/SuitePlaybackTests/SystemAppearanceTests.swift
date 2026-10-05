import XCTest
import SwiftUI
import AppKit
@testable import PokemonSuiteMac

/// The Mac app follows the macOS appearance (owner, 2026-10-04): Settings has no Appearance
/// control, no window overrides the system appearance, and a stored choice from an earlier
/// version is cleared at launch. (The iPhone companion keeps its own setting.)
@MainActor final class SystemAppearanceTests: XCTestCase {
    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "appearance")
        UserDefaults.standard.removeObject(forKey: "settingsPane")
    }

    /// Hosts a view in a light window and returns its hosting view after layout settles.
    private func host<V: View>(_ view: V, size: CGSize) async throws -> (NSWindow, NSView) {
        let controller = NSHostingController(rootView: view)
        controller.sizingOptions = []
        let window = NSWindow(contentRect: NSRect(origin: CGPoint(x: 60, y: 60), size: size), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .aqua)
        window.contentViewController = controller
        window.setContentSize(size)
        window.orderFrontRegardless()
        for _ in 0..<10 { try await Task.sleep(for: .milliseconds(100)); window.contentView?.layoutSubtreeIfNeeded() }
        return (window, controller.view)
    }

    /// The choices rendered anywhere under a view: each segmented control's segments and each pop-up's items.
    /// (SwiftUI builds its accessibility tree only for an assistive client, so the rendered controls are read.)
    private func choices(_ view: NSView) -> [[String]] {
        var out: [[String]] = []
        if let control = view as? NSSegmentedControl { out.append((0..<control.segmentCount).map { control.label(forSegment: $0) ?? "" }) }
        if let popup = view as? NSPopUpButton { out.append(popup.itemTitles) }
        for sub in view.subviews { out += choices(sub) }
        return out
    }

    private func isDark(_ view: NSView) -> Bool { view.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }

    func testSettingsHasNoAppearanceChoiceAndFollowsTheSystem() async throws {
        UserDefaults.standard.set("dark", forKey: "appearance")
        var seen = 0
        for pane in ["General", "Library", "Companion", "Updates", "Support"] {
            UserDefaults.standard.set(pane, forKey: "settingsPane")
            let (window, view) = try await host(SuiteSettingsView().environmentObject(SuiteModel()).environmentObject(AppUpdater()), size: CGSize(width: 580, height: 620))
            defer { window.orderOut(nil); window.close() }
            let rendered = choices(view)
            seen += rendered.count
            XCTAssertFalse(rendered.contains { Set($0).isSuperset(of: ["Light", "Dark"]) }, "\(pane) offers no Light/Dark appearance choice: \(rendered)")
            XCTAssertFalse(isDark(view), "a stored dark choice no longer darkens Settings (\(pane)) in a light system")
        }
        XCTAssertGreaterThan(seen, 0, "the probe reads rendered choices (Updates has section tabs)")
    }

    func testMainWindowFollowsTheSystemAppearance() async throws {
        UserDefaults.standard.set("dark", forKey: "appearance")
        let model = SuiteModel()
        UserDefaults.standard.set("dark", forKey: "appearance")  // even if a launch cleared it, the window must not read it
        let (window, view) = try await host(SuiteWindow().environmentObject(model).environmentObject(AppUpdater()), size: CGSize(width: 1100, height: 680))
        defer { window.orderOut(nil); window.close() }
        XCTAssertFalse(isDark(view), "the main window keeps the system appearance")
    }

    func testLaunchClearsTheOldAppearanceChoice() {
        UserDefaults.standard.set("dark", forKey: "appearance")
        _ = SuiteModel()
        XCTAssertNil(UserDefaults.standard.object(forKey: "appearance"), "an earlier version's Light/Dark choice is removed at launch")
    }
}
