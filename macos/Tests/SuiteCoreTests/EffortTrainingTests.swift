import XCTest
@testable import SuiteCore

final class EffortTrainingTests: XCTestCase {
    func testExistingEVsCannotBeSilentlyResetAndIVsAreValidatedBeforeStart() throws {
        let pokemon = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"fingerprint":"[4,1,2,31,0,31,31,31,31]","level":25,"evs":{"hp":0,"attack":5,"defense":0,"speed":0,"spAttack":0,"spDefense":0},"ivs":{"hp":31,"attack":0,"defense":31,"speed":31,"spAttack":31,"spDefense":31}}"#.utf8))
        var draft = EffortTrainingDraft(pokemon: pokemon)
        XCTAssertNil(draft.validation)
        draft.evs["attack"] = 0
        XCTAssertNotNil(draft.validation)
        draft.evs["attack"] = 5
        draft.maxIvs["speed"] = 0
        XCTAssertNotNil(draft.validation)
        draft.maxIvs["speed"] = 31
        draft.maxIvs["attack"] = 0
        XCTAssertNil(draft.validation)
        XCTAssertEqual(draft.request["ivRanges"]["attack"]["max"], .number(0))
        XCTAssertEqual(draft.request["fingerprint"], pokemon["fingerprint"])
    }
}
