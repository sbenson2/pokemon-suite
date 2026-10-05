import XCTest
@testable import SuiteCore

/// Build 126 story requests: "play the story" continues the save's own campaign, and a brand-new
/// save answers task-only requests with suggestions and no Run.
@MainActor final class StoryRequestTests: XCTestCase {
    /// The interpreter's no-save reply (pokemon_requests, BLANK_SUGGESTIONS).
    private let noSave = #"{"ok":true,"understood":true,"confidence":1.0,"summary":"Travel to Cinnabar Island","answer":"There’s no save yet, so the bot can’t do that. Say “play the story” to start it from New Game.","message":"There’s no save yet, so the bot can’t do that. Say “play the story” to start it from New Game.","clarification":null,"preview":[],"suggestions":["play the story","start a new game as nova with squirtle","get me a shiny Mewtwo"],"draftId":"d1"}"#

    func testANoSaveReplyIsAnsweredWithSuggestionsAndNoRun() async throws {
        let suite = FakeSuite(); suite.replies = [.success(fixture(noSave))]
        let flow = BotRequestFlow(client: "mac", transport: suite.transport) { "k" }
        await flow.submit("go to cinnabar", via: .ui)
        guard case .answered(let draft) = flow.stage else { return XCTFail("expected an answer, got \(flow.stage)") }
        XCTAssertFalse(draft.runnable)
        XCTAssertNil(flow.confirmLabel, "no Run or Confirm for a reply that can't run")
        XCTAssertEqual(draft.suggestions, ["play the story", "start a new game as nova with squirtle", "get me a shiny Mewtwo"])
        XCTAssertTrue(flow.resultLine.hasPrefix("There’s no save yet"))
    }

    func testAContinuedStoryIsNotLabelledANewGame() {
        let continued = fixture(#"{"id":"g1","status":"running","source":{"text":"play the story"},"steps":[{"kind":"campaign","settings":{"starter":"random","afterCampaign":"postgame"},"continue":true}],"progress":{"step":0,"steps":1,"kind":"campaign","phase":"campaign","detail":"Continuing this save’s story campaign."},"execution":{"plan":null}}"#)
        XCTAssertEqual(SuiteGoal(goal: continued)?.continuesStory, true)
        XCTAssertEqual(SuiteGoal(goal: continued)?.kindLabel, "Story")
        let fresh = fixture(#"{"id":"g2","status":"queued","source":{"text":"start a new game"},"steps":[{"kind":"campaign","settings":{"starter":"squirtle"}}],"progress":{"step":0,"steps":1,"kind":"campaign"}}"#)
        XCTAssertEqual(SuiteGoal(goal: fresh)?.kindLabel, "New game")
        let brief = fixture(#"{"id":"g1","status":"running","text":"play the story","step":0,"steps":1,"kind":"campaign","phase":"campaign","detail":"Continuing this save’s story campaign."}"#)
        XCTAssertEqual(SuiteGoal(brief: brief)?.kindLabel, "Story")
        let unknown = fixture(#"{"id":"g3","status":"running","text":"x","kind":"campaign"}"#)
        XCTAssertEqual(SuiteGoal(brief: unknown)?.kindLabel, "Story", "without steps the label stays neutral")
    }
}
