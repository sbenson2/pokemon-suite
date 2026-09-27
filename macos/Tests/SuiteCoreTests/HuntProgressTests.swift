import XCTest
@testable import SuiteCore

final class HuntProgressTests: XCTestCase {
    func testUnreachableStatusDoesNotCallALiveOwnerStoppedOrRunning() throws {
        for value in [#"{"state":"reconnecting"}"#, #"{"state":"reconnecting","sessionId":"live","bot":{"enabled":true}}"#] {
            XCTAssertEqual(BotRunStatus(session: try json(value)).label, "Reconnecting…")
        }
        XCTAssertEqual(BotRunStatus(session: try json(#"{"state":"closed","sessionId":"old"}"#)).label, "Game stopped")
    }
    func testBlockedCampaignDoesNotAppearToBeRunning() throws {
        let session = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"sessionId":"live","state":"blocked","bot":{"enabled":true,"status":"blocked"}}"#.utf8))
        XCTAssertEqual(BotRunStatus(session: session).label, "Needs attention")
    }
    func json(_ value: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(value.utf8)) }

    func testPausedOrStaleTelemetryDoesNotRunItsClockIndefinitely() throws {
        var session = try json(#"{"bot":{"enabled":true},"mission":{"id":"hunt","state":"running","phase":"timing-shiny","timing":{"asOf":100000,"active":true,"elapsedMs":5000,"phaseElapsedMs":2000,"stages":{"timing-shiny":2000}},"rng":{"completed":25,"total":100}}}"#)
        let active = try XCTUnwrap(HuntProgress(session: session, nowMilliseconds: 101000))
        XCTAssertEqual(active.elapsedMilliseconds, 6000)
        XCTAssertEqual(active.phaseMilliseconds, 3000)
        XCTAssertEqual(active.inputProgress, 0.25)
        session["bot"]["enabled"] = .bool(false)
        XCTAssertEqual(HuntProgress(session: session, nowMilliseconds: 105000)?.elapsedMilliseconds, 5000)
        session["bot"]["enabled"] = .bool(true)
        let stale = try XCTUnwrap(HuntProgress(session: session, nowMilliseconds: 200000))
        XCTAssertTrue(stale.stale)
        XCTAssertLessThanOrEqual(stale.elapsedMilliseconds ?? 0, 15000)
    }

    func testUnknownTimingAndCountsAreNotInventedAsZero() throws {
        let p = try XCTUnwrap(HuntProgress(session: try json(#"{"mission":{"state":"paused","phase":"capturing","protected":true}}"#), nowMilliseconds: 100000))
        XCTAssertNil(p.elapsedMilliseconds)
        XCTAssertNil(p.inputProgress)
        XCTAssertTrue(p.protected)
        XCTAssertNil(HuntProgress(session: .null, nowMilliseconds: 100000))
    }

    func testFinishedOrAlreadyRunningHuntsCannotBeStartedAgainFromTheirQueueRow() throws {
        let plan = try json(#"{"canStart":true}"#)
        for state in ["complete", "running", "queued", "preparing-evolution", "preparing"] {
            XCTAssertFalse(HuntWorkflow.canStart(plan: plan, record: .object(["state": .string(state)])))
        }
        XCTAssertTrue(HuntWorkflow.canStart(plan: plan, record: .object(["state": .string("stopped")])))
        XCTAssertFalse(HuntWorkflow.canStart(plan: plan, record: .object(["state": .string("waiting-for-evolution")])))
        XCTAssertTrue(HuntWorkflow.canStart(plan: try json(#"{"canContinue":true}"#), record: .object(["state": .string("waiting-for-evolution")])))
    }

    func testStartingAnAcquisitionStageDoesNotReportTheWholeHuntAsRunningOrComplete() throws {
        XCTAssertEqual(HuntWorkflow.startStage(try json(#"{"stage":"source"}"#)), .acquisition)
        XCTAssertEqual(HuntWorkflow.startStage(try json(#"{"stage":"evolution-preparation"}"#)), .evolution)
        XCTAssertEqual(HuntWorkflow.startStage(try json(#"{"session":{"mission":{"state":"complete"}}}"#)), .complete)
        XCTAssertEqual(BotRunStatus(session: try json(#"{"sessionId":"run","state":"running","bot":{"enabled":true,"awaitingCommand":true}}"#)), .ready)
    }
}
