import XCTest
import SwiftUI
import AppKit
@testable import PokemonSuiteMac

/// Settings → Support keeps every license link readable at the pane's width,
/// including the bundled emulator's. Set SUPPORT_REVIEW_IMAGES to keep a PNG.
@MainActor final class SupportLinksLayoutTests: XCTestCase {
    func testEveryLicenseLinkFitsTheSupportPane() throws {
        var opened: [String] = []
        let links = LicenseLinks { opened.append($0) }
        XCTAssertEqual(links.destinations.map(\.title), ["Third-Party Notices", "Cartridge Credits", "Emulator License", "Runtime Licenses"])
        XCTAssertEqual(links.destinations.first { $0.title == "Emulator License" }?.path, "GameResources/licenses/mgba/README.md")
        let pane = Form { Section { links } }.formStyle(.grouped).frame(width: 580)
        let host = NSHostingView(rootView: pane)
        host.frame = CGRect(origin: .zero, size: CGSize(width: 580, height: max(host.fittingSize.height, 120)))
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        // The two-row fallback fits a grouped-form row in the 580 pt pane (about
        // 520 pt after insets), so ViewThatFits never has to cut a title off.
        XCTAssertLessThanOrEqual(NSHostingView(rootView: links.twoRows).fittingSize.width, 500)
        if let directory = ProcessInfo.processInfo.environment["SUPPORT_REVIEW_IMAGES"], let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: bitmap)
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: directory), withIntermediateDirectories: true)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("support-links.png"))
        }
    }
}
