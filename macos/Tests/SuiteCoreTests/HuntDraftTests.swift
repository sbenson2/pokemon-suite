import XCTest
@testable import SuiteCore

final class HuntDraftTests: XCTestCase {
    func testZeroMaximumIVSurvivesDraftReloadWithoutAddingGen3TraitsToCrystal() throws {
        let input = try json(#"{"minIvs":{"hp":31},"maxIvs":{"attack":0}}"#)
        let draft = HuntDraft(request: input)
        XCTAssertEqual(draft.request(game: "firered", speciesID: 113, generation: 3)["maxIvs"]["attack"], .number(0))
        XCTAssertTrue(draft.request(game: "crystal", speciesID: 113, generation: 2)["maxIvs"].isNull)
    }
    func json(_ value: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(value.utf8)) }

    func testAllAcceptableSavedNaturesReachTheHunt() throws {
        let draft = HuntDraft(defaults: try json(#"{"natures":["jolly","adamant"]}"#))
        XCTAssertEqual(draft.request(game: "firered", speciesID: 246, generation: 3)["natures"], .array([.string("jolly"), .string("adamant")]))
    }

    func testNewHuntUsesSavedRequirementsInItsSubmittedRequest() throws {
        let defaults = try json(#"{"shiny":"required","natures":["jolly"],"gender":"female","ball":{"id":"ultra-ball","requirement":"required"},"minIvs":{"attack":28,"speed":31},"limits":{"maxMinutes":12,"maxEncounters":200,"minBalls":25,"maxSpend":10000},"afterCompletion":"prepare-trade"}"#)
        let draft = HuntDraft(defaults: defaults)
        let request = draft.request(game: "firered", speciesID: 197, generation: 3)
        XCTAssertEqual(request["shiny"].string, "required")
        XCTAssertEqual(request["natures"], .array([.string("jolly")]))
        XCTAssertEqual(request["ball"], try json(#"{"id":"ultra-ball","requirement":"required"}"#))
        XCTAssertEqual(request["minIvs"]["speed"].int, 31)
        XCTAssertEqual(request["limits"]["maxMinutes"].int, 12)
        XCTAssertEqual(request["afterCompletion"].string, "prepare-trade")
        XCTAssertEqual(request["speciesId"].int, 197)
    }

    func testDraftSurvivesNavigationAndReopeningItsLibraryWithoutNewDefaultsOverwritingIt() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("drafts.json")
        let store = try HuntDraftStore(url: file)
        var draft = store.load(game: "firered", speciesID: 197, defaults: .null)
        draft.shiny = false; draft.nickname = "MOON"; draft.nature = "timid"; draft.moveIDs = [28, 98]
        try store.save(draft, game: "firered", speciesID: 197, generation: 3)
        let reopened = try HuntDraftStore(url: file)
        let restored = reopened.load(game: "firered", speciesID: 197, defaults: try json(#"{"shiny":"required","natures":["jolly"]}"#))
        XCTAssertFalse(restored.shiny)
        XCTAssertEqual(restored.nickname, "MOON")
        XCTAssertEqual(restored.nature, "timid")
        XCTAssertEqual(restored.moveIDs, [28, 98])
    }

    func testChangingGameOrSpeciesDoesNotReuseAnotherTargetsBallItemsOrLevels() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try HuntDraftStore(url: folder.appendingPathComponent("drafts.json"))
        var draft = HuntDraft(defaults: .null)
        draft.ball = "ultra-ball"; draft.heldItem = 201; draft.finalLevel = 55
        try store.save(draft, game: "firered", speciesID: 197, generation: 3)
        for (game, species) in [("emerald", 197), ("firered", 133)] {
            let other = store.load(game: game, speciesID: species, defaults: .null)
            XCTAssertEqual(other.ball, "any")
            XCTAssertEqual(other.heldItem, 0)
            XCTAssertEqual(other.finalLevel, 0)
        }
    }

    func testSavedRequestCanBeReviewedWithoutLosingAdvancedRequirements() throws {
        let request = try json(#"{"game":"firered","speciesId":197,"shiny":"required","quantity":2,"locationId":"gift-eevee","natures":["careful"],"gender":"male","nickname":"MOON","abilityId":28,"ball":{"id":"poke-ball","requirement":"required"},"minIvs":{"hp":25},"minDvs":{},"encounterLevel":{"min":20,"max":30},"finalLevel":40,"moves":[28,98],"heldItemId":201,"limits":{"maxMinutes":90,"maxEncounters":3000,"minBalls":20,"maxSpend":9999},"afterCompletion":"prepare-trade"}"#)
        let draft = HuntDraft(request: request)
        let restored = draft.request(game: "firered", speciesID: 197, generation: 3)
        for key in ["shiny","quantity","locationId","natures","gender","nickname","abilityId","ball","minIvs","minDvs","encounterLevel","finalLevel","moves","heldItemId","limits","afterCompletion"] {
            XCTAssertEqual(restored[key], request[key], key)
        }
    }

    func testCrystalRequirementsUseDVsWithoutSendingThirdGenerationTraits() throws {
        let draft = HuntDraft(defaults: try json(#"{"shiny":"required","natures":["jolly"],"minIvs":{"speed":31},"minDvs":{"attack":10,"special":10},"gender":"any"}"#))
        let request = draft.request(game: "crystal", speciesID: 133, generation: 2)
        XCTAssertEqual(request["natures"].array, [])
        XCTAssertEqual(request["minIvs"].object, [:])
        XCTAssertEqual(request["minDvs"]["attack"].int, 10)
        XCTAssertTrue(request["abilityId"].isNull)
    }
}
