import XCTest
import SuiteCore
@testable import PokemonSuiteCompanion

final class PartyDetailSnapshotTests:XCTestCase {
    private var party:[JSONValue] {[
        .object(["speciesId":.number(9),"speciesName":.string("Blastoise"),"shiny":.bool(false),"level":.number(40),"hp":.number(120),"maxHp":.number(130)]),
        .object(["speciesId":.number(93),"speciesName":.string("Haunter"),"shiny":.bool(false)])
    ]}
    private var mon:JSONValue {.object([
        "id":.string("individual-a"),"validity":.string("valid"),"nationalSpeciesId":.number(9),"shiny":.bool(false),"location":.object(["kind":.string("party"),"slot":.number(4)]),
        "personality":.number(30),"level":.number(39),"ability":.string("Torrent"),"nature":.object(["name":.string("Modest")]),
        "moves":.array([.number(57),.number(0),.number(44)]),"pp":.array([.number(0),.number(0),.number(20)]),"ppBonuses":.number(35),
        "maxHp":.number(128),"stats":.object(["attack":.number(80)]),"ivs":.object(["attack":.number(31)]),"evs":.object(["attack":.number(0)])
    ])}
    private var inventory:JSONValue {.object([
        "game":.string("firered"),"sessionId":.string("session-1"),"validity":.string("valid"),"sourceId":.string("current"),"isActiveSave":.bool(true),
        "save":.object(["ownerId":.string("run-1"),"updatedAt":.string("2026-09-14T04:00:00.000Z")]),"pokemon":.array([mon])
    ])}
    private var catalog:JSONValue {.object([
        "species":.array([.object(["id":.number(9),"genderRate":.number(1),"types":.array([.string("water")])])]),
        "moves":.array([.object(["id":.number(57),"name":.string("Surf"),"type":.string("water"),"pp":.number(15),"power":.number(95),"accuracy":.number(100)]),.object(["id":.number(44),"name":.string("Bite"),"type":.string("dark"),"pp":.number(25)])])
    ])}
    private func snapshot(_ value:JSONValue?=nil,members:[JSONValue]?=nil,expectedID:String?=nil)->PartyDetailSnapshot? {
        .init(inventory:value ?? inventory,party:members ?? party,index:0,game:"firered",sessionID:"session-1",ownerID:"run-1",expectedID:expectedID,catalog:catalog)
    }
    func testMatchesIndividualAcrossSavedSlotReorderingWithoutReplacingLiveLevel() throws {
        let p=try XCTUnwrap(snapshot())
        XCTAssertEqual(p.id,"individual-a");XCTAssertEqual(p.ability,"Torrent");XCTAssertEqual(p.nature,"Modest")
        XCTAssertEqual(p.sex,"Female");XCTAssertEqual(p.savedLevel,39)
        XCTAssertEqual(PartyMemberPresentation(member:party[0],index:0).level,40)
        XCTAssertEqual(p.moves.map(\.name),["Surf","Bite"])
        XCTAssertEqual(p.stats.first(where:{$0.key=="attack"})?.value,80)
        XCTAssertEqual(p.stats.first(where:{$0.key=="attack"})?.iv,31)
        XCTAssertEqual(p.stats.first(where:{$0.key=="attack"})?.ev,0)
    }
    func testPPUsesOriginalMoveSlotAndPPUpsAndKeepsZero() throws {
        let moves=try XCTUnwrap(snapshot()).moves
        XCTAssertEqual(moves.map(\.slot),[0,2])
        XCTAssertEqual(moves.map(\.maxPP),[24,35])
        XCTAssertEqual(moves.map(\.pp),[0,20])
    }
    func testRejectsOtherSavesSessionsGamesAndChangedIndividuals() {
        for (key,value) in [("game","emerald"),("sessionId","session-2"),("sourceId","preserved"),("validity","unknown")] {
            var changed=inventory;changed[key] = .string(value)
            XCTAssertNil(snapshot(changed),key)
        }
        var changed=inventory;changed["save"]["ownerId"] = .string("run-2")
        XCTAssertNil(snapshot(changed));XCTAssertNil(snapshot(expectedID:"different-pokemon"))
    }
    func testNeverSubstitutesBoxedOrAmbiguousPokemon() {
        var changed=inventory;var boxed=mon;boxed["location"]["kind"] = .string("box")
        changed["pokemon"] = .array([boxed]);XCTAssertNil(snapshot(changed))
        changed["pokemon"] = .array([mon,mon]);XCTAssertNil(snapshot(changed))
        XCTAssertNil(snapshot(members:[party[0],party[0]]))
        var conflict=mon;conflict["identityConflict"] = .bool(true)
        changed["pokemon"] = .array([conflict]);XCTAssertNil(snapshot(changed))
    }
    func testCurrentHuntOwnsItsSaveEvenWithRetainedCampaignHistory() {
        let session:JSONValue = .object(["campaign":.object(["id":.string("run-1")]),"mission":.object(["id":.string("hunt-2")])])
        XCTAssertEqual(PartyDetailSnapshot.ownerID(in:session),"hunt-2")
        XCTAssertEqual(PartyDetailSnapshot.ownerID(in:.object(["campaign":session["campaign"]])),"run-1")
        XCTAssertNil(PartyDetailSnapshot.ownerID(in:.object([:])))
    }
    func testGen3SexThresholdsAndUnknownData() {
        for (rate,pid,sex) in [(1,30,"Female"),(1,31,"Male"),(4,126,"Female"),(4,127,"Male"),(6,190,"Female"),(6,191,"Male"),(8,255,"Female"),(0,0,"Male"),(-1,127,"Genderless")] {
            XCTAssertEqual(PartyDetailSnapshot.sex(personality:.number(Double(pid)),rate:.number(Double(rate))),sex)
        }
        XCTAssertNil(PartyDetailSnapshot.sex(personality:.null,rate:.number(4)))
        XCTAssertNil(PartyDetailSnapshot.sex(personality:.number(-1),rate:.number(4)))
        XCTAssertNil(PartyDetailSnapshot.sex(personality:.number(31),rate:.null))
    }
    func testInvalidPPAndStatsStayUnknown() throws {
        var changed=inventory;var invalid=mon
        invalid["pp"] = .array([.number(1000)]);invalid["ivs"]["attack"] = .number(32)
        invalid["stats"]["attack"] = .number(-1);invalid["evs"]["attack"] = .number(256)
        changed["pokemon"] = .array([invalid])
        let p=try XCTUnwrap(snapshot(changed))
        XCTAssertNil(p.moves[0].pp)
        let attack=try XCTUnwrap(p.stats.first(where:{$0.key=="attack"}))
        XCTAssertNil(attack.value);XCTAssertNil(attack.iv);XCTAssertNil(attack.ev)
    }
}
