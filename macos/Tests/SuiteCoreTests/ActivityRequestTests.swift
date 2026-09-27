import XCTest
@testable import SuiteCore

/// The owner's request (a G2 goal from `session.goals`) in the Activity outline.
final class ActivityRequestTests: XCTestCase {
    private func session(goals: String?) -> JSONValue {
        var s = fixture(#"{"sessionId":"live","state":"running","updatedAt":"1970-01-01T00:16:40Z","mode":"overworld","bot":{"enabled":true,"status":"running","runScope":"task"},"spectator":{"map":{"name":"Cerulean Cave"}}}"#)
        if let goals { s["goals"] = fixture(goals) }
        return s
    }
    private func outline(_ s: JSONValue) -> ActivityOutline { ActivityPresentation(session: s, now: Date(timeIntervalSince1970: 1002)).outline }

    func testActiveGoalShowsItsStepPhaseAndDetail() throws {
        let request = try XCTUnwrap(outline(session(goals: BotRequestFixtures.goalsSummaryQueued)).request)
        XCTAssertEqual(request.title, "“get me a shiny Mewtwo”")
        XCTAssertEqual(request.detail, "Hunting Mewtwo: hunting, 0 encounters.")
        XCTAssertEqual(request.notes, ["Running · Hunting", "1 more request queued"])
        XCTAssertNil(request.meter)
    }

    func testMultiStepGoalNamesTheCurrentStep() throws {
        let goals = #"{"active":{"id":"g1","status":"running","text":"heal then go to cinnabar and save","step":1,"steps":3,"kind":"player-task","phase":"task","detail":"Travelling to Cinnabar Island.","question":null,"result":null},"queued":2,"decisions":[],"last":null}"#
        let request = try XCTUnwrap(outline(session(goals: goals)).request)
        XCTAssertEqual(request.notes, ["Running · Step 2 of 3 · Running a task", "2 more requests queued"])
    }

    func testGoalWaitingForTheOwnerShowsTheQuestion() throws {
        let request = try XCTUnwrap(outline(session(goals: BotRequestFixtures.goalsSummaryDecision)).request)
        XCTAssertEqual(request.title, "“get me a shiny Mewtwo”")
        XCTAssertTrue(request.detail?.hasPrefix("Mewtwo’s one-time encounter is already used in this save.") == true)
        XCTAssertEqual(request.notes, ["Waiting · Needs your decision"])
    }

    func testNoOpenGoalAddsNothing() {
        XCTAssertNil(outline(session(goals: nil)).request)
        XCTAssertNil(outline(session(goals: #"{"active":null,"queued":0,"decisions":[],"last":{"id":"g0","status":"done","text":"heal","phase":"done"}}"#)).request,
                     "a finished request is history, not current activity")
    }
}
