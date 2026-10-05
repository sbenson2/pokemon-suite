import XCTest
@testable import SuiteCore

/// The Bank: its "Get it" configurator sends exactly the selections that
/// tests/test_bank.py proves produce the same goal as the typed phrase, through
/// the same request flow as Ask.
@MainActor final class BankTests: XCTestCase {
    private static let natureOrder = ["hardy", "lonely", "brave", "adamant", "naughty", "bold", "docile", "relaxed", "impish", "lax", "timid", "hasty",
                                      "serious", "jolly", "naive", "modest", "mild", "quiet", "bashful", "rash", "calm", "gentle", "sassy", "careful", "quirky"]

    private func parityCases() throws -> [String: JSONValue] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../tests/data/bank-parity.json").standardized
        let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))["cases"].array
        return Dictionary(uniqueKeysWithValues: cases.map { ($0["id"].string, $0) })
    }

    private func draft(_ species: Int, _ configure: (inout BankDraft) -> Void) -> BankDraft {
        var value = BankDraft(speciesId: species); configure(&value); return value
    }

    func testTheConfiguratorSendsTheParitySelections() throws {
        let cases = try parityCases()
        let order = Self.natureOrder
        let drafts: [String: BankDraft] = [
            // Abra + shiny + Timid == "get me a shiny timid abra"
            "shiny-timid-abra": draft(63) { $0.shiny = true; $0.toggleNature("timid", order: order) },
            "hidden-power": draft(63) { $0.shiny = true; $0.toggleNature("modest", order: order); $0.setMinimumIV("specialAttack", 25); $0.hiddenPower = "ice" },
            "iv-range": draft(63) { $0.shiny = true; $0.setMinimumIV("speed", 31); $0.setMaximumIV("attack", 5) },
            "iv-between": draft(63) { $0.shiny = true; $0.setMinimumIV("speed", 20); $0.setMaximumIV("speed", 31) },
            "iv-range-quantity": draft(63) { $0.setMinimumIV("speed", 10); $0.setMaximumIV("speed", 20); $0.quantity = 2 },
            "quantity": draft(63) { $0.toggleNature("adamant", order: order); $0.quantity = 3 },
            "natures-ability": draft(63) { $0.toggleNature("modest", order: order); $0.toggleNature("timid", order: order); $0.abilityId = 39; $0.quantity = 2 },
            "gender": draft(133) { $0.shiny = true; $0.gender = "female" },
            "send-to-switch": draft(63) { $0.shiny = true; $0.toggleNature("timid", order: order); $0.destination = "switch" },
            "legendary-to-switch": draft(150) { $0.shiny = true; $0.destination = "switch" },
            "switch-several": draft(63) { $0.shiny = true; $0.destination = "switch"; $0.quantity = 3 },
            "switch-not-shiny": draft(63) { $0.toggleNature("timid", order: order); $0.destination = "switch" },
            // The configurator would not offer this (see testTheSwitchTakesUpToNine); the host refuses it with Ask's message.
            "switch-too-many": draft(63) { $0.destination = "switch"; $0.quantity = 10 },
        ]
        XCTAssertEqual(Set(drafts.keys), Set(cases.keys), "every parity case has its configurator settings")
        for (id, value) in drafts {
            XCTAssertEqual(value.selection, cases[id]?["selection"], id)
        }
    }

    func testIVRangesStayValidAndDefaultsAreLeftOut() {
        var value = BankDraft(speciesId: 63)
        value.setMaximumIV("speed", 10)
        value.setMinimumIV("speed", 20)
        XCTAssertEqual([value.minimumIV("speed"), value.maximumIV("speed")], [20, 20], "raising the minimum raises the maximum")
        value.setMaximumIV("speed", 5)
        XCTAssertEqual([value.minimumIV("speed"), value.maximumIV("speed")], [5, 5])
        value.setMinimumIV("speed", 0); value.setMaximumIV("speed", 31)
        XCTAssertEqual(value.selection["minIvs"], .object([:]))
        XCTAssertEqual(value.selection["maxIvs"], .object([:]), "0–31 is no requirement")
        value.setMinimumIV("hp", 40)
        XCTAssertEqual(value.minimumIV("hp"), 31)
    }

    func testTheSwitchTakesUpToNine() {
        var value = BankDraft(speciesId: 63)
        XCTAssertTrue(value.canSendToSwitch, "shiny or not")
        value.destination = "switch"; value.quantity = 9; value.keepDestinationValid()
        XCTAssertEqual(value.destination, "switch", "the catch plus nine trades fill a goal")
        value.quantity = 10; value.keepDestinationValid()
        XCTAssertFalse(value.canSendToSwitch)
        XCTAssertEqual(value.destination, "save")
        XCTAssertEqual(BankDraft.genders(rate: -1), ["genderless"])
        XCTAssertEqual(BankDraft.genders(rate: 0), ["male"])
        XCTAssertEqual(BankDraft.genders(rate: 8), ["female"])
        XCTAssertEqual(BankDraft.genders(rate: 4), ["male", "female"])
    }

    func testThePlanShowsItsSearchLimits() {
        let goal = fixture(#"{"steps":[{"kind":"farming","request":{"quantity":3,"limits":{"maxMinutes":240,"maxEncounters":1000}}},{"kind":"trade"}]}"#)
        let line = BankDraft.budget(goal: goal)
        XCTAssertEqual(line?.hasPrefix("Search limit: 4 hours or "), true, line ?? "")
        XCTAssertEqual(line?.hasSuffix(" encounters for each Pokémon, whichever comes first."), true)
        XCTAssertEqual(BankDraft.budget(goal: fixture(#"{"steps":[{"kind":"farming","request":{"quantity":1,"limits":{"maxMinutes":60,"maxEncounters":500}}}]}"#)),
                       "Search limit: 60 minutes or 500 encounters, whichever comes first.")
        XCTAssertNil(BankDraft.budget(goal: .null))
    }

    func testTheSpeciesListFiltersByTheBankOverview() {
        let species = fixture(#"[{"id":63,"name":"Abra","types":["psychic"],"encounters":[{"location":"Road 24"}]},{"id":151,"name":"Mew","types":["psychic"],"encounters":[]},{"id":150,"name":"Mewtwo","types":["psychic"],"encounters":[{"location":"Cerulean Cave"}]}]"#).array
        let bank = BankIndex.species(fixture(#"{"species":[{"id":63,"owned":3,"shiny":1,"saves":2,"route":{"label":"Wild","obtainable":true}},{"id":151,"owned":0,"shiny":0,"route":{"label":"External","obtainable":false}},{"id":150,"owned":1,"shiny":0,"saves":1,"route":{"label":"Static encounter","obtainable":true}}]}"#))
        var filter = PokedexFilter()
        let ids = { filter.apply(to: species, bank: bank).map { $0["id"].int } }
        XCTAssertEqual(ids(), [63, 150, 151])
        filter.ownership = "owned"; XCTAssertEqual(ids(), [63, 150])
        filter.ownership = "shiny"; XCTAssertEqual(ids(), [63])
        filter.ownership = "missing"; XCTAssertEqual(ids(), [151])
        filter.ownership = "all"; filter.availability = "obtainable"; XCTAssertEqual(ids(), [63, 150])
        filter.availability = "external"; XCTAssertEqual(ids(), [151])
        filter.availability = "all"; filter.query = "static"; XCTAssertEqual(ids(), [150], "the route is searchable")
        XCTAssertEqual(BankIndex.ownership(bank[63]!), "3 owned · 1 shiny · in 2 saves")
        XCTAssertEqual(BankIndex.ownership(bank[150]!), "1 owned")
        XCTAssertNil(BankIndex.ownership(bank[151]!))
        let mon = fixture(#"{"location":{"kind":"box","box":2,"slot":4},"ivs":{"hp":31,"attack":30,"defense":29,"spAttack":27,"spDefense":26,"speed":28}}"#)
        XCTAssertEqual(BankIndex.location(mon), "Box 3, slot 5")
        XCTAssertEqual(BankIndex.ivs(mon), "31/30/29/27/26/28")
    }

    func testCopiesInSeveralSavesAreOneIndividual() {
        let owned = fixture(#"{"pokemon":[{"fingerprint":"a","sourceId":"current","slotId":"box:0:1","saveLabel":"Current game","isActiveSave":true,"location":{"kind":"box","box":0,"slot":1}},{"fingerprint":"b","sourceId":"nova","slotId":"party:0","saveLabel":"Nova’s postgame","isActiveSave":false,"location":{"kind":"party","slot":0}},{"fingerprint":"a","sourceId":"nova","slotId":"box:3:2","saveLabel":"Nova’s postgame","isActiveSave":false,"location":{"kind":"box","box":3,"slot":2}},{"fingerprint":"b","sourceId":"rio","slotId":"party:1","saveLabel":"Rio’s run","isActiveSave":false,"location":{"kind":"party","slot":1}}]}"#)
        let rows = BankIndex.individuals(owned)
        XCTAssertEqual(rows.map { $0["sourceId"].string }, ["current", "nova"], "one row each, the active save's copy first")
        XCTAssertEqual(rows[0]["alsoIn"], .array([.string("Nova’s postgame · Box 4, slot 3")]))
        XCTAssertEqual(BankIndex.whereHeld(rows[0]), "Current game · Box 1, slot 2 · also in 1 other save")
        XCTAssertEqual(BankIndex.whereHeld(rows[1]), "Nova’s postgame · Party 1 · also in 1 other save")
    }

    func testGetItUsesTheRequestFlowWithTheSelection() async throws {
        let suite = FakeSuite()
        let flow = BotRequestFlow(client: "mac-bank", transport: suite.transport) { "mac-bank-key-1" }
        var value = BankDraft(speciesId: 113); value.shiny = true
        var question = fixture(BotRequestFixtures.clarify)
        question["clarification"] = fixture(#"{"id":"0:ball","slot":"ball","clause":0,"question":"Chansey is only found in the Safari Zone, where only Safari Balls work. Use Safari Balls?","choices":[{"id":"safari-ball","label":"Use Safari Balls"},{"id":"any","label":"Any suitable ball"}],"freeText":false}"#)
        suite.replies = [.success(question), .success(fixture(BotRequestFixtures.mewtwo)), .success(fixture(BotRequestFixtures.trade_commit)), .success(fixture(BotRequestFixtures.goalsListRunning))]
        await flow.select(value.selection)
        XCTAssertEqual(suite.calls.last?.path, "/api/pokemon-suite/requests/select")
        XCTAssertEqual(suite.calls.last?.body, .object(["selection": value.selection, "answers": .object([:])]))
        guard case .clarifying(let draft) = flow.stage, let choice = draft.clarification?.choices.first else { return XCTFail("\(flow.stage)") }
        await flow.choose(choice)
        XCTAssertEqual(suite.calls.last?.path, "/api/pokemon-suite/requests/select")
        XCTAssertEqual(suite.calls.last?.body?["answers"], .object(["0:ball": .string("safari-ball")]), "the answer goes with the same selection")
        XCTAssertEqual(suite.calls.last?.body?["selection"], value.selection)
        XCTAssertEqual(flow.confirmLabel, "Run")
        await flow.commit()
        XCTAssertEqual(suite.calls[2].path, "/api/pokemon-suite/requests/commit")
        XCTAssertEqual(suite.calls[2].body?["idempotencyKey"], .string("mac-bank-key-1"))
        guard case .committed = flow.stage else { return XCTFail("\(flow.stage)") }
        suite.replies = [.success(fixture(BotRequestFixtures.mewtwo))]
        await flow.submit("get me a shiny mewtwo", via: .typed)
        XCTAssertEqual(suite.calls.last?.path, "/api/pokemon-suite/requests/interpret", "a typed request after the Bank is words again")
        XCTAssertNil(flow.selection)
    }
}
