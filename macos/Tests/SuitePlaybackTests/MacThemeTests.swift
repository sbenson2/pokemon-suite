import XCTest
import SwiftUI
import AppKit
import SuiteCore
@testable import PokemonSuiteMac

/// The Mac's content-layer theme is the iOS companion's GameTheme; these checks keep them equal,
/// and cover the screen geometry, meters and release-safety fixes that came with it.
@MainActor final class MacThemeTests: XCTestCase {
    private var iosTheme: String {
        get throws {
            let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../native/ios/Companion/GameTheme.swift").standardized
            return try String(contentsOf: url, encoding: .utf8)
        }
    }
    private func matches(_ pattern: String, in text: String) -> [[String]] {
        let regex = try! NSRegularExpression(pattern: pattern)
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { m in
            (1..<m.numberOfRanges).map { String(text[Range(m.range(at: $0), in: text)!]) }
        }
    }

    func testPaletteMatchesTheIOSCompanion() throws {
        let text = try iosTheme
        let pairs = matches(#"var (\w+):Color\{Color\(hex:dark \? 0x([0-9A-Fa-f]{6}):0x([0-9A-Fa-f]{6})\)\}"#, in: text)
        XCTAssertEqual(pairs.count, GameThemeValues.pairs.count, "every appearance-dependent iOS color has a Mac twin")
        for p in pairs {
            let mac = try XCTUnwrap(GameThemeValues.pairs[p[0]], p[0])
            XCTAssertEqual(mac.dark, UInt32(p[1], radix: 16), p[0]); XCTAssertEqual(mac.light, UInt32(p[2], radix: 16), p[0])
        }
        let fixed = matches(#"var (\w+):Color\{Color\(hex:0x([0-9A-Fa-f]{6})\)\}"#, in: text)
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: fixed.map { ($0[0], UInt32($0[1], radix: 16)!) }), GameThemeValues.fixed)
        let metalLine = try XCTUnwrap(text.split(separator: "\n").first { $0.contains("var metal:LinearGradient") })
        let metal = matches(#"Color\(hex:0x([0-9A-Fa-f]{6})\),location:([0-9.]+)"#, in: String(metalLine))
        XCTAssertEqual(metal.map { UInt32($0[0], radix: 16)! }, GameThemeValues.metal.map(\.0))
        XCTAssertEqual(metal.map { Double($0[1])! }, GameThemeValues.metal.map(\.1))
    }

    func testHPMeterUsesTheGamesThresholdsAndAlwaysHasAReading() {
        XCTAssertEqual(GameMeter.hpColor(1), GameMeter.hpColor(0.51))
        XCTAssertNotEqual(GameMeter.hpColor(0.5), GameMeter.hpColor(0.51), "half or less turns yellow")
        XCTAssertNotEqual(GameMeter.hpColor(0.2), GameMeter.hpColor(0.21), "a fifth or less turns red")
    }

    /// The screen's bezel follows the frame's own shape, so a tall pane letterboxes outside the bezel.
    func testScreenRatioFollowsTheFrameThenThePlatform() throws {
        let frame = try XCTUnwrap(CGContext(data: nil, width: 240, height: 160, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage())
        XCTAssertEqual(GameScreenGeometry.ratio(image: frame, platform: "nds"), 1.5)
        XCTAssertEqual(GameScreenGeometry.ratio(image: nil, platform: "gba"), 1.5)
        XCTAssertEqual(GameScreenGeometry.ratio(image: nil, platform: "gbc"), 160.0 / 144.0)
        XCTAssertEqual(GameScreenGeometry.ratio(image: nil, platform: "nds"), 256.0 / 384.0)
    }

    /// Release binaries must not carry the build machine's source path (W4 finding 5).
    func testPackagedAppFindsCartridgeModelsOnlyInItsOwnResources() throws {
        let app = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("Fake.app")
        try FileManager.default.createDirectory(at: app.appendingPathComponent("Contents/Resources"), withIntermediateDirectories: true)
        try Data(#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.fake</string></dict></plist>"#.utf8)
            .write(to: app.appendingPathComponent("Contents/Info.plist"))
        defer { try? FileManager.default.removeItem(at: app.deletingLastPathComponent()) }
        let bundle = try XCTUnwrap(Bundle(url: app))
        let folder = try XCTUnwrap(CartridgeModels.modelFolder(bundle: bundle))
        XCTAssertEqual(folder.standardizedFileURL.path, app.appendingPathComponent("Contents/Resources/Suite/macos/Assets/Cartridges").standardizedFileURL.path)
        XCTAssertFalse(folder.path.contains("/Sources/"), "a packaged app never reads a developer checkout")
    }

    /// Public releases are unsigned GitHub zips without an update feed (W4 finding 4).
    func testUpdateMessageMatchesHowPublicReleasesShip() {
        XCTAssertEqual(AppUpdater().message, "This version doesn’t update itself. Download new versions from the project’s Releases page on GitHub.")
    }
}
