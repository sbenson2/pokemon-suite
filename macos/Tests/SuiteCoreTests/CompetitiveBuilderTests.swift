import XCTest
@testable import SuiteCore

final class CompetitiveBuilderTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    func testRequestFromAnInventoryRecord() throws {
        let pokemon = try json(#"{"id":"\#(String(repeating: "a", count: 64))","nationalSpeciesId":6,"fingerprint":"[6,1,2,3,4,5,6,7,8]"}"#)
        let request = CompetitiveBuilderRequest(pokemon: pokemon)
        XCTAssertEqual(request.speciesID, 6)
        XCTAssertEqual(request.pokemonID, String(repeating: "a", count: 64))
        XCTAssertEqual(request.sourceID, "current")
        XCTAssertNil(CompetitiveBuilderRequest(speciesID: 25, pokemonID: "").pokemonID)
        XCTAssertNotEqual(request.id, CompetitiveBuilderRequest(speciesID: 6).id)
    }

    func testTargetFromGuidanceRoundTripsToTheHostShape() throws {
        let target = try json(#"{"speciesId":6,"nature":"timid","abilitySlot":null,"ivs":{"speed":{"min":20,"max":31}},"hiddenPower":{"type":"grass"},"evs":{"hp":4,"attack":0,"defense":0,"speed":252,"spAttack":252,"spDefense":0},"moves":[126,237,337,92],"heldItem":141,"level":100,"shiny":"any"}"#)
        let draft = BuilderTarget(target: target, speciesID: 6)
        XCTAssertEqual(draft.nature, "timid")
        XCTAssertEqual(draft.evTotal, 508)
        XCTAssertEqual(draft.moves, [126, 237, 337, 92])
        XCTAssertEqual(draft.hiddenPowerType, "grass")
        XCTAssertEqual(draft.minIvs["speed"], 20)
        XCTAssertNil(draft.validation)
        let body = draft.json
        XCTAssertEqual(body["speciesId"].int, 6)
        XCTAssertEqual(body["evs"]["spAttack"].int, 252)
        XCTAssertEqual(body["hiddenPower"]["type"].string, "grass")
        XCTAssertEqual(body["ivs"]["speed"]["min"].int, 20)
        XCTAssertEqual(body["ivs"]["speed"]["max"].int, 31)
        XCTAssertEqual(body["shiny"].string, "any")
        XCTAssertTrue(body["abilitySlot"].isNull)
    }

    func testTargetValidation() {
        var draft = BuilderTarget(speciesID: 6)
        XCTAssertNil(draft.validation)
        draft.evs = ["hp": 255, "attack": 255, "defense": 4, "speed": 0, "spAttack": 0, "spDefense": 0]
        XCTAssertNotNil(draft.validation)
        draft = BuilderTarget(speciesID: 6)
        draft.moves = [1, 1]
        XCTAssertNotNil(draft.validation)
        draft = BuilderTarget(speciesID: 6)
        draft.minIvs["attack"] = 20; draft.maxIvs["attack"] = 10
        XCTAssertNotNil(draft.validation)
    }

    func testEndpointsAndBodies() throws {
        let request = CompetitiveBuilderRequest(speciesID: 6, pokemonID: String(repeating: "b", count: 64), sourceID: "saved id")
        XCTAssertEqual(BuilderAPI.guidancePath(speciesID: 6), "/api/pokemon-suite/builder/guidance?species=6")
        XCTAssertEqual(BuilderAPI.individualPath(game: "firered", source: "current", pokemonID: "abc"),
                       "/api/pokemon-suite/builder/individual?game=firered&source=current&pokemon=abc")
        XCTAssertTrue(BuilderAPI.legalityPath(game: "firered", source: "saved id").hasSuffix("source=saved%20id"))
        let plan = BuilderAPI.planBody(game: "firered", request: request, target: BuilderTarget(speciesID: 6))
        XCTAssertEqual(Set(plan.object.keys), ["game", "sourceId", "pokemonId", "target"])
        XCTAssertEqual(plan["sourceId"].string, "saved id")
        let commit = BuilderAPI.commitBody(goal: .object(["schema": .string("pokemon-suite/goal/v1")]), key: "builder-test-key")
        XCTAssertEqual(commit["idempotencyKey"].string, "builder-test-key")
        XCTAssertTrue(BuilderAPI.commitBody(goal: .null)["idempotencyKey"].string.hasPrefix("builder-"))
    }

    func testOnlyExecutablePlayerTaskStepsCanStart() throws {
        let runnable = try json(#"{"executable":true,"action":{"method":"POST","path":"/api/pokemon-suite/player-tasks","body":{"game":"firered","action":"start","task":{"kind":"ev-training","fingerprint":"[1,2,3,4,5,6,7,8,9]","evs":{},"ivRanges":{}}}}}"#)
        XCTAssertEqual(BuilderAPI.playerTask(step: runnable)?["kind"].string, "ev-training")
        let manual = try json(#"{"executable":false,"manual":"Do it in the game."}"#)
        XCTAssertNil(BuilderAPI.playerTask(step: manual))
    }

    func testPresentation() throws {
        XCTAssertEqual(BuilderPresentation.verdictSymbol("legal"), "checkmark.seal")
        XCTAssertEqual(BuilderPresentation.verdictSymbol("illegal"), "xmark.octagon")
        XCTAssertEqual(BuilderPresentation.severityLabel("fishy"), "Suspicious")
        XCTAssertEqual(BuilderPresentation.statLabel("spAttack"), "Sp. Atk")
        let evs = try json(#"{"hp":1,"attack":2,"defense":3,"speed":4,"spAttack":5,"spDefense":6}"#)
        XCTAssertEqual(BuilderPresentation.traitValue(evs), "HP 1 · Attack 2 · Defense 3 · Speed 4 · Sp. Atk 5 · Sp. Def 6")
        let met = try json(#"{"level":3,"location":"Route 22","game":"FireRed","ball":"Poké Ball","encounter":"wild"}"#)
        XCTAssertEqual(BuilderPresentation.traitValue(met), "Route 22 · Lv. 3 · FireRed · Poké Ball")
        let evolutions = try json(#"[{"id":6,"name":"Charizard","how":"Level 36"}]"#)
        XCTAssertEqual(BuilderPresentation.traitValue(evolutions), "Charizard (Level 36)")
    }
}
