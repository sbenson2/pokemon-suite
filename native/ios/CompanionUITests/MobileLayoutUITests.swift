import XCTest

final class MobileLayoutUITests: XCTestCase {
    func testStoryCheckpointsWithoutChangingBotTasks() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication(); app.launch()
        navigateToSuitePage(app,"Bot Settings")
        let configuration = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Bot configuration'")).firstMatch
        XCTAssertTrue(configuration.waitForExistence(timeout: 10), app.debugDescription)
        if !configuration.label.contains("Story progress") {
            configuration.tap(); app.buttons["Story progress"].firstMatch.tap()
        }
        // SwiftUI propagates the enclosing story identifier to its text
        // descendants on iOS. Scope the lookup to the story scroll region.
        let current = app.scrollViews.firstMatch.staticTexts["storyProgress"].firstMatch
        XCTAssertTrue(current.waitForExistence(timeout: 20), app.debugDescription)
        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.exists)
        XCTAssertLessThanOrEqual(scroll.frame.maxY,navigationBottom(app)+1)
        let remaining = app.switches["Remaining steps only"].firstMatch
        for _ in 0..<4 { if remaining.isHittable { break }; scroll.swipeUp() }
        XCTAssertTrue(remaining.isHittable); remaining.tap()
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Story checkpoints"; shot.lifetime = .keepAlways; add(shot)
    }
    func testLiveContentUsesBoundedSpaceWithoutBottomNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        let live = app.descendants(matching: .any).matching(identifier: "live-screen").firstMatch
        XCTAssertTrue(live.waitForExistence(timeout: 40), app.debugDescription)
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            let rotated = NSPredicate { _, _ in
                orientation == .portrait ? app.frame.height > app.frame.width : app.frame.width > app.frame.height
            }
            expectation(for: rotated, evaluatedWith: app); waitForExpectations(timeout: 10)
            let scroll = app.scrollViews.firstMatch
            XCTAssertTrue(scroll.waitForExistence(timeout: 10), app.debugDescription)
            let bottom = navigationBottom(app)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = orientation == .portrait ? "Live portrait" : "Live landscape"
            shot.lifetime = .keepAlways; add(shot)
            print("LAYOUT viewport=\(app.frame) game=\(live.frame) scroll=\(scroll.frame) bottom=\(bottom)")
            XCTAssertGreaterThan(scroll.frame.height, 100, "The team needs a usable scrolling region")
            XCTAssertLessThanOrEqual(scroll.frame.maxY, bottom + 1,
                "The bounded game information area must stay inside the screen")
            XCTAssertLessThanOrEqual(live.frame.maxY, bottom + 1,
                "The game must stay inside the screen")
            XCTAssertGreaterThan(live.frame.width, 220, "The landscape game must remain useful")
            checkLastPartyMember(app, scroll: scroll, bottom: bottom)
            for _ in 0..<5 { scroll.swipeDown(velocity: .fast) }
        }
    }

    func testLiveWithAccessibilityText() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let live = app.descendants(matching: .any).matching(identifier: "live-screen").firstMatch
        XCTAssertTrue(live.waitForExistence(timeout: 40))
        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 10))
        let bottom = navigationBottom(app)
        XCTAssertGreaterThan(scroll.frame.height, 100)
        XCTAssertLessThanOrEqual(scroll.frame.maxY, bottom + 1)
        checkLastPartyMember(app, scroll: scroll, bottom: bottom)
        let gameFrame=live.frame
        app.buttons["party-slot-5"].tap()
        let back=app.buttons["party-detail-toggle"]
        XCTAssertTrue(back.waitForExistence(timeout:5))
        XCTAssertTrue(back.isHittable,"Opening the last member at large text must reveal the detail header")
        XCTAssertGreaterThanOrEqual(back.frame.minY,scroll.frame.minY-1)
        XCTAssertLessThanOrEqual(back.frame.maxY,bottom+1)
        XCTAssertEqual(live.frame.minY,gameFrame.minY,accuracy:1)
        XCTAssertEqual(live.frame.height,gameFrame.height,accuracy:1)
        back.tap()
        XCTAssertTrue(app.buttons["party-slot-0"].waitForExistence(timeout:5))
    }

    func testOtherPagesUseBoundedSpaceWithoutBottomNavigation() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication(); app.launch()
        XCTAssertTrue(app.buttons["Game menu"].firstMatch.waitForExistence(timeout: 40))
        for page in ["Games", "Trading", "Bank"] {
            navigateToSuitePage(app,page)
            let region = page == "Bank" ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
            XCTAssertTrue(region.waitForExistence(timeout: 30), app.debugDescription)
            XCTAssertLessThanOrEqual(region.frame.maxY,navigationBottom(app)+1,page)
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = page; shot.lifetime = .keepAlways; add(shot)
        }
        navigateToSuitePage(app,"Live game")
    }

    private func navigationBottom(_ app:XCUIApplication)->CGFloat {
        XCTAssertFalse(app.otherElements["suite-dock"].exists)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        return app.frame.maxY
    }

    private func checkLastPartyMember(_ app: XCUIApplication, scroll: XCUIElement, bottom: CGFloat) {
        // Stop the drag before lifting to avoid inertial overshoot. At the
        // largest text size a card nearly fills this region; repeated flings
        // can oscillate between clipping its top and clipping its bottom.
        let last = app.descendants(matching: .any).matching(identifier: "party-slot-5").firstMatch
        for _ in 0..<60 {
            if last.exists && last.frame.minY >= scroll.frame.minY && last.frame.maxY <= bottom { break }
            let up = !last.exists || last.frame.maxY > bottom
            let overflow = !last.exists ? scroll.frame.height : up ? last.frame.maxY-bottom : scroll.frame.minY-last.frame.minY
            let distance = min(max(overflow+4,12),scroll.frame.height*0.3)
            let from=scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:up ? 0.7:0.3))
            let to=from.withOffset(CGVector(dx:0,dy:up ? -distance:distance))
            from.press(forDuration:0.1,thenDragTo:to,withVelocity:.slow,thenHoldForDuration:0.2)
        }
        XCTAssertTrue(last.exists, app.debugDescription)
        XCTAssertGreaterThanOrEqual(last.frame.minY, scroll.frame.minY)
        XCTAssertLessThanOrEqual(last.frame.maxY, bottom)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "Last team member"; shot.lifetime = .keepAlways; add(shot)
    }
}
