import XCTest
@testable import SuiteCore

final class GameInputTests: XCTestCase {
    func testReleasingOneInputSourcePreservesOtherHeldControls() {
        var input = GameInputSources()
        input.update("keyboard", value: GameInputState(buttons: ["up", "a"]))
        input.update("controller", value: GameInputState(buttons: ["left", "a"]))
        XCTAssertEqual(Set(input.merged.buttons), ["up", "left", "a"])
        input.update("controller", value: GameInputState())
        XCTAssertEqual(Set(input.merged.buttons), ["up", "a"])
        input.releaseAll()
        XCTAssertFalse(input.merged.isActive)
    }
    func testTouchCoordinatesRejectTopScreenAndLetterbox() {
        XCTAssertNil(GameTouch.at(x: 150, y: 50, width: 300, height: 500, platform: "nds"))
        XCTAssertNil(GameTouch.at(x: 150, y: 495, width: 300, height: 500, platform: "nds"))
        XCTAssertEqual(GameTouch.at(x: 150, y: 362.5, width: 300, height: 500, platform: "nds"), GameTouch(x: 128, y: 96))
        XCTAssertNil(GameTouch.at(x: 10, y: 360, width: 400, height: 480, platform: "3ds"))
        XCTAssertEqual(GameTouch.at(x: 200, y: 360, width: 400, height: 480, platform: "3ds"), GameTouch(x: 160, y: 120))
        XCTAssertNil(GameTouch.at(x: 0, y: 0, width: 0, height: 0, platform: "nds"))
    }
    func testControllerAxesAndButtonsRespectConsoleCapabilities() {
        let state = GameInputState(buttons: ["a", "x", "zl", "l3"], axes: [-0.8, -0.7, 0.12, 0.6])
        let gba = state.payload(game: "firered", platform: "gba")
        XCTAssertEqual(Set(gba["buttons"].array.map(\.string)), ["a", "up", "left"])
        XCTAssertTrue(gba["axes"].isNull)
        XCTAssertTrue(gba["touch"].isNull)
        let three = state.payload(game: "x", platform: "3ds")
        XCTAssertEqual(Set(three["buttons"].array.map(\.string)), ["a", "x", "zl", "ls-up", "ls-left", "rs-down"])
        let sw = state.payload(game: "sword", platform: "switch")
        XCTAssertEqual(sw["axes"].array.map(\.double), [-0.8, -0.7, 0, 0.6])
        XCTAssertTrue(sw["touch"].isNull)
        XCTAssertFalse(GameInputState(axes: [.nan, .infinity, 0.1, 0]).isActive)
    }
    func testKeyboardAddsConsoleButtonsWithoutStealingFocusEscape() {
        var input = GameKeyboard(platform: "switch")
        XCTAssertEqual(input.update(keyCode: 13, pressed: true), ["ls-up"])
        XCTAssertEqual(Set(input.update(keyCode: 34, pressed: true)!), ["ls-up", "rs-up"])
        XCTAssertTrue(input.update(keyCode: 8, pressed: true)!.contains("x"))
        XCTAssertNil(input.update(keyCode: 53, pressed: true))
    }
}
