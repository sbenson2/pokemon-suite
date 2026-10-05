import XCTest
@testable import SuiteCore

/// Other saves' rows (GET /api/pokemon-suite/extra-saves): build 125 rows map actions from status and
/// helper.saveId; build 126 rows name them in `start`. One mapping serves both.
final class ExtraSavePlanTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    /// The live 125.1 response (2026-10-04): two of its five rows.
    func testBuild125RowsMapNewHelperSavesAndLeavePartnerSetupWithoutAProfile() throws {
        let plan = ExtraSavePlan(try json(#"{"ok":true,"schema":"pokemon-suite/extra-save-progress/v1","rows":[{"needId":"starter-charmander","label":"Charmander line","species":[4,5,6],"route":"Charmander line: Borrow Charizard from FireRed clean campaign engine 53, breed a Charmander Egg with the main save's Ditto at the Four Island Day Care, then return it.","save":"FireRed clean campaign engine 53","mode":"borrow and return","status":"needs-partner-owner","doing":"Waiting to set up FireRed clean campaign engine 53 as a trade partner.","eta":"unknown","runtime":"short"},{"needId":"fossil-dome","label":"Kabuto line","species":[140,141],"route":"Kabuto line: a helper FireRed save takes the Dome Fossil.","save":"Helper save 1 (Dome Fossil)","mode":"keep","status":"needs-helper-save","doing":"Waiting for a new helper FireRed save.","eta":"unknown","runtime":"medium","helper":{"saveId":"helper-1","settings":{"fossil":"dome","afterCampaign":"wait"},"goal":{"kind":"fossil","fossil":"dome"}}}],"partners":[{"owner":"firered-partner","lending":null,"grants":0}]}"#))
        XCTAssertEqual(plan.rows.map(\.id), ["starter-charmander", "fossil-dome"])
        XCTAssertNil(plan.rows[0].action, "125 rows carry no profile, so partner setup has no safe action")
        XCTAssertEqual(plan.rows[0].statusLabel, "Needs setup")
        let helper = try XCTUnwrap(plan.rows[1].action)
        XCTAssertEqual(helper.path, "/api/pokemon-suite/extra-saves/start-helper")
        XCTAssertEqual(helper.body, .object(["saveId": .string("helper-1")]))
        XCTAssertEqual(helper.title, "Start Helper Save")
        XCTAssertEqual(plan.rows[1].species, [140, 141])
        XCTAssertEqual(plan.partners, [ExtraSavePlan.Partner(owner: "firered-partner", lending: nil, grants: 0)])
    }

    /// Build 126 rows (helper-tasks design): `start` names the action and its body.
    func testBuild126StartFieldsMapToTheirRoutes() throws {
        let rows = try json(#"[{"needId":"hitmon","label":"Hitmonlee, Hitmonchan, Tyrogue and Hitmontop","species":[106,107,236,237],"status":"needs-helper-task","doing":"FIRE must first take its Fighting Dojo prize.","save":"FIRE","mode":"keep","source":{"kind":"profile","profileId":"08b8c4c8-5802-4f2f-9aa1-5521fa723563","label":"FIRE"},"task":{"kind":"dojo-prize","speciesId":107},"start":{"action":"start-helper","needId":"hitmon"}},{"needId":"starter-charmander","label":"Charmander line","species":[4,5,6],"status":"needs-park","save":"FIRE","mode":"borrow and return","source":{"kind":"profile","profileId":"08b8c4c8-5802-4f2f-9aa1-5521fa723563","label":"FIRE"},"start":{"action":"seed-partner","profileId":"08b8c4c8-5802-4f2f-9aa1-5521fa723563"}},{"needId":"fossil-dome","label":"Kabuto line","species":[140,141],"status":"needs-helper-save","start":{"action":"start-helper","saveId":"helper-1"},"helper":{"saveId":"helper-1"}},{"needId":"roamer-raikou","label":"Raikou","species":[243],"status":"planned-long","source":{"kind":"profile","profileId":"f11f3c5c","label":"engine 50"},"task":{"kind":"roamer-capture","speciesId":243},"start":{"action":"start-helper","needId":"roamer-raikou"}}]"#)
        let plan = ExtraSavePlan(rows)
        XCTAssertEqual(plan.rows.count, 4, "the session's bare extraSaves array decodes too")
        let dojo = try XCTUnwrap(plan.rows[0].action)
        XCTAssertEqual(dojo.body, .object(["needId": .string("hitmon")]))
        XCTAssertEqual(dojo.title, "Take the Dojo Prize")
        XCTAssertTrue(dojo.effect.contains("never written"))
        let park = try XCTUnwrap(plan.rows[1].action)
        XCTAssertEqual(park.path, "/api/pokemon-suite/extra-saves/seed-partner")
        XCTAssertEqual(park.body, .object(["profileId": .string("08b8c4c8-5802-4f2f-9aa1-5521fa723563")]))
        XCTAssertEqual(park.title, "Prepare Trade Partner", "an unparked archive walks to a Center first")
        XCTAssertEqual(plan.rows[2].action?.body, .object(["saveId": .string("helper-1")]))
        XCTAssertEqual(plan.rows[3].action?.title, "Catch the Roaming Legendary")
        XCTAssertEqual(plan.rows[3].statusLabel, "Planned (long)")
    }

    func testOnlyExtraSaveRoutesAreAcceptedFromAHostDescriptor() throws {
        let given = try json(#"{"needId":"x","label":"X","status":"ready","action":{"title":"Do It","path":"/api/pokemon-suite/extra-saves/do-it","body":{"needId":"x"},"effect":"Does it."}}"#)
        XCTAssertEqual(ExtraSavePlan.action(for: given)?.path, "/api/pokemon-suite/extra-saves/do-it")
        let foreign = try json(#"{"needId":"x","status":"ready","action":{"title":"Stop","path":"/api/pokemon-suite/stop-game","body":{}}}"#)
        XCTAssertNil(ExtraSavePlan.action(for: foreign), "a row can never name an unrelated route")
        XCTAssertNil(ExtraSavePlan.action(for: try json(#"{"needId":"x","status":"needs-helper-save","start":{"action":"start-helper"}}"#)), "start-helper needs a saveId or needId")
        XCTAssertTrue(ExtraSavePlan(try json(#"{"rows":[{"label":"no id"}]}"#)).rows.isEmpty)
    }
}
