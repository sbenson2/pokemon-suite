import XCTest
import SuiteCore
@testable import PokemonSuiteCompanion

final class PartyInspectionTests:XCTestCase {
    private var party:[JSONValue] { [
        .object(["speciesId":.number(9),"speciesName":.string("Blastoise"),"level":.number(36),"hp":.number(108),"maxHp":.number(108),"heldItem":.number(0)]),
        .object(["speciesId":.number(93),"speciesName":.string("Haunter"),"level":.number(30),"hp":.number(60),"maxHp":.number(75)])
    ] }
    private func roster(_ members:[JSONValue],game:String="firered",session:String="run-1")->PartyInspection.Roster {
        .init(party:members,game:game,session:session)
    }
    func testTapSelectedMemberReturnsToTeamAndAnotherCanOpen() {
        var selection=PartyInspection();let current=roster(party)
        selection.toggle(0,in:current);XCTAssertEqual(selection.index(in:current),0)
        selection.toggle(0,in:current);XCTAssertNil(selection.index(in:current))
        selection.toggle(1,in:current);XCTAssertEqual(selection.index(in:current),1)
        selection.toggle(0,in:current);XCTAssertEqual(selection.index(in:current),0)
    }
    func testLiveHealthLevelAndItemUpdatesKeepInspectionOpen() {
        var selection=PartyInspection();selection.toggle(0,in:roster(party))
        var updated=party
        updated[0]["hp"] = .number(20);updated[0]["status"] = .string("PSN")
        updated[0]["level"] = .number(37);updated[0]["heldItem"] = .number(13)
        updated[0]["experience"] = .object(["ratio":.number(0.25),"remaining":.number(800)])
        let current=roster(updated);selection.reconcile(with:current)
        XCTAssertEqual(selection.index(in:current),0)
        let details=PartyMemberPresentation(member:updated[selection.index(in:current)!],index:0)
        XCTAssertEqual(details.hp,20);XCTAssertEqual(details.level,37)
        XCTAssertEqual(details.heldItem,13);XCTAssertEqual(details.experienceRemaining,800)
    }
    func testRosterOrSaveChangesCannotSilentlyShowAnotherPokemon() {
        var evolved=party;evolved[1]["speciesId"] = .number(94);evolved[1]["speciesName"] = .string("Gengar")
        for changed in [roster([party[0]]),roster(evolved),roster(party,game:"emerald"),roster(party,session:"run-2")] {
            var selection=PartyInspection();selection.toggle(1,in:roster(party))
            XCTAssertNil(selection.index(in:changed),"Reject changed identity before the next UI reconciliation")
            selection.reconcile(with:changed)
            XCTAssertNil(selection.index(in:roster(party)),"Returning to an old roster must not reopen dismissed details")
        }
    }
    func testReorderingKeepsTheSameDistinctPokemonOpen() {
        var selection=PartyInspection();selection.toggle(1,in:roster(party))
        let swapped=roster(Array(party.reversed()))
        XCTAssertEqual(selection.index(in:swapped),0,"Follow Haunter when battle telemetry changes its position")
        selection.reconcile(with:swapped);XCTAssertEqual(selection.index(in:swapped),0)
        let alone=roster([party[1]])
        selection.reconcile(with:alone);XCTAssertEqual(selection.index(in:alone),0)
    }
    func testAmbiguousDuplicatesCloseOnRosterChange() {
        let duplicates=roster([party[0],party[0],party[1]])
        var selection=PartyInspection();selection.toggle(0,in:duplicates)
        XCTAssertEqual(selection.index(in:duplicates),0)
        let moved=roster([party[1],party[0],party[0]])
        XCTAssertNil(selection.index(in:moved),"Telemetry cannot identify which duplicate moved")
        selection.reconcile(with:moved);XCTAssertNil(selection.index(in:duplicates))
    }
    func testEmptyAndInvalidSlotsDoNotOpenDetails() {
        for slot in [-1,2,6] {
            var selection=PartyInspection();selection.toggle(slot,in:roster(party))
            XCTAssertNil(selection.index(in:roster(party)))
        }
        var selection=PartyInspection();selection.toggle(0,in:roster([]))
        XCTAssertNil(selection.index(in:roster([])))
    }
}
