import XCTest
import SwiftUI
import SuiteCore
@testable import PokemonSuiteCompanion

/// The builder opens from anywhere (the Bank's hook) and fills an iPhone sheet
/// without horizontal overflow. No network: it stays in its loading state.
@MainActor final class CompetitiveBuilderLayoutTests: XCTestCase {
    func testBuilderFitsPhoneAndTabletWidths() {
        let model = SuiteModel()
        for (width, type) in [(CGFloat(320), DynamicTypeSize.large), (390, .accessibility3), (820, .large)] {
            let view = NavigationStack { CompetitiveBuilderView(speciesID: 6) }
                .environmentObject(model).environment(\.dynamicTypeSize, type)
            let host = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 780))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds; host.view.layoutIfNeeded()
            let fit = host.sizeThatFits(in: CGSize(width: width, height: 780))
            XCTAssertLessThanOrEqual(fit.width, width + 1)
        }
    }

    /// Every tab with real host responses (macos/Tests/Fixtures/builder-review.json) on an iPhone.
    /// Run with TEST_RUNNER_BUILDER_REVIEW_IMAGES=<folder> to keep PNGs.
    func testTabsWithHostDataFitAnIPhone() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("macos/Tests/Fixtures/builder-review.json")
        let data = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        let request = CompetitiveBuilderRequest(speciesID: data["guidance"]["speciesId"].int, pokemonID: data["individual"]["pokemon"]["id"].string)
        for section in ["Set", "Traits", "Legality", "Plan"] {
            let preloaded = CompetitiveBuilderView.Preloaded(guidance: data["guidance"], individual: data["individual"], plan: data["plan"], section: section)
            let view = NavigationStack { CompetitiveBuilderView(request: request, preloaded: preloaded)
                    .navigationTitle("Competitive Builder").navigationBarTitleDisplayMode(.inline) }
                .environmentObject(SuiteModel())
            let host = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
            window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
            host.view.layoutIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.3))
            host.view.layoutIfNeeded()
            XCTAssertLessThanOrEqual(host.sizeThatFits(in: CGSize(width: 390, height: 844)).width, 391, section)
            if let folder = ProcessInfo.processInfo.environment["BUILDER_REVIEW_IMAGES"] {
                let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
                try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
                try image.pngData()?.write(to: URL(fileURLWithPath: folder).appendingPathComponent("iphone-\(section.lowercased()).png"))
            }
        }
    }

    func testPresenterTakesARequestFromAnInventoryRecord() throws {
        let record = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"id":"\#(String(repeating: "c", count: 64))","nationalSpeciesId":25}"#.utf8))
        var request: CompetitiveBuilderRequest? = CompetitiveBuilderRequest(pokemon: record)
        let binding = Binding(get: { request }, set: { request = $0 })
        let host = UIHostingController(rootView: Text("Bank").competitiveBuilder(binding).environmentObject(SuiteModel()))
        host.view.layoutIfNeeded()
        XCTAssertEqual(request?.speciesID, 25)
        XCTAssertEqual(request?.sourceID, "current")
    }
}
