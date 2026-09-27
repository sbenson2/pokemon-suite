import XCTest

final class LocalGameUITests: XCTestCase {
    func testLocalAdventureStartsPausesAndResumes() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Manual play"].waitForExistence(timeout: 30), app.debugDescription)
        app.buttons["Bot"].firstMatch.tap()
        let choose = app.buttons["Choose team"]
        if choose.exists {
            let loaded = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: choose)
            XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 30), .completed, app.debugDescription)
            choose.tap()
        }
        let start = app.buttons["Start bot"]
        XCTAssertTrue(start.waitForExistence(timeout: 20), app.debugDescription)
        let initial = Int((start.value as? String ?? "0").split(separator: " ").first ?? "0") ?? 0
        start.tap()
        let pause = app.buttons["Pause and save"]
        XCTAssertTrue(pause.waitForExistence(timeout: 20), app.debugDescription)
        let progressed = NSPredicate { _, _ in (Int((pause.value as? String ?? "0").split(separator: " ").first ?? "0") ?? 0) > initial + 2 }
        expectation(for: progressed, evaluatedWith: pause)
        waitForExpectations(timeout: 30)
        pause.tap()
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        let previous = start.value as? String
        app.terminate(); app.launch()
        app.buttons["Bot"].firstMatch.tap()
        XCTAssertTrue(start.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertEqual(start.value as? String, previous)
        start.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        app.buttons["Play"].firstMatch.tap()
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Standalone FireRed"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["Pause and save"].tap()
    }
}
