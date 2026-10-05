import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

/// Each builder tab fits the Mac sheet with real host responses (from
/// Tests/Fixtures/builder-review.json, made by the Python builder from a
/// legitimately caught sample). Set BUILDER_REVIEW_IMAGES to keep PNGs.
@MainActor final class CompetitiveBuilderLayoutTests: XCTestCase {
    private func fixture() throws -> JSONValue {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fixtures/builder-review.json")
        return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    }

    func testEveryTabFitsTheSheet() throws {
        let data = try fixture()
        let species = data["guidance"]["speciesId"].int
        XCTAssertGreaterThan(data["guidance"]["sets"].array.count, 0)
        XCTAssertEqual(data["individual"]["legality"]["verdict"].string, "legal")
        let request = CompetitiveBuilderRequest(speciesID: species, pokemonID: data["individual"]["pokemon"]["id"].string)
        for section in ["Set", "Traits", "Legality", "Plan"] {
            let preloaded = CompetitiveBuilderView.Preloaded(guidance: data["guidance"], individual: data["individual"], plan: data["plan"], section: section)
            let view = CompetitiveBuilderView(request: request, preloaded: preloaded).environmentObject(SuiteModel())
                .frame(width: 760, height: 720).background(Color(nsColor: .windowBackgroundColor))
            let host = NSHostingView(rootView: view)
            host.frame = CGRect(x: 0, y: 0, width: 760, height: 720)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.contentView = host
            host.layoutSubtreeIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.2))
            host.layoutSubtreeIfNeeded()
            XCTAssertLessThanOrEqual(host.fittingSize.width, 761, section)
            if let directory = ProcessInfo.processInfo.environment["BUILDER_REVIEW_IMAGES"], let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: bitmap)
                try FileManager.default.createDirectory(at: URL(fileURLWithPath: directory), withIntermediateDirectories: true)
                try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("builder-\(section.lowercased()).png"))
            }
        }
    }
}
