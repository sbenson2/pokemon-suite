import XCTest

func navigateToSuitePage(_ app: XCUIApplication, _ title: String, file: StaticString = #filePath, line: UInt = #line) {
    let menu = app.buttons["Game menu"].firstMatch
    XCTAssertTrue(menu.waitForExistence(timeout: 40), app.debugDescription, file: file, line: line)
    menu.tap()
    let destination = app.buttons[title].firstMatch
    XCTAssertTrue(destination.waitForExistence(timeout: 5), file: file, line: line)
    destination.tap()
}

final class NavigationMenuUITests: XCTestCase {
    func testPokeballMenuReachesEveryPageAndReturnsToLiveFrames() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        let menu = app.buttons["Game menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 40), app.debugDescription)
        capture("Before opening navigation")
        menu.tap()
        XCTAssertTrue(app.buttons["Hunting"].firstMatch.waitForExistence(timeout: 5), "Every destination must be available from the logo menu")
        app.buttons["Hunting"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Preview Hunt"].firstMatch.waitForExistence(timeout: 15))
        navigate(app, to: "Bot Settings")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Bot configuration'")).firstMatch.waitForExistence(timeout: 10))
        navigate(app, to: "Games")
        XCTAssertTrue(app.switches["In my library"].firstMatch.waitForExistence(timeout: 10))
        navigate(app, to: "Trading")
        XCTAssertTrue(app.buttons["Shiny"].firstMatch.waitForExistence(timeout: 15))
        navigate(app, to: "Pokédex")
        XCTAssertTrue(app.searchFields["Search Pokémon"].firstMatch.waitForExistence(timeout: 15))
        navigate(app, to: "Live game")
        let screen = app.descendants(matching: .any).matching(identifier: "live-screen").firstMatch
        XCTAssertTrue(screen.waitForExistence(timeout: 10))
        let frames = screen.value as? String
        let advancing = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (screen.value as? String) != frames }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [advancing], timeout: 15), .completed)
        XCTAssertFalse(app.otherElements["suite-dock"].exists)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertTrue(app.buttons["session-detail-toggle"].firstMatch.isHittable)
        XCTAssertGreaterThanOrEqual(menu.frame.height, 44)
        capture("Logo navigation and full dashboard")
    }
    func testSharedCenteredHeaderKeepsNavigationActivityAndSearchReachable() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        let menu = app.buttons["Game menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 40))
        let wordmark = app.otherElements["suite-wordmark"]
        let activity = app.buttons["Network and trades"].firstMatch
        for page in ["Live game", "Games", "Trading", "Pokédex", "Hunting", "Bot Settings"] {
            navigateToSuitePage(app, page)
            XCTAssertTrue(activity.waitForExistence(timeout: 5), "Network stays available from every page")
            XCTAssertTrue(menu.isHittable && activity.isHittable)
            XCTAssertEqual(wordmark.frame.midX, app.frame.midX, accuracy: 1, "The wordmark stays centered")
            XCTAssertLessThanOrEqual(menu.frame.maxX, wordmark.frame.minX)
            XCTAssertGreaterThanOrEqual(activity.frame.minX, wordmark.frame.maxX)
            XCTAssertGreaterThanOrEqual(menu.frame.height, 44)
            if page == "Games" || page == "Pokédex" || page == "Trading" {
                let field = app.searchFields[page == "Games" ? "Find a game" : "Search Pokémon"].firstMatch
                XCTAssertTrue(field.waitForExistence(timeout: 10))
                XCTAssertTrue(field.isHittable, "Search stays available below the shared header")
                field.tap()
                field.typeText(page == "Games" ? "FireRed" : "Bulbasaur")
                XCTAssertEqual(field.value as? String, page == "Games" ? "FireRed" : "Bulbasaur")
                app.keyboards.buttons["Search"].firstMatch.tap()
                XCTAssertTrue(menu.isHittable)
            }
            capture("Shared header — " + page)
        }
        activity.tap()
        XCTAssertTrue(app.navigationBars["Network and trades"].waitForExistence(timeout: 10))
        app.buttons["Done"].firstMatch.tap()
        navigateToSuitePage(app, "Live game")
    }
    private func navigate(_ app: XCUIApplication, to title: String) {
        let menu = app.buttons["Game menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "Navigation remains available on every page")
        menu.tap()
        let destination = app.buttons[title].firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout: 5))
        destination.tap()
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
