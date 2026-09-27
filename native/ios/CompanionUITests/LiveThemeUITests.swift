import XCTest

final class LiveThemeUITests:XCTestCase {
    func testSessionStatusAndDetailsRemainReachableWithAccessibilityText() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication()
        app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch();navigateToSuitePage(app,"Live game")
        let dashboard=app.scrollViews["live-dashboard"]
        let session=app.otherElements["live-session-stats"]
        let status=session.descendants(matching:.any).matching(identifier:"session-status").firstMatch
        let toggle=session.buttons["session-detail-toggle"]
        for _ in 0..<10 { if toggle.isHittable { break };dashboard.swipeUp(velocity:.slow) }
        XCTAssertTrue(toggle.isHittable,"Session controls must remain reachable at the largest text size")
        XCTAssertTrue(status.exists)
        XCTAssertGreaterThanOrEqual(toggle.frame.minY,status.frame.maxY-1,"The activity heading must not overlap status")
        toggle.tap()
        let facts=session.scrollViews["session-detail-facts"]
        XCTAssertTrue(facts.exists)
        XCTAssertGreaterThanOrEqual(facts.frame.minY,toggle.frame.maxY-1)
        XCTAssertGreaterThanOrEqual(facts.frame.height,100,"Details retain a usable scrolling region")
        capture("Accessible Session status and details")
        toggle.tap()
        XCTAssertEqual(toggle.value as? String,"Collapsed")
    }
    func testSessionStatusRemainsVisibleWhenDetailsAreExpanded() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launch();navigateToSuitePage(app,"Live game")
        let session=app.otherElements["live-session-stats"]
        let status=session.descendants(matching:.any).matching(identifier:"session-status").firstMatch
        XCTAssertTrue(status.waitForExistence(timeout:10),"Session must distinguish working, waiting, recovery and review in text")
        XCTAssertFalse(session.buttons["session-status"].exists,"The status is information, not another control")
        let bounds=session.frame
        XCTAssertGreaterThanOrEqual(status.frame.minY,bounds.minY)
        XCTAssertLessThanOrEqual(status.frame.maxX,bounds.maxX+1)
        session.buttons["session-detail-toggle"].tap()
        XCTAssertTrue(status.isHittable,"Opening details must not hide a warning")
        XCTAssertTrue(session.scrollViews["session-detail-facts"].exists)
        capture("Session status and expanded details")
        session.buttons["session-detail-toggle"].tap()
        XCTAssertTrue(status.isHittable)
    }
    func testTrainerAndLocationExpandInsideTheirCards() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"];app.launch()
        navigateToSuitePage(app,"Live game")
        let screen=app.descendants(matching:.any).matching(identifier:"live-screen").firstMatch
        let screenFrame=screen.frame
        for (cardID,toggleID,factsID) in [("trainer-panel","trainer-detail-toggle","trainer-detail-facts"),("live-location-map","location-detail-toggle","location-detail-facts")] {
            let card=app.otherElements[cardID],toggle=app.buttons[toggleID]
            XCTAssertTrue(toggle.waitForExistence(timeout:10))
            let bounds=card.frame
            toggle.tap()
            let facts=app.scrollViews[factsID]
            XCTAssertTrue(facts.waitForExistence(timeout:5))
            XCTAssertGreaterThanOrEqual(facts.frame.minY,bounds.minY)
            XCTAssertLessThanOrEqual(facts.frame.maxY,bounds.maxY)
            facts.swipeUp()
            XCTAssertTrue(toggle.isHittable)
            XCTAssertEqual(card.frame.height,bounds.height,accuracy:1)
            XCTAssertEqual(screen.frame,screenFrame)
            capture("Inline " + cardID)
            toggle.tap()
            XCTAssertFalse(facts.exists)
        }
    }
    func testPokeballMenuAndNetworkDrawer() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launch();navigateToSuitePage(app,"Live game")
        let menu=app.buttons["Game menu"].firstMatch
        let logo=app.otherElements["suite-wordmark"]
        let network=app.buttons["Network and trades"]
        XCTAssertTrue(network.waitForExistence(timeout:5))
        XCTAssertLessThan(menu.frame.maxX,logo.frame.minX)
        XCTAssertGreaterThan(network.frame.minX,logo.frame.maxX)
        XCTAssertEqual(logo.frame.midX,app.frame.midX,accuracy:1)
        XCTAssertFalse(app.buttons["Settings"].exists)
        XCTAssertTrue((menu.value as? String)?.contains("Closed") == true)
        menu.tap()
        XCTAssertTrue(app.buttons["Hunting"].firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue((menu.value as? String)?.contains("Open") == true)
        capture("Open Poké Ball menu")
        XCTAssertFalse(app.buttons["Settings"].exists)
        app.buttons["Live game"].firstMatch.tap()
        XCTAssertTrue((menu.value as? String)?.contains("Closed") == true)
        network.tap()
        XCTAssertTrue(app.navigationBars["Network and trades"].waitForExistence(timeout:5))
        XCTAssertTrue(app.staticTexts["Mac connection"].exists)
        XCTAssertTrue(app.staticTexts["Trade network"].exists)
        capture("Network drawer")
        app.buttons["Done"].tap()
        XCTAssertTrue(menu.isHittable)
    }
    func testExpandedPokemonShowsReadableMovesAndIndividualDetails() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"];app.launch()
        navigateToSuitePage(app,"Live game")
        XCTAssertTrue(app.buttons["party-slot-0"].waitForExistence(timeout:15));app.buttons["party-slot-0"].tap()
        let details=app.otherElements["party-inline-details"]
        XCTAssertTrue(details.waitForExistence(timeout:5))
        let firstMove=details.descendants(matching:.any).matching(identifier:"party-move-0").firstMatch
        XCTAssertTrue(firstMove.waitForExistence(timeout:15),"Show the Pokémon's actual saved moves")
        XCTAssertTrue(details.descendants(matching:.any).matching(identifier:"party-fact-ability").firstMatch.exists)
        XCTAssertTrue(details.descendants(matching:.any).matching(identifier:"party-fact-sex").firstMatch.exists)
        let facts=app.scrollViews["party-detail-facts"]
        for _ in 0..<12 {
            if firstMove.frame.minY >= facts.frame.minY && firstMove.frame.maxY <= facts.frame.maxY {break}
            let up=firstMove.frame.maxY > facts.frame.maxY
            let overflow=up ? firstMove.frame.maxY-facts.frame.maxY:facts.frame.minY-firstMove.frame.minY
            // Clear UIKit's pan threshold even for a nearly visible final row.
            let distance=min(max(overflow+2,20),facts.frame.height*0.45)
            let start=facts.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:up ? 0.75:0.25))
            start.press(forDuration:0.1,thenDragTo:start.withOffset(CGVector(dx:0,dy:up ? -distance:distance)),withVelocity:.slow,thenHoldForDuration:0.2)
        }
        XCTAssertTrue(firstMove.isHittable)
        XCTAssertGreaterThanOrEqual(firstMove.frame.minY,facts.frame.minY-1)
        XCTAssertLessThanOrEqual(firstMove.frame.maxY,facts.frame.maxY+1)
        XCTAssertTrue(app.buttons["party-detail-toggle"].isHittable)
        XCTAssertTrue(app.buttons["session-detail-toggle"].isHittable)
        capture("Expanded Pokémon moves")
        app.buttons["party-detail-toggle"].tap()
        XCTAssertTrue(app.buttons["party-slot-0"].waitForExistence(timeout:5))
    }
    func testPokemonDetailsStayInsideTeamAndToggleBack() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"];app.launch()
        navigateToSuitePage(app,"Live game")
        let screen=app.descendants(matching:.any).matching(identifier:"live-screen").firstMatch
        XCTAssertTrue(app.buttons["party-slot-0"].waitForExistence(timeout:15))
        let screenFrame=screen.frame
        let team=app.otherElements["team-panel"]
        let teamFrame=team.frame
        for index in [0,5,2] {
            app.buttons["party-slot-\(index)"].tap()
            let details=app.otherElements["party-inline-details"]
            XCTAssertTrue(details.waitForExistence(timeout:5),"Pokémon details must replace only the Team grid")
            XCTAssertGreaterThanOrEqual(details.frame.minY,team.frame.minY-1)
            XCTAssertLessThanOrEqual(details.frame.maxY,team.frame.maxY+1)
            XCTAssertEqual(team.frame.minY,teamFrame.minY,accuracy:1)
            XCTAssertEqual(team.frame.height,teamFrame.height,accuracy:1)
            XCTAssertEqual(screen.frame.minY,screenFrame.minY,accuracy:1)
            XCTAssertEqual(screen.frame.height,screenFrame.height,accuracy:1)
            XCTAssertTrue(app.buttons["session-detail-toggle"].isHittable)
            XCTAssertFalse(app.buttons["party-slot-0"].exists,"The hidden team grid must not remain accessible")
            if index==0 {
                let frames=(screen.value as? String) ?? ""
                let delivered=XCTNSPredicateExpectation(predicate:NSPredicate {_,_ in (screen.value as? String) != frames},object:nil)
                XCTAssertEqual(XCTWaiter.wait(for:[delivered],timeout:10),.completed,"The game must keep receiving frames with Pokémon details open")
            }
            capture("Inline Pokémon \(index+1)")
            app.buttons["party-detail-toggle"].tap()
            XCTAssertTrue(app.buttons["party-slot-\(index)"].waitForExistence(timeout:5))
            XCTAssertFalse(details.exists)
        }
    }
    func testMapAndSessionDetailsStayInsideTheirCards() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"];app.launch()
        navigateToSuitePage(app,"Live game")
        let map=app.otherElements["live-location-map"],session=app.otherElements["live-session-stats"]
        XCTAssertTrue(map.waitForExistence(timeout:10),app.debugDescription)
        // SwiftUI also propagates the child's identifier to the surrounding
        // button. Inspect the map itself, whose value describes the marker.
        let artwork=map.otherElements["rom-town-map"].firstMatch
        XCTAssertTrue(artwork.waitForExistence(timeout:15),"The Town Map must load from the owning ROM")
        XCTAssertTrue(((artwork.value as? String) ?? "").contains("trainer"),"Show the observed player marker")
        app.buttons["location-detail-toggle"].tap()
        XCTAssertTrue(app.scrollViews["location-detail-facts"].waitForExistence(timeout:5))
        capture("ROM Town Map and player head");app.buttons["location-detail-toggle"].tap()
        XCTAssertTrue(session.exists)
        XCTAssertLessThan(map.frame.maxY,session.frame.minY)
        let toggle=session.buttons["session-detail-toggle"]
        XCTAssertFalse(session.buttons["Manual Play"].exists)
        XCTAssertFalse(session.buttons["Telemetry"].exists)
        XCTAssertFalse(session.staticTexts["Running"].exists)
        XCTAssertTrue(toggle.isHittable)
        XCTAssertGreaterThanOrEqual(toggle.frame.height+0.0001,44)
        XCTAssertFalse(session.buttons["Stop Game"].exists)
        let original=session.frame
        toggle.tap()
        XCTAssertEqual(toggle.value as? String,"Expanded")
        let facts=session.scrollViews["session-detail-facts"]
        XCTAssertTrue(facts.exists)
        XCTAssertGreaterThanOrEqual(facts.frame.minY,original.minY)
        XCTAssertLessThanOrEqual(facts.frame.maxY,original.maxY)
        facts.swipeUp()
        XCTAssertEqual(session.frame.height,original.height,accuracy:1)
        XCTAssertTrue(toggle.isHittable)
        capture("Inline session details")
        toggle.tap()
        XCTAssertEqual(toggle.value as? String,"Collapsed")
        XCTAssertTrue(session.staticTexts["Location"].isHittable,"Returning to summary resets the card's scroll position")
        capture("Location map and session")
    }
    func testLogoMenuKeepsHuntingAndBotSettingsReachable() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication();app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"];app.launch()
        navigateToSuitePage(app,"Hunting")
        XCTAssertTrue(app.buttons["Plan and Queue"].firstMatch.waitForExistence(timeout:10),app.debugDescription)
        navigateToSuitePage(app,"Bot Settings")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'Bot configuration'")).firstMatch.waitForExistence(timeout:10),app.debugDescription)
        navigateToSuitePage(app,"Live game")
    }
    func testReferenceCompositionShowsFullTeamAndActivityWithoutScrolling() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication()
        app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"]
        app.launch()
        navigateToSuitePage(app,"Live game")
        let scroll=app.scrollViews["live-dashboard"]
        XCTAssertTrue(scroll.waitForExistence(timeout:15))
        XCTAssertFalse(app.otherElements["suite-dock"].exists)
        let bottom=app.frame.maxY
        capture("Reference composition")
        for index in 0..<6 {
            let member=app.buttons["party-slot-\(index)"]
            XCTAssertTrue(member.isHittable,"All six team members should be visible without scrolling")
            XCTAssertGreaterThanOrEqual(member.frame.minY,scroll.frame.minY)
            XCTAssertLessThanOrEqual(member.frame.maxY,bottom)
        }
        let stop=app.buttons["session-detail-toggle"].firstMatch
        XCTAssertTrue(stop.isHittable,"Session details stay visible beside the full team")
        XCTAssertLessThanOrEqual(stop.frame.maxY,bottom)
    }
    func testPartyDetailsAndActivityWithoutChangingGame() {
        continueAfterFailure=false
        XCUIDevice.shared.orientation = .portrait
        let app=XCUIApplication()
        app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryL"]
        app.launch()
        navigateToSuitePage(app,"Live game")
        let scroll=app.scrollViews["live-dashboard"]
        XCTAssertTrue(scroll.waitForExistence(timeout:15),app.debugDescription)
        let last=app.buttons["party-slot-5"]
        for _ in 0..<10 {if last.isHittable{break};scroll.swipeUp()}
        XCTAssertTrue(last.isHittable,app.debugDescription)
        last.tap()
        XCTAssertTrue(app.otherElements["party-inline-details"].waitForExistence(timeout:5),app.debugDescription)
        app.buttons["party-detail-toggle"].tap()
        app.buttons["session-detail-toggle"].tap()
        XCTAssertTrue(app.scrollViews["session-detail-facts"].waitForExistence(timeout:5),app.debugDescription)
        capture("Activity details");app.buttons["session-detail-toggle"].tap()
        for _ in 0..<10{scroll.swipeDown(velocity:.fast)}
        // Live location/checkpoint copy can grow. Find the controls within the
        // bounded dashboard instead of assuming a fixed position above the fold.
        for _ in 0..<8 {if app.buttons["session-detail-toggle"].firstMatch.isHittable{break};scroll.swipeUp(velocity:.slow)}
        XCTAssertTrue(app.buttons["session-detail-toggle"].firstMatch.isHittable,app.debugDescription)
        XCTAssertFalse(scroll.buttons["Bot Settings"].exists,app.debugDescription)
        capture("FireRed dashboard")
    }
    private func capture(_ name:String){let shot=XCTAttachment(screenshot:XCUIScreen.main.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot)}
}
