import XCTest

final class CompanionUITests:XCTestCase {
    func testIPadPokedexAdaptsWithoutLosingSelection() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication(); app.launch()
        navigateToSuitePage(app,"Pokédex")
        let bulbasaur = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Bulbasaur'")).firstMatch
        XCTAssertTrue(bulbasaur.waitForExistence(timeout: 20)); bulbasaur.tap()
        // A smaller iPad uses a sheet; a 13-inch iPad can fit inline details
        // even in portrait. Both must keep the selected Pokémon and action visible.
        XCTAssertTrue(app.buttons["Set Up Hunt"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        let portraitUsesSheet = app.buttons["Done"].firstMatch.exists
        XCTAssertTrue(app.buttons["Set Up Hunt"].firstMatch.isHittable)
        capture(app, "Portrait Pokédex detail")
        if portraitUsesSheet { app.buttons["Done"].firstMatch.tap() }
        XCUIDevice.shared.orientation = .landscapeLeft
        capture(app, "Pokédex after rotation")
        XCTAssertTrue(app.buttons["Set Up Hunt"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["Done"].firstMatch.exists)
        bulbasaur.tap()
        capture(app, "Landscape Pokédex split")
        XCUIDevice.shared.orientation = .portrait
        if portraitUsesSheet { XCTAssertTrue(app.buttons["Done"].firstMatch.waitForExistence(timeout: 10)) }
        XCTAssertTrue(app.buttons["Set Up Hunt"].firstMatch.isHittable)
        XCTAssertTrue(app.staticTexts["Bulbasaur"].firstMatch.exists)
        if portraitUsesSheet { app.buttons["Done"].firstMatch.tap() }
    }

    func testLibraryFastScrollingAndSearchWithoutStartingGames() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        navigateToSuitePage(app,"Games")
        let library = app.scrollViews.firstMatch
        XCTAssertTrue(library.waitForExistence(timeout: 20), app.debugDescription)
        let options = XCTMeasureOptions(); options.iterationCount = 2
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(), XCTMemoryMetric()], options: options) {
            for _ in 0..<8 { library.swipeUp(velocity: .fast) }
            capture(app, "Cartridges after fast scroll")
            for _ in 0..<8 { library.swipeDown(velocity: .fast) }
        }
        capture(app, "Revisited cartridges")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap(); search.typeText("FireRed")
        XCTAssertTrue(app.staticTexts["Pokémon FireRed"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        capture(app, "Filtered FireRed cartridge")
    }
    func testIPadCollectionAndFarmingWithoutStartingTasks() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication(); app.launch()
        navigateToSuitePage(app,"Trading")
        XCTAssertTrue(app.buttons["All"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["All"].firstMatch.tap()
        let pokemon = app.buttons.matching(NSPredicate(format: "label CONTAINS ', level '")).firstMatch
        XCTAssertTrue(pokemon.waitForExistence(timeout: 30), app.debugDescription)
        pokemon.tap()
        XCTAssertTrue(app.buttons["Prepare Trade"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Prepare Trade"].firstMatch.isHittable)
        capture(app, "Portrait collection detail")
        if app.buttons["Done"].firstMatch.exists { app.buttons["Done"].firstMatch.tap() }
        navigateToSuitePage(app,"Hunting")
        let queue = app.buttons["Plan and Queue"].firstMatch
        XCTAssertTrue(app.buttons["Preview Hunt"].firstMatch.waitForExistence(timeout: 15))
        if queue.exists {
            XCTAssertTrue(queue.isHittable); queue.tap()
            XCTAssertTrue(app.buttons["Done"].firstMatch.waitForExistence(timeout: 10))
            capture(app, "Portrait hunt activity")
            app.buttons["Done"].firstMatch.tap()
        } else { capture(app, "Portrait farming split") }
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["Preview Hunt"].firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        let inline = NSPredicate { _,_ in !app.buttons["Plan and Queue"].firstMatch.exists }
        expectation(for: inline, evaluatedWith: app); waitForExpectations(timeout: 10)
        capture(app, "Landscape farming")
    }
    func testMirrorsMacAndReconnectsAfterBackground() {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        let screen=app.descendants(matching:.any).matching(identifier:"live-screen").firstMatch
        XCTAssertTrue(screen.waitForExistence(timeout:40),app.debugDescription)
        let frame=NSPredicate{_,_ in (Int((screen.value as? String ?? "0").filter(\.isNumber)) ?? 0)>0}
        expectation(for:frame,evaluatedWith:screen);waitForExpectations(timeout:30)
        capture(app,"Mirrored Mac game")
        let before = Int((screen.value as? String ?? "0").filter(\.isNumber)) ?? 0
        XCUIDevice.shared.press(.home);app.activate()
        XCTAssertTrue(screen.waitForExistence(timeout:20),app.debugDescription)
        let resumed=NSPredicate{_,_ in (Int((screen.value as? String ?? "0").filter(\.isNumber)) ?? 0)>before}
        expectation(for:resumed,evaluatedWith:screen);waitForExpectations(timeout:30)
        navigateToSuitePage(app,"Bot Settings")
        XCTAssertTrue(app.staticTexts["storyProgress"].firstMatch.waitForExistence(timeout:20) || app.buttons["Start Task"].exists,app.debugDescription)
        capture(app,"Shared bot settings")
    }
    func testRealMacLibraryAndCollectionWithoutStartingTasks() {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        XCTAssertTrue(app.buttons["Game menu"].firstMatch.waitForExistence(timeout:40),app.debugDescription)
        navigateToSuitePage(app,"Games")
        XCTAssertTrue(app.staticTexts["Game Boy Advance"].firstMatch.waitForExistence(timeout:40) || app.staticTexts["Game Boy"].firstMatch.exists,app.debugDescription)
        capture(app,"Games")
        navigateToSuitePage(app,"Trading")
        let shiny=app.buttons["Shiny"].firstMatch
        XCTAssertTrue(shiny.waitForExistence(timeout:30),app.debugDescription);shiny.tap()
        let loaded=NSPredicate{_,_ in app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'Shiny '")).count>0}
        expectation(for:loaded,evaluatedWith:app);waitForExpectations(timeout:40)
        capture(app,"Shiny collection")
        app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'Shiny '")).firstMatch.tap()
        XCTAssertTrue(app.buttons["Prepare Trade"].waitForExistence(timeout:15),app.debugDescription)
        capture(app,"Pokémon details")
        if app.buttons["Done"].firstMatch.exists { app.buttons["Done"].firstMatch.tap() }
        navigateToSuitePage(app,"Live game")
        XCTAssertTrue(app.buttons["Game menu"].firstMatch.waitForExistence(timeout:20),app.debugDescription)
        let screen=app.descendants(matching:.any).matching(identifier:"live-screen").firstMatch
        capture(app,"Live game before frame check")
        let frame=NSPredicate{_,_ in (Int((screen.value as? String ?? "0").filter(\.isNumber)) ?? 0)>0}
        expectation(for:frame,evaluatedWith:screen);waitForExpectations(timeout:30)
        capture(app,"Live game")
        navigateToSuitePage(app,"Bot Settings")
        XCTAssertTrue(app.staticTexts["storyProgress"].firstMatch.waitForExistence(timeout:20) || app.buttons["Start Task"].exists,app.debugDescription)
        capture(app,"Bot settings")
        navigateToSuitePage(app,"Pokédex")
        let bulbasaur=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Bulbasaur'")).firstMatch
        XCTAssertTrue(bulbasaur.waitForExistence(timeout:20),app.debugDescription);bulbasaur.tap()
        XCTAssertTrue(app.buttons["Set Up Hunt"].waitForExistence(timeout:10));capture(app,"Pokédex")
        app.buttons["Set Up Hunt"].tap()
        capture(app,"Farming")
        app.buttons["Game menu"].firstMatch.tap();app.buttons["Appearance"].firstMatch.tap();app.buttons["Dark"].firstMatch.tap()
        app.buttons["Hunting"].firstMatch.tap()
        capture(app,"Farming dark")
        app.buttons["Game menu"].firstMatch.tap();app.buttons["Appearance"].firstMatch.tap();app.buttons["System"].firstMatch.tap()
        app.buttons["Hunting"].firstMatch.tap()
    }
    private func capture(_ app:XCUIApplication,_ name:String){let a=XCTAttachment(screenshot:XCUIScreen.main.screenshot());a.name=name;a.lifetime = .keepAlways;add(a)}
}
