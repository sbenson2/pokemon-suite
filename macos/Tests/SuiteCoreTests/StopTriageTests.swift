import XCTest
@testable import SuiteCore

/// L1.1 "Why it stopped": decoding the host's session triage and the card's one-tap state.
final class StopTriageTests: XCTestCase {
    func testDecodesTheRareCandyStop() throws {
        let t = try XCTUnwrap(StopTriage(session: session(triage: rareCandy)))
        XCTAssertEqual(t.bucket, "known-bug-family")
        XCTAssertEqual(t.bucketLabel, "Known bug")
        XCTAssertEqual(t.family, "party-menu-move-prompt")
        XCTAssertEqual(t.title, "Move-learning prompt in the party menu")
        XCTAssertEqual(t.fixedIn, 108)
        XCTAssertEqual(t.evidence.count, 2)
        XCTAssertEqual(t.suggestion.action, "none")
        XCTAssertFalse(t.suggestion.canTap)
        XCTAssertEqual(t.suggestion.why, "Install engine build 108 or later; its installer restarts the task.")
    }

    func testSafeChecklistRestartCanBeTapped() throws {
        let t = try XCTUnwrap(StopTriage(session: session(triage: stepZero)))
        XCTAssertTrue(t.suggestion.canTap)
        XCTAssertEqual(t.suggestion.playerTask, "postgame")
        XCTAssertEqual(t.suggestion.token, "abc123")
        XCTAssertEqual(t.suggestion.label, "Restart the postgame checklist")
        XCTAssertTrue(t.suggestion.effect?.contains("Nothing was changed") == true)
    }

    func testAnythingLessThanAProvenSafeSuggestionIsNotTappable() throws {
        let changes: [(String, JSONValue)] = [("safe", .bool(false)), ("token", .string("")), ("playerTask", .string("retry-hunt")), ("label", .null), ("confirm", .null)]
        for (key, replacement) in changes {
            var s = session(triage: stepZero)
            s["triage"]["suggestedAction"][key] = replacement
            let t = try XCTUnwrap(StopTriage(session: s), key)
            XCTAssertFalse(t.suggestion.canTap, key)
        }
    }

    func testNoTriageWithoutAStopOrWithAnUnknownSchema() {
        XCTAssertNil(StopTriage(session: value(#"{"sessionId":"s","state":"running"}"#)))
        XCTAssertNil(StopTriage(session: session(triage: #"{"schema":"other/v9","bucket":"needs-owner","title":"x","explanation":"y","suggestedAction":{"action":"none","safe":false,"why":"z"}}"#)))
        XCTAssertNil(StopTriage(session: session(triage: #"{"schema":"pokemon-suite/stop-triage/v1","bucket":"needs-owner"}"#)))
    }

    func testPresentationCarriesTheTriageOfAStoppedOwner() {
        let p = ActivityPresentation(session: session(triage: rareCandy), now: Date(timeIntervalSince1970: 1002))
        XCTAssertEqual(p.triage?.family, "party-menu-move-prompt")
        XCTAssertTrue(p.needsAttention)
        let running = ActivityPresentation(session: value(#"{"sessionId":"s","state":"running","bot":{"enabled":true}}"#), now: Date(timeIntervalSince1970: 1002))
        XCTAssertNil(running.triage)
    }

    private let rareCandy = #"{"schema":"pokemon-suite/stop-triage/v1","bucket":"known-bug-family","family":"party-menu-move-prompt","title":"Move-learning prompt in the party menu","explanation":"The game is showing a move-learning question in the party menu.","fixedIn":108,"regression":false,"evidence":["Screen: party (CB2_UpdatePartyMenu)","901 recent decisions: \"Current task list is exhausted\""],"suggestedAction":{"action":"none","safe":false,"why":"Install engine build 108 or later; its installer restarts the task."}}"#
    private let stepZero = #"{"schema":"pokemon-suite/stop-triage/v1","bucket":"known-bug-family","family":"evolution-step-source-lookup","title":"Held-item evolution route stopped at its first step","explanation":"An evolution route stopped at its first step.","fixedIn":103,"evidence":["Stop: The source Pokémon is missing, duplicated, or evolved outside the expected step."],"suggestedAction":{"action":"postgame-checklist","safe":true,"why":"Nothing was changed at the stopped step.","label":"Restart the postgame checklist","confirm":"Restarts the postgame checklist from this save. Nothing was changed at the stopped step.","playerTask":"postgame","token":"abc123"}}"#
    private func value(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private func session(triage: String) -> JSONValue {
        value(#"{"sessionId":"s","state":"blocked","updatedAt":"1970-01-01T00:16:40Z","bot":{"enabled":true,"status":"blocked","runScope":"postgame","reason":"Recovery could not finish the transition."},"decision":{"kind":"blocked"},"triage":"# + triage + "}")
    }
}
