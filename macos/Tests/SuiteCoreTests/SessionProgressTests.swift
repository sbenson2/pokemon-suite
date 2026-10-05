import XCTest
@testable import SuiteCore

/// A brand-new save offers New run on the Live page instead of "Choose a task in Bot settings".
final class SessionProgressTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    /// The fresh-user run (W4, 2026-10-04): Add FireRed, Start game, then this session.
    func testFreshUsersFirstSessionIsBrandNew() throws {
        let session = try json(#"{"sessionId":"5f0","state":"ready","newProfile":true,"campaign":null,"observation":{"mode":"boot","party":[]},"bot":{"enabled":true,"status":"ready","reason":"Ready for commands. Choose a task in Bot settings.","awaitingCommand":true},"spectator":{"trainer":{"name":"RED","pokedex":{"owned":0,"seen":0}},"badges":[{"earned":false}],"party":[]}}"#)
        XCTAssertTrue(SessionProgress.isBrandNewSave(session))
        var started = session; started["campaign"] = .object(["id": .string("run-1")])
        XCTAssertFalse(SessionProgress.isBrandNewSave(started), "a running campaign is not offered another run")
    }

    func testAPlayedSaveIsNotBrandNew() throws {
        let played = try json(#"{"sessionId":"a","state":"running","campaign":null,"bot":{"enabled":true},"spectator":{"trainer":{"pokedex":{"owned":177}},"badges":[{"earned":true}],"party":[{"species":22}]}}"#)
        XCTAssertFalse(SessionProgress.isBrandNewSave(played))
        XCTAssertFalse(SessionProgress.isBrandNewSave(try json(#"{"state":"offline","newProfile":true}"#)), "no session, nothing to offer")
    }
}
