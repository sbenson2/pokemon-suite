import XCTest
@testable import SuiteCore

final class PartyMemberPresentationTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self,from:Data(text.utf8)) }
    func testMissingHealthAndExperienceStayUnknown() {
        let p = PartyMemberPresentation(member:.null,index:0)
        XCTAssertNil(p.hp); XCTAssertNil(p.maxHP); XCTAssertNil(p.hpRatio)
        XCTAssertNil(p.experienceRatio); XCTAssertNil(p.status); XCTAssertFalse(p.active)
    }
    func testFaintedAndPoisonedAreDistinctFromHealthy() throws {
        let fainted = PartyMemberPresentation(member:try json(#"{"speciesName":"Haunter","hp":0,"maxHp":108,"status":"PSN"}"#),index:2)
        XCTAssertEqual(fainted.status,"Fainted"); XCTAssertEqual(fainted.hpRatio,0)
        let poison = PartyMemberPresentation(member:try json(#"{"hp":{"current":35,"max":74},"status":"PSN"}"#),index:0)
        XCTAssertEqual(poison.status,"Poisoned"); XCTAssertEqual(try XCTUnwrap(poison.hpRatio),35.0/74.0,accuracy:0.001)
    }
    func testLeadIsNotNecessarilyTheActiveBattler() throws {
        let mon = try json(#"{"slot":0,"lead":true,"speciesId":102,"speciesName":"Exeggcute","hp":35,"maxHp":74}"#)
        let battle = try json(#"{"slot":3,"speciesId":131,"hp":175,"maxHp":182}"#)
        let p = PartyMemberPresentation(member:mon,index:0,battler:battle)
        XCTAssertFalse(p.active); XCTAssertEqual(p.hp,35)
    }
    func testOnlyVerifiedMatchingBattlerOverridesPartyHP() throws {
        let mon = try json(#"{"slot":3,"speciesId":131,"speciesName":"Lapras","hp":182,"maxHp":182}"#)
        let battle = try json(#"{"slot":3,"speciesId":131,"hp":175,"maxHp":182,"status":"PAR"}"#)
        let p = PartyMemberPresentation(member:mon,index:3,battler:battle)
        XCTAssertTrue(p.active); XCTAssertEqual(p.hp,175); XCTAssertEqual(p.status,"Paralyzed")
        let wrong = PartyMemberPresentation(member:mon,index:3,battler:try json(#"{"slot":3,"speciesId":94,"hp":1,"maxHp":20}"#))
        XCTAssertFalse(wrong.active); XCTAssertEqual(wrong.hp,182)
    }
    func testMalformedValuesDoNotBecomeHealthyPokemon() throws {
        let p = PartyMemberPresentation(member:try json(#"{"level":0,"hp":-2,"maxHp":0,"experience":{"ratio":3,"remaining":-5},"gender":"unknown"}"#),index:0)
        XCTAssertNil(p.hpRatio); XCTAssertNil(p.level); XCTAssertNil(p.experienceRatio)
        XCTAssertNil(p.experienceRemaining); XCTAssertNil(p.gender)
    }
    func testRealNicknameAndExperienceArePreserved() throws {
        let p = PartyMemberPresentation(member:try json(#"{"nickname":"Clover","speciesName":"Bulbasaur","speciesId":1,"level":7,"shiny":true,"experience":{"ratio":0.5,"remaining":80},"heldItem":13,"gender":"female"}"#),index:4)
        XCTAssertEqual(p.name,"Clover"); XCTAssertEqual(p.speciesName,"Bulbasaur")
        XCTAssertEqual(p.experienceRemaining,80); XCTAssertEqual(p.gender,"♀"); XCTAssertTrue(p.shiny)
        XCTAssertEqual(p.slot,4); XCTAssertEqual(p.heldItem,13)
    }
}
